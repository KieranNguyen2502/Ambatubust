export type DataStatus = 'LIVE' | 'CACHED' | 'SCHEDULED' | 'ESTIMATED' | 'UNAVAILABLE';
export type Lesson = { id: string; moduleCode: string; moduleTitle?: string; lessonType: string; classNo: string; dayOfWeek: string; startTime: string; endTime: string; weeks: number[]; rawVenue: string; resolvedBuildingId: string | null };
export type Provenance = { source: string; status: DataStatus; fetchedAt: string | null; warningMessage?: string };
export type PlannedRoute = { id: string; summary: string; departure: string; arrival: string; arrivalRange: string; durationMinutes: number; walkingMinutes: number; waitingMinutes: number; transfers: number; services: string[]; crowding: string; provenance: Provenance[]; warnings: string[] };
