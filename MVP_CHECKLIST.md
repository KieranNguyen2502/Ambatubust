# MVP Implementation & Verification Checklist (`MVP_CHECKLIST.md`)

## 1. Milestones Progress

- [ ] **Milestone 1: Project Scaffold** — Next.js App Router, TypeScript, Tailwind CSS, Vitest, core schemas
- [ ] **Milestone 2: Static Route & Map Prototype** — 2-column layout, MapLibre GL map, multi-leg GeoJSON rendering
- [ ] **Milestone 3: Timetable Input / Import** — NUSMods share link parser, `.ics` upload, manual entry, `localStorage`
- [ ] **Milestone 4: NUS Destination Mapping** — Curated `nus-buildings.json`, NUSMods `venues.json` lookup, manual building fallback
- [ ] **Milestone 5: Public Transport Integration** — OneMap Search geocoding & OneMap PT routing adapter + JWT caching
- [ ] **Milestone 6: NUS Shuttle Integration** — Static ISB route/stop/headway registry (`A1`, `A2`, `D1`, `D2`, `K`, `E`, `BTC`, `L`) + live adapter with fallback
- [ ] **Milestone 7: Route Combination & Transfer Logic** — Gateway hub stitcher & deterministic duration/range calculator
- [ ] **Milestone 8: Live Arrival & Crowding Data** — LTA DataMall `BusArrival v3` (`SEA`/`SDA`/`LSD`, `Monitored`) + LRU cache
- [ ] **Milestone 9: Route Comparison UI** — Neutral comparison cards, trade-off badges, detail timeline, optional departure reminder
- [ ] **Milestone 10: Fallback Data & Error Handling** — Explicit unavailable/scheduled banners + Demo Snapshot mode
- [ ] **Milestone 11: Deployment** — Production build & deployment verification
- [ ] **Milestone 12: Demo Preparation** — Preset student personas, demo clock override, 3-minute script verification

## 2. Mandatory Route Card Information Audit

Every route displayed in the UI must show:
- [ ] Route name or summary
- [ ] Departure time
- [ ] Estimated arrival time
- [ ] Estimated travel duration
- [ ] Estimated arrival-time range or uncertainty (`[Earliest - Latest]`)
- [ ] Public bus and MRT services used
- [ ] NUS shuttle service used
- [ ] Waiting time (separated from walking & riding time)
- [ ] Walking time (separated from waiting & riding time)
- [ ] Number of transfers (with explicit transfer buffer)
- [ ] Crowding or load information (`SEA`/`SDA`/`LSD` or `Crowding information unavailable`)
- [ ] Data source and last-updated time
- [ ] Missing or unreliable data indicators
- [ ] Warning if any segment has no live data

## 3. Mandatory Neutrality & Integrity Checks

- [ ] No route is labeled "Best", "Recommended", or "Optimal"
- [ ] Neutral tags (`Fastest by estimate`, `Fewest transfers`, `Least walking`, `Lowest reported crowding`, `More data available`) are used accurately
- [ ] No crowding percentages are invented
- [ ] Crowding data never alters route duration calculations
- [ ] AI is not used for any travel-time or arrival-range arithmetic
- [ ] API keys are never exposed in client-side code

## 4. Required Edge-Case Test Suite

- [ ] Empty timetable state
- [ ] Invalid timetable URL / malformed `.ics` file
- [ ] Missing home location state
- [ ] Unknown NUS building / E-Learning venue fallback
- [ ] No route found state (`This route could not be calculated`)
- [ ] External API timeout (`Live arrival data unavailable` / `Using scheduled timetable`)
- [ ] Stale API response (`Cached` badge with age)
- [ ] Missing crowding data (`Crowding information unavailable`)
- [ ] Multiple transfers (2+ transfers with cumulative range propagation)
- [ ] Class already in progress indicator
- [ ] Route arriving after class start warning

