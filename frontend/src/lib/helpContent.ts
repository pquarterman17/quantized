// In-app Help content (GUI_INTERACTION #17's Help build-out) — pure, testable
// data plus a fuzzy search over it. The dialog (components/overlays/HelpDialog)
// is a dumb renderer, the same split ShortcutsDialog uses with lib/shortcuts.
//
// Why the content is hand-authored here rather than pulled live from each
// tool: the command registry (store/commands.ts) has no description field, and
// a tool's real one-liner lives in its workshop panel's top comment, which is
// stripped at build time. So each sentence below is authored FROM that comment
// (kept faithful to what the tool does) and the id is kept equal to the
// command id, so `help.test.ts` can assert every Analyze-menu command has a
// help entry -- a new tool cannot ship without one. That coverage guard is
// what keeps "data-driven" honest instead of drift-prone.

import { fuzzy } from "./fuzzy";

/** One searchable help topic, category-agnostic. Tools, formats, and Origin
 *  tips all normalize to this so ONE search covers the whole Help surface. */
export interface HelpItem {
  /** Stable key (a tool's command id; a format's extension; an origin tip id). */
  key: string;
  /** What the item is called. */
  title: string;
  /** One sentence: what it does / when to use it. */
  detail: string;
  /** Where/how to reach it (a menu path, an extension, a shortcut) — shown as
   *  a muted chip. Optional. */
  meta?: string;
  /** Extra search terms not shown (synonyms, the section name). */
  keywords?: string;
}

export interface ScoredHelpItem extends HelpItem {
  /** Indices into `title` that matched, for highlight. */
  hits: number[];
  score: number;
}

/** One analysis/workshop tool. `section` is its Analyze sub-menu group (the
 *  same vocabulary lib/menuSections.ts renders); `shortcut` is the single-key
 *  accelerator when it has one (macOS glyphs, translate at render). */
export interface HelpTool {
  id: string;
  name: string;
  desc: string;
  section: string;
  shortcut?: string;
  keywords?: string;
}

// Authored from each workshop panel's header comment; `id` == the
// analysisCommands.ts command id (asserted in help.test.ts).
export const HELP_TOOLS: readonly HelpTool[] = [
  {
    id: "curvefit",
    name: "Curve fit",
    desc: "Fit a model to the active dataset and overlay the fitted curve, with parameters, errors, and goodness-of-fit.",
    section: "Fit",
    shortcut: "F",
    keywords: "regression least squares nonlinear model gaussian lorentzian",
  },
  {
    id: "peaks",
    name: "Find peaks",
    desc: "Detect peaks (center, height, FWHM, SNR) and optionally fit them together with a shared background or independently.",
    section: "Peaks & baseline",
    shortcut: "P",
    keywords: "peak picking detection fwhm prominence",
  },
  {
    id: "baseline",
    name: "Baseline / background",
    desc: "Estimate and subtract a background under the active dataset — ALS, rolling ball, modpoly, SNIP, Shirley, anchors, or analytic polynomials.",
    section: "Peaks & baseline",
    keywords: "background subtraction als snip shirley rolling ball detrend",
  },
  {
    id: "peak-wizard",
    name: "Peak Analyzer",
    desc: "A guided five-step workflow over baseline → find → fit → report, Origin's Peak Analyzer re-imagined.",
    section: "Peaks & baseline",
    keywords: "wizard stepper guided origin peak analyzer",
  },
  {
    id: "hysteresis",
    name: "Hysteresis analysis",
    desc: "Extract loop parameters (Hc, Mr, Ms, squareness, loop area, switching-field distribution) from an M–H dataset.",
    section: "Magnetometry",
    shortcut: "Y",
    keywords: "coercivity remanence saturation magnetization mh loop vsm squid",
  },
  {
    id: "magtools",
    name: "Magnetometry tools",
    desc: "Subtract a linear high-temperature background from M(T), or convert field and moment units (sample-aware).",
    section: "Magnetometry",
    keywords: "background units tesla oersted emu moment mass volume",
  },
  {
    id: "reflectivity",
    name: "Reflectivity model",
    desc: "Build a layer stack from SLD presets, pick radiation and a Q grid, and simulate R(Q) as a new dataset.",
    section: "XRD & reflectivity",
    keywords: "xrr specular parratt sld layer stack simulate reflectometry",
  },
  {
    id: "reflview",
    name: "Reflectometry view",
    desc: "Show measured vs modelled reflectivity and the SLD depth profile side by side (pairs a refl1d export set).",
    section: "XRD & reflectivity",
    keywords: "refl1d sld profile two frame model data",
  },
  {
    id: "rsm",
    name: "RSM analysis",
    desc: "Find substrate and film peaks in a reciprocal-space map and compute strain and relaxation from their Q centres.",
    section: "XRD & reflectivity",
    keywords: "reciprocal space map strain relaxation epitaxy q",
  },
  {
    id: "reductions-wh",
    name: "Williamson–Hall",
    desc: "Estimate crystallite size and microstrain from peak widths across 2θ (a manually editable peak table).",
    section: "XRD & reflectivity",
    keywords: "crystallite size microstrain broadening williamson hall xrd",
  },
  {
    id: "reductions-fft",
    name: "Film thickness (FFT)",
    desc: "Measure film thickness from Kiessig fringes via FFT, with uncertainty, and push the spectrum to the library.",
    section: "Transform & signal",
    keywords: "fft kiessig fringe thickness frequency reflectivity",
  },
  {
    id: "reductions-reflfft",
    name: "Reflectivity FFT",
    desc: "Kiessig-fringe thicknesses plus superlattice harmonic analysis for XRR (needs a wavelength) or NR.",
    section: "Transform & signal",
    keywords: "fft superlattice harmonic thickness xrr nr",
  },
  {
    id: "distribution",
    name: "Distribution",
    desc: "Histogram, box/quantile strip, descriptive stats, an optional fit overlay, and a Shapiro–Wilk normality verdict for one column.",
    section: "Statistics",
    keywords: "histogram normality shapiro wilk quantile descriptive stats",
  },
  {
    id: "stats-chooser",
    name: "Test chooser",
    desc: "Get a recommended statistical test with its assumption checks explained, run it one-click, and land the result as a report.",
    section: "Statistics",
    keywords: "t-test anova mann whitney which test assumptions hypothesis",
  },
  {
    id: "graph-builder",
    name: "Graph Builder",
    desc: "Drag channels into X / Y / Group / Facet wells; the mark morphs as columns land, then send it to the stage.",
    section: "Workflow",
    keywords: "drag wells x y group facet plot builder origin",
  },
  {
    id: "digitizer",
    name: "Graph digitizer",
    desc: "Trace a curve from an image of a plot (set two X and two Y reference points) and turn the traced points into a dataset.",
    section: "Workflow",
    keywords: "digitize trace image extract points plot picture",
  },
  {
    id: "calculators",
    name: "DiraCulator — materials calculators",
    desc: "Materials-science calculators across many domains (crystal, SLD, transport, optics, superconductivity, and more).",
    section: "Workflow",
    keywords: "calculator crystal sld transport optics semiconductor units elements constants diraculator",
  },
];

/** Normalize a tool into a searchable HelpItem. `meta` is the menu path so a
 *  search result tells the user where to find it. */
export function toolToHelpItem(t: HelpTool): HelpItem {
  return {
    key: t.id,
    title: t.name,
    detail: t.desc,
    meta: `Analyze ▸ ${t.section}`,
    keywords: `${t.section} ${t.keywords ?? ""} ${t.shortcut ?? ""}`.trim(),
  };
}

/** Search a HelpItem list, two tiers:
 *
 *   1. Title — FUZZY (subsequence, typo-tolerant), producing highlight hits.
 *   2. Fallback — a case-insensitive SUBSTRING of `detail`/`keywords`, so a
 *      topic stays findable by a word not in its title.
 *
 *  The fallback is a substring, NOT a fuzzy subsequence, on purpose: a fuzzy
 *  subsequence of a whole detail SENTENCE matches almost any short query
 *  (e.g. "hyster" is a subsequence of "...tHe overlaY the fitted...dataSeT...
 *  parameTErs, erroRs"), which would make the fallback noise. A substring
 *  ("the word appears") is precise and still covers detail-only words.
 *
 *  Title matches rank above fallback matches; within a tier, best fuzzy score
 *  first, then input order (Array.sort is stable). Blank query returns all. */
export function searchHelpItems(items: readonly HelpItem[], query: string): ScoredHelpItem[] {
  const q = query.trim();
  if (!q) return items.map((it) => ({ ...it, hits: [], score: 0 }));
  const ql = q.toLowerCase();
  const out: ScoredHelpItem[] = [];
  for (const it of items) {
    const onTitle = fuzzy(q, it.title);
    if (onTitle) {
      out.push({ ...it, hits: onTitle.hits, score: onTitle.score + 1000 });
      continue;
    }
    if (`${it.detail} ${it.keywords ?? ""}`.toLowerCase().includes(ql)) {
      out.push({ ...it, hits: [], score: 0 });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
