# Error-label classifier — structural fix

**Status:** Proposed (2026-08-25). Supersedes the round-by-round patching on
`claude/fix-error-label-classifier`.

## Why this plan exists

`lib/errorLabelClassify.ts` decides whether a column label names an
uncertainty column (`R_err`, `dR`, `M_std_err`) and, if so, which column it
belongs to. Seven review rounds have each fixed a real bug and introduced a
new one in the same family. The trades so far:

| Round | Fixed | Broke |
|-------|-------|-------|
| 1 | bare-`d` over-match (`Depth` read as an error column) | — |
| 2 | `ERROR_TOKENS` substring over-match (`Kerr`, `Phase`, `Noise`) | `Ierr` (patched with a hard-coded token) |
| 5 | punctuation base-matching (`NbAu-1_err` bound to `NbAu-2`), glued forms (`Rerr` vanished) | — |
| 6 | multi-segment tokens (`M_std_err` bound to the wrong column), `StDev` vanished | explicit `_err` on token-containing bases (`Phase_err`, `Base_err`, `Noise_err`, `Sensor_err` **all vanished**) |

Every one of these shipped a green suite. The suite was green at 8613 tests
while four ordinary column names silently lost their error bars.

## Root cause

The classifier **mutates one interpretation in sequential phases and cannot
undo a commitment.**

`peelTrailingTokens` peels a whole-segment token run (phase 1), then peels a
glued token from whatever remains (phase 2), each mutating `remaining` and
the `provisional` flag. Phase 2 runs even when phase 1 already produced a
confirmed, correct answer:

```
"Phase_err"  -> segments ["phase", "err"]
   phase 1: "err" is a whole-segment token   -> base "phase"  (CONFIRMED, correct)
   phase 2: "phase" ends with the token "se" -> base "pha"    (PROVISIONAL, wrong)
   evidence gate: no sibling column named "pha" -> binding DROPPED
```

The correct answer existed and was overwritten. This is structural, not a
missing case: any new rule can destroy any earlier rule's result, so each
added rule multiplies the interaction surface. Patching adds another phase
that can be destroyed by the next one.

## The fix: generate candidates, then select with evidence

Replace sequential mutation with **candidate enumeration + ranked selection**.
Nothing mutates; nothing commits until a single selection step.

### 1. Generate (pure, no dataset context)

`errorLabelCandidates(label) -> Candidate[]`, where

```ts
interface Candidate {
  token: string;          // which token matched
  base: string;           // normalized remainder ("" if the label IS the token)
  side: ErrorSide;        // both | + | -
  axis: "x" | "y" | null;
  confirmed: boolean;     // true = token sat on real segment boundaries
}
```

Generation rules, each independently producing zero or more candidates —
they never consume each other's input:

- whole segment equals a token, trailing or leading (`confirmed`)
- a **run** of consecutive whole segments joins to a token (`confirmed`)
- a token glued inside an edge segment (`provisional`)
- a confirmed peel **composed with** a glued peel of what remains
  (`provisional`) — this is what `MStdErr` needs, and it is a separate
  candidate rather than a mutation of the confirmed one
- the bare-`d` delta convention (`provisional`)
- explicit `x`/`y` axis prefixes (`confirmed`)
- a single-letter quantity prefix from an explicit allowlist,
  `CONFIRMED_QUANTITY_PREFIXES = ["i"]`, glued to a token (`confirmed`, base
  kept). See "the `Ierr` special case" below — this is deliberately a domain
  special case, not a general rule, and it is a separate generation rule from
  the `x`/`y` axis prefixes, which mean something structural.

Generation constraints that exist to keep obviously-wrong candidates out of
the pool entirely:

- 2-character tokens (`sd`, `se`) may only match a **whole segment**, never
  glued — otherwise `Set` yields base `t` and binds against a single-letter
  column (probed: `["T","R","Set"]` binds `Set` as `T`'s error).
- a candidate with an empty base is only valid where the whole label is the
  token (`sigma` as its own column).

### 2. Rank (pure, total order, no dataset context)

1. `confirmed` before `provisional`
2. longer matched token first (`stderr` beats `err`)
3. longer remaining base first
4. lexical, to make the order total and the tests deterministic

### 3. Select (the only place dataset context enters)

```
select(candidates, labels):
  1. first candidate whose base names a real sibling column   -> use it
  2. else first CONFIRMED candidate                           -> use it
  3. else                                                     -> not an error column
```

Step 2 is the rule the current code is missing, and it is what makes the
failure class impossible: **a confirmed interpretation can never be
destroyed by a provisional one.**

Worked through the cases that have broken:

| Label | Candidates (ranked) | Selected | Why |
|---|---|---|---|
| `Phase_err` beside `Phase` | confirmed(err, `phase`), provisional(se, `pha`) | confirmed | sibling `Phase` exists — step 1 |
| `Phase_err` with no `Phase` | same | confirmed | step 2 fallback — never dropped |
| `Kerr` beside `Field`,`Phase` | provisional(err, `k`) | none | no sibling `K`, no confirmed candidate |
| `Kerr` beside a real `K` | provisional(err, `k`) | that one | evidence rule working as designed |
| `M_std_err` | confirmed(stderr, `m`), confirmed(err, `mstd`) | `m` | longer token ranks first |
| `MStdErr` beside `M` | confirmed(err, `mstd`), composed-provisional(std, `m`) | `m` | sibling `M` — step 1 |
| `Set` beside `T` | *(none — 2-char glued excluded at generation)* | none | generation constraint |

### 4. Where the pieces live

- `errorLabelCandidates.ts` — generation rules + the token table. New
  spellings are added **here only**.
- `errorLabelClassify.ts` — ranking + selection, plus the existing
  `classifyErrorLabel` / `classifyErrorLabelInLabels` signatures re-expressed
  on top of it, so the ~40 importers are untouched.
- Pairing (`inferErrorBindingsFromLabels`) stays in `errorRoles.ts`.

The invariant that buys permanence: **adding a token changes only the
generator.** Ranking and selection are independent of the token list, so a
new spelling cannot perturb an existing one — the interaction surface that
produced seven rounds of regressions goes away.

## Testing — the half that actually prevents recurrence

The current suite is anecdotal: each round added its own cases and passed
while breaking a class nobody had written a case for.

1. **Generated per-token coverage.** For every token in the table × each
   position (leading / trailing / glued / multi-segment run), assert a label
   built from an ordinary base binds to that base. Generated *from the token
   table*, so adding a token cannot silently skip coverage.
2. **Generated substring-collision coverage.** For every token, build an
   ordinary base name that CONTAINS another token as a substring
   (`Phase_err`, `Base_err`, `Noise_err`, `Sensor_err`, `Dose_err`,
   `Response_err`, `Set_err`) and assert it binds to its own base. This is
   the class round 6 broke.
3. **The never-classify list.** `Kerr`, `Phase`, `Noise`, `Sensor`,
   `Response`, `Dose`, `Pulse`, `Base`, `Use`, `Series`, `Second`, `Depth`,
   `Delay`, `Density` — asserted against datasets **with and without** a
   single-letter column, since the missing single-letter case is exactly what
   hid the `Set` → `T` trap.
4. **A domain corpus with expected targets.** Real headers from this
   toolbox's own techniques — MOKE (`Field`, `Kerr`, `Phase`), XRD (`2theta`,
   `Intensity`, `Ierr`), SIMS depth profiles (`Depth (nm)`, `Si`, `O`,
   `Si_sigma`), magnetometry (`Temp (K)`, `M`, `M_std_err`), hyphenated
   sample names (`NbAu-1`, `NbAu-1_err`) — each pinned to an exact expected
   target, not merely "some binding".
5. **A no-silent-loss invariant.** Any label with a separator-delimited
   explicit token that classifies today must still classify. Losing error
   bars is the worst failure mode here: it is invisible on the plot.

## Migration

1. Land the generator + selection behind the existing exported signatures;
   no caller changes.
2. Port the current suite plus all seven rounds' probes as the starting
   corpus — they all pass or the port is wrong.
3. Delete the old atomic `ierr` token; replace it with the
   `CONFIRMED_QUANTITY_PREFIXES` generation rule above. `Ierr` beside a literal
   `I` passes on evidence; `["2theta","Intensity","Ierr"]` reaches positional
   pairing via SELECT step 2, because the prefix rule gives it a confirmed
   candidate with base `i`.
4. Re-run the seven rounds' probes as a single acceptance sweep.

### The `Ierr` special case

There is **no label-intrinsic signal** separating `Ierr` from `Kerr`: both are
a single segment, single-letter base, glued `err`. Any rule that binds one and
not the other is a domain special case, and pretending otherwise is how this
file accumulated seven rounds of patches.

`Ierr` must keep binding: `origin/main` binds it today through the plain
`endsWith("err")` match, so dropping it is a silent loss of error bars on XRD
data — the worst failure mode named below. The allowlist rule is a *smaller*
special case than the old `ierr` token (it keeps the base, so pairing still
runs through the ordinary mechanism), but it is still one. Requirements:

- a named module-level constant, never an inline literal;
- a comment naming `k`/`Kerr` as the deliberate exclusion and stating that no
  label-intrinsic rule distinguishes them;
- a single test asserting **both halves together** — `Ierr` beside `Intensity`
  binds, `Kerr` beside `Field`/`Phase` does not — so the pair cannot drift.

Rejected alternative: extending SELECT's evidence rule to prefix-match a
single-letter base against sibling labels (so `i` finds `Intensity`). It binds
`Terr` to whichever of `Time`/`Temp` comes first — a silent wrong binding,
which is worse than no binding.

### SELECT, stated precisely

Step 1 scans **every** candidate in ranked order looking for sibling evidence.
It is not "check the top-ranked candidate, then fall back". `MStdErr` beside
`M` ranks `confirmed(err, "mstd")` first, finds no `Mstd` sibling, and must
continue to `composed-provisional(std, "m")`, which has evidence.

The run-of-segments rule generates a candidate for **every** matching run
length, not just the longest. Ranking, not generation, picks between them —
cutting options off early is the failure mode being removed.

Ranking's final tiebreak is lexical on `(base, token, side)`; `base` alone is
not total, since two candidates can share a base with different tokens.

## Known accepted behaviours

- `Kerr` **does** bind beside a column literally named `K`. That is the
  evidence rule working, symmetric with `dDepth` beside `Depth`.
- `Std Dev` (separated, no base) binds positionally — there is no base to
  match, and positional is the documented fallback.
- This changes inference for existing files: anyone relying on today's loose
  matching sees different bindings. Worth a release note; the current
  behaviour is wrong, but it is a behaviour change, not a pure bugfix.
