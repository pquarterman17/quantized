# CLAUDE.md: frontend (React 19 + TypeScript + Vite + Zustand + uPlot)

Root rules still apply (see [../CLAUDE.md](../CLAUDE.md)). Running the gate
like CI: the `gate` skill ([SKILL.md](../.claude/skills/gate/SKILL.md)).

## Structure and ratchets

- **400 lines per `.tsx` component**, zero grandfathered pins
  (`src/architecture.test.ts`, "component-ceiling ratchet"). Heavy features
  become a `workshops/` subtree (state hook + view + sub-components), the
  React analogue of the MATLAB "workshop pattern". (`App.tsx` and
  `ThinFilmTab.tsx` were the last holdouts; `thin_film_toolkit`'s
  `FigureBuilder.vue` hit 2,669 lines, the anti-pattern.)
- `architecture.test.ts` also ratchets store size, `.ts` module size,
  `getState()`-in-render, storage keys, lazy seams and layering. **Pins only
  move DOWN**: extract a cohesive module instead of raising one; a raise needs
  written justification in the commit message.
- **Weak-wait ratchet:** a new `waitFor(() => expect(mock).toHaveBeenCalled())`
  fails the build. Wait on STATE, not on the call. A bare
  `expect(mock).toHaveBeenCalled()` is fine.
- Test determinism and flake evidence: [../docs/testing.md](../docs/testing.md).

## Bundle budget (`scripts/check-bundle-size.mjs`, runs in `npm run build`)

- A ratchet on eager JS: over the pin fails; more than 40 kB under also fails
  until the pin is lowered. Follow the review process in the script header:
  MEASURE first; a raise is the last resort, capped at `measured + 1,024`,
  only after trying a lazy split; every change gets a dated history entry
  with exact before/after bytes.
- **Before trusting any bundle number that will become a pin, run `npm ci`
  and rebuild.** vite's transform cache under `node_modules` served stale
  output for the very files being edited (PR #343: local 892.1 kB, CI
  892.5 kB over a 892.2 kB budget; `npm ci` made them match byte for byte).
  A version comparison of a pinned dependency cannot see this.

## Verifying a build the way CI does

- **`npm run build`'s `tsc -b` is incremental: a local pass can be stale.**
  PR #343 passed locally and failed CI on six errors in two new test files
  that the old `.tsbuildinfo` never rechecked. Before claiming green:
  **`npx tsc -b --force`** (or delete the buildinfo).
- `npx tsc --noEmit -p tsconfig.json` is NOT the CI check: it misses project
  references. It missed a plain `DataStruct` passed where branded
  `StrippableData` is required (use `asAlreadyComputed`) and an unsound
  `as PlotPayload` cast on a literal missing `xLabel`/`xUnit`.
- Stale `node_modules` after a container reset: compare
  `node -p "require('./package-lock.json').packages['node_modules/vite'].version"`
  with `node -p "require('./node_modules/vite/package.json').version"`; a
  mismatch means `npm ci`.
- Memory: run vitest with `--maxWorkers=3` on shared boxes; let runs finish
  (a killed run leaks ~80 MB into `$TMPDIR`; cleanup in the `gate` skill).

## Styling and conventions

- **Design tokens are the only styling source**: read CSS custom properties
  (`--accent`, `--series-N`, ...); never hardcode colours. Theme/accent/
  density switch via `data-*` on `<html>`. Authority: `plans/design/`.
- Unicode-glyph icons, never emoji; cursors `default`; JetBrains Mono for
  every number.
- **Copy-vendor from `../fermiviewer/frontend/src`** with a
  `// Ported from fermiviewer ...` header; swap `fvd-*` -> `qz-*` classes and
  `useViewer` -> `useApp`; keep structure identical so a future diff stays
  small. Decouple a ported component from the store when it need not be
  coupled (e.g. `ToolWindow` owns its position locally).
- The plot has an **offline client fallback** (`lib/plotdata.ts`): try
  `/api/plot/series`, fall back to local column packing so the UI and tests
  run without a backend.
- Origin apply code (`lib/origin*`, `store/originApply*`) follows
  [../src/quantized/io/origin_project/CLAUDE.md](../src/quantized/io/origin_project/CLAUDE.md).
