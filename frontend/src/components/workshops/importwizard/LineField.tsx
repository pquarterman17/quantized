// Import wizard — one 1-based line field (Header / Units / Label / Data start).
// The wire's indices are 0-based; the field shows them 1-based, like the
// raw-lines gutter. A buffered field: binding the input straight to
// `index + 1` snapped a cleared "Data start line" back to "1", so typing 5
// read "15" and silently dropped 14 rows. The draft text stays as typed; only
// a whole line number (1 or more) commits.

import { lineIndex } from "../../../lib/importRawLines";
import BufferedNumberField from "../../primitives/BufferedNumberField";

export default function LineField({
  value,
  onLine,
  required = false,
}: {
  /** The 0-based line index, or null for "none". */
  value: number | null | undefined;
  onLine: (index: number | null) => void;
  /** A field that cannot be "none" (Data start): a blank draft commits
   *  nothing and reverts on blur. */
  required?: boolean;
}) {
  return (
    <BufferedNumberField
      value={value == null ? undefined : value + 1}
      min={1}
      required={required}
      placeholder={required ? undefined : "none"}
      width={56}
      onValue={(v) => {
        if (v === undefined) {
          if (!required) onLine(null);
          return;
        }
        const index = lineIndex(String(v));
        if (index !== null) onLine(index);
      }}
    />
  );
}
