# Releasing Quantized (desktop installer + auto-update + PyPI)

Quantized ships two ways from the same `vX.Y.Z` tag, both built and published
entirely by CI:

1. A native **Tauri** desktop app: a thin Rust shell window over the local
   FastAPI server, frozen into a self-contained **PyInstaller sidecar**
   (`.github/workflows/release.yml`).
2. A **PyPI package** (`pip install quantized` / `pipx install quantized` /
   `uv tool install quantized`): a pure-Python wheel with the built SPA baked
   in (`.github/workflows/pypi.yml`).

The repo stays binary-free either way — installers and wheels are build
artifacts, never committed.

The Windows installer creates **two** Start Menu shortcuts pointing at the
same `Quantized.exe` — "Quantized" (full app) and "DiraCulator" (`--calc`,
the calculator-only view) — added/removed together by
`src-tauri/nsis-hooks.nsh`'s `NSIS_HOOK_POSTINSTALL`/`POSTUNINSTALL`.

Two update paths for the desktop app, both wired:

1. **In-app auto-update** — on launch (Windows), the app checks the GitHub
   Release for a newer *signed* build, prompts, then downloads + installs +
   restarts. No new entry in *Installed apps*.
2. **Upgrade-in-place installer** — the `*-setup.exe` recognizes a prior
   install and **replaces** it instead of stacking a second copy.

## Why you don't get duplicate installs

Three invariants in `src-tauri/tauri.conf.json` must **never change** across
releases (changing any one makes Windows treat the build as a *different* app
and leave a duplicate in *Installed apps*):

| Invariant | Value | Where |
|-----------|-------|-------|
| `productName` | `Quantized` | tauri.conf.json |
| `identifier` | `app.quantized.desktop` | tauri.conf.json |
| `nsis.installMode` | `currentUser` | tauri.conf.json |
| single bundle target | `["nsis"]` only (no WiX/MSI) | tauri.conf.json |
| Tauri CLI version | pinned (`@tauri-apps/cli@2.11.2`) | release.yml |

The CLI pin matters: the NSIS uninstall-registry-key + shortcut naming scheme
must stay byte-identical between releases. A floating CLI can change it and
break in-place upgrade detection. Keep the pin in lockstep with the resolved
`tauri` crate in `src-tauri/Cargo.lock`.

> Never add a WiX/MSI target or switch to `perMachine` — NSIS and MSI track
> installs in *separate* registries, which is the classic cause of "lots of
> installed repeats" (the problem this setup exists to prevent).

---

## One-time setup (do this before the first release)

### 1. Generate the updater signing keypair

Run this **once**, locally (it never leaves your machine):

```bash
npx @tauri-apps/cli@2.11.2 signer generate -w ~/.tauri/quantized.key
```

It prints (and saves) a **private key** + asks for a **password**, and prints
the matching **public key**.

### 2. Paste the PUBLIC key into the config

In `src-tauri/tauri.conf.json`, replace the placeholder
`plugins.updater.pubkey` value (`REPLACE_ME__…`) with the public key string.
Commit it — the public key is not a secret.

### 3. Add the PRIVATE key as GitHub repo secrets

Repo → Settings → Secrets and variables → Actions → *New repository secret*:

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/quantized.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you chose |

> The CI build step has `createUpdaterArtifacts: true`, so it **requires** these
> secrets — without them the Windows build fails at the signing step. Keep the
> private key backed up; losing it means installed apps can no longer
> auto-update (they'd need a manual reinstall to adopt a new key).

### 4. (Optional) Replace the placeholder icons

`src-tauri/icons/*` are currently copied from FermiViewer as placeholders.
Generate Quantized-branded icons:

```bash
npx @tauri-apps/cli@2.11.2 icon path/to/quantized-1024.png
```

### 5. Register PyPI Trusted Publishing (`pypi.yml`)

`pypi.yml` publishes via [PyPI Trusted Publishing](https://docs.pypi.org/trusted-publishers/)
(OIDC) — no API token secret to generate or rotate. One-time setup on
**both** pypi.org and test.pypi.org:

1. Create the project on PyPI once manually (`twine upload` a first build,
   or use "create a new pending publisher" if the project name is free), or
   use PyPI's *pending publisher* flow if the project doesn't exist yet.
2. Project → *Publishing* → *Add a new publisher* → GitHub:
   - Repository owner / name: this repo
   - Workflow name: `pypi.yml`
   - Environment name: `pypi` (production) — repeat on test.pypi.org with
     environment name `testpypi`
3. In the GitHub repo, Settings → Environments → create `pypi` and
   `testpypi` (empty — no secrets needed; the environment name is what
   Trusted Publishing matches against). Optionally add required reviewers
   on `pypi` for a manual approval gate before a tag actually publishes.

---

## Cutting a release

1. **Bump the version in all four files** (they must match):
   - `pyproject.toml` → `version`
   - `src/quantized/__init__.py` → `__version__`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - (`frontend/package.json` → `version` — cosmetic, but keep it in sync)

2. **Commit + tag + push:**

   ```bash
   git commit -am "chore(release): v0.2.0"
   git tag v0.2.0
   git push origin main --tags
   ```

3. The tag push fans out to **two** workflows:
   - `release.yml` — builds Windows/macOS/Linux, smoke-tests the sidecar,
     signs, and attaches `Quantized_x64-setup.exe` (+ `.sig`), the `.dmg`,
     the `.deb`, and `qz-server-*.{zip,tar.gz}` to the GitHub Release, then
     generates and uploads `latest.json`. Installed Windows apps pick up the
     update on next launch.
   - `pypi.yml` — builds the SPA, builds the sdist + wheel, smoke-tests the
     wheel in a clean venv, and publishes to PyPI via Trusted Publishing.
     `pip install quantized` / `pipx install quantized` /
     `uv tool install quantized` pick up the new version immediately.

### Dry run (validate without releasing)

- Actions → *release* → *Run workflow* (manual dispatch): builds +
  smoke-tests + uploads run artifacts, but creates no Release and no tag.
- Actions → *pypi* → *Run workflow* (manual dispatch): builds +
  smoke-tests, then publishes the build to **TestPyPI** (not PyPI) so the
  whole pipeline — including the Trusted Publishing handshake — is
  validated end to end without touching a real release. Install from there
  with `pip install -i https://test.pypi.org/simple/ quantized`.

---

## Local development

```bash
# Vite HMR + reloading backend (no bundling, no signing needed)
cd src-tauri && cargo tauri dev
```

The shell reuses an already-running dev server on :8000 if present; otherwise it
spawns `.venv` Python via `python -m quantized --no-browser`. Building a local
installer requires the Rust toolchain + the signing secrets in your env (or flip
`createUpdaterArtifacts` off temporarily).
