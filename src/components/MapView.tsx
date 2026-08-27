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
