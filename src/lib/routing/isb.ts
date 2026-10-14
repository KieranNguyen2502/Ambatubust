// Deterministic NUS shuttle (ISB) calculations. No network access here; see src/lib/adapters/shuttle.ts.
import type { GeoPoint } from '@/types/commute';
import type { IsbArrival, IsbLine, IsbNetwork, IsbStop } from '@/lib/adapters/shuttle';

export const WALK_SPEED_MPS = 1.25; // 4.5 km/h, ARCHITECTURE.md §6
export const WALK_DETOUR_FACTOR = 1.3; // straight-line → path distance; walking legs to/from ISB stops are estimates
export const FALLBACK_SHUTTLE_KMH = 18; // only when the proxy has no learned time for a segment

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Estimated walk between two points: straight line × detour factor at walking pace. */
export function estimateWalk(a: GeoPoint, b: GeoPoint): { meters: number; seconds: number } {
  const meters = Math.round(distanceMeters(a, b) * WALK_DETOUR_FACTOR);
  return { meters, seconds: Math.ceil(meters / WALK_SPEED_MPS) };
}

export function nearbyStops(network: IsbNetwork, point: GeoPoint, maxMeters: number, limit = 4): (IsbStop & { meters: number })[] {
  return network.stops
    .map((s) => ({ ...s, meters: distanceMeters(point, s) }))
    .filter((s) => s.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

export type IsbRide = {
  line: string;
  boardCode: string;
  alightCode: string;
  seconds: number;
  stopCount: number;
  meters: number;
  path: [number, number][]; // [lon, lat]
  estimatedSegments: number; // segments without a learned time
};

/**
 * Ride on `line` from `boardCode` to the next `alightCode` in travel direction.
 * Closed (loop) lines may wrap past the terminal; open lines may not.
 */
export function isbRide(network: IsbNetwork, line: IsbLine, boardCode: string, alightCode: string): IsbRide | null {
  const seq = line.stops;
  const last = seq.length - 1;
  // A loop line lists its terminal twice (first and last); positions 0..n-1 are distinct and wrap.
  const loop = line.closed && last > 0 && seq[0].code === seq[last].code;
  const n = loop ? last : seq.length;
  const position = (p: number) => (loop ? p % n : p);

  let best: { from: number; hops: number } | null = null;
  for (let from = 0; from < n; from++) {
    if (seq[from].code !== boardCode) continue;
    const maxHops = loop ? n - 1 : last - from;
    for (let hops = 1; hops <= maxHops; hops++) {
      if (seq[position(from + hops)].code !== alightCode) continue;
      if (!best || hops < best.hops) best = { from, hops };
      break;
    }
  }
  if (!best) return null;

  let seconds = 0;
  let meters = 0;
  let estimatedSegments = 0;
  for (let step = 0; step < best.hops; step++) {
    const p = position(best.from + step); // segment p+1 runs from seq[p] to seq[p+1]
    const segMeters = Math.max(0, seq[p + 1].arcM - seq[p].arcM);
    meters += segMeters;
    const learned = network.segmentMinutes[`${line.line}|${p + 1}`];
    if (typeof learned === 'number' && Number.isFinite(learned)) seconds += learned * 60;
    else {
      seconds += segMeters / ((FALLBACK_SHUTTLE_KMH * 1000) / 3600);
      estimatedSegments++;
    }
  }

  const startArc = seq[best.from].arcM;
  return {
    line: line.line,
    boardCode,
    alightCode,
    seconds: Math.round(seconds),
    stopCount: best.hops,
    meters: Math.round(meters),
    path: slicePath(line, startArc, startArc + meters),
    estimatedSegments,
  };
}

/** Sub-polyline between two arc distances (metres) along a line; wraps for loop lines. */
export function slicePath(line: IsbLine, fromArc: number, toArc: number): [number, number][] {
  const pts = line.path;
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + distanceMeters({ lon: pts[i - 1][0], lat: pts[i - 1][1] }, { lon: pts[i][0], lat: pts[i][1] }));
  }
  const scale = line.lengthM > 0 ? cum[cum.length - 1] / line.lengthM : 1; // align proxy arcs with geometry
  const total = cum[cum.length - 1];

  const pointAt = (arc: number): [number, number] => {
    const d = Math.min(Math.max(arc, 0), total);
    let i = cum.findIndex((c) => c >= d);
    if (i <= 0) return pts[0];
    const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  const segment = (a: number, b: number): [number, number][] => [pointAt(a), ...pts.filter((_, i) => cum[i] > a && cum[i] < b), pointAt(b)];

  const a = fromArc * scale;
  const b = toArc * scale;
  if (b <= total || !line.closed) return segment(a, Math.min(b, total));
  return [...segment(a, total), ...segment(0, b - total).slice(1)];
}

export type IsbWait = {
  seconds: number;
  low: number; // seconds below the estimate
  high: number; // seconds above the estimate
  status: 'LIVE' | 'ESTIMATED';
  bus: IsbArrival | null;
  note: string;
};

/**
 * Wait for `line` at a stop reached at `reachMs`.
 * LIVE: the reach time falls within the reported countdowns (ARCHITECTURE.md §6 live formula).
 * ESTIMATED: beyond the countdown horizon, half the currently observed headway, range [0, headway].
 * Returns null when no bus on the line is reported (it may not be running), so nothing is invented.
 */
export function isbWait(arrivals: IsbArrival[], line: string, reachMs: number): IsbWait | null {
  const etas = arrivals
    .filter((a) => a.line === line)
    .map((a) => ({ ...a, ms: new Date(a.etaIso).getTime() }))
    .sort((a, b) => a.ms - b.ms);
  if (!etas.length) return null;

  const idx = etas.findIndex((e) => e.ms >= reachMs);
  if (idx >= 0) {
    const bus = etas[idx];
    const seconds = Math.round((bus.ms - reachMs) / 1000);
    const next = etas[idx + 1];
    // Within 60 s of the bus: it may be missed, so the upper bound extends to the following bus.
    const high = seconds < 60 && next ? Math.round((next.ms - reachMs) / 1000) - seconds : 120;
    return { seconds, low: Math.min(60, seconds), high, status: 'LIVE', bus, note: `live countdown` };
  }

  const gaps = etas.slice(1).map((e, i) => e.ms - etas[i].ms).filter((g) => g > 0);
  if (!gaps.length) return null;
  const headway = Math.round(gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] / 1000);
  const seconds = Math.round(headway / 2);
  return { seconds, low: seconds, high: headway - seconds, status: 'ESTIMATED', bus: null, note: `estimated from current ~${Math.round(headway / 60)} min headway` };
}
