import { NextResponse } from 'next/server';
import { reverseGeocodeOneMap } from '@/lib/adapters/onemap';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (!(lat >= 1.1 && lat <= 1.5 && lon >= 103.5 && lon <= 104.1)) {
    return NextResponse.json({ error: 'lat/lon must be inside Singapore' }, { status: 400 });
  }
  try {
    const place = await reverseGeocodeOneMap({ lat, lon });
    return NextResponse.json({ place, provenance: { source: 'OneMap', status: 'LIVE', fetchedAt: new Date().toISOString() } });
  } catch (error) {
    return NextResponse.json(
      { place: null, error: error instanceof Error ? error.message : 'Reverse geocoding unavailable', provenance: { source: 'OneMap', status: 'UNAVAILABLE', fetchedAt: null } },
      { status: 503 },
    );
  }
}
