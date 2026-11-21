---
name: release
description: Cut a quantized release (vX.Y.Z or vX.Y.Z-rcN) - version bump, CHANGELOG section, release PR, then tag via the cut-tag workflow and dispatch the release (installers) and pypi workflows, and verify the assets. Use whenever asked to release, tag, or publish a version.
---

# Release

Background and one-time setup: `RELEASE.md`. **Tags are only ever cut by
`.github/workflows/cut-tag.yml`**: the agent git proxy silently no-ops tag
pushes, and a tag made with `GITHUB_TOKEN` triggers no tag-push workflow, so
`release.yml` and `pypi.yml` are dispatched by hand afterwards. No AI
attribution in the commit, PR or release notes.

## 1. Version bump (eight files; CHANGELOG makes nine)

```bash
uv run python tools/bump_version.py X.Y.Z --dry-run
uv run python tools/bump_version.py X.Y.Z
```

It edits `pyproject.toml`, `src/quantized/__init__.py`, `src-tauri/Cargo.toml`,
`src-tauri/tauri.conf.json`, `frontend/package.json` and regenerates
`uv.lock`, `frontend/package-lock.json`, `src-tauri/Cargo.lock`.
`tests/test_version_consistency.py` checks they agree.

## 2. CHANGELOG

Move the `## [Unreleased]` items under a new `## [X.Y.Z] - YYYY-MM-DD`
heading (Keep a Changelog: Added / Changed / Fixed), leaving an empty
`[Unreleased]`. Write for users; cite PR numbers.

## 3. Release PR

Branch `release/vX.Y.Z`, commit `Release vX.Y.Z`, open the PR, wait for the
required checks, merge. Record the merge commit's full SHA on `main`.

## 4. Tag via cut-tag.yml

```bash
gh workflow run cut-tag.yml -f tag=vX.Y.Z -f sha=<full merge SHA>
gh run watch "$(gh run list --workflow cut-tag.yml -L1 --json databaseId -q '.[0].databaseId')"
gh api repos/{owner}/{repo}/git/refs/tags/vX.Y.Z      # wait until the tag exists
```

## 5. Dispatch the builds with the TAG as the ref

```bash
gh workflow run release.yml --ref vX.Y.Z                    # installers + GitHub Release
gh workflow run pypi.yml --ref vX.Y.Z -f target=pypi        # real PyPI (non-rc only)
```

- An `-rc` tag: `release.yml` publishes a prerelease (auto-update keeps the
  last stable); for pypi use the default `target=testpypi` (rc never goes to
  PyPI).
- Both verify the tag matches the package version
  (`tools/check_release_tag.py`) and fail fast if not.

## 6. Verify

```bash
gh run list --workflow release.yml -L1 ; gh run list --workflow pypi.yml -L1   # both success
gh release view vX.Y.Z --json assets -q '.assets[].name'
```

Expect: `*-setup.exe` + `.sig` (Windows), `.dmg`, `.deb`,
`qz-server-win64.zip`, `qz-server-macos.tar.gz`, `qz-server-linux.tar.gz`,
`latest.json` and `SHA256SUMS`. For a stable tag, check
`pip index versions quantized-lab` (or the PyPI page) shows X.Y.Z. Report
any missing asset; re-run only the failed job.
