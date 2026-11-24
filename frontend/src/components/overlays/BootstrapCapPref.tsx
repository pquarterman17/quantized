// Preferences ▸ Fitting: "Maximum bootstrap replicates" (lib/fitPrefs.ts).
// A value outside the allowed range is kept out of the pref and SAID.

import { useState } from "react";

import {
  BOOTSTRAP_CAP_MAX,
  BOOTSTRAP_CAP_MIN,
  bootstrapCap,
  saveBootstrapCap,
  validBootstrapCap,
} from "../../lib/fitPrefs";
import { NumberField } from "../primitives/NumberField";

const RANGE = `${BOOTSTRAP_CAP_MIN} to ${BOOTSTRAP_CAP_MAX.toLocaleString("en-US")}`;

export function BootstrapCapPref() {
  const [cap, setCap] = useState(bootstrapCap);
  const [text, setText] = useState(String(cap));
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        Maximum bootstrap replicates
        <span className="hint">the most a bootstrap or corner plot may resample (default 10,000)</span>
      </div>
      <div className="qzk-pref-ctl">
        <NumberField
          aria-label="Maximum bootstrap replicates"
          aria-invalid={note ? true : undefined}
          value={text}
          width={96}
          onChange={(t) => {
            setText(t);
            const n = validBootstrapCap(Number(t.replace(/,/g, "")));
            if (t.trim() === "" || n === null) {
              setNote(`Use a whole number from ${RANGE}. Still ${cap.toLocaleString("en-US")}.`);
              return;
            }
            setNote(null);
            setCap(n);
            saveBootstrapCap(n);
          }}
          onBlur={() => {
            if (note) {
              setText(String(cap));
              setNote(null);
            }
          }}
        />
        {note && (
          <span className="hint qzk-pref-warn" role="alert">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
