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
  { exts: [".brml"], name: "Bruker DIFFRAC (BRML)", category: "X-ray & diffraction", note: "scans and RSMs" },
  {
    exts: [".raw"],
    name: "Rigaku SmartLab / Bruker RAW",
    category: "X-ray & diffraction",
    note: "Auto-detected by magic bytes (Rigaku 'FI' vs Bruker 'RAW1.01').",
  },
  {
    exts: [".cif"],
    name: "Crystallographic Information File (CIF)",
    category: "X-ray & diffraction",
    note: "A crystal structure, not a dataset: it becomes a lattice preset for Pawley and the Crystal calculator.",
  },
  // ── Magnetometry & transport ─────────────────────────────────────────
  {
    exts: [".dat"],
    name: "Quantum Design / PPMS / Lake Shore",
    category: "Magnetometry & transport",
    note: "Content-sniffed: Quantum Design, refl1d, PPMS, or Lake Shore; any other .dat reads as a plain table.",
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
    exts: [".ort"],
    name: "ORSO reduced reflectivity",
    category: "Reflectometry & neutron",
    note: "Standards 0.1 and 1.0; each data set becomes its own curve.",
  },
  {
    exts: [".data", ".datb", ".datc", ".datd"],
    name: "NCNR .datA/B/C/D",
    category: "Reflectometry & neutron",
  },
  // ── Spectroscopy ─────────────────────────────────────────────────────
  { exts: [".jdx", ".dx"], name: "JCAMP-DX", category: "Spectroscopy", note: "IR / Raman / UV-Vis / NMR / MS." },
  { exts: [".spc"], name: "GRAMS / Thermo SPC", category: "Spectroscopy", note: "Spectral binary." },
  {
    exts: [".opus", ".0", ".1", ".2", ".3", ".4", ".5", ".6", ".7", ".8", ".9"],
    name: "Bruker OPUS",
    category: "Spectroscopy",
    note: "FTIR / NIR / Raman binary, including numbered sample.0, sample.1 … files.",
  },
  // ── Chromatography ───────────────────────────────────────────────────
  { exts: [".nc", ".cdf"], name: "NetCDF (ANDI / AIA)", category: "Chromatography", note: "Generic NetCDF-3/4 too." },
  // ── Array containers & images ────────────────────────────────────────
  {
    exts: [".h5", ".hdf5", ".nxs"],
    name: "HDF5 / NeXus",
    category: "Array containers & images",
    note:
      "Quantized's own HDF5 export re-imports exactly. NeXus NXdata uses @signal/@axes for its axes; other groups give their 1-D/2-D datasets as columns. Ambiguous files are refused, never guessed.",
  },
  {
    exts: [".mat"],
    name: "MATLAB MAT-file",
    category: "Array containers & images",
    note: "v5 and v7.3. Numeric arrays and structs of arrays become columns, names kept.",
  },
  {
    exts: [".ibw"],
    name: "Igor Pro binary wave",
    category: "Array containers & images",
    note: "Versions 2 and 5. Units and x scaling (x0, dx) are kept; a 2-D wave is a map.",
  },
  {
    exts: [".png", ".tif", ".tiff", ".jpg", ".jpeg"],
    name: "Images",
    category: "Array containers & images",
    note:
      "A 2-D map of intensity (16-bit TIFF kept as stored). Colour is converted to luminance (0.299 R + 0.587 G + 0.114 B); limit 2048 × 2048 pixels.",
  },
  // ── Origin projects ──────────────────────────────────────────────────
  {
    exts: [".opj", ".opju"],
    name: "OriginLab project",
    category: "Origin projects",
    note: "Clean-room reader — .opj (≤2017 binary) and .opju (2018+ Unicode).",
  },
  // ── Tables ───────────────────────────────────────────────────────────
  {
    exts: [".csv", ".tsv", ".txt", ".xy", ".xye", ".xlsx", ".xlsm", ".xls"],
    name: "Delimited text & Excel",
    category: "Tables & generic",
    note:
      "SIMS depth profiles are auto-detected first. Every data sheet of a workbook imports as its own dataset. Any text file also imports via the Import Wizard.",
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
