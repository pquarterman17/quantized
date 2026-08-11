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
findings are deliberate design decisions rather than defects. Each carries a
`# NOTE(codeql <rule>)` marker on the line immediately **above** the reported
line, so the reasoning sits next to the code and stays greppable, and each is
listed here so the set stays reviewable — **anything not on this list is a real
finding and must be fixed, not explained away.**

The marker deliberately does not share a line with the alert itself. Code
scanning reports any alert sitting on a line a pull request touches as a *new*
alert for that PR, so annotating the reported line turns the `CodeQL` check red
on the very change that documents why the alert is acceptable. Keep the
annotation on its own line above.

The marker is documentation, not a directive: CodeQL has no source-suppression
mechanism (`# codeql[...]`/`# lgtm[...]` comments were an LGTM.com feature and
the CLI has no flag for them today). What actually stops these being reported
is a `query-filters` exclusion in
[`.github/codeql/codeql-config.yml`](.github/codeql/codeql-config.yml), wired
into the analysis via `config-file:` in `codeql.yml`.

Both queries were investigated as ordinary bugs first and found to be
**unfixable by construction**, which is the bar for being excluded rather than
repaired:

- `py/sql-injection` accepts exactly two barriers — a comparison of the query
  text against a constant, or a models-as-data barrier node. The first means an
  allowlist of literal queries, i.e. deleting the feature rather than securing
  it.
- `py/stack-trace-exposure` treats the name bound by `except … as exc` as the
  source, so *any* value derived from a caught exception is reported however it
  is plumbed. There is no spelling of "tell the user why their equation did not
  parse" that the query accepts.

A `query-filters` exclusion is **repo-wide** — it also hides a genuine future
occurrence — so each one is fenced by a guard in
`tests/test_repo_integrity.py` that fails the build when a new site appears:
the excluded set must match its register, the annotated sites must match
theirs, and `sqlite3` must stay confined to the one reviewed connector. Adding
an exclusion without extending those guards defeats the whole arrangement.

Prefer this to dismissing alerts in the Security tab: a dismissal lives in
repository settings, where it cannot be reviewed in a pull request, diffed, or
reverted alongside the code it excuses.

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
