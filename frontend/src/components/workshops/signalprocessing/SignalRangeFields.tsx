// The optional "Limit output to an X range" control shared by every Signal
// Processing body (recipe operations, the filters and the spectrogram). The
// fields hold the strings the inputs hold; each model validates and sends them.

import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";

export interface RangeFieldsValue {
  useRange: boolean;
  xMin: string;
  xMax: string;
}

export default function SignalRangeFields({ value, onChange }: {
  value: RangeFieldsValue;
  onChange: (patch: Partial<RangeFieldsValue>) => void;
}) {
  return (
    <div className="qz-signal-smooth">
      <Checkbox checked={value.useRange} onChange={(useRange) => onChange({ useRange })}>
        Limit output to an X range
      </Checkbox>
      {value.useRange && (
        <>
          <label>X minimum
            <NumberField value={value.xMin} onChange={(v) => onChange({ xMin: String(v) })} />
          </label>
          <label>X maximum
            <NumberField value={value.xMax} onChange={(v) => onChange({ xMax: String(v) })} />
          </label>
        </>
      )}
    </div>
  );
}

/** The finite `[min, max]` of an X column (null when it has none): what the range fields start at. */
export function xExtent(x: readonly number[]): { xMin: string; xMax: string } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of x) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { xMin: String(min), xMax: String(max) } : null;
}
