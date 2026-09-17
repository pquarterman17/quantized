// Resolve an XRD pattern's X-ray wavelength (Å) from its instrument metadata
// (PRIMARY_SOFTWARE_AUDIT_PLAN P2.1). Pure lib — a DataStruct's `metadata` in,
// a number or null out.
//
// The keys are exactly the ones the parsers write — VERIFIED by grep over
// `src/quantized/io/` on 2026-09-14, and narrowed to two by that check:
//   `wavelength_a`   — io/xrdml.py:384 and io/_xrdml_scan.py:273. The value is
//                      the file's own kAlpha1 element (io/xrdml.py:86 reads it),
//                      already in Å, or null.
//   `alpha_average`  — io/bruker_raw.py:154, the Kα average at byte 616.
// The order is deliberate and DOES fire: `wavelength_a` IS the Kα1 line, and an
// explicit Kα1 beats the Kα1/Kα2 average, because a Williamson-Hall fit on a
// Kα1-stripped pattern wants the Kα1 line. (For Cu that is 1.540598 vs 1.5418,
// +0.08 % straight into D = Kλ/intercept — small, but it should not be silent.)
//
// REMOVED 2026-09-14 (review round 2): `k_alpha1`/`kAlpha1` were listed and
// read here, and NO parser writes either. io/xrd_csv.py:285 is the ASCII
// EXPORTER reading them back out of metadata, and io/xrdml.py:86 is an XML
// element name, not a metadata key — two of four keys were dead, and the
// stated Kα1 preference could never fire for the one parser that could have
// supplied it. A Bruker RAW pattern still adopts the Kα AVERAGE, because
// io/bruker_raw.py documents `alpha1` at byte 624 but emits only
// `alpha_average`; decoding it is a backend change, tracked in the plan.
//
// A value is accepted only inside 0.2–10 Å. That window covers every lab anode
// line (Cu Kα1 1.5406, Mo Kα1 0.7093, Ag Kα1 0.5594, and W Kα1 0.2090 at the
// floor) while rejecting the two ways this field is wrong in real files: a 0 or
// negative placeholder, and a wavelength recorded in nanometres or picometres
// (0.15406 nm is below the floor, 154.06 pm above the ceiling) — either of
// which would silently scale a crystallite size by 10x. The deliberate cost is
// that a sub-0.2 Å synchrotron wavelength is not adopted either; that falls
// back to the panel's own field, which the user can type, rather than to a
// number this module cannot tell apart from a unit mistake.

const WAVELENGTH_KEYS = ["wavelength_a", "alpha_average"] as const;

const MIN_A = 0.2;
const MAX_A = 10;

/** The wavelength in Å, or null when the metadata carries none that is
 *  plausible. Never throws — metadata is whatever the file happened to hold. */
export function wavelengthFromMetadata(metadata: Record<string, unknown> | undefined): number | null {
  if (!metadata) return null;
  for (const key of WAVELENGTH_KEYS) {
    const raw = metadata[key];
    const v = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(v) && v >= MIN_A && v <= MAX_A) return v;
  }
  return null;
}
