// Supported import-format catalog for the Help hub (GUI_INTERACTION #17).
// Pure data, authored from the backend parser registry (src/quantized/io/
// registry.py's _EXT_MAP + _SNIFFERS) — the single source of truth for what
// import_auto can actually read.
//
// importFormats.test.ts asserts every extension listed here is offered by
// `lib/openFilePicker.IMPORT_ACCEPT`, so the documented list and the file
// dialog can't drift apart (that drift is exactly what hid the missing
// .opj/.opju Origin entries until 2026-07-19).

import type { HelpItem } from "./helpContent";

export interface ImportFormat {
  /** File extensions, lower-case with the dot (e.g. ".xrdml"). */
  exts: string[];
  /** Instrument / vendor / format name. */
  name: string;
  /** Grouping for the browse view. */
  category: string;
  /** Optional extra detail (ambiguity notes, what it maps to). */
  note?: string;
}

export const IMPORT_FORMATS: readonly ImportFormat[] = [
  // ── X-ray & diffraction ──────────────────────────────────────────────
  { exts: [".xrdml"], name: "PANalytical XRDML", category: "X-ray & diffraction" },
  { exts: [".brml"], name: "Bruker DIFFRAC (BRML)", category: "X-ray & diffraction", note: "1-D line scans" },
  {
    exts: [".raw"],
    name: "Rigaku SmartLab / Bruker RAW",
    category: "X-ray & diffraction",
    note: "Auto-detected by magic bytes (Rigaku 'FI' vs Bruker 'RAW1.01').",
  },
  // ── Magnetometry & transport ─────────────────────────────────────────
  {
    exts: [".dat"],
    name: "Quantum Design / PPMS / Lake Shore",
    category: "Magnetometry & transport",
    note: "Content-sniffed: Quantum Design VSM, refl1d, PPMS, or Lake Shore.",
  },
  // ── Reflectometry & neutron ──────────────────────────────────────────
  {
    exts: [".refl"],
    name: "reductus / refl1d reflectivity",
    category: "Reflectometry & neutron",
    note: "reductus JSON header, or a refl1d 'Q R dR' column export.",
  },
  { exts: [".pnr"], name: "NCNR polarized neutron reflectometry", category: "Reflectometry & neutron" },
  {
    exts: [".data", ".datb", ".datc", ".datd"],
    name: "NCNR .datA/B/C/D",
    category: "Reflectometry & neutron",
  },
  // ── Spectroscopy ─────────────────────────────────────────────────────
  { exts: [".jdx", ".dx"], name: "JCAMP-DX", category: "Spectroscopy", note: "IR / Raman / UV-Vis / NMR / MS." },
  { exts: [".spc"], name: "GRAMS / Thermo SPC", category: "Spectroscopy", note: "Spectral binary." },
  { exts: [".opus"], name: "Bruker OPUS", category: "Spectroscopy", note: "FTIR / NIR / Raman binary." },
  // ── Chromatography ───────────────────────────────────────────────────
  { exts: [".nc", ".cdf"], name: "NetCDF (ANDI / AIA)", category: "Chromatography", note: "Generic NetCDF-3/4 too." },
  // ── Origin projects ──────────────────────────────────────────────────
  {
    exts: [".opj", ".opju"],
    name: "OriginLab project",
    category: "Origin projects",
    note: "Clean-room reader — .opj (≤2017 binary) and .opju (2018+ Unicode).",
  },
  // ── Tables ───────────────────────────────────────────────────────────
  {
    exts: [".csv", ".tsv", ".xlsx", ".xlsm"],
    name: "Delimited text & Excel",
    category: "Tables & generic",
    note: "SIMS depth profiles are auto-detected first. Any text file also imports via the Import Wizard.",
  },
];

/** Every extension the catalog documents, flattened (lower-case, dot-prefixed). */
export function documentedExtensions(): string[] {
  return IMPORT_FORMATS.flatMap((f) => f.exts);
}

/** Normalize a format into a searchable HelpItem so the one Help search covers
 *  formats alongside tools. `meta` is the extension list. */
export function formatToHelpItem(f: ImportFormat): HelpItem {
  return {
    key: `fmt:${f.exts[0]}`,
    title: f.name,
    detail: f.note ? `${f.category}. ${f.note}` : f.category,
    meta: f.exts.join(" "),
    keywords: `import open file format ${f.category} ${f.exts.join(" ")}`,
  };
}
