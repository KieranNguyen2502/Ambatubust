// NUSMods API v2 (community-operated). Public, unauthenticated, cached for 24 h.
import { NextResponse } from 'next/server';
import { env } from '@/lib/config/env';

export async function GET(_: Request, { params }: { params: { code: string } }) {
  const code = params.code.trim().toUpperCase();
  if (!/^[A-Z]{2,4}\d{4}[A-Z]{0,4}$/.test(code)) {
    return NextResponse.json({ error: `"${params.code}" is not a valid module code`, status: 'UNAVAILABLE' }, { status: 400 });
  }
  try {
    const response = await fetch(`${env.nusmodsBaseUrl}/${env.acadYear}/modules/${code}.json`, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 86400 },
    });
    if (response.status === 404) {
      return NextResponse.json({ error: `${code} is not offered in AY${env.acadYear}`, status: 'UNAVAILABLE' }, { status: 404 });
    }
    if (!response.ok) return NextResponse.json({ error: 'NUSMods is unavailable', status: 'UNAVAILABLE' }, { status: 502 });
    return NextResponse.json(await response.json(), { headers: { 'X-Data-Source': 'NUSMods API v2' } });
  } catch {
    return NextResponse.json({ error: 'NUSMods is unavailable', status: 'UNAVAILABLE' }, { status: 503 });
  }
}
