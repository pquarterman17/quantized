---
name: new-route
description: >
  Scaffold a thin FastAPI router + pydantic schema + frontend api-client
  method + Zustand store wiring + test, following quantized's thin-routes
  layering. Use when exposing an existing calc/ or io/ function to the UI.
  (The global add-api-endpoint targets thin_film_toolkit's stack — this
  one matches quantized: React/Zustand, fermiviewer conventions.)
---

# new-route

Expose a pure function over HTTP without leaking logic into the transport.
See `.Codex/rules/architecture-guards.md` (thin routes, pure layers).

## Prereq
The business logic already lives in `src/quantized/calc/` or `io/`. If it
doesn't, port it first (`port-feature`). Routes call it; they don't
contain it.

## Backend
1. **Router** `src/quantized/routes/<domain>.py`:
   - pydantic request/response models live HERE (not in calc/).
   - handler = validate → call the pure fn → serialize. No algorithms.
   - long-running work → submit to the `routes/jobs` WebSocket queue
     instead of blocking.
2. **Register** the router in `src/quantized/app.py` (`include_router`).
3. **Test** `tests/test_api_<domain>.py` using FastAPI `TestClient`:
   happy path + a validation-error case.

## Frontend
4. **API client** — add a typed method in `frontend/src/lib/api.ts`
   mirroring the request/response shapes.
5. **Store wiring** — call it from the relevant Zustand slice in
   `frontend/src/store/`; keep components thin (they read store state).
6. **Frontend test** — vitest for the store action / api call.

## Verify
`uv run pytest tests/test_api_<domain>.py`, then
`cd frontend && npm run typecheck && npm test`. Run `check-guards` to
confirm the route stayed thin and no pure-layer import leaked.

## Output
List the router + schema, the app.py registration line, the api-client
method, the store action, and the tests. Confirm the route contains zero
business logic.
