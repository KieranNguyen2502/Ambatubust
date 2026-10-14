import { NextResponse } from 'next/server';
import { searchOneMap } from '@/lib/adapters/onemap';

type OneMapSearchResult = { SEARCHVAL: string; ADDRESS: string; LATITUDE: string; LONGITUDE: string };

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ results: [], error: 'Search must contain at least 2 characters' }, { status: 400 });
  }
  try {
    const data = await searchOneMap(query);
    const results = ((data.results ?? []) as OneMapSearchResult[])
      .map((r) => ({ label: r.SEARCHVAL, address: r.ADDRESS, lat: Number(r.LATITUDE), lon: Number(r.LONGITUDE) }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
      .slice(0, 8);
    return NextResponse.json({ results, provenance: { source: 'OneMap', status: 'LIVE', fetchedAt: new Date().toISOString() } });
  } catch (error) {
    return NextResponse.json(
      {
        results: [],
        error: error instanceof Error ? error.message : 'Location search unavailable',
        provenance: { source: 'OneMap', status: 'UNAVAILABLE', fetchedAt: null },
      },
      { status: 503 },
    );
  }
}
