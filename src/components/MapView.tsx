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
      mapRef.current = map;
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
      markersRef.current?.clearLayers();
      markersRef.current = null;
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
    <div
      ref={containerRef}
      data-testid="map"
      data-presence="map"
      role="region"
      aria-label="Carte"
      className="h-[420px] w-full border border-brand-ink/10"
    />
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
