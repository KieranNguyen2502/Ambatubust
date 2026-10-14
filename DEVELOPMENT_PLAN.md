# Product Specification, UI Design & 12-Milestone Development Plan (`DEVELOPMENT_PLAN.md`)

## A. Product Specification

### 1. Product Name Ideas
- **NUS CommuteLens** *(transparent, side-by-side comparison focus)*
- **KRidge Connect** *(focus on bridging off-campus public transit with Kent Ridge campus shuttles)*
- **BusToNUS / ImBoutToBusss** *(hackathon working title matching the repository workspace)*
- **ModTransit** *(linking NUSMods timetables directly to transit options)*

### 2. Target Users
- **Primary:** Undergraduate and graduate NUS students living off campus (HDB estates, private residences, or off-campus hostels across Singapore) who commute to Kent Ridge or UTown for lectures, tutorials, and labs.
- **Secondary:** NUS teaching staff and part-time students travelling to specific campus buildings at varying times of day.

### 3. User Problem
1. **Network boundary blind spot:** Mainstream transit apps (Google Maps, Citymapper) route users up to the campus perimeter or direct them on 15–25 minute uphill walks because they lack live-integrated awareness of **NUS Internal Shuttle Buses (ISB)** (`A1`, `A2`, `D1`, `D2`, `K`, `E`, `BTC`, `L`).
2. **Venue-to-stop mismatch:** NUSMods displays room codes like `COM3-01-20` or `AS6-0211`, not the nearest ISB stop or gateway transfer hub.
3. **Fragmented mental math & opaque uncertainty:** Students juggle 3–4 apps (NUSMods, Google Maps, SG BusLeh, uNivUS/NextBus) while mentally estimating transfer buffers and arrival uncertainty.
4. **Over-confident single-route recommendations:** Existing route planners push a single "Best Route" with a single exact arrival minute, hiding transfer and headway uncertainty.

### 4. Value Proposition
A **single-screen, timetable-aware commute comparison tool** that reads a student's NUSMods schedule, maps class venues to exact campus buildings and shuttle stops, stitches public MRT/bus legs with NUS internal shuttle legs through campus gateway hubs, and presents **transparent, side-by-side route trade-offs**—including arrival-time ranges, segment-by-segment breakdowns, crowding indicators, and explicit data provenance—so students can make their own informed commute decision.

### 5. Core MVP Features vs. Explicitly Deferred Features

| Core MVP Features (In Scope) | Explicitly Deferred (Out of Scope) |
| :--- | :--- |
| • Home location setup via Singapore postal code / address search or presets<br>• Timetable import via NUSMods Share URL, `.ics` upload, or manual class entry<br>• Upcoming class detection & venue-to-building coordinate resolution<br>• Hybrid multi-modal route generation (OneMap PT + Gateway Transfer Hubs + NUS Shuttles)<br>• Interactive MapLibre GL map with color-coded multi-leg polylines<br>• Side-by-side comparison cards with neutral trade-off tags (`Fastest by estimate`, `Fewest transfers`, `Least walking`, `Lowest reported crowding`, `More data available`)<br>• Deterministic arrival-time ranges (`[Earliest - Latest]`), LTA crowding (`SEA`/`SDA`/`LSD`), data freshness badges, and explicit missing-data warnings<br>• Optional user-toggled departure reminder | • No "Best Route" or automated route recommendation engine<br>• No invented crowding percentages or ML predictions<br>• No full NUS student SSO / uNivUS authentication<br>• No native iOS/Android mobile apps<br>• No exhaustive indoor room-to-room turn-by-turn navigation<br>• No production-scale user accounts or social features |

---

## B. Competitive Analysis

| Dimension | Google Maps | NUS Shuttle Apps (uNivUS / NextBus) | SG Bus Apps (SG BusLeh / MyTransport) | NUSMods | **Proposed MVP** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Off-campus Public Bus + MRT Routing** | Yes (Strong) | No | Stop-level arrivals only | No | **Yes** (OneMap PT + LTA DataMall) |
| **NUS Internal Shuttle Bus (ISB) Routing** | Partial/Inconsistent | Yes (ISB stops & ETAs) | No | No | **Yes** (Stitches public transit to ISB gateway hubs) |
| **Timetable & Venue Code Awareness** | No | No | No | Yes (Timetable & venues) | **Yes** (Imports NUSMods link / `.ics` & maps venue $\rightarrow$ building) |
| **Public-to-ISB Gateway Stitching** | Poor (Often suggests 18m walk instead of ISB transfer) | No (Campus-only) | No | No | **Yes** (Explicit transfer hubs at KR MRT, Clementi, UTown, UHC, BIZ2) |
| **Crowding / Load Visibility** | Qualitative | Partial | Yes (LTA `SEA`/`SDA`/`LSD`) | No | **Yes** (Surfaces official LTA load per route leg; flags missing data) |
| **Uncertainty & Data Freshness Transparency** | Low (Single ETA minute) | Medium | Medium | N/A | **High** (Shows arrival range `[Earliest–Latest]`, source badge, and cache age) |
| **Decision Philosophy** | Prescriptive ("Best route") | Lookup utility | Lookup utility | Schedule planner | **Non-prescriptive** (Neutral trade-off comparison; user decides) |

---

## C. UI and User Experience Specification

```text
+---------------------------------------------------------------------------------------------------+
| [BusToNUS]  Timetable-Aware NUS Commute Planner                   [Demo Snapshot: OFF] [Refresh]  |
+------------------------------------------------+--------------------------------------------------+
| 1. COMMUTE CONTEXT                             |                                                  |
| Home: [ 120456 - Clementi Ave 3 (Blk 456)  v ] |                                                  |
| Timetable: [ NUSMods Sem 1 Imported (5 mods) ] |                 MAPLIBRE GL MAP                  |
|            [Import URL] [Upload .ics] [+Add]   |                                                  |
|                                                |       [Home: Clementi]                           |
| 2. UPCOMING CLASSES (Wed, 14 Oct)              |              \                                   |
| +--------------------+ +--------------------+  |               \ (EW Line / Bus 96)               |
| | * CS2103T LEC [1]  | |   IS1108 TUT [04]  |  |                v                                 |
| | 10:00 - 12:00      | | 14:00 - 15:00      |  |          [Gateway: KR MRT / CLB]                 |
| | Venue: COM1-0212   | | Venue: BIZ2-0111   |  |                 \                                |
| | -> Computing 1     | | -> Business 2      |  |                  \ (NUS Shuttle A1 / D1)         |
| +--------------------+ +--------------------+  |                   v                              |
|                                                |             [Dest: COM1-0212]                    |
| 3. ROUTE COMPARISON (Target: Arrive by 10:00)  |                                                  |
| Sort view: [Arrival Range v]   Showing 3 routes|   Legend: --- Walk  === Public Bus               |
|                                                |           === MRT   === NUS Shuttle (Orange)     |
| +--------------------------------------------+ |                                                  |
| | Route A: Bus 96 -> Central Lib -> ISB D1   | |                                                  |
| | [Fastest by estimate] [More data available]| |                                                  |
| | Dep: 09:14   Arr: 09:46 - 09:54 (32-40m)   | |                                                  |
| | Walk: 6m | Wait: 7m | Transfers: 1         | |                                                  |
| | Load: Bus 96 [SEA: Seats Avail]            | |                                                  |
| |       Shuttle D1 [Crowding unavailable]    | |                                                  |
| | Data: LTA Live (14s ago) · ISB Scheduled   | |                                                  |
| | [!] Warning: Shuttle D1 using static sched | |                                                  |
| | [Inspect 5 Legs v]  [Select for Reminder]  | |                                                  |
| +--------------------------------------------+ |                                                  |
+------------------------------------------------+--------------------------------------------------+
```

### Mandatory Route Card Information
For every route, the UI displays:
1. Route name or summary (`Bus 96 → Central Library → NUS Shuttle D1`)
2. Departure time (`09:14 AM`)
3. Estimated arrival time (`09:50 AM`)
4. Estimated travel duration (`36 min`)
5. Estimated arrival-time range (`09:46 AM – 09:54 AM · 32–40 min`)
6. Public bus and MRT services used (`Bus 96`, `EWL`, `CCL`)
7. NUS shuttle service used (`ISB D1`, `ISB A1`)
8. Waiting time (`7 min wait`)
9. Walking time (`6 min walk · 450m`)
10. Number of transfers (`1 transfer`)
11. Crowding or load information (`Seats Available (SEA)`, `Standing Available (SDA)`, `Limited Standing (LSD)`, or `Crowding information unavailable`)
12. Data source and last-updated time (`LTA DataMall v3 · Live 14s ago`)
13. Missing or unreliable data indicators (`Using scheduled timetable`)
14. Warning if any segment has no live data (`⚠️ Shuttle D1: Live arrival data unavailable — Using scheduled timetable`)

---

## D. 12-Milestone Development Plan

### Milestone 1: Project Scaffold
- **Goal:** Initialize Next.js 14+ TypeScript project, Tailwind CSS, MapLibre dependencies, core domain types, and Vitest test suite.
- **Files / Components:** `package.json`, `tsconfig.json`, `src/types/commute.ts`, `src/lib/config/env.ts`, `vitest.config.ts`.
- **Acceptance Criteria:** `npm run lint`, `npm run test`, and `npm run build` succeed with zero errors; core TypeScript schemas compile cleanly.
- **Test Plan:** Unit test validating environment configuration parsing and schema type guards.
- **Dependencies:** None.
- **Risks:** Node/Next.js version mismatch (mitigated by pinning LTS versions).

### Milestone 2: Static Route and Map Prototype
- **Goal:** Build the 2-column dashboard shell and render multi-leg GeoJSON routes (Walk, MRT, Bus, NUS Shuttle) on a MapLibre GL map using static fixture data.
- **Files / Components:** `src/app/page.tsx`, `src/components/map/CommuteMap.tsx`, `src/data/fixtures/sample-routes.json`.
- **Acceptance Criteria:** Map loads Singapore/Kent Ridge tiles without API key errors; hovering a route highlights its segments with distinct colors for Walk, Public Transit, and NUS Shuttle.
- **Test Plan:** Component render test and manual browser verification of map zoom, markers, and polyline layers.
- **Dependencies:** Milestone 1.
- **Risks:** SSR hydration issues with `maplibre-gl` (mitigated via Next.js dynamic client import).

### Milestone 3: Timetable Input / Import
- **Goal:** Implement NUSMods share link parsing, `.ics` calendar file parsing, manual class entry, and `localStorage` persistence.
- **Files / Components:** `src/lib/timetable/nusmods-parser.ts`, `src/lib/timetable/ics-parser.ts`, `src/app/api/nusmods/module/[code]/route.ts`, `src/components/timetable/TimetableModal.tsx`, `src/components/timetable/UpcomingClassesStrip.tsx`.
- **Acceptance Criteria:** Pasting an NUSMods share URL fetches module lesson details from `api.nusmods.com/v2`, extracts venue codes and times, persists to `localStorage`, and lists upcoming classes chronologically.
- **Test Plan:** Unit tests for valid/invalid NUSMods URLs, empty timetables, malformed `.ics` files, and class-already-in-progress time filtering.
- **Dependencies:** Milestone 1.
- **Risks:** NUSMods URL query format variations (`LEC:1` vs `LEC:01` — mitigated by normalizing class numbers with leading-zero fallback).

### Milestone 4: NUS Destination Mapping
- **Goal:** Create the curated NUS building registry, integrate NUSMods `venues.json` coordinates, and map classroom codes (`COM1-0212`, `LT17`, `AS6-0211`, `UTSRC-LT51`, `BIZ2-0111`) to buildings and nearest NUS Shuttle / LTA stops.
- **Files / Components:** `src/data/nus-buildings.json`, `src/data/nusmods-venues-subset.json`, `src/lib/campus/venue-resolver.ts`.
- **Acceptance Criteria:** Common NUS venue strings resolve deterministically to a building, coordinates, and nearest shuttle stops; unknown or online (`E-Learn_C`) venues trigger a clear fallback state with manual building selection.
- **Test Plan:** Unit tests covering exact venue matches (`LT17`), prefix building matches (`COM1-0212` $\rightarrow$ `COM1`), online venues, and unknown venue strings.
- **Dependencies:** Milestone 3.
- **Risks:** Ambiguous room prefixes (mitigated by explicit prefix mapping rules + manual override selector).

### Milestone 5: Public Transport Integration
- **Goal:** Implement the OneMap Search adapter (home postal code/address geocoding) and OneMap Public Transport Routing adapter (`/api/public/routingsvc/route`), plus optional Google Routes fallback.
- **Files / Components:** `src/lib/adapters/onemap.ts`, `src/lib/adapters/google-routes.ts`, `src/app/api/location/search/route.ts`, `src/components/setup/HomeLocationInput.tsx`.
- **Acceptance Criteria:** User can search a Singapore postal code or select a preset home location; backend authenticates with OneMap, caches the JWT token, and returns parsed `WALK`, `BUS`, and `MRT` legs.
- **Test Plan:** Unit tests with mocked OneMap responses, token refresh on 401, and timeout fallback handling.
- **Dependencies:** Milestone 1.
- **Risks:** Missing OneMap credentials in local dev (mitigated by clear error banner and fallback to pre-cached demo origin corridors).

### Milestone 6: NUS Shuttle Integration
- **Goal:** Build the NUS Shuttle stop/route registry (`A1`, `A2`, `D1`, `D2`, `K`, `E`, `BTC`, `L`), static headway & inter-stop ride time calculator, and live shuttle proxy adapter with automatic fallback.
- **Files / Components:** `src/data/nus-shuttles.json`, `src/data/nus-stops.json`, `src/lib/adapters/nus-shuttle.ts`.
- **Acceptance Criteria:** Given any origin NUS stop and destination NUS stop, the module returns all valid direct shuttle services, baseline ride times, live ETAs (if reachable), or static headway wait ranges with `status: 'SCHEDULED'`.
- **Test Plan:** Unit tests for stop sequence validation, loop routes (`A1`/`A2`), live API timeout fallback (`2500ms`), and off-service hours.
- **Dependencies:** Milestone 4.
- **Risks:** Reverse-engineered NUS NextBus/uNivUS endpoint blocking requests (mitigated by making the static headway calculator first-class and automatic).

### Milestone 7: Route Combination and Transfer Logic
- **Goal:** Implement the Gateway Transfer Hub stitcher (`HUB_KR_MRT`, `HUB_UTOWN`, `HUB_CLEMENTI_96`, `HUB_OPP_UHC`, `HUB_KV_BIZ`) and deterministic timing/uncertainty calculator (`/api/routes/plan`).
- **Files / Components:** `src/data/nus-gateways.json`, `src/lib/routing/stitcher.ts`, `src/lib/routing/calculator.ts`, `src/app/api/routes/plan/route.ts`.
- **Acceptance Criteria:** Generates 3–5 distinct routes combining public transit, gateway transfer walks/buffers, NUS shuttles, and final campus walks; calculates deterministic arrival ranges `[earliestIso, latestIso]` and neutral trade-off tags.
- **Test Plan:** Deterministic math unit tests verifying walking, waiting, transfer buffers, arrival range propagation, and late-for-class detection.
- **Dependencies:** Milestones 4, 5, 6.
- **Risks:** Duplicate or dominated routes (mitigated by deduplicating routes with identical service sequences).

### Milestone 8: Live Arrival and Crowding Data
- **Goal:** Integrate LTA DataMall `BusArrival v3` to enrich public bus legs with live arrival times, `Monitored` status, and official load codes (`SEA`, `SDA`, `LSD`), backed by server LRU caching.
- **Files / Components:** `src/lib/adapters/lta-datamall.ts`, `src/lib/cache/lru.ts`.
- **Acceptance Criteria:** Public bus legs display live wait times and `SEA`/`SDA`/`LSD` crowding badges when LTA returns telemetry, and explicitly show `Crowding information unavailable` when absent.
- **Test Plan:** Unit tests for `SEA`/`SDA`/`LSD` mapping, `Monitored: 0` handling, and stale-cache recovery when LTA returns 500/timeout.
- **Dependencies:** Milestone 7.
- **Risks:** LTA `BusStopCode` mismatch with OneMap stop codes (mitigated by normalizing 5-digit LTA stop codes extracted from OneMap PT legs).

### Milestone 9: Route Comparison UI
- **Goal:** Build the neutral Route Comparison Cards, neutral trade-off badges, stacked duration bars, expandable Route Detail timeline, and optional user-selected departure reminder.
- **Files / Components:** `src/components/routes/RouteComparisonList.tsx`, `src/components/routes/RouteCard.tsx`, `src/components/routes/RouteDetailTimeline.tsx`, `src/components/routes/ProvenanceBadge.tsx`.
- **Acceptance Criteria:** All 14 required route attributes are clearly visible per route; zero "Best/Recommended" labels exist; users can sort routes and inspect segment-level provenance and warnings.
- **Test Plan:** UI component tests checking presence of all required fields, neutral badge rendering, and warning states.
- **Dependencies:** Milestones 2, 7, 8.
- **Risks:** Information overload on cards (mitigated by clean visual hierarchy: primary timing/range header, service pills, stacked time bar, and collapsible per-leg timeline).

### Milestone 10: Fallback Data and Error Handling
- **Goal:** Harden all failure modes (`Live arrival data unavailable`, `Using scheduled timetable`, `Crowding information unavailable`, `This route could not be calculated`) and implement the toggleable Demo Snapshot mode.
- **Files / Components:** `src/data/fixtures/demo-snapshots.json`, `src/components/common/FallbackBanner.tsx`.
- **Acceptance Criteria:** All 11 required edge-case tests in `AGENTS.md` pass; simulating API failures in the UI shows accurate fallback states without crashing.
- **Test Plan:** Automated integration tests for all 11 edge cases (empty timetable, invalid file, missing home, unknown building, no route, API timeout, stale response, missing crowding, multi-transfer, class in progress, arriving late).
- **Dependencies:** Milestone 9.
- **Risks:** Hidden unhandled promise rejections (mitigated by strict adapter try/catch wrappers).

### Milestone 11: Deployment
- **Goal:** Verify production build, configure environment variables on Vercel, and test live HTTPS deployment.
- **Files / Components:** `next.config.mjs`, `.env.example`, `README.md`.
- **Acceptance Criteria:** `npm run build` passes cleanly; deployed URL loads map, imports timetable, and computes routes over HTTPS.
- **Test Plan:** Production smoke test on deployed URL.
- **Dependencies:** Milestone 10.
- **Risks:** Serverless function cold-start timeouts (mitigated by 2.5s–4s upstream fetch timeouts).

### Milestone 12: Demo Preparation
- **Goal:** Seed preset demo personas (Clementi & Bishan students with real NUSMods schedules), verify the Demo Time Override clock, and rehearse the 3-minute script.
- **Files / Components:** `src/data/demo-presets.ts`.
- **Acceptance Criteria:** 1-click demo preset loads instantly; both live API mode and recorded fallback mode work seamlessly.
- **Test Plan:** Full 3-minute timed walkthrough rehearsal.
- **Dependencies:** Milestone 11.
- **Risks:** Live hackathon venue Wi-Fi outage (mitigated by built-in Demo Snapshot fallback).

---

## E. Hackathon Demo Plan (3 Minutes)

1. **0:00 – 0:25 | Student Timetable & Home Setup:** Paste a real NUSMods Semester 1 URL (`CS2103T`, `CS2101`, `IS1108`, `MA1521`) and set Home Location to `120456 (Clementi Ave 3)`.
2. **0:25 – 0:50 | Select Upcoming Class:** Click **`CS2103T Lecture · 10:00 AM · Venue: COM1-0212`**, showing automatic resolution to **Computing 1 (COM1)** and nearby shuttle stops (`COM3`, `Central Library`).
3. **0:50 – 1:30 | Public Bus/MRT + NUS Shuttle Integration:** Show 3 multi-modal routes on the MapLibre map (Route A via `Bus 96` + `Shuttle D1`; Route B via `MRT EWL/CCL` to `Kent Ridge MRT` + `Shuttle A1`; Route C via `Bus 196` + walk).
4. **1:30 – 2:10 | Arrival-Time Range & Crowding Comparison:** Compare `09:46–09:54 AM` (`Seats Available (SEA)` on Bus 96, `Fastest by estimate`) against `09:48–09:57 AM` (`Least walking` via MRT + A1) and `09:51–10:02 AM` (`May arrive 2 min after class start`).
5. **2:10 – 2:40 | Route Details & Data Freshness:** Expand Route A's 5-leg timeline showing `LTA DataMall v3 · Live (11s ago)` vs. `NUS Shuttle D1 · Using scheduled timetable (5–8m peak headway)`. Toggle simulated shuttle API outage to prove graceful degradation.
6. **2:40 – 3:00 | User Makes Their Own Informed Decision:** Select a preferred route based on weather/crowding preference and toggle the optional 10-minute departure reminder.

