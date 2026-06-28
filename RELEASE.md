# Releasing Quantized (desktop installer + auto-update)

Quantized ships as a native **Tauri** desktop app: a thin Rust shell window
over the local FastAPI server, which is frozen into a self-contained
**PyInstaller sidecar**. Releases are built and published entirely by CI
(`.github/workflows/release.yml`) when you push a `vX.Y.Z` tag — the repo stays
binary-free.

Two update paths, both wired:

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

3. CI builds Windows/macOS/Linux, smoke-tests the sidecar, signs, and attaches
   `Quantized_x64-setup.exe` (+ `.sig`), the `.dmg`, the `.deb`, and
   `qz-server-*.{zip,tar.gz}` to the Release — then generates and uploads
   `latest.json`. Installed Windows apps pick up the update on next launch.

### Dry run (validate without releasing)

Actions → *release* → *Run workflow* (manual dispatch): builds + smoke-tests +
uploads run artifacts, but creates no Release and no tag.

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
