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
import { fold } from '@/lib/types';
import 'leaflet/dist/leaflet.css';

const MARKER_CAP = 400;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CORAL = '#EE6E62';
const PETROL = '#002731';
const YELLOW = '#FFE500';

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

  // Create once, destroy on unmount.
  useEffect(() => {
    let cancelled = false;
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
      map.on('contextmenu', (ev) => {
        const e = ev as { latlng: { lat: number; lng: number }; containerPoint: { x: number; y: number } };
        setWheel({ x: e.containerPoint.x, y: e.containerPoint.y, lat: e.latlng.lat, lng: e.latlng.lng });
      });
      mapRef.current = map;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      markersRef.current?.clearLayers();
      markersRef.current = null;
      pingLayerRef.current?.clearLayers();
      pingLayerRef.current = null;
      pulseLayerRef.current?.clearLayers();
      pulseLayerRef.current = null;
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
        const centroids = townCentroids(store);
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
      for (const i of view.highlighted) {
        if (drawn >= MARKER_CAP) break;
        const p = places[i];
        if (!p || p.lat === null || p.lng === null) continue;
        // Signature craft detail (issue #607): the agent labels its first
        // finds on the map, written letter by letter in brand ink.
        if (agentDriven && drawn < 5) {
          const label = L.marker([p.lat, p.lng], {
            interactive: false,
            icon: L.divIcon({
              className: 'ink-label-wrap',
              html: `<span class="ink-label" style="animation-delay:${drawn * 450}ms;--chars:${Math.min(p.n.length, 24)}">${escapeHtml(p.n.slice(0, 24))}</span>`,
              iconAnchor: [-10, 24],
            }),
          }).addTo(group);
          void label;
        }
        L.circleMarker([p.lat, p.lng], {
          radius: 8,
          weight: agentDriven ? 3 : 2,
          color: agentDriven ? YELLOW : '#ffffff',
          fillColor: agentDriven ? PETROL : CORAL,
          fillOpacity: 0.95,
        })
          .bindPopup(
            `<span class="display-caps" style="font-size:12px;color:${PETROL}">${escapeHtml(p.n)}</span>` +
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
      <div
        ref={containerRef}
        data-testid="map"
        data-presence="map"
        role="region"
        aria-label="Carte"
        className="h-[420px] w-full border border-brand-ink/10"
      />
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
const centroidCache = new WeakMap<object, Map<string, { lat: number; lng: number }>>();
function townCentroids(store: Store): Map<string, { lat: number; lng: number }> {
  const key = store.catalog;
  const cached = centroidCache.get(key);
  if (cached) return cached;
  const sums = new Map<string, { lat: number; lng: number; n: number }>();
  store.catalog.places.forEach((p) => {
    if (p.lat === null || p.lng === null || p.t < 0) return;
    const town = fold(store.vocab.towns[p.t] ?? '');
    if (!town) return;
    const e = sums.get(town) ?? { lat: 0, lng: 0, n: 0 };
    e.lat += p.lat;
    e.lng += p.lng;
    e.n += 1;
    sums.set(town, e);
  });
  const out = new Map<string, { lat: number; lng: number }>();
  for (const [town, e] of sums) out.set(town, { lat: e.lat / e.n, lng: e.lng / e.n });
  centroidCache.set(key, out);
  return out;
}
