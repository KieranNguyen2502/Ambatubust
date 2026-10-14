# AGENTS.md

## Project purpose

This project is a timetable-aware NUS commute planner for off-campus students.

It combines:
- Singapore public transport
- NUS internal shuttle buses
- Walking segments
- NUS timetable and destination information
- Live arrival and crowding data where available

The product displays transparent route comparisons. It does not recommend or choose a route for the user.

## Product principles

- Present information clearly and transparently.
- Let users make their own route decisions.
- Prefer accuracy and data provenance over impressive-looking guesses.
- Never invent transport, crowding, timetable, or arrival information.
- Clearly distinguish live, cached, estimated, static, and unavailable data.
- Optimize for a reliable hackathon demo, not unnecessary production complexity.

## Scope control

Prioritize the main flow:

1. Import or enter timetable.
2. Set home location.
3. Select an upcoming class.
4. Generate routes to the NUS destination.
5. Combine public transport and NUS shuttle segments.
6. Display route comparisons.
7. Show timing, transfers, walking, crowding, and data freshness.

Do not add unrelated features unless explicitly requested.

Do not build:
- A route recommendation engine
- Exact crowding prediction without reliable data
- A social network
- Full student authentication
- A native mobile app
- Complex machine-learning models
- An unnecessarily complex backend

## Agent workflow

Before implementing a non-trivial task:

1. Read `README.md`, `ARCHITECTURE.md`, and `MVP_CHECKLIST.md`.
2. Restate the requested behavior.
3. Identify the relevant files.
4. Propose a concise implementation plan.
5. Identify assumptions, dependencies, and risks.
6. Ask for approval if the requirement is ambiguous or affects architecture.

For small, isolated fixes, proceed directly and explain the change afterward.

## Implementation rules

- Inspect existing code before editing.
- Make the smallest change that satisfies the requirement.
- Do not rewrite working code unnecessarily.
- Do not modify unrelated files.
- Follow existing project conventions.
- Keep components and modules focused.
- Prefer simple, readable code over premature abstraction.
- Reuse existing utilities and components.
- Do not install dependencies without explaining their purpose.
- Do not change the technology stack without approval.
- Do not introduce mock data into production code without clearly marking it.
- Keep API calls behind the backend when credentials or rate limits are involved.
- Never expose API keys in frontend code.
- Never commit `.env` files or secrets.

## Data-source rules

For every external API:

- Record its source and purpose.
- Record whether it is official, third-party, reverse-engineered, or community-operated.
- Read and respect its usage terms.
- Handle request failures and stale responses.
- Cache data where appropriate.
- Display the last-updated time when relevant.
- Do not assume an API will always be available.

Use live data when available. If live data is unavailable, show a clear fallback state such as:

- `Live arrival data unavailable`
- `Using scheduled timetable`
- `Crowding information unavailable`
- `This route could not be calculated`

Never silently replace missing live data with fabricated values.

## Route-calculation rules

- Calculate route durations deterministically.
- Do not ask an AI model to perform core time arithmetic.
- Keep walking, waiting, riding, and transfer time separate.
- Show an arrival range when the data is uncertain.
- Include transfer buffers explicitly.
- Preserve the original timestamps and source data.
- Do not present an exact arrival time when the underlying data is approximate.

A route may include:

1. Walking to an external transport stop.
2. Public bus or MRT.
3. Transfer or waiting segment.
4. NUS shuttle.
5. Walking to the destination building.

## Crowding rules

- Display official load data when available.
- Label user-reported or estimated crowding separately.
- Do not invent occupancy percentages.
- Do not present crowding as a prediction unless there is supporting data.
- If the data is missing, state that it is unavailable.
- Never allow crowding information to silently alter the route duration.

## AI rules

AI may be used for:

- Explaining route information
- Parsing timetable files
- Converting natural-language input into structured data
- Identifying missing information
- Summarizing trade-offs
- Generating user-friendly explanations

AI must not be the sole source of:

- Arrival-time calculations
- Route geometry
- Official policy
- Live transport status
- Crowding values
- Financial or safety-critical claims

Validate all AI-generated structured output before using it.

## UI rules

Every route comparison should make the following visible:

- Departure time
- Arrival time or arrival range
- Total duration
- Public transport legs
- NUS shuttle legs
- Walking time
- Transfer count
- Crowding information
- Data freshness
- Warnings or unavailable data

Do not visually imply that one route is the correct route. Avoid labels such as:

- Best route
- Recommended route
- Optimal route

Use neutral labels such as:

- Fastest by estimate
- Fewest transfers
- Least walking
- Lowest reported crowding
- More data available

## Testing rules

After every meaningful change:

1. Run the relevant tests.
2. Run the linter.
3. Run the production build.
4. Check the UI manually if it changed.
5. Test API failure states.
6. Inspect the final Git diff.

At minimum, test:

- Empty timetable
- Invalid timetable file
- Missing home location
- Unknown building
- No route found
- External API timeout
- Stale API response
- Missing crowding data
- Multiple transfers
- Class already in progress
- Route arriving after class start

## Git rules

- Keep commits small and logically focused.
- Do not commit secrets.
- Do not amend or rewrite commits unless explicitly asked.
- Before major changes, inspect `git status`.
- Do not discard user changes.
- Do not reset or delete files without explicit approval.

## Completion report

After each task, report:

1. What changed
2. Files changed
3. APIs or dependencies added
4. Tests and commands run
5. Whether the build passed
6. Known limitations
7. Data-source limitations
8. Suggested next milestone

Do not claim that a feature is complete unless it has been tested.

