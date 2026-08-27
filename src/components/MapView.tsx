'use client';

/**
 * Leaflet map over the shared view state. Leak posture: the map instance and
 * its layers are torn down with map.remove() on unmount; markers live in one
 * LayerGroup that is cleared (not re-created) on every update; the render cap
 * keeps a "highlight everything" call from creating thousands of DOM nodes.
 */

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import type { Store, ViewState } from '@/lib/store';
import 'leaflet/dist/leaflet.css';

const MARKER_CAP = 400;
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function MapView({ store, view }: { store: Store; view: ViewState }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);

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

  // Redraw highlighted markers.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import('leaflet')).default;
      const group = markersRef.current;
      if (cancelled || !group) return;
      group.clearLayers();
      const places = store.catalog.places;
      let drawn = 0;
      for (const i of view.highlighted) {
        if (drawn >= MARKER_CAP) break;
        const p = places[i];
        if (!p || p.lat === null || p.lng === null) continue;
        L.circleMarker([p.lat, p.lng], {
          radius: 6,
          weight: 1.5,
          color: view.lastActor === 'agent' ? '#7c3aed' : '#0f766e',
          fillColor: view.lastActor === 'agent' ? '#a78bfa' : '#2dd4bf',
          fillOpacity: 0.7,
        })
          .bindPopup(
            `<strong>${escapeHtml(p.n)}</strong><br/><a href="https://www.myprovence.fr${escapeAttr(p.u)}" target="_blank" rel="noopener noreferrer">myprovence.fr</a>`,
          )
          .addTo(group);
        drawn++;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, view.highlighted, view.lastActor]);

  return (
    <div
      ref={containerRef}
      data-testid="map"
      role="region"
      aria-label="Carte"
      className="h-[380px] w-full overflow-hidden rounded-lg border border-stone-200 shadow-sm"
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
