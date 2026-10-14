import type { GeoPoint } from '@/types/commute';

/** Leg colours shared by the map and the route cards. */
export const MODE_COLORS: Record<string, string> = {
  WALK: '#475569',
  BUS: '#2563eb',
  RAIL: '#9333ea',
  NUS_SHUTTLE: '#ea580c',
  OTHER: '#0f766e',
};

/**
 * A vehicle drawn on the map. LTA positions are GPS (only for monitored buses);
 * NUS shuttle positions are dead-reckoned estimates with an error bound and must be labelled as such.
 */
export type LiveBus = GeoPoint & { kind: 'LTA' | 'ISB'; serviceNo: string; minutes: number | null; errorBoundM?: number };
