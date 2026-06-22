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

## Supported Versions

This project tracks the latest commit on `main`. Fixes land against the most
recent version; there is no long-term-support branch.
