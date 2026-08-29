'use client';

/**
 * Leaflet map over the shared view state, styled in the source site's map
 * language: coral circle markers with white strokes; agent-driven results
 * flip to petrol with a yellow ring so the visitor sees who acted.
 *
 * Leak posture: the map and its layers are torn down with map.remove() on
 * unmount; markers live in one LayerGroup cleared (not re-created) per
 * update; the render cap bounds DOM nodes.
 */

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { Store, ViewState } from '@/lib/store';
import { getPresenceBus } from '@/lib/presence';
import { getSignalsLog, type PingKind } from '@/lib/signals';
import { getPulseStore } from '@/lib/pulse-client';
import { getViewportStore } from '@/lib/viewport';
import { getScoutStore, MAX_FINDINGS, type Mission } from '@/lib/scouts';
import { getShortlistStore } from '@/lib/shortlist';
import { fold } from '@/lib/types';
import { townCentroids } from '@/lib/centroids';
import { pickGlyph } from '@/lib/glyphs';
import { useTranslations } from 'next-intl';
import 'leaflet/dist/leaflet.css';

const MARKER_CAP = 400;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CORAL = '#EE6E62';
const PETROL = '#002731';
const YELLOW = '#FFE500';
/** One tint per scout body; brand family, distinct at a glance. */
const SCOUT_TINTS = [PETROL, CORAL, '#E63521', '#7A6A00'] as const;



export function MapView({ store, view }: { store: Store; view: ViewState }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);
  // The Leaflet import is async: highlights that arrive before init must be
  // drawn once the map exists, so readiness is state, not just a ref.
  const [mapReady, setMapReady] = useState(false);
  // Ping wheel (issue #608): opened by leaflet's contextmenu event, which
  // covers desktop right-click AND mobile long-press with one code path.
  const [wheel, setWheel] = useState<{ x: number; y: number; lat: number; lng: number } | null>(
    null,
  );
  const pingLayerRef = useRef<LayerGroup | null>(null);
  const pulseLayerRef = useRef<LayerGroup | null>(null);
  const scoutLayerRef = useRef<LayerGroup | null>(null);
  const t = useTranslations('scouts');
  const tl = useTranslations('legend');
  const [legendOpen, setLegendOpen] = useState(false);

  // Create once, destroy on unmount.
  useEffect(() => {
    let cancelled = false;
    let viewportTimer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current, {
        center: [view.center.lat, view.center.lng],
        zoom: view.zoom,
        zoomControl: true,
      });
      L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 18 }).addTo(map);
      markersRef.current = L.layerGroup().addTo(map);
      pingLayerRef.current = L.layerGroup().addTo(map);
      pulseLayerRef.current = L.layerGroup().addTo(map);
      scoutLayerRef.current = L.layerGroup().addTo(map);
      // Publish what the human is looking at (v3, issue #614). Debounced:
      // moveend fires once per gesture, but zoom + pan chains still cluster.
      const publishViewport = () => {
        if (viewportTimer) clearTimeout(viewportTimer);
        viewportTimer = setTimeout(() => {
          const b = map.getBounds();
          getViewportStore().setBounds(
            {
              north: b.getNorth(),
              south: b.getSouth(),
              east: b.getEast(),
              west: b.getWest(),
            },
            map.getZoom(),
          );
        }, 300);
      };
      map.on('moveend zoomend', publishViewport);
      publishViewport();
      map.on('contextmenu', (ev) => {
        const e = ev as { latlng: { lat: number; lng: number }; containerPoint: { x: number; y: number } };
        setWheel({ x: e.containerPoint.x, y: e.containerPoint.y, lat: e.latlng.lat, lng: e.latlng.lng });
      });
      mapRef.current = map;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      if (viewportTimer) clearTimeout(viewportTimer);
      markersRef.current?.clearLayers();
      markersRef.current = null;
      pingLayerRef.current?.clearLayers();
      pingLayerRef.current = null;
      pulseLayerRef.current?.clearLayers();
      pulseLayerRef.current = null;
      scoutLayerRef.current?.clearLayers();
      scoutLayerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the shared view state (agent- or human-driven).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setView([view.center.lat, view.center.lng], view.zoom, { animate: true });
  }, [view.center.lat, view.center.lng, view.zoom]);

  // One-shot camera frames (store.frameHighlighted): Leaflet picks the
  // optimal zoom via fitBounds; a zero-area frame (single point) gets a
  // sane town-level zoom through maxZoom.
  useEffect(() => {
    const map = mapRef.current;
    const frame = view.frame;
    if (!map || !frame || !mapReady) return;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (!mapRef.current) return;
      map.fitBounds(
        L.latLngBounds(
          [frame.south, frame.west],
          [frame.north, frame.east],
        ),
        { padding: [60, 60], maxZoom: 13, animate: true },
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.frame?.seq, mapReady]);

  const placePing = (kind: PingKind) => {
    if (!wheel) return;
    getSignalsLog().addPing(kind, wheel.lat, wheel.lng);
    void (async () => {
      const L = (await import('leaflet')).default;
      const layer = pingLayerRef.current;
      if (!layer) return;
      const glyph = kind === 'plus-comme-ca' ? '★' : kind === 'eviter' ? '✕' : '?';
      const tone = kind === 'plus-comme-ca' ? '#FFE500' : kind === 'eviter' ? '#002731' : '#EE6E62';
      L.marker([wheel.lat, wheel.lng], {
        interactive: false,
        icon: L.divIcon({
          className: 'ink-label-wrap',
          html: `<span class="ping-mark" style="--tone:${tone}">${glyph}</span>`,
          iconAnchor: [11, 11],
        }),
      }).addTo(layer);
      // Bounded: mirror SignalsLog's cap by trimming oldest layers.
      const layers = layer.getLayers();
      if (layers.length > 20 && layers[0]) layer.removeLayer(layers[0]);
    })();
    setWheel(null);
  };

  // Grounding ack (issue #608): when the agent reads the signals, it writes
  // a small acknowledgment at the latest ping.
  useEffect(() => {
    const bus = getPresenceBus();
    let ackTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = bus.subscribe(() => {
      const e = bus.last();
      if (e?.phase !== 'act' || e.tool !== 'get_visitor_signals' || !e.center) return;
      const map = mapRef.current;
      if (!map) return;
      void (async () => {
        const L = (await import('leaflet')).default;
        const ack = L.marker([e.center!.lat, e.center!.lng], {
          interactive: false,
          icon: L.divIcon({
            className: 'ink-label-wrap',
            html: '<span class="ink-label" style="--chars:6">vu ✓</span>',
            iconAnchor: [-14, 2],
          }),
        }).addTo(map);
        ackTimer = setTimeout(() => ack.remove(), 2600);
      })();
    });
    return () => {
      unsubscribe();
      if (ackTimer) clearTimeout(ackTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Les éclaireurs (v3, issue #612): scout bodies fan out to their findings,
  // plant evidence flags, and retire. Flags open a keep/dismiss popup; a
  // verdict updates the mission store and (kept) the shortlist. Leak posture:
  // every timeout is in one array cleared on new mission and unmount; the
  // scout layer is a single LayerGroup cleared, never re-created; movement
  // is CSS transition on the marker element (no rAF at all).
  const keepLabel = t('keep');
  const dismissLabel = t('dismiss');
  useEffect(() => {
    if (!mapReady) return;
    const scoutStore = getScoutStore();
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    let epoch = 0;
    let lastMissionId: string | null = null;
    // One drag listener per RUNNING mission: an interrupted mission must
    // detach its listener, or they accumulate one per replay (audit 8).
    let detachDrag: (() => void) | null = null;
    const reduced =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      detachDrag?.();
      detachDrag = null;
    };

    const play = () => {
      const mission = scoutStore.getSnapshot();
      const layer = scoutLayerRef.current;
      const map = mapRef.current;
      if (!mission || !layer || !map || mission.missionId === lastMissionId) return;
      lastMissionId = mission.missionId;
      const mine = ++epoch;
      clearTimers();
      void (async () => {
        const L = (await import('leaflet')).default;
        if (mine !== epoch || !mapRef.current) return;
        layer.clearLayers();
        const origin = map.getCenter();

        // The camera frames the whole mission before the scouts fly: bodies
        // were gliding out of view (field report 29 Aug, screenshot of scouts
        // beyond the frame).
        const allSpots: Array<[number, number]> = [];

        // Findings without coordinates flag at their town centroid, like the
        // marker layer (field bug 29 Aug: region wishes produced invisible
        // scouts because agenda records often carry no GPS point).
        const centroids = townCentroids(store.catalog, store.vocab);
        const spotOf = (
          f: Mission['reports'][number]['findings'][number],
        ): { lat: number; lng: number } | null => {
          if (f.lat !== null && f.lng !== null) return { lat: f.lat, lng: f.lng };
          const c = f.town ? centroids.get(fold(f.town)) : undefined;
          if (!c) return null;
          return { lat: c.lat + ((f.id % 7) - 3) * 0.0012, lng: c.lng + ((f.id % 5) - 2) * 0.0015 };
        };

        const plantFlag = (f: Mission['reports'][number]['findings'][number], tint: string) => {
          const spot = spotOf(f);
          if (!spot) return;
          const flag = L.marker([spot.lat, spot.lng], {
            icon: L.divIcon({
              className: 'scout-flag-wrap',
              html:
                `<span class="scout-flag-glyph" style="--tint:${tint}">${f.glyph}</span>` +
                `<span class="scout-flag" style="--tint:${tint}"></span>`,
              // The ROOT is the click target: it must cover the visuals
              // (12x12 default made the drawing unclickable — field bug).
              iconSize: [26, 40],
              iconAnchor: [13, 40],
            }),
          }).addTo(layer);
          // Popup content is BUILT, never innerHTML'd: names are catalogue
          // text headed for the DOM, textContent keeps them inert.
          const content = document.createElement('div');
          content.className = 'scout-popup';
          const title = document.createElement('p');
          title.className = 'scout-popup-title';
          title.textContent = f.name;
          const line = document.createElement('p');
          line.className = 'scout-popup-line';
          line.textContent = [f.town, f.d1 ?? f.upcoming?.date].filter(Boolean).join(' · ');
          const row = document.createElement('div');
          row.className = 'scout-popup-row';
          const keep = document.createElement('button');
          keep.type = 'button';
          keep.textContent = keepLabel;
          keep.className = 'scout-popup-keep';
          const dismiss = document.createElement('button');
          dismiss.type = 'button';
          dismiss.textContent = dismissLabel;
          dismiss.className = 'scout-popup-dismiss';
          keep.addEventListener('click', () => {
            scoutStore.setVerdict(f.id, 'kept');
            getShortlistStore().keep({
              id: f.id,
              name: f.name,
              town: f.town ?? '',
              url: f.url,
              d1: f.d1,
              d2: f.d2,
              img: f.img,
              glyph: f.glyph,
            });
            flag.getElement()?.classList.add('scout-flag-wrap--kept');
            flag.closePopup();
          });
          dismiss.addEventListener('click', () => {
            scoutStore.setVerdict(f.id, 'dismissed');
            getShortlistStore().remove(f.id);
            flag.closePopup();
            layer.removeLayer(flag);
          });
          row.append(keep, dismiss);
          content.append(title, line, row);
          flag.bindPopup(content, { closeButton: false, offset: [0, -40] });
        };

        for (const report of mission.reports) {
          for (const f of report.findings) {
            const spot = spotOf(f);
            if (spot) allSpots.push([spot.lat, spot.lng]);
          }
        }
        const frameMission = () => {
          if (allSpots.length === 0 || !mapRef.current) return;
          map.fitBounds(L.latLngBounds(allSpots), {
            padding: [60, 60],
            maxZoom: 12,
            animate: !reduced,
          });
        };
        frameMission();
        // Settle shot: once the last flag is planted, re-frame — UNLESS the
        // human moved the map during the flight (their hand wins, always).
        let humanMoved = false;
        const onDrag = () => {
          humanMoved = true;
        };
        map.on('dragstart', onDrag);
        detachDrag = () => map.off('dragstart', onDrag);
        const lastLanding =
          400 + mission.reports.length * 350 + MAX_FINDINGS * 1400 + 2200;
        timers.push(
          setTimeout(() => {
            detachDrag?.();
            detachDrag = null;
            if (mine === epoch && !humanMoved) frameMission();
          }, lastLanding),
        );

        mission.reports.forEach((report, i) => {
          const stops = report.findings.filter((f) => spotOf(f) !== null);
          if (stops.length === 0) return;
          const tint = SCOUT_TINTS[i % SCOUT_TINTS.length]!;
          if (reduced) {
            for (const f of stops) plantFlag(f, tint);
            return;
          }
          const body = L.marker(origin, {
            interactive: false,
            icon: L.divIcon({
              className: 'scout-body',
              html:
                `<span class="scout-nib" style="--tint:${tint}"></span>` +
                `<span class="scout-tag">${escapeHtml(report.label)}</span>`,
              iconAnchor: [11, 11],
            }),
          }).addTo(layer);
          stops.forEach((f, j) => {
            timers.push(
              setTimeout(() => {
                if (mine !== epoch) return;
                const spot = spotOf(f);
                if (!spot) return;
                body.setLatLng([spot.lat, spot.lng]);
                timers.push(
                  setTimeout(() => {
                    if (mine === epoch) plantFlag(f, tint);
                  }, 900),
                );
              }, 400 + i * 350 + j * 1400),
            );
          });
          timers.push(
            setTimeout(
              () => {
                if (mine === epoch) layer.removeLayer(body);
              },
              400 + i * 350 + stops.length * 1400 + 1200,
            ),
          );
        });
      })();
    };

    const unsubscribe = scoutStore.subscribe(play);
    play();
    return () => {
      epoch += 1;
      clearTimers();
      unsubscribe();
      scoutLayerRef.current?.clearLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, keepLabel, dismissLabel]);

  // The demand pulse layer (issue #609): towns swell with real agent demand,
  // coral for served requests, bright yellow for the invisible demand
  // (zero results). Centroids come from the catalogue itself; towns without
  // a resolvable centroid simply do not plot.
  useEffect(() => {
    const pulseStore = getPulseStore();
    // Epoch guard: draw() awaits the leaflet import, so two rapid pulse
    // updates could interleave clearLayers/addTo and paint duplicates. Only
    // the newest draw is allowed to touch the layer after its await.
    let epoch = 0;
    const draw = () => {
      const data = pulseStore.getSnapshot();
      const layer = pulseLayerRef.current;
      if (!data || !layer || !mapReady) return;
      const mine = ++epoch;
      void (async () => {
        const L = (await import('leaflet')).default;
        if (mine !== epoch) return;
        layer.clearLayers();
        // Town centroid: mean of the catalogue's own coordinates, memoized.
        const centroids = townCentroids(store.catalog, store.vocab);
        const max = Math.max(1, ...data.towns.map((t) => t.count));
        for (const t of data.towns) {
          const c = centroids.get(fold(t.town));
          if (!c) continue;
          const size = 18 + Math.round(30 * Math.sqrt(t.count / max));
          const invisible = t.zeroCount > 0 && t.zeroCount >= t.count / 2;
          L.marker([c.lat, c.lng], {
            interactive: false,
            icon: L.divIcon({
              className: 'ink-label-wrap',
              html: `<span class="demand-pulse ${invisible ? 'demand-pulse--invisible' : ''}" style="--size:${size}px" title="${t.count}"></span>`,
              iconAnchor: [size / 2, size / 2],
            }),
          }).addTo(layer);
        }
      })();
    };
    const unsubscribe = pulseStore.subscribe(draw);
    draw();
    return () => {
      epoch += 1; // strand any in-flight draw
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, store]);

  // Tool theatre (issue #607): find_near sweeps its radius on the shared map.
  // The temporary circle removes itself; timeouts are cleared on unmount.
  useEffect(() => {
    const bus = getPresenceBus();
    let sweepTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = bus.subscribe(() => {
      const e = bus.last();
      if (e?.phase !== 'act' || e.tool !== 'find_near' || !e.center || !e.radiusKm) return;
      const map = mapRef.current;
      if (!map) return;
      void (async () => {
        const L = (await import('leaflet')).default;
        const circle = L.circle([e.center!.lat, e.center!.lng], {
          radius: 200,
          color: '#002731',
          weight: 2,
          fillColor: '#FFE500',
          fillOpacity: 0.12,
          className: 'sweep-circle',
        }).addTo(map);
        const targetM = e.radiusKm! * 1000;
        const start = performance.now();
        const grow = () => {
          const t = Math.min(1, (performance.now() - start) / 900);
          circle.setRadius(200 + (targetM - 200) * t * t);
          if (t < 1 && mapRef.current) requestAnimationFrame(grow);
        };
        requestAnimationFrame(grow);
        sweepTimer = setTimeout(() => circle.remove(), 3200);
      })();
    });
    return () => {
      unsubscribe();
      if (sweepTimer) clearTimeout(sweepTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw highlighted markers.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import('leaflet')).default;
      const group = markersRef.current;
      if (cancelled || !group) return;
      group.clearLayers();
      const agentDriven = view.lastActor === 'agent';
      const places = store.catalog.places;
      let drawn = 0;
      // Coordinate fallback (field report 29 Aug: cited events invisible on
      // the map): a record without coordinates but with a town pins at the
      // town centroid, hollow-styled and labelled approximate, with a small
      // deterministic offset so stacked townmates stay distinguishable.
      const centroids = townCentroids(store.catalog, store.vocab);
      // A place that currently carries a scout flag must not ALSO get a
      // chip: two signs on one roof read as two places (field bug).
      const flagged = new Set(
        (getScoutStore().getSnapshot()?.reports ?? []).flatMap((r) => r.findings.map((f) => f.id)),
      );
      const coordsOf = (p: (typeof places)[number]): { lat: number; lng: number; approx: boolean } | null => {
        if (p.lat !== null && p.lng !== null) return { lat: p.lat, lng: p.lng, approx: false };
        const town = p.t >= 0 ? store.vocab.towns[p.t] : undefined;
        const c = town ? centroids.get(fold(town)) : undefined;
        if (!c) return null;
        const nudge = ((p.id % 7) - 3) * 0.0012;
        return { lat: c.lat + nudge, lng: c.lng + ((p.id % 5) - 2) * 0.0015, approx: true };
      };
      for (const i of view.highlighted) {
        if (drawn >= MARKER_CAP) break;
        const p = places[i];
        if (!p || flagged.has(p.id)) continue;
        const at = coordsOf(p);
        if (!at) continue;
        // Signature craft detail (issue #607): the agent labels its first
        // finds on the map, written letter by letter in brand ink.
        if (agentDriven && drawn < 5) {
          const label = L.marker([at.lat, at.lng], {
            interactive: false,
            icon: L.divIcon({
              className: 'ink-label-wrap',
              html: `<span class="ink-label" style="animation-delay:${drawn * 450}ms;--chars:${Math.min(p.n.length, 24)}">${escapeHtml(p.n.slice(0, 24))}</span>`,
              iconAnchor: [-10, 24],
            }),
          }).addTo(group);
          void label;
        }
        // The sign conveys the thing (field request 29 Aug): a pictogram
        // chip per record; the border still says who put it there.
        L.marker([at.lat, at.lng], {
          icon: L.divIcon({
            className: 'ink-label-wrap',
            html:
              `<span class="poi-chip${agentDriven ? ' poi-chip--agent' : ''}${at.approx ? ' poi-chip--approx' : ''}">` +
              `${pickGlyph(p, store.vocab)}</span>`,
            iconAnchor: [13, 13],
          }),
        })
          .bindPopup(
            `<span class="display-caps" style="font-size:12px;color:${PETROL}">${escapeHtml(p.n)}</span>` +
              (at.approx
                ? `<br/><span style="font-size:11px;color:#434343">position approximative (au bourg)</span>`
                : '') +
              `<br/><a href="https://www.myprovence.fr${escapeAttr(p.u)}" target="_blank" rel="noopener noreferrer" style="color:${CORAL}">myprovence.fr</a>`,
          )
          .addTo(group);
        drawn++;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, view.highlighted, view.lastActor, mapReady]);

  return (
    <div className="relative">
      <div className="relative">
        <div
          ref={containerRef}
          data-testid="map"
          data-presence="map"
          role="region"
          aria-label="Carte"
          className="h-[420px] w-full border border-brand-ink/10"
        />
        <button
          type="button"
          className="map-legend-toggle"
          aria-expanded={legendOpen}
          aria-label={tl('toggle')}
          onClick={() => setLegendOpen((v) => !v)}
        >
          ?
        </button>
        {legendOpen && (
        <div className="map-legend" data-testid="map-legend">
          <p>
            <span className="poi-chip">🛏</span> {tl('chip')}
          </p>
          <p>
            <span className="poi-chip poi-chip--agent">🧺</span> {tl('agentChip')}
          </p>
          <p>
            <span aria-hidden className="inline-block h-[18px] w-[4px] bg-brand-petrol" /> {tl('flag')}
          </p>
          <p>
            <span aria-hidden className="demand-pulse" style={{ ['--size' as string]: '18px' }} /> {tl('pulse')}
          </p>
        </div>
        )}
      </div>
      {wheel && (
        <div
          data-testid="ping-wheel"
          className="absolute z-[800] flex -translate-x-1/2 -translate-y-1/2 gap-1"
          style={{ left: wheel.x, top: wheel.y }}
          role="menu"
          aria-label="Pings"
        >
          {(
            [
              ['plus-comme-ca', '★', 'Plus comme ça ici'],
              ['eviter', '✕', 'Éviter cette zone'],
              ['question', '?', 'Curieux de cet endroit'],
            ] as const
          ).map(([kind, glyph, label]) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              title={label}
              className="display-caps h-9 w-9 border-2 border-brand-ink bg-brand-yellow text-[15px] text-brand-ink shadow-[2px_2px_0_#002731] hover:bg-brand-ink hover:text-brand-yellow"
              onClick={() => placePing(kind)}
            >
              {glyph}
            </button>
          ))}
          <button
            type="button"
            aria-label="Annuler"
            className="h-9 w-9 border-2 border-brand-ink/40 bg-white text-[13px] text-brand-ink/60"
            onClick={() => setWheel(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/** Popup HTML is built from catalogue text: escape it. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** Mean coordinates per folded town name, computed once per catalogue. */
