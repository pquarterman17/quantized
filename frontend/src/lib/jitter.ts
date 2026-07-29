// Deterministic point jitter (JMP_GAP J5 #1): a pure hash of (rowIndex,
// category) -> [-1,1], NEVER Math.random -- so a raw point's horizontal
// scatter within its box/strip category slot is stable across re-renders
// (test stability) and IDENTICAL between the interactive canvas
// (Stage/statRenderBox.ts) and the matplotlib export
// (calc.statplots.deterministic_jitter mirrors this bit-for-bit: FNV-1a
// hashes the UTF-8 category bytes, XORs in a Knuth-multiplicative row term,
// then a `triple32` integer mix -- a well-known 32-bit avalanche hash).
// Verified byte-identical against the Python implementation for the shared
// fixtures both test suites pin (see jitter.test.ts / test_calc_statplots.py).
//
// Row-state exclusion (#50) simply omits a row's point; it never renumbers
// or reseeds its still-visible neighbours, because the hash depends only on
// the ORIGINAL dataset row index, not a point's position within the
// filtered group (lib/statschooser.ts's `groupsByCategoryIndexed` /
// `groupsFromColumnsIndexed` carry that original index through).

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const textEncoder = new TextEncoder();

function fnv1a32(bytes: Uint8Array): number {
  let h = FNV_OFFSET_BASIS >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** A standard 32-bit integer avalanche mix ("triple32"). */
function triple32(xIn: number): number {
  let x = xIn >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Deterministic pseudo-random offset in [-1, 1] for one (rowIndex,
 *  category) pair -- the box/strip "show points" jitter. Pure: the same
 *  inputs always produce the byte-identical output, so a re-render, a test
 *  run, and the server-side export all agree on where a point sits. */
export function deterministicJitter(rowIndex: number, category: string): number {
  const catHash = fnv1a32(textEncoder.encode(category));
  const rowTerm = Math.imul(rowIndex >>> 0, 0x9e3779b1) >>> 0;
  const mixed = triple32((catHash ^ rowTerm) >>> 0);
  return (mixed / 4294967295) * 2 - 1;
}
