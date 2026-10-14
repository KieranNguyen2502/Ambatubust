// Venue coordinates come from the NUSMods venues dataset (community-operated, MIT licence),
// bundled in src/data/nusmods-venues.json so resolution works offline. See that file for source and retrieval date.
import venueData from '@/data/nusmods-venues.json';

const venues = venueData.venues as unknown as Record<string, [number, number, string]>;

export type VenueResolution =
  | { status: 'RESOLVED'; venueCode: string; roomName: string; buildingCode: string; lat: number; lon: number }
  | { status: 'ONLINE'; venueCode: string }
  | { status: 'UNKNOWN'; venueCode: string };

export const venueDataRetrievedAt = venueData.retrievedAt;

export function resolveVenue(raw: string): VenueResolution {
  const venueCode = raw.trim();
  const upper = venueCode.toUpperCase();
  if (!upper || upper === 'UNKNOWN') return { status: 'UNKNOWN', venueCode };
  if (/E-?LEARN|ONLINE|ZOOM|VIRTUAL/.test(upper)) return { status: 'ONLINE', venueCode };

  const key = venueCode in venues ? venueCode : Object.keys(venues).find((k) => k.toUpperCase() === upper);
  if (!key) return { status: 'UNKNOWN', venueCode };
  const [lat, lon, roomName] = venues[key];
  return { status: 'RESOLVED', venueCode: key, roomName, buildingCode: key.split('-')[0], lat, lon };
}

/** Matches NUS venues by code prefix ("COM1", "LT17") or room-name words ("lecture theatre 17"). */
export function searchVenues(query: string, limit = 5): Extract<VenueResolution, { status: 'RESOLVED' }>[] {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/);
  const scored: [number, string][] = [];
  for (const [code, [, , roomName]] of Object.entries(venues)) {
    const upperCode = code.toUpperCase();
    const upperName = roomName.toUpperCase();
    let score = 0;
    if (upperCode === q) score = 3;
    else if (upperCode.startsWith(q)) score = 2;
    else if (words.every((w) => upperName.includes(w) || upperCode.includes(w))) score = 1;
    if (score) scored.push([score, code]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1], 'en', { numeric: true }))
    .slice(0, limit)
    .map(([, code]) => resolveVenue(code) as Extract<VenueResolution, { status: 'RESOLVED' }>);
}
