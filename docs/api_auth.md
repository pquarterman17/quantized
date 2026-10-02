# Local API token, CSP and body limits

The Quantized server listens on loopback only. Loopback alone does not keep
other callers out. Any local process, or any other user on a shared machine,
could call `/api/*`, for example `/api/parsers/import` on a file in the server
user's home. Three protections close that gap. They live in
`src/quantized/auth.py`, `web_guard.py` and `body_limit.py`.

## 1. API token

Each launch has a random token (`secrets.token_urlsafe(32)`, 256 bits). Every
`/api` route needs it, and so does the `/api/ws` WebSocket. The only exempt
paths are:

- `/api/health`, which the launchers and the e2e harness poll before the app
  is open.
- CORS preflights (`OPTIONS` with `Access-Control-Request-Method`), which
  never carry credentials.
- The static SPA assets, which hold no secrets.

A request without the token gets `401 {"detail": "missing or invalid API
token"}`. A WebSocket without it is closed with code 1008. Every comparison
uses `hmac.compare_digest`.

### How the browser gets it

The launcher opens a **launch URL** that carries the token once:
`http://127.0.0.1:8000/?token=…`. The index sets this cookie:

```
qz_token_<port>=<token>; HttpOnly; SameSite=Strict; Path=/
```

It then sends the page on to the same URL without the token. It does this
with a zero-delay meta refresh, not a `303` redirect. When the launch URL is
opened from another site (the Tauri splash on `tauri.localhost`, or a link on
some other page), Chromium withholds a `SameSite=Strict` cookie from every
request in that redirect chain, so a `303` would land on the locked page.
This was measured. The refresh is a new navigation started by the server's
own page, so the cookie goes with it.

From then on, the page's own requests carry the cookie automatically, and
page scripts cannot read it. The port is part of the cookie name because
cookies are scoped by host, not port. Without it, two servers (8000 plus an
ephemeral fallback) would overwrite each other's cookie in the same browser.

The index sets the cookie **only** for a request that already presents the
token. A request to `/` with neither the token nor the cookie gets a short
401 page asking for the launch link. If the cookie went to any request for
`/`, any local process could fetch it, and the token would protect nothing.

| Run mode | What opens the launch URL |
|---|---|
| `qz` | The browser tab that qz opens. qz also prints the URL. |
| `qz --no-browser` | Nothing. Open the printed `[qz] quantized -> …` URL yourself. |
| `qz --desktop` | The pywebview window loads the launch URL. |
| Tauri shell | The shell generates the token, passes it to the sidecar as `QZ_API_TOKEN`, and navigates to the launch URL. It never adopts a server that is already running, because it cannot know that server's token. |
| `qz --dev` | See below. |

A bookmark to `http://127.0.0.1:8000/` works for as long as the browser
keeps the session cookie for that server. A new launch has a new token, so
use the new launch URL.

### `qz --dev` (Vite HMR)

In dev mode, Vite serves the index on `:5173` and proxies `/api` (HTTP and
WebSocket) to the backend. The backend therefore never serves the index, so
qz opens a dev-only bootstrap route instead:

```
http://localhost:5173/api/auth/bootstrap?token=…
```

Vite proxies this request to the backend. The backend checks the token, sets
the cookie, and redirects to `/` on the Vite origin. The cookie lands on
`localhost` because the browser made the request to `localhost:5173`, and
Vite forwards it on every proxied `/api` call. The route exists only when
`QZ_DEV_VITE_PORT` is set, which only `qz --dev` does. Everywhere else it
returns 401 like any other unauthenticated `/api` path.

The token is exported as `QZ_API_TOKEN` before uvicorn starts. The `--reload`
subprocess inherits it, so a backend reload keeps the token the browser
already holds.

### Scripts and other programmatic callers

To call the API from a script, set `QZ_API_TOKEN` before you launch the
server. qz uses that value instead of generating one. Give the same variable
to your script:

```bash
export QZ_API_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
qz --no-browser &
python my_script.py   # quantized.client.QuantizedClient reads QZ_API_TOKEN
curl -H "X-Quantized-Token: $QZ_API_TOKEN" http://127.0.0.1:8000/api/fitting/models
```

- `QuantizedClient` reads `QZ_API_TOKEN`, or takes `token=…`, and sends it
  as the `X-Quantized-Token` header. A 401 names the variable to set.
- A user-supplied token must be at least 32 characters from `A-Z a-z 0-9 . _ ~ -`.
  qz refuses to start with a shorter or unsafe one.
- The environment variable was chosen over a token file because it is the
  simplest secure channel. It is readable only by processes of the same user
  (and by root), it needs no file permissions to get right on every OS, and
  it leaves nothing stale on disk.
- Other pages cannot set the custom header cross-site. Doing so needs a CORS
  preflight, and CORS admits only the `qz --dev` Vite origin.

In-repo callers:

- The FastAPI `TestClient`s in `tests/` are authenticated once, in
  `tests/conftest.py`. Every client sends its app's token in the header.
  `tests/test_api_auth.py` removes the header to test refusals.
- The e2e harness (`frontend/e2e/playwright.config.ts`) sets `QZ_API_TOKEN`
  for its webServer and workers, and `gotoApp` opens the launch URL. If you
  reuse an e2e server that is already running, start it with the same
  variable.
- `tools/bench/*` (through `envelope-lib.mjs`) and
  `tools/visual/origin_figures.mjs` export a token before they spawn `qz`.

## 2. Content-Security-Policy

Every non-API response, including the SPA index, carries this header:

```
default-src 'self'; script-src 'self'; object-src 'none';
frame-ancestors 'none'; base-uri 'self';
style-src 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:
```

The first line is the baseline. Each later directive was added because a
Chromium run of the whole e2e suite reported a `securitypolicyviolation`
without it:

- `style-src-attr 'unsafe-inline'`: KaTeX markup (equation previews) and
  several components use inline `style` attributes. Stylesheets and `<style>`
  elements stay `'self'`-only.
- `img-src data:`: Report, figure and thumbnail previews are `data:` PNGs.
  (`blob:` URLs are used only for downloads, which `img-src` does not
  govern.)
- `font-src data:`: The KaTeX stylesheet inlines a small font as a `data:`
  URI.

`connect-src` falls back to `'self'`, which also covers the same-origin
`ws:` of `/api/ws`. `frontend/e2e/specs/csp-auth.spec.ts` loads the app,
imports, plots and typesets an equation, and fails on any violation.

`src-tauri/tauri.conf.json` sets the same policy for the assets the shell
bundles (the `loading.html` splash). That splash has no inline script or
style. The live app inside the Tauri window comes from the server, so the
server's header applies to it.

## 3. Request body limits

`BodyLimitMiddleware` enforces the caps while the body streams in, not after
Starlette has buffered or spooled it:

| Content-Type | Cap | Why |
|---|---|---|
| `multipart/form-data` | 512 MiB + 1 MiB | The per-file upload cap (`routes/_uploadstream.py`, sized from the instrument corpus), plus room for boundaries. |
| anything else (JSON, raw bodies) | 256 MiB | The largest measured JSON is a 188 MB workspace and a 78 MB plot payload (`docs/performance_envelope.md`). The workbook-transfer body is capped at 128 MB by its store. |

- A declared `Content-Length` over the cap is refused before any body byte is
  read.
- A chunked body is counted as it arrives and refused once it passes the cap.

Both cases return `413 {"detail": "request body too large (limit N bytes)"}`
with `Connection: close`. Unauthenticated requests are refused first, by the
token check, so their size never matters.
