// The ONE glyph registry (UX audit 7, lane G2). Quantized's icons are Unicode
// glyphs (CLAUDE.md: never emoji), so the only thing standing between two
// controls and a shared, ambiguous mark is discipline. This module is that
// discipline: every glyph the app chrome draws as an ICON is named here, once,
// and `glyphs.test.ts` fails if two names resolve to the same character.
//
// The audit's collisions, all resolved here: ▤ was the Library toggle, Text
// box, Stack channels, the Workbook node and Stacked column; ⊞ was both
// "Import data" and "Snapshot window"; ▦ was both "Sheet" and "Statistics
// view"; ⊕ rendered visibly larger than its toolbar siblings.
//
// ONE MEANING PER GLYPH. Two surfaces that mean the SAME thing (the toolbar's
// "Stack channels" and the "Stacked panels" plot type) share one key, so the
// check is "keys are injective", not "every use site is distinct".
//
// Out of scope: typographic/maths glyphs that are TEXT (SymbolPalette's ±, Å,
// ∫ …), disclosure carets, and a row's inline status dots — they are not
// icons and live next to the component that renders them.

// ── App chrome (TitleBar). ▤/▥ are the design guide's panel toggles; no
// node type, shape or plot type may reuse them. ──
export const brand = "⎓";
export const themeDark = "☾";
export const themeLight = "☀";
export const calculators = "√";
export const libraryToggle = "▤";
export const inspectorToggle = "▥";

// ── Library node types (components/Library/nodeIcons.ts). ──
export const nodeFolder = "▰";
export const nodeWorkbook = "⊟";
export const nodeWorksheet = "≡";
export const nodeAnalysisResult = "⌬";
export const nodeOriginFigure = "⌁";
/** The virtual "Unresolved Origin figures" group: a circled slash, "nothing
 *  bound here". Distinct from every node mark and row command glyph. */
export const nodeOriginGroup = "⊘";
export const nodeEditableFigure = "◇";
export const nodePublicationFigure = "◆";
export const nodePage = "▢";
export const nodeReport = "¶";
export const frozen = "❄";

// ── Document kinds / window actions drawn outside the four registries. ──
/** "▦ sheet" badge and the worksheet view toggle. */
export const sheet = "▦";
/** Import data (HomeScreen). */
export const importData = "⇪";
/** Open in a new window / panel snapshot window. */
export const newWindow = "⊞";

// ── Plot toolbar: tools (lib/plotToolbarDefs.ts). ──
export const toolPointer = "➤";
export const toolZoom = "⛶";
export const toolPan = "✥";
export const toolCursor = "✛";
export const toolMeasure = "∡";
export const toolStats = "Σ";
export const toolSelect = "⬚";
export const toolLasso = "◌";
export const toolIntegrate = "∫";
export const toolFwhm = "∩";
export const toolQuickFit = "≈";
/** The programmatic "pick from plot" tool; it has no button of its own. */
export const toolRegion = "↔";

// ── Plot toolbar: shape flyout. ──
export const shapeArrow = "↗";
export const shapeLine = "╱";
export const shapeRect = "▭";
export const shapeEllipse = "◯";
export const shapeTextbox = "⌶";
export const shapeSlope = "◿";
export const shapeDistance = "⟷";
export const shapeAngle = "∠";
export const shapeScalebar = "⊣";

// ── Plot toolbar: view / export actions. ──
export const actionReset = "⊡";
export const actionSmartScale = "⊿";
/** Shared by the toolbar's "Stack channels" and the "Stacked panels" type. */
export const stackedPanels = "☰";
/** A corner inset: a geometric shape, so it matches its siblings' size
   *  (the former ⊕ drew larger than every other toolbar glyph). */
export const actionInset = "◳";
export const actionPolar = "✺";
export const actionStatMode = "⊠";
export const actionSavePng = "⤓";
export const actionCopyData = "⧉";
export const actionCopyFigure = "⎘";

// ── Plot types (lib/plotTypes.ts). ──
export const plotLine = "╲";
export const plotScatter = "∴";
export const plotLineSymbol = "⟋";
export const plotArea = "◢";
export const plotColumn = "▮";
export const plotColumnX = "▐";
export const plotBarH = "▬";
export const plotStackedColumn = "◪";
export const plotStackedColumnX = "▙";
export const plotStackedBarH = "▚";
export const plotStackedArea = "◭";
export const plotFloatColumn = "▯";
export const plotBox = "◫";
export const plotHistogram = "▇";
export const plotCdf = "⎍";
export const plotMarginal = "◰";
export const plotRidgeline = "≀";
export const plotContour = "◎";
export const plotViolin = "⋈";
export const plotDoubleY = "⇵";
export const plotPolar = "◴";
export const plotPolarMap = "◍";
export const plotWaterfall = "≋";
export const plotTernary = "△";
export const plotTernaryMap = "◬";
export const plotPie = "◕";
export const plotParallel = "⫴";
export const plotHexbin = "⬢";
export const plotKde2d = "⊚";
export const plotPareto = "⑊";
export const plotBlandAltman = "⇕";
// Variant presets (lib/plotTypePresets.ts).
export const presetViolinPoints = "⋊";
export const presetViolinMedian = "⋋";
export const presetBoxPoints = "⧈";
export const presetBoxMean = "⧇";
export const presetHistogramFit = "▓";
export const presetStackedPercent = "◩";
export const presetErrorBand = "⌇";
export const presetDropLines = "⊥";
export const presetSpline = "∿";
export const presetStep = "⊓";
export const presetCdfBand = "⌒";
export const presetCdfPlain = "⌢";
export const presetCdfRug = "⌷";
export const presetMarginalBox = "◱";
export const presetMarginalRug = "⋮";
export const presetRidgeOverlap = "⌣";
