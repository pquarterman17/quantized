---
name: origin-change
description: Step-by-step workflow for ANY change to the Origin (.opj/.opju) import - decode, curve binding, figure apply or rendering of imported Origin graphs (src/quantized/io/origin_project/, frontend/src/lib/origin*, frontend/src/store/originApply*). Use before editing that code and before opening its PR.
---

# Origin import change

Rules live in `src/quantized/io/origin_project/CLAUDE.md`; facts and history
in `docs/origin_re/DECODE_LEDGER.md`. This is the order to do the work in.

## 1. Read before touching code

- Read `docs/origin_re/DECODE_LEDGER.md`: the facts (section 2) and owner
  decisions (section 3) you are about to rely on, and the regression history
  (section 4) for the same field or path. A fact marked **UNGUARDED** is not
  a contract.
- Read the linked detail doc for the area (`docs/origin_re/README.md` has the
  index).

## 2. Baseline before the change

- Confirm a corpus is present (`test-data/origin` sibling, or
  `QZ_ORIGIN_PUBLIC_CORPUS` / `QZ_ORIGIN_OWNER_CORPUS`). Without one the
  regress gate skips: say so in the PR rather than claiming it passed.
- Optional fast loop: `uv run python tools/origin_regress.py snapshot --out <scratch>/base.json`
  on the untouched tree (never write inside the repo; it refuses).

## 3. Meet the evidence bar

A new decode (or a changed one) needs ALL of: a controlled specimen; an
independent oracle (COM/LabTalk, Origin's saved preview, or an Origin
export); a plausible whole-corpus distribution; positive AND negative
controls. Synthetic tests lock proven behaviour; they never establish it. A
COM plot list proves bindings, never visibility. Fail closed: an unproven
field is omitted and diagnosed, never guessed. COM runs dispatch
`Origin.Application` only (never `ApplicationSI`), one instance at a time.

## 4. Check it visually against Origin's own images

```bash
OUT=<scratch>/visual
uv run python tools/visual/origin_preview_extract.py --out $OUT [--files list.txt]
cd frontend && npm run build && cd ../tools/visual && npm ci
node origin_preview_shots.mjs --out $OUT --port 8931 --resume
uv run python tools/visual/origin_preview_report.py --out $OUT   # -> $OUT/gallery.html
```

Review the pages your change touches plus Moke, PNR and RockingCurve. Details
and blind spots: `tools/visual/README.md` "Origin preview oracle".

## 5. Regress after the change

```bash
uv run python tools/gate.py --origin --origin-allow docs/origin_re/regress_allow/<lane>.json
```

- Every listed change gets a rule in the allow-file:
  `{"<project or glob>": [{"kind": "...", "contains": "...", "reason": "..."}]}`.
  The reason names the evidence (preview, export, COM count), not "expected".
- An unexplained change is a regression until proven otherwise. Do not widen
  `kind: "*"` or a glob to make it pass.
- `origin/generated/` (Origin-built specimens) is READ-ONLY: read it only through `tests/test_plot_corpus_import_floor.py` (run by `gate.py --origin`) and `tools/plot_corpus/score_import.py` / `score_report.py`; never edit, copy or move it, and commit nothing derived from it but the pins in `tests/fixtures/plot_corpus/import_floor.json` (owner rule 2026-11-20; ledger R-34).

## 6. Guard it and record it (same PR)

- Add a guarding test per fact or fix (synthetic + a `realdata` test that
  computes its expectation at run time via `tests/origin_corpus.py`).
- Add one-line rows to `DECODE_LEDGER.md`: a fact (section 2), a rule or
  owner decision (3), a regression (4), a change-log line (5). Each row links
  its detail doc and names its guard; update the guard-status counts. Never
  leave a "to merge" section in a detail doc (`tests/test_repo_integrity.py`
  fails).
- **Never weaken a guard to make a change pass.** If a guard is wrong, prove
  it with new evidence, change it, and log that in section 4.

## 7. Independent review

Before the PR: run the code-review skill on the diff, then get a review from
an agent or person that did not write the change, pointed at the ledger rows,
the allow-file reasons and the gallery pages. No AI attribution anywhere.
