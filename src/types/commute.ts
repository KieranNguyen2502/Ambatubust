export type DataStatus = 'LIVE' | 'CACHED' | 'SCHEDULED' | 'ESTIMATED' | 'UNAVAILABLE';

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export type Lesson = {
  id: string;
  moduleCode: string;
  moduleTitle?: string;
  lessonType: string;
  classNo: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // "HH:MM", Singapore time
  endTime: string;
  weeks: number[];
  rawVenue: string;
};

export type GeoPoint = { lat: number; lon: number };

/** A start or destination chosen by search, NUS venue, map pin or device location. */
export type Place = GeoPoint & { label: string; detail?: string; kind: 'search' | 'venue' | 'pin' | 'gps'; venueCode?: string };

export type TimeMode = 'NOW' | 'DEPART_AT' | 'ARRIVE_BY';

export type Provenance = {
  source: string;
  status: DataStatus;
  fetchedAt: string | null; // ISO 8601
  warningMessage?: string;
};

export type NeutralTag = 'Fastest by estimate' | 'Fewest transfers' | 'Least walking';

export type LegMode = 'WALK' | 'BUS' | 'RAIL' | 'NUS_SHUTTLE' | 'OTHER';

export type RouteLeg = {
  mode: LegMode;
  service?: string;
  fromName: string;
  fromStopCode?: string;
  toName: string;
  toStopCode?: string;
  departureIso: string;
  arrivalIso: string;
  durationSeconds: number;
  distanceMeters: number;
  stopCount?: number;
  fromCoords: [number, number]; // [lon, lat]
  toCoords: [number, number];
  path: [number, number][]; // [lon, lat] polyline; straight line when OneMap gives no geometry
};

export type PlannedRoute = {
  id: string;
  summary: string;
  tags: NeutralTag[];
  departureIso: string;
  arrivalIso: string;
  arrivalRange: { earliestIso: string; latestIso: string };
  durationSeconds: number;
  walkSeconds: number;
  walkMeters: number;
  waitSeconds: number;
  rideSeconds: number;
  transferBufferSeconds: number;
  transfers: number;
  publicServices: string[];
  nusShuttles: string[];
  legs: RouteLeg[];
  crowding: string;
  arrivesAfterClassStart: boolean;
  mayArriveAfterClassStart: boolean;
  provenance: Provenance[];
  warnings: string[];
};

export type PlanResponse = {
  routes: PlannedRoute[];
  status: DataStatus;
  timeMode: TimeMode;
  targetIso: string; // departure time (NOW / DEPART_AT) or required arrival time (ARRIVE_BY)
  arriveByPassed: boolean; // ARRIVE_BY only: the target time (e.g. class start) has already passed
  fetchedAt: string;
  warnings: string[];
};
