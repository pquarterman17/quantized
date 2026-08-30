// The attribution core of profile-eager-bundle.mjs, split out so it can be
// tested. Pure: sourcemap fields in, bytes-per-source out, no file system.
//
// Two things here are easy to get subtly wrong, and both were wrong in this
// script's first version (caught in review on #274). A profiler that is
// quietly off by a few percent is worse than no profiler, because its output
// gets pasted into a plan and used to schedule work.

/** base64 alphabet, as a lookup for VLQ digits. */
const B64 = new Map(
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]),
);

/** Decode one VLQ segment into its signed fields. */
export function decodeSegment(seg) {
  const out = [];
  let shift = 0;
  let acc = 0;
  for (const ch of seg) {
    const d = B64.get(ch);
    if (d === undefined) return out; // malformed — keep what parsed
    acc |= (d & 31) << shift;
    if (d & 32) {
      shift += 5;
    } else {
      out.push((acc >> 1) * (acc & 1 ? -1 : 1));
      shift = 0;
      acc = 0;
    }
  }
  return out;
}

/** Bytes of generated output owned by each source module.
 *
 *  ── UNMAPPED SEGMENTS ARE STILL BOUNDARIES ─────────────────────────────
 *  A sourcemap line mixes 4/5-field segments (mapped to a source) with
 *  1-field ones (generated text belonging to nothing — bundler boilerplate,
 *  runtime glue). The first version advanced the column for every segment but
 *  only RECORDED the mapped ones, so a mapped span ran to the next MAPPED
 *  segment and swallowed any unmapped text in between, charging boilerplate
 *  to whichever module happened to precede it. Every segment is recorded
 *  here, unmapped ones with a null source: they end the preceding span and
 *  contribute nothing themselves, so the gap stays unattributed.
 *
 *  ── COLUMNS ARE UTF-16 UNITS, THE ANSWER IS UTF-8 BYTES ────────────────
 *  Sourcemap columns are UTF-16 code units, so slicing the generated line by
 *  column is right — but `end - start` is then a COUNT OF UNITS, and the
 *  first version reported that as "bytes" and compared it against
 *  `statSync().size`, which is UTF-8. Any non-ASCII in generated output makes
 *  the two diverge. Slice by column, then measure the slice with
 *  `Buffer.byteLength`. */
export function attributeMappings({ mappings, sources, lines }, into = new Map()) {
  let srcIndex = 0;
  mappings.split(";").forEach((lineMappings, lineNo) => {
    const line = lines[lineNo] ?? "";
    let col = 0;
    /** @type {[number, number|null][]} startColumn, source index or null */
    const segs = [];
    for (const seg of lineMappings.split(",")) {
      if (!seg) continue;
      const v = decodeSegment(seg);
      if (v.length === 0) continue;
      col += v[0];
      if (v.length >= 4) {
        srcIndex += v[1];
        segs.push([col, srcIndex]);
      } else {
        segs.push([col, null]); // boundary only — see the note above
      }
    }
    segs.forEach(([start, si], i) => {
      if (si === null) return;
      const end = i + 1 < segs.length ? segs[i + 1][0] : line.length;
      const src = sources[si];
      if (src === undefined) return;
      const text = line.slice(start, Math.max(start, end));
      into.set(src, (into.get(src) ?? 0) + Buffer.byteLength(text, "utf8"));
    });
  });
  return into;
}
