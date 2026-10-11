// Stable identity guard for positional fit subsets. Row numbers alone are not
// identities: sorting, or deleting and replacing a row, can keep both the row
// count and selected positions unchanged while pointing at different data.

const bytes = new DataView(new ArrayBuffer(8));

function mix(hash: number, value: number, prime: number): number {
  bytes.setFloat64(0, Number.isFinite(value) ? value + 0 : Number.NaN);
  let next = hash;
  for (let index = 0; index < 8; index++) next = Math.imul(next ^ bytes.getUint8(index), prime) >>> 0;
  return next;
}

/** Fingerprint the ordered, finite X values actually consumed by a subset fit.
 * Y is deliberately excluded so editing measured values can still trigger a
 * legitimate refit when the selected observations themselves have not moved. */
export function fitRowXFingerprint(x: readonly number[]): string {
  let a = mix(0x811c9dc5, x.length, 0x01000193);
  let b = mix(0x9747b28c, x.length, 0x5bd1e995);
  for (const value of x) {
    a = mix(a, value, 0x01000193);
    b = mix(b, value, 0x5bd1e995);
  }
  return `x1:${x.length}:${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}
