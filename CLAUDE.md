# xWeek: instructions for Claude Code

This is a greenfield project. Only `README.md` and `schema.sql` exist; everything else is yours to build from this file.

@README.md
@schema.sql

The README describes the product. `schema.sql` is the source of truth for the data model.

## How to work

- Build in the milestones at the bottom of this file, in order. A milestone is done when its code and tests exist and `npm run typecheck`, `npm run lint` and `npm test` pass.
- Before coding a milestone, give a short plan: files you'll create and any decisions you're making.
- Ask me before: adding a dependency not listed here, changing the schema or the stack, or adding scope beyond this file.
- Don't commit unless I ask. At the end of a milestone, summarize what you did and what's next.
- Keep `README.md` and `schema.sql` accurate. If the data model changes, update both in the same change.

## Stack (already decided)

- Node.js current LTS (22 or newer), TypeScript in strict mode, ESM everywhere
- Backend: Express, SQLite via `better-sqlite3` (synchronous API), validation with `zod`
- Frontend: React + TypeScript, built with Vite, TanStack Query for server state, plain CSS modules. No UI or calendar library: build the week and month grids ourselves.
- AI: the official `openai` npm SDK with a configurable base URL, using tool/function calling
- Recurrence: `rrule` package
- Tooling: Vitest, ESLint, Prettier, `tsx` for running the server in dev
- One `package.json` at the repo root (no workspaces)

## Project layout

```
src/
  shared/          # zod schemas, inferred types, time helpers (used by server AND client)
  server/
    index.ts       # Express bootstrap only
    config.ts      # env parsing with zod, fails fast with a clear message
    db/            # connection + migrations
    services/      # ALL business logic: tasks, groups, settings, free-time, recurrence, change-log
    ai/            # client, prompts, tools, chat loop
    routes/        # thin handlers: validate -> call service -> respond
  client/          # Vite root: index.html, main.tsx, api.ts, components/, pages/
migrations/        # numbered .sql files applied after the initial schema
docs/              # nginx.conf example
```

Tests live next to the code as `*.test.ts`.

## Commands (create these npm scripts)

| Command                              | What it does                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Runs Express (`node --watch --import tsx`) and the Vite dev server together, with hot reload. Vite proxies `/api` to Express. |
| `npm run build`                      | Typechecks, then writes `out/client` (static files for nginx) and `out/server` (compiled JS).                 |
| `npm start`                          | Runs `out/server`.                                                                                            |
| `npm test`                           | `vitest run`                                                                                                  |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` for server and client / ESLint                                                                 |

## Configuration

Commit `.env.example`, git-ignore `.env`, `data/` and `out/`. Variables: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (default `https://api.openai.com/v1`), `OPENAI_MODEL`, `PORT` (default 3000), `HOST` (default `127.0.0.1`), `DATABASE_PATH` (default `./data/xweek.db`). Never log the API key or send it to the client.

## Database rules

- On startup, if `PRAGMA user_version` is 0, run `schema.sql` in a transaction and set `user_version` to the current schema version (2). Later changes go in `migrations/NNNN_name.sql`, each bumping `user_version`. Never edit an applied migration.
- On every connection, outside any transaction: `PRAGMA foreign_keys = ON` and WAL mode.
- Parameterized queries only. Never build SQL from strings.
- Dates are `YYYY-MM-DD` and times `HH:MM`, in the user's local time (`settings.timezone`). Never do arithmetic with JS `Date` on these. Use helpers in `shared/time.ts` (`toMinutes`, `fromMinutes`, `addDays`, `weekRange`, ...). "Today" and "now" come from `settings.timezone` (via `Intl`), not the server's zone. `HH:MM` strings compare correctly with `<` and `>`.
- Multi-row writes go in `db.transaction(...)`. Never hold a transaction open across an `await`; use one transaction per tool call.
- Every AI-made create, update or delete writes a `task_changes` row (before/after JSON) in the same transaction as the change.

## Domain rules (in `services/`)

- A task lies within one day and `end_time > start_time`.
- Overlaps: create and update reject overlapping non-cancelled tasks with a `ConflictError` that lists the conflicts. The REST API accepts `allowOverlap: true` (for the GUI's "add anyway"). AI tools never set it.
- Free time is computed in TypeScript (`free-time.ts`), not SQL. Per day: clamp non-cancelled tasks to the waking window, merge overlapping intervals, subtract from `day_start`..`day_end`. Return free minutes and the list of free windows.
- Recurring groups: on create, expand `recurrence_rule` into real `tasks` rows for the next 12 weeks and set `materialized_until`. `GET /api/tasks` for a range beyond `materialized_until` extends the series first. `rrule` works in UTC: pass dates at UTC midnight and use only the date part so DST can never shift a day.
- Split goals ("study 20h in 5 days"): one group with `total_minutes` plus N tasks. Deleting a group cascades to its tasks, and each deleted task is logged.
- Errors: throw typed errors (`NotFoundError`, `ConflictError`, `ValidationError`). One Express error middleware maps them to 404, 409 and 400. Anything else is a 500 with no internals leaked.

## REST API (JSON, under `/api`)

`GET /tasks?from&to`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`, `DELETE /groups/:id`, `GET /free-time?from&to`, `GET /settings`, `PUT /settings`, `GET /chat/messages`, `POST /chat` (`{ message }` returns `{ reply, changes }`).

Validate every body and query with the zod schemas from `shared/`.

## AI layer (`ai/`)

This is the core of the product. The model never touches the database directly.

- Tools call the same `services/` functions as the REST routes, so the GUI and the AI can never follow different rules.
- Tools (zod-validated arguments): `get_tasks`, `get_free_time` (read-only), `add_tasks` (optional group with `total_minutes`), `add_recurring_task` (takes an RRULE), `update_task`, `delete_tasks`, `delete_group`.
- Turn loop in `chat.ts`: build messages (system prompt, last ~20 chat messages, new user message), call the model, run tool calls, append results, repeat until the model replies without tool calls. Cap at 6 iterations. Save the user message and final reply to `chat_messages`.
- Treat model output as untrusted. Validate every tool argument. On validation or conflict errors, return the error text as the tool result so the model can retry. Don't throw.
- Provider errors and timeouts: respond 502 with a friendly message and write nothing.
- The system prompt lives in `prompts.ts` as one exported function. It must include the current local date, weekday and time, the timezone, week start, waking hours, and these rules:
  - Decide whether the request changes the plan or is only a question. For questions, use read tools and change nothing.
  - Check the real schedule (`get_tasks` / `get_free_time`) before picking a time for anything unscheduled. Use sensible defaults (e.g. meetings in the morning) and free slots only.
  - Split a large task into smaller ones only when it helps, spread evenly over the days requested.
  - Don't invent tasks the user didn't ask for. If the request is ambiguous in a way that matters, ask one short question instead of guessing.
  - Answer feasibility questions ("can I afford a part-time job?") from real free-time numbers.
  - Never claim a change was made unless the tool call succeeded. Reply briefly, in the user's language.
- Tests use a fake client with scripted responses. Never call a real API in tests. Cover all five use cases from the README.

## Frontend

- Week view is the default, plus a month view, with previous/next/today navigation. The week starts on `settings.week_starts_on`.
- Click an empty slot to create a task. Click a task to edit, delete or mark it done in a modal. Show API conflicts inline with an "add anyway" option.
- Chat panel: input and message history. After each reply, refetch tasks and show what was added, changed or removed.
- Every request has loading, error and empty states. Layout is responsive and keyboard accessible (modals trap focus, buttons are real buttons).
- All requests go through `client/api.ts` using types from `shared/`. Don't duplicate business logic (such as overlap checks) in the client.

## Code conventions

- No `any` (use `unknown` plus zod). Named exports. Small functions. Comments explain why, not what.
- Files are kebab-case, types PascalCase.
- Test services against in-memory SQLite (`:memory:`) built from the real `schema.sql`. Test the AI loop with the fake client. For the UI, test only pure helpers unless I ask for more.
- Run `npm run lint`, `npm run typecheck` and `npm test` before saying you're done.

## Out of scope for v1

Auth and multiple users, notifications, calendar sync, streaming replies, an undo endpoint (the log exists, the endpoint doesn't), and editing all future occurrences of a recurring series (single occurrences and whole-series delete are supported).

There is no auth, so the server binds to `127.0.0.1` by default. The README must warn against exposing it publicly without adding auth.

## Milestones

1. **Scaffold**: `package.json` scripts, tsconfig(s), Vite, ESLint, Prettier, Vitest, `.env.example`, `.gitignore`, config loading, "hello" route and page.
2. **Data layer**: connection, schema init and migrations, `shared/` schemas and time helpers, settings and tasks services with conflict detection, change log. Tests.
3. **REST API**: tasks, groups, settings, free-time routes and the error middleware. Route tests.
4. **Recurrence and free time**: groups, `rrule` expansion, lazy extension, `free-time.ts`. Tests.
5. **AI**: tools, prompts, chat loop, `POST /chat`, chat history. Tests with the fake client.
6. **Frontend**: week view, task modal, chat panel, month view.
7. **Build and deploy**: `npm run build` output in `out/`, an nginx example in `docs/` (serve `out/client`, proxy `/api` to the Node server), and update the README's Scripts and Deployment sections to match.
