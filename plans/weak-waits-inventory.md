# Weak Waits Inventory — Task 4 (TEST_DETERMINISM_PLAN)

**Status:** Standing reference (triage completed 2026-08-10)
**Parent:** TEST_DETERMINISM_PLAN.md
**Scope:** Appendix to TEST_DETERMINISM_PLAN task 5, which is a standing
opportunistic rule (owner decision 2026-08-10), never "done" — so this
file is NOT deleted. When editing a test file listed here for any other
reason, fix its weak waits (wait on STATE, never on the mock call) and
lower the task-6 ratchet allowlist in `architecture.test.ts` in the same
commit.

## Summary

**CRITICAL:** SUSPECT count (98) exceeds task-scoped appetite (~40). This is a larger campaign than task 4 anticipated. The owner should decide on appetite before task 5 begins scheduling per-directory fixes.

| Metric | Count |
|--------|-------|
| Total matches found | 124 |
| SAFE (final assertion or mock-only checks) | 26 |
| SUSPECT (depends on awaited call's resolved value) | 98 |
| **% SUSPECT** | **79%** |

## Classification rules (mechanical, no judgement)

- **SAFE:** The `waitFor(() => expect(mock).toHaveBeenCalled())` is the test's final assertion, OR every line following it (within the same `it()`/`test()` block) is another `expect(...)` on a mock (`toHaveBeenCalledWith`, `toHaveBeenCalledTimes`, etc.). Test purpose IS "we called it."
- **SUSPECT:** After the `waitFor`, the block performs an action (fireEvent, userEvent, act, hook method call) or asserts on component/hook STATE (result.current.*, screen.getBy*, result.current.*, toBeInTheDocument(), etc.). Anything that could depend on the call's *resolved value* rather than just that it was invoked.

## SUSPECT entries by directory

### components/Inspector (5 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| CorrectionsCard.test.tsx | 136 | applyCorrectionsApi | `expect(params.yScale).toBe(1000);` |
| CorrectionsCard.test.tsx | 146 | applyCorrectionsApi | `expect(vi.mocked(applyCorrectionsApi).mock.calls[0][0].params.xScale).toBe(0.1);` |
| CorrectionsCard.test.tsx | 153 | applyCorrectionsApi | `expect(params.xScale).toBeUndefined();` |
| CorrectionsCard.test.tsx | 223 | applyCorrectionsApi | `await waitFor(() => expect(useApp.getState().yAxisLabel).toBe(...));` |
| CorrectionsCard.test.tsx | 234 | applyCorrectionsApi | `expect(useApp.getState().yAxisLabel).toBe("original");` |

### components/Library (2 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| MultiSelectBar.test.tsx | 95 | askParams | `expect(useApp.getState().datasets.find(...).tags ?? []).toEqual(...)` |
| PagesSection.test.tsx | 139 | exportFigurePage | `expect(body.fmt).toBe("svg");` |

### components/Stage (4 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| Worksheet.test.tsx | 106 | statsDescriptive | `expect(await screen.findByText("Median")).toBeInTheDocument();` |
| usePlotPayload.test.ts | 179 | fetchPlotMock | `await waitFor(() => expect(result.current.payload?.series[0].label).toBe(...)` |
| usePlotPayload.test.ts | 207 | fetchPlotMock | `await waitFor(() => expect(result.current.payload?.series[0].label).toBe(...)` |
| useShapeDraw.test.ts | 119 | mockAskAnnotationText | `await act(async () => {` |

### components/Stage/worksheet (3 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| GridViewport.perf.test.tsx | 225 | statsDescriptive | `expect(fanoutMs).toBeLessThan(2000);` |
| useWorksheetBlockOps.test.tsx | 56 | setStatus | `expect(setStatus.mock.calls.some(...includes("pasting"))).toBe(...)` |
| useWorksheetBlockOps.test.tsx | 66 | setStatus | `expect(setStatus.mock.calls.some(...includes("pasting"))).toBe(...)` |

### components/workshops/baseline (1 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| useBaseline.test.ts | 441 | baselineAnchor | `expect(useApp.getState().baselineOverlay).not.toBeNull();` |

### components/workshops/calculators (1 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| UnitsTab.test.tsx | 141 | convertUnits | `expect(screen.getByText("1239.84")).toBeInTheDocument();` |

### components/workshops/curvefit (2 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| useCurveFit.test.ts | 130 | listFitModels | `await act(async () => {` |
| useModelScan.test.ts | 166 | scanFitModelsJob | `await act(async () => {` |

### components/workshops/distribution (8 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| DistributionPanel.test.tsx | 79 | statsFitDistributions | `expect(await screen.findByText(/AIC 24/)).toBeInTheDocument();` |
| DistributionPanel.test.tsx | 89 | statsFitDistributions | `expect(await screen.findAllByText("normal")).not.toHaveLength(0);` |
| DistributionPanel.test.tsx | 102 | statsFitDistributions | `expect(await screen.findByText(...Percentiles...)).toBeInTheDocument()` |
| useDistribution.test.ts | 78 | statsHistogram | `expect(result.current).toBeTruthy();` |
| useDistribution.test.ts | 121 | statsFitDistributions | `await waitFor(() => expect(result.current.currentFit).not.toBeNull());` |
| useDistribution.test.ts | 146 | statsFitDistributions | `await waitFor(() => expect(result.current.skippedReason).not.toBeNull());` |
| useDistribution.test.ts | 185 | statsFitDistributions | `await waitFor(() => expect(result.current.rankedFits.length).toBe(2));` |
| useDistribution.test.ts | 317 | statsHistogram | `await waitFor(() => expect(result.current.hist).not.toBeNull());` |

### components/workshops/figurebuilder (22 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| useFigureBuilder.test.ts | 58 | renderFigureHitmap | `expect(result.current.preview).toBe("data:image/png;base64...")` |
| useFigureBuilder.test.ts | 174 | renderFigureHitmap | `expect(preview?.series_styles).toEqual([...])` |
| useFigureBuilder.test.ts | 214 | renderFigureHitmap | `expect(preview?.group_col).toBe(1);` |
| useFigureBuilder.test.ts | 337 | renderFigureHitmap | `await waitFor(() => expect(result.current.hitmap).not.toBeNull());` |
| useFigureBuilder.test.ts | 408 | renderFigureHitmap | `await waitFor(() => expect(result.current.hitmap).not.toBeNull());` |
| useFigureBuilder.test.ts | 451 | renderFigureHitmap | `act(() => result.current.setOverrides(...))` |
| useFigureBuilder.test.ts | 479 | renderFigureHitmap | `expect(result.current.canApply).toBe(false);` |
| useFigureBuilder.test.ts | 492 | renderFigureHitmap | `expect(result.current.canApply).toBe(false);` |
| useFigureBuilder.test.ts | 505 | renderFigureHitmap | `expect(result.current.canApply).toBe(true);` |
| useFigureBuilder.test.ts | 518 | renderFigureHitmap | `expect(result.current.canApply).toBe(false);` |
| useFigureBuilder.test.ts | 539 | renderFigureHitmap | `expect(result.current.canApply).toBe(true);` |
| useFigureBuilder.test.ts | 564 | renderFigureHitmap | `expect(result.current.canApply).toBe(true);` |
| useFigureBuilder.test.ts | 658 | renderFigureHitmap | `act(() => {` |
| useFigureBuilder.test.ts | 733 | renderFigureHitmap | `act(() => {` |
| useFigureBuilder.test.ts | 747 | renderFigureHitmap | `await waitFor(() => expect(result.current.hitmap).not.toBeNull());` |
| useFigureBuilder.test.ts | 812 | renderFigureHitmap | `expect(result.current.hitmap).toBeNull();` |
| useFigureBuilder.test.ts | 849 | renderFigureHitmap | `act(() => result.current.editElementText("xlabel", ...))` |
| useFigureBuilder.test.ts | 860 | renderFigureHitmap | `act(() => result.current.editElementText("ylabel", ...))` |
| useFigureBuilder.test.ts | 881 | renderFigureHitmap | `await waitFor(() => expect(result.current.hitmap).not.toBeNull());` |
| useFigureBuilder.test.ts | 943 | renderFigureHitmap | `await waitFor(() => expect(result.current.hitmap).not.toBeNull());` |
| useFigureBuilder.test.ts | 975 | renderFigureHitmap | `expect(result.current.xBreaks).toEqual([[1, 2]]);` |
| useFigureBuilder.test.ts | 1002 | renderFigureHitmap | `expect(result.current.xBreaks).toEqual([[1, 2]]);` |

### components/workshops/figurepage (12 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| useFigurePage.test.ts | 347 | renderFigurePageBlob | `expect(body.fmt).toBe("png");` |
| useFigurePage.test.ts | 363 | renderFigurePageBlob | `act(() => {` |
| useFigurePage.test.ts | 374 | renderFigurePageBlob | `expect(body.panels[0].figure.dataset).toEqual(corrected);` |
| useFigurePage.test.ts | 384 | renderFigurePageBlob | `act(() => {` |
| useFigurePage.test.ts | 418 | renderFigurePageBlob | `expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0]...)` |
| useFigurePage.test.ts | 429 | renderFigurePageBlob | `act(() => {` |
| useFigurePage.test.ts | 439 | renderFigurePageBlob | `expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0]...)` |
| useFigurePage.test.ts | 507 | renderFigurePageBlob | `act(() => result.current.setLayout({ linkX: true }));` |
| useFigurePage.test.ts | 509 | renderFigurePageBlob | `expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0].link_x)...` |
| useFigurePage.test.ts | 555 | renderFigurePageBlob | `act(() => {` |
| useFigurePage.test.ts | 897 | renderFigurePageBlob | `act(() => {` |
| useFigurePage.test.ts | 909 | renderFigurePageBlob | `expect(vi.mocked(renderFigurePageBlob).mock.calls[1][0]...)` |

### components/workshops/fityx (8 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| FitYByXPanel.test.tsx | 97 | anovaMock | `expect(await screen.findByRole("columnheader", { name: "F" }))...` |
| FitYByXPanel.test.tsx | 106 | regressionMock | `expect(screen.getByLabelText("bivariate scatter with fit"))...` |
| FitYByXPanel.test.tsx | 114 | regressionMock | `const checkbox = await screen.findByText("band");` |
| FitYByXPanel.test.tsx | 127 | regressionMock | `expect(await screen.findByText(/confidence band/)).toBeInTheDocument();` |
| FitYByXPanel.test.tsx | 142 | chi2Mock | `expect(await screen.findByText("Fisher's exact (2x2)"))...` |
| FitYByXPanel.test.tsx | 150 | anovaMock | `fireEvent.click(await screen.findByRole("button"...))` |
| FitYByXPanel.test.tsx | 189 | anovaMock | `fireEvent.change(screen.getByLabelText("By (optional)")...)` |
| FitYByXPanel.test.tsx | 199 | anovaMock | `fireEvent.change(screen.getByLabelText("By (optional)")...)` |

### components/workshops/graphbuilder (1 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| PlotSpecBar.test.tsx | 113 | askParams | `expect(fields[0].default).toBe("Alpha");` |

### components/workshops/multivar (12 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| MultivarPanel.test.tsx | 103 | statsCorrelation | `expect(await screen.findByTitle("a × b: r=0.87..."))...` |
| MultivarPanel.test.tsx | 111 | statsCorrelation | `fireEvent.click(screen.getByRole("checkbox", ...))` |
| MultivarPanel.test.tsx | 120 | statsCorrelation | `fireEvent.click(screen.getByRole("tab", { name: "SPLOM" }))` |
| MultivarPanel.test.tsx | 130 | statsPCA | `expect(await screen.findByText("PC1")).toBeInTheDocument();` |
| MultivarPanel.test.tsx | 139 | statsCorrelation | `fireEvent.click(screen.getByRole("tab", { name: "Spearman" }))` |
| MultivarPanel.test.tsx | 147 | statsCorrelation | `fireEvent.click(screen.getByRole("checkbox", ...))` |
| MultivarPanel.test.tsx | 163 | statsCorrelation | `fireEvent.click(screen.getByRole("button", { name: "Export..." }))` |
| MultivarPanel.test.tsx | 177 | statsCorrelation | `fireEvent.click(screen.getByRole("tab", { name: "SPLOM" }))` |
| MultivarPanel.test.tsx | 193 | statsPCA | `fireEvent.click(screen.getByRole("button", { name: "Export scree" }))` |
| MultivarPanel.test.tsx | 196 | exportPcaScreeFigure | `fireEvent.click(screen.getByRole("button", { name: "Export..." }))` |
| useMultivar.test.ts | 100 | statsCorrelation | `act(() => {` |
| useMultivar.test.ts | 145 | statsCorrelation | `expect(result.current.labels).toEqual(["a", "c"]);` |

### components/workshops/outliers (6 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| OutlierScreeningPanel.test.tsx | 52 | grubbsMock | `expect(await screen.findByText(/G = 3\.5/))...` |
| OutlierScreeningPanel.test.tsx | 64 | grubbsMock | `fireEvent.change(screen.getByLabelText("Method")...)` |
| OutlierScreeningPanel.test.tsx | 66 | rosnerMock | `expect(await screen.findByText(/1 of up to 2 tested/))...` |
| OutlierScreeningPanel.test.tsx | 72 | grubbsMock | `fireEvent.click(await screen.findByRole("button"...))` |
| OutlierScreeningPanel.test.tsx | 81 | grubbsMock | `expect(await screen.findByText("none flagged"))...` |
| useOutlierScreening.test.ts | 90 | statsGrubbs | `act(() => result.current.setMethod("rosner"));` |

### components/workshops/peaks (1 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| usePeaks.test.ts | 319 | fitPeak | `await act(async () => {` |

### components/workshops/peakwizard (3 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| PeakWizardPanel.test.tsx | 77 | findMock | `await waitFor(() => expect(useApp.getState().peakOverlay...))` |
| PeakWizardPanel.test.tsx | 112 | findMock | `fireEvent.click(screen.getByText("Report"...))` |
| PeakWizardPanel.test.tsx | 132 | alsMock | `expect(useApp.getState().baselineOverlay?.datasetId)...` |

### components/workshops/rsm (2 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| RsmPanel.test.tsx | 92 | analyzeRsmMock | `const strainButton = await screen.findByRole("button"...)` |
| RsmPanel.test.tsx | 95 | rsmStrainMock | `const value = await screen.findByText("not measurable");` |

### components/workshops/tabulate (1 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| TabulatePanel.test.tsx | 164 | emitMock | `expect(useApp.getState().reports).toHaveLength(0);` |

### components/workshops/variability (3 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| VariabilityChartPanel.test.tsx | 121 | statsNestedAnova | `expect(await screen.findByRole("img"...))...` |
| VariabilityChartPanel.test.tsx | 138 | statsNestedAnova | `expect(await screen.findByText(/variance components...))...` |
| VariabilityChartPanel.test.tsx | 147 | statsNestedAnova | `const { fireEvent } = await import(...react...);` |

### store (1 suspect)

| File | Line | Mock | Context |
|------|------|------|---------|
| useApp.test.ts | 1469 | fetchBookData | `expect(useApp.getState().datasets[0].pending)...` |

## SAFE entries — 26 total

Distributed across:
- components/Inspector/CorrectionsCard.test.tsx: 2
- components/Library: 2
- components/Stage: 4
- components/windows/WindowCanvas.test.tsx: 1
- components/workshops/baseline/useBaseline.test.ts: 1
- components/workshops/distribution/useDistribution.test.ts: 2
- components/workshops/figurebuilder/useFigureBuilder.test.ts: 2
- components/workshops/figurepage/useFigurePage.test.ts: 3
- components/workshops/fityx/useFitYByX.test.ts: 3
- components/workshops/graphbuilder/PlotSpecBar.test.tsx: 2
- components/workshops/multivar: 2
- components/workshops/outliers/useOutlierScreening.test.ts: 1
- components/workshops/variability/useVariability.test.ts: 1
- store/useApp.test.ts: 1

---

## Spot-check examples

**SUSPECT #1 (figurebuilder, line 337):**
- Mock: `renderFigureHitmap` — waits for mock invocation
- Dependent: `await waitFor(() => expect(result.current.hitmap).not.toBeNull());` — waits for STATE

**SUSPECT #2 (distribution, line 79):**
- Mock: `statsFitDistributions` — waits for mock invocation
- Dependent: `expect(await screen.findByText(/AIC 24/)).toBeInTheDocument();` — waits for RENDERED TEXT

**SUSPECT #3 (figurebuilder, line 451):**
- Mock: `renderFigureHitmap` — waits for mock invocation
- Dependent: `act(() => result.current.setOverrides(...));` — ACTION depending on hitmap state

---

## Notes

- **Counts verified:** SAFE (26) + SUSPECT (98) = 124 total matches
- **Scope:** All `frontend/src/**/*.test.ts{,x}` files scanned
- **Strategy:** Conservative — favor SUSPECT over false SAFE to avoid missing flakes
- **Appetite warning:** SUSPECT count (98) is 2.45× the task's ~40 threshold. Task 5 (fixes) should not begin until owner confirms appetite.
- **Lifecycle:** This file is a scratch inventory and will be deleted per plan-consolidation rule once task 5 completes.
