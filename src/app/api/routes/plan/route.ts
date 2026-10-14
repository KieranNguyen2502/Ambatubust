import { NextResponse } from 'next/server';
import type { GeoPoint, TimeMode } from '@/types/commute';
import { env } from '@/lib/config/env';
import { planCommute } from '@/lib/routing/plan-commute';

const TIME_MODES: TimeMode[] = ['NOW', 'DEPART_AT', 'ARRIVE_BY'];

/** Accepts points inside a padded Singapore bounding box. */
function toPoint(value: unknown): GeoPoint | null {
  const p = value as { lat?: unknown; lon?: unknown } | null;
  const ok = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  return p && ok(p.lat, 1.1, 1.5) && ok(p.lon, 103.5, 104.1) ? { lat: p.lat, lon: p.lon } : null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });

  const origin = toPoint(body.origin);
  if (!origin) return NextResponse.json({ error: 'Choose a start point in Singapore' }, { status: 400 });
  const destination = toPoint(body.destination);
  if (!destination) return NextResponse.json({ error: 'Choose a destination in Singapore' }, { status: 400 });

  const timeMode: TimeMode = TIME_MODES.includes(body.timeMode) ? body.timeMode : 'NOW';
  const target = timeMode === 'NOW' ? new Date() : new Date(body.time);
  if (Number.isNaN(target.getTime())) return NextResponse.json({ error: 'time must be an ISO 8601 timestamp' }, { status: 400 });

  const plan = await planCommute(origin, destination, timeMode, target, { demoFallback: env.demoFallback });
  return NextResponse.json(plan);
}
