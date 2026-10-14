# NUS Commute Planner (`ImBoutToBusss`)

A timetable-aware, transparent multi-modal commute planner built for off-campus NUS students.

## Overview

Off-campus NUS students navigate two separate transit networks every day: **Singapore public transport** (MRT and LTA buses) and **NUS Internal Shuttle Buses (ISB)**. Existing tools either stop at the campus boundary, suggest 15–25 minute uphill walks, or hide transfer uncertainty behind a single "Recommended Route."

This application imports a student's **NUSMods timetable** (or `.ics` / manual schedule), maps classroom venue codes (e.g., `COM1-0212`, `LT17`, `AS6-0211`, `UTSRC-LT51`) to campus buildings and shuttle stops, stitches public transit routes with NUS internal shuttles across campus gateway hubs, and presents **neutral, side-by-side route comparisons** with explicit arrival-time ranges, official crowding data, and transparent data provenance.

## Core Principles

1. **User Agency First:** Displays multiple routes with neutral trade-off descriptors (`Fastest by estimate`, `Fewest transfers`, `Least walking`, `Lowest reported crowding`, `More data available`). Never chooses or recommends a "best" route.
2. **Deterministic Math:** All walking, waiting, transfer, riding, and arrival-range calculations are executed deterministically in TypeScript. AI is never used for time arithmetic.
3. **Zero Fabricated Telemetry:** Never invents crowding percentages or hides missing live data. Every leg reports whether its data is `LIVE`, `CACHED`, `SCHEDULED`, `ESTIMATED`, or `UNAVAILABLE`.
4. **Hackathon Demo Reliability:** Every external API call is isolated behind a server-side timeout and falls back gracefully to deterministic static schedules (`Using scheduled timetable`) so the app never crashes during an upstream outage.

## Core User Flow

1. **Enter Home Location:** Search Singapore postal codes/addresses (via OneMap Search API) or pick a preset off-campus neighbourhood.
2. **Import or Enter Timetable:** Paste an NUSMods share URL, upload a `.ics` calendar file, or add a class manually.
3. **Identify Upcoming Classes:** Automatically detects upcoming sessions chronologically and resolves raw NUS venue codes to buildings and nearest shuttle/bus stops.
4. **Select Session:** Pick an upcoming class to plan the commute for its start time.
5. **Generate Multi-Modal Routes:** Combines public MRT/buses with NUS internal shuttles (`A1`, `A2`, `D1`, `D2`, `K`, `E`, `BTC`, `L`) across verified campus gateway hubs.
6. **Compare on Map & Cards:** Inspect routes side by side on a MapLibre GL map and comparison cards showing departure time, arrival range, duration, services used, waiting/walking time, transfers, crowding (`SEA`/`SDA`/`LSD`), data freshness, and missing-data warnings.
7. **User Decision & Optional Reminder:** Inspect leg-by-leg details, pick a preferred route, and optionally enable a departure reminder.

## Tech Stack

- **Framework:** Next.js 14+ (App Router), React 18, TypeScript, Tailwind CSS
- **Map:** MapLibre GL JS (`maplibre-gl` + `react-map-gl`) with OneMap / OpenStreetMap tiles
- **Backend & Caching:** Next.js Server Route Handlers (`/api/*`) + `lru-cache`
- **Persistence:** Browser `localStorage` + static versioned campus datasets (`src/data/*.json`)
- **Testing:** Vitest + React Testing Library

## Data Sources & Provenance

| Source | Classification | Purpose | Fallback Behavior |
| :--- | :--- | :--- | :--- |
| **NUSMods API v2 & Venue Data** (`api.nusmods.com/v2`) | Community-operated (Official student tool) | Module timetable import & classroom coordinate lookup | Bundled static snapshot of `venues.json` & manual building selector |
| **SLA OneMap API** (`www.onemap.gov.sg/api`) | Official Government API | Address geocoding & public transport (`BUS`/`MRT`/`WALK`) routing | Optional Google Maps Routes API fallback or cached demo corridors |
| **LTA DataMall v3** (`datamall2.mytransport.sg`) | Official Government API | Live public bus arrival ETAs, `Monitored` status, and load (`SEA`/`SDA`/`LSD`) | Falls back to OneMap scheduled durations + `Crowding information unavailable` |
| **NUS Shuttle API / Static ISB Registry** | Reverse-engineered / Unofficial + Static Official Schedule | Campus shuttle routes (`A1`, `A2`, `D1`, `D2`, `K`, `E`, `BTC`, `L`), stops, and ETAs | Automatic fallback to deterministic static headway & ride-time matrix (`Using scheduled timetable`) |
| **Google Maps Routes API** | Official Commercial Third-Party | Optional fallback transit router | Used only if OneMap PT routing fails or times out |

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in `LTA_ACCOUNT_KEY`, `ONEMAP_EMAIL`, and `ONEMAP_PASSWORD` in `.env.local` (the app also supports static schedule fallbacks and demo snapshots if keys are omitted).
3. **Run development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.
4. **Run tests, linter, and production build:**
   ```bash
   npm run test
   npm run lint
   npm run build
   ```

## Documentation Index

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Technical architecture, data schemas, gateway hub stitching, and deterministic route-calculation formulas.
- [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) — Product specification, competitive analysis, 12-milestone development plan, and 3-minute hackathon demo script.
- [`AGENTS.md`](./AGENTS.md) — Agent implementation, data-provenance, route-calculation, UI neutrality, and testing rules.
- [`MVP_CHECKLIST.md`](./MVP_CHECKLIST.md) — Milestone progress tracker, mandatory route card audit, and edge-case test checklist.
- [`DEVELOPMENT_AND_ARCHITECTURE_PLAN.pdf`](./DEVELOPMENT_AND_ARCHITECTURE_PLAN.pdf) — Consolidated PDF of the complete architecture and development plan for sharing with other agents and team members.

