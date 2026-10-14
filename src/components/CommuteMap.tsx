'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoPoint, Place, PlannedRoute } from '@/types/commute';
import { formatSgtTime } from '@/lib/time';
import { MODE_COLORS, type LiveBus } from '@/components/map-style';

type Role = 'origin' | 'destination';

type Props = {
  origin: Place | null;
  destination: Place | null;
  routes: PlannedRoute[];
  selectedRouteId: string | null;
  userLocation: (GeoPoint & { accuracy: number }) | null;
  liveBuses: LiveBus[];
  onPick: (role: Role, point: GeoPoint) => void;
  onSelectRoute: (id: string) => void;
};

const NUS: [number, number] = [103.7764, 1.2966];
const SINGAPORE_BOUNDS: [[number, number], [number, number]] = [
  [103.55, 1.15],
  [104.1, 1.48],
];

// OneMap basemap (official, Singapore Land Authority). Attribution wording and logo are required by OneMap's terms.
const ONEMAP_ATTRIBUTION =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:16px;width:16px;vertical-align:middle" alt=""/> ' +
  '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors &#124; ' +
  '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';

function el(className: string, text = ''): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return div;
}

function routesGeoJson(routes: PlannedRoute[], selectedId: string | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((route) =>
      route.legs
        .filter((leg) => leg.path.length >= 2)
        .map((leg) => ({
          type: 'Feature' as const,
          properties: { routeId: route.id, mode: leg.mode, selected: route.id === selectedId },
          geometry: { type: 'LineString' as const, coordinates: leg.path },
        })),
    ),
  };
}

export default function CommuteMap(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const callbacks = useRef(props);
  callbacks.current = props;

  const originMarker = useRef<Marker | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  const userMarker = useRef<Marker | null>(null);
  const labelMarkers = useRef<Marker[]>([]);
  const busMarkers = useRef<Marker[]>([]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          onemap: {
            type: 'raster',
            tiles: ['https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 11,
            maxzoom: 19,
            attribution: ONEMAP_ATTRIBUTION,
          },
        },
        layers: [{ id: 'onemap', type: 'raster', source: 'onemap' }],
      },
      center: NUS,
      zoom: 13,
      minZoom: 11,
      maxZoom: 19,
      maxBounds: SINGAPORE_BOUNDS,
      attributionControl: { compact: false },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('routes', { type: 'geojson', data: routesGeoJson([], null) });
      map.addLayer({
        id: 'routes-other',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'selected'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#94a3b8', 'line-width': 5, 'line-opacity': 0.7 },
      });
      map.addLayer({
        id: 'routes-casing',
        type: 'line',
        source: 'routes',
        filter: ['all', ['==', ['get', 'selected'], true], ['!=', ['get', 'mode'], 'WALK']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 10 },
      });
      map.addLayer({
        id: 'routes-transit',
        type: 'line',
        source: 'routes',
        filter: ['all', ['==', ['get', 'selected'], true], ['!=', ['get', 'mode'], 'WALK']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 6,
          'line-color': ['match', ['get', 'mode'], 'BUS', MODE_COLORS.BUS, 'RAIL', MODE_COLORS.RAIL, 'NUS_SHUTTLE', MODE_COLORS.NUS_SHUTTLE, MODE_COLORS.OTHER],
        },
      });
      map.addLayer({
        id: 'routes-walk',
        type: 'line',
        source: 'routes',
        filter: ['all', ['==', ['get', 'selected'], true], ['==', ['get', 'mode'], 'WALK']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': MODE_COLORS.WALK, 'line-width': 4, 'line-dasharray': [0.1, 1.8] },
      });

      for (const layer of ['routes-other', 'routes-transit', 'routes-walk']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      setLoaded(true);
    });

    // Clicking a route selects it; clicking elsewhere offers "Start here" / "Go here".
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['routes-other', 'routes-transit', 'routes-walk'] })[0];
      if (hit?.properties?.routeId) {
        callbacks.current.onSelectRoute(String(hit.properties.routeId));
        return;
      }
      const point = { lat: e.lngLat.lat, lon: e.lngLat.lng };
      const box = el('pick-popup');
      const popup = new maplibregl.Popup({ closeButton: true, offset: 8 }).setLngLat(e.lngLat).setDOMContent(box).addTo(map);
      for (const [role, text] of [
        ['origin', 'Start here'],
        ['destination', 'Go here'],
      ] as [Role, string][]) {
        const button = document.createElement('button');
        button.textContent = text;
        button.className = role === 'origin' ? 'pick-origin' : 'pick-destination';
        button.addEventListener('click', () => {
          callbacks.current.onPick(role, point);
          popup.remove();
        });
        box.appendChild(button);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Start / destination pins (draggable).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = (ref: React.MutableRefObject<Marker | null>, place: Place | null, role: Role, label: string) => {
      if (!place) {
        ref.current?.remove();
        ref.current = null;
        return;
      }
      if (!ref.current) {
        ref.current = new maplibregl.Marker({ element: el(`pin pin-${role}`, label), draggable: true });
        ref.current.on('dragend', () => {
          const p = ref.current!.getLngLat();
          callbacks.current.onPick(role, { lat: p.lat, lon: p.lng });
        });
        ref.current.setLngLat([place.lon, place.lat]).addTo(map);
      } else {
        ref.current.setLngLat([place.lon, place.lat]);
      }
    };
    sync(originMarker, props.origin, 'origin', 'A');
    sync(destinationMarker, props.destination, 'destination', 'B');

    // Without routes, keep both pins in view.
    if (!props.routes.length) {
      const pts = [props.origin, props.destination].filter(Boolean) as Place[];
      if (pts.length === 1) map.easeTo({ center: [pts[0].lon, pts[0].lat], zoom: Math.max(map.getZoom(), 14) });
      if (pts.length === 2) {
        map.fitBounds(
          [
            [Math.min(pts[0].lon, pts[1].lon), Math.min(pts[0].lat, pts[1].lat)],
            [Math.max(pts[0].lon, pts[1].lon), Math.max(pts[0].lat, pts[1].lat)],
          ],
          { padding: 80, maxZoom: 16 },
        );
      }
    }
  }, [props.origin, props.destination, props.routes.length]);

  // Fit to all routes when a new plan arrives.
  useEffect(() => {
    const map = mapRef.current;
    const coords = props.routes.flatMap((r) => r.legs.flatMap((l) => l.path));
    if (!map || !coords.length) return;
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    map.fitBounds(bounds, { padding: 70, maxZoom: 16 });
  }, [props.routes]);

  // Route lines and time labels for the selected route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource('routes') as GeoJSONSource).setData(routesGeoJson(props.routes, props.selectedRouteId));

    labelMarkers.current.forEach((m) => m.remove());
    labelMarkers.current = [];
    const route = props.routes.find((r) => r.id === props.selectedRouteId);
    if (!route) return;
    for (const leg of route.legs) {
      if (leg.mode === 'WALK') continue;
      const service =
        leg.mode === 'BUS' ? `Bus ${leg.service ?? ''}` : leg.mode === 'RAIL' ? `MRT ${leg.service ?? ''}` : leg.mode === 'NUS_SHUTTLE' ? `ISB ${leg.service ?? ''}` : leg.service ?? '';
      const board = el('time-label', `${formatSgtTime(leg.departureIso)} · ${service.trim()}`);
      board.style.borderColor = MODE_COLORS[leg.mode] ?? MODE_COLORS.OTHER;
      const alight = el('time-label subtle', `${formatSgtTime(leg.arrivalIso)} · alight`);
      labelMarkers.current.push(
        new maplibregl.Marker({ element: board, anchor: 'bottom-left', offset: [6, -6] }).setLngLat(leg.fromCoords).addTo(map),
        new maplibregl.Marker({ element: alight, anchor: 'top-left', offset: [6, 6] }).setLngLat(leg.toCoords).addTo(map),
      );
    }
    const last = route.legs[route.legs.length - 1];
    if (last) {
      labelMarkers.current.push(
        new maplibregl.Marker({ element: el('time-label arrive', `Arrive ${formatSgtTime(route.arrivalIso)}`), anchor: 'top', offset: [0, 8] })
          .setLngLat(last.toCoords)
          .addTo(map),
      );
    }
  }, [loaded, props.routes, props.selectedRouteId]);

  // Device location (live, only after the user opts in).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.userLocation) {
      userMarker.current?.remove();
      userMarker.current = null;
      return;
    }
    if (!userMarker.current) userMarker.current = new maplibregl.Marker({ element: el('user-dot') }).setLngLat([props.userLocation.lon, props.userLocation.lat]).addTo(map);
    else userMarker.current.setLngLat([props.userLocation.lon, props.userLocation.lat]);
  }, [props.userLocation]);

  // Live bus positions from LTA (only buses LTA is GPS-tracking).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    busMarkers.current.forEach((m) => m.remove());
    busMarkers.current = props.liveBuses.map((bus) => {
      const isb = bus.kind === 'ISB';
      const text = isb
        ? `ISB ${bus.serviceNo} · estimated position ${bus.errorBoundM ? `±${bus.errorBoundM} m` : 'at or near a stop'} (from arrival countdowns, not GPS)`
        : `Bus ${bus.serviceNo} · ${bus.minutes ?? '?'} min away (LTA live GPS)`;
      const marker = el(isb ? 'bus-dot isb' : 'bus-dot', isb ? `≈${bus.serviceNo}` : bus.serviceNo);
      marker.title = text;
      return new maplibregl.Marker({ element: marker }).setLngLat([bus.lon, bus.lat]).setPopup(new maplibregl.Popup({ offset: 10 }).setText(text)).addTo(map);
    });
  }, [props.liveBuses]);

  return <div ref={containerRef} className="map" aria-label="Route map" />;
}
