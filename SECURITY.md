# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities **privately** so they can be fixed
before public disclosure.

- **Preferred:** Use GitHub's
  [private vulnerability reporting](https://github.com/pquarterman17/quantized/security/advisories/new) —
  open the **Security** tab and click **Report a vulnerability**. This keeps
  the report confidential and tracks it in a security advisory.

Please do **not** open a public issue for security problems.

### What to include

- A description of the vulnerability and its impact
- Steps to reproduce (a proof-of-concept if possible)
- The affected version or commit
- Any suggested remediation

### What to expect

- Acknowledgement within **5 business days**
- An initial assessment and severity rating
- Coordinated disclosure once a fix is available; credit given if you'd like it

## Scope

Quantized is local analysis software — a FastAPI backend bound to `127.0.0.1`
serving a local single-page app. The attack surface that matters most:

- **File parsers** (`io/`) reading untrusted instrument/data files —
  memory safety, path traversal, zip/decompression bombs, malformed-header
  handling
- **The local API server** (`routes/`) — arbitrary file read/write, SSRF,
  command/path injection
- **Dependencies** not already surfaced by Dependabot alerts

Out of scope:

- Issues that require an already-compromised local machine
- Vulnerabilities in dependencies already tracked by open Dependabot alerts

## Reviewed static-analysis findings

CodeQL runs on every PR (`.github/workflows/codeql.yml`). A handful of its
findings are deliberate design decisions rather than defects. Each carries an
inline `# NOTE(codeql <rule>)` marker at the exact line so the reasoning sits
next to the code and stays greppable, and each is listed here so the set stays
reviewable — **anything not on this list is a real finding and must be fixed,
not explained away.**

The marker is documentation, not a directive: CodeQL has no source-suppression
mechanism (`# codeql[...]`/`# lgtm[...]` comments were an LGTM.com feature and
the CLI has no flag for them today), so these alerts must be **dismissed once
in the repository's Security tab** — *Alerts → Dismiss → "Used safely"* — with
this file cited as the rationale. They will otherwise sit open forever. If a
future CodeQL release does honour source suppressions, upgrading the markers is
a mechanical change.

| Rule | Where | Why it stays |
|------|-------|--------------|
| `py/sql-injection` | `io/sqlite_query.py` | Running the caller's own `SELECT` against their own local database is the connector's entire purpose, so there is no parameterized form to move to. Safety comes from the surrounding controls: the file is confined to the allowed roots by the route, the connection is opened `mode=ro`, an authorizer denies every write/DDL/`ATTACH`/transaction action, the statement must begin `SELECT`/`WITH`, only one statement runs, and a progress handler bounds runtime. Reader and data are the same local user — no privilege boundary is crossed. |
| `py/stack-trace-exposure` | `routes/fitting.py` (×2), `routes/peaks.py`, `routes/stats.py` | These responses carry the app's own curated `ValueError` text — "unknown function 'expp'", "data must be positive for lognormal", "region lies outside the data range" — which is the useful half of the answer for a validate endpoint, a model-ranking scan, a per-spectrum batch, or a skipped distribution family. No traceback, frame, or path is included, and the server binds to `127.0.0.1`, so the "external user" in the query's threat model is the operator reading their own diagnostics. |

The path-traversal guards these findings sit near are **not** suppressed: every
route that opens a caller-supplied path (`routes/parsers.py`,
`routes/books.py`, `routes/database.py`, `routes/import_template.py`)
normalizes with `os.path.realpath` and then requires the result to sit under a
separator-terminated allowed root, in a form the analyzer can verify.

## Supported Versions

This project tracks the latest commit on `main`. Fixes land against the most
recent version; there is no long-term-support branch.
