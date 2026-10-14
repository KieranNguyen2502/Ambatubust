// SLA OneMap API (official, Singapore Land Authority). Terms: Singapore Open Data Licence / OneMap Terms.
// - Search (/common/elastic/search) is public and needs no token.
// - Public-transport routing (/public/routingsvc/route) needs a Bearer JWT valid for ~3 days.
//   Tokens come from ONEMAP_EMAIL + ONEMAP_PASSWORD (auto-refreshed) or a manually pasted ONEMAP_STATIC_TOKEN.
// Routing itineraries are built from LTA GTFS schedules, so they are SCHEDULED data, not live positions.
import { env } from '@/lib/config/env';
import type { GeoPoint } from '@/types/commute';
import { toOneMapDateTime } from '@/lib/time';

const BASE = 'https://www.onemap.gov.sg/api';
const TIMEOUT_MS = 4000;

export type OneMapPlace = { name: string; stopCode?: string; lat?: number; lon?: number };
export type OneMapLeg = {
  mode: string; // WALK | BUS | SUBWAY | TRAM | ...
  route?: string;
  startTime: number; // epoch ms
  endTime: number;
  duration: number; // seconds
  distance: number; // metres
  from: OneMapPlace;
  to: OneMapPlace;
  intermediateStops?: unknown[];
  legGeometry?: { points?: string };
};
export type OneMapItinerary = {
  duration: number;
  startTime: number;
  endTime: number;
  walkTime: number;
  transitTime: number;
  waitingTime: number;
  walkDistance: number;
  transfers: number;
  legs: OneMapLeg[];
};

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Reads the `exp` claim (seconds) from a JWT without verifying it. */
function jwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function getToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.value;

  if (env.oneMapEmail && env.oneMapPassword) {
    const res = await fetch(`${BASE}/auth/post/getToken`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: env.oneMapEmail, password: env.oneMapPassword }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`OneMap login failed (${res.status})`);
    const json = await res.json();
    if (typeof json.access_token !== 'string') throw new Error('OneMap login returned no token');
    const expiresAt = Number(json.expiry_timestamp) * 1000 || jwtExpiry(json.access_token) || now + 60 * 60 * 1000;
    cachedToken = { value: json.access_token, expiresAt };
    return cachedToken.value;
  }

  if (env.oneMapStaticToken) {
    const expiresAt = jwtExpiry(env.oneMapStaticToken);
    if (expiresAt !== null && expiresAt <= now) {
      throw new Error('ONEMAP_STATIC_TOKEN has expired; generate a new one or set ONEMAP_EMAIL and ONEMAP_PASSWORD');
    }
    return env.oneMapStaticToken;
  }

  throw new Error('OneMap routing is not configured (set ONEMAP_EMAIL and ONEMAP_PASSWORD)');
}

export async function searchOneMap(query: string) {
  const url = `${BASE}/common/elastic/search?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`OneMap search failed (${res.status})`);
  return res.json();
}

/** Public-transport itineraries departing at `departAt`. OneMap ignores `arriveBy`, so callers pick the departure time. */
export async function routeOneMap(origin: GeoPoint, destination: GeoPoint, departAt: Date): Promise<OneMapItinerary[]> {
  const { date, time } = toOneMapDateTime(departAt);
  const params = new URLSearchParams({
    start: `${origin.lat},${origin.lon}`,
    end: `${destination.lat},${destination.lon}`,
    routeType: 'pt',
    date,
    time,
    mode: 'TRANSIT',
    numItineraries: '3',
  });
  const request = async (token: string) =>
    fetch(`${BASE}/public/routingsvc/route?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 300 },
    });

  let res = await request(await getToken());
  if (res.status === 401 && env.oneMapEmail) res = await request(await getToken(true));
  if (!res.ok) throw new Error(`OneMap routing failed (${res.status})`);
  const json = await res.json();
  const itineraries = json?.plan?.itineraries;
  if (!Array.isArray(itineraries)) throw new Error(json?.error ?? 'OneMap routing returned no itineraries');
  return itineraries as OneMapItinerary[];
}

/** Nearest addressed building to a point (needs a token). Returns null when nothing is within ~60 m. */
export async function reverseGeocodeOneMap(point: GeoPoint): Promise<{ label: string; detail: string } | null> {
  const params = new URLSearchParams({ location: `${point.lat},${point.lon}`, buffer: '60', addressType: 'All', otherFeatures: 'N' });
  const res = await fetch(`${BASE}/public/revgeocode?${params}`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: 86400 },
  });
  if (!res.ok) throw new Error(`OneMap reverse geocode failed (${res.status})`);
  const json = await res.json();
  const hit = json?.GeocodeInfo?.[0];
  if (!hit) return null;
  const clean = (v?: string) => (v && v !== 'NIL' ? v : '');
  const street = [clean(hit.BLOCK), clean(hit.ROAD)].filter(Boolean).join(' ');
  const label = clean(hit.BUILDINGNAME) || street || 'Pinned location';
  return { label, detail: [street, clean(hit.POSTALCODE) && `Singapore ${hit.POSTALCODE}`].filter(Boolean).join(', ') };
}
