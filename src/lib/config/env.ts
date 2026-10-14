// Server-only configuration. Never import this from client components.
export const env = {
  nusmodsBaseUrl: process.env.NUSMODS_API_BASE_URL || 'https://api.nusmods.com/v2',
  acadYear: process.env.NUSMODS_ACAD_YEAR || '2026-2027',
  shuttleBaseUrl: process.env.NUS_SHUTTLE_API_BASE_URL ?? '',
  shuttleAuthHeader: process.env.NUS_SHUTTLE_AUTH_HEADER ?? '',
  ltaKey: process.env.LTA_ACCOUNT_KEY ?? '',
  oneMapEmail: process.env.ONEMAP_EMAIL ?? '',
  oneMapPassword: process.env.ONEMAP_PASSWORD ?? '',
  oneMapStaticToken: process.env.ONEMAP_STATIC_TOKEN ?? '',
  demoFallback: process.env.ENABLE_DEMO_FALLBACK_SNAPSHOTS === 'true',
};
