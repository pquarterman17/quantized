// Per-series X for the Quick Figure Builder (LIBRARY_WORKBOOK_UX_PLAN,
// "multiple independent X channels"): one X menu per Y series, so an
// `X,Y,X,Y,X,Y` worksheet plots each Y against its OWN X. "Shared X" follows
// the X axis role; any other choice is that series' override
// (`QuickFigureMapping.xKeyByY`). Open from the start when the mapping already
// pairs a series with its own X (e.g. inferred from Origin designations);
// otherwise one "Per-series X…" button reveals it (a CSV has no designations,
// so its pairing is always the user's explicit choice).

import { useState } from "react";

import type { QuickFigureMapping } from "../../../lib/quickFigureMapping";
import { assignSeriesX, seriesXCandidates } from "../../../lib/quickFigureMappingActions";
import { usesPerSeriesX, xSourceName } from "../../../lib/quickFigureSeriesX";
import type { DataStruct } from "../../../lib/types";

interface Props {
  data: DataStruct;
  mapping: QuickFigureMapping;
  onChange: (mapping: QuickFigureMapping) => void;
}

const SHARED = "shared";
const ACQUISITION = "acquisition";

function currentValue(mapping: QuickFigureMapping, y: number): string {
  const own = mapping.xKeyByY ?? {};
  if (!Object.hasOwn(own, y)) return SHARED;
  const x = own[y];
  return x === null ? ACQUISITION : String(x);
}

export default function QuickSeriesXPanel({ data, mapping, onChange }: Props) {
  // Collapsed to one button on a shared-X sheet, so the Y list is not
  // repeated there; open from the start when a series already has its own X.
  const [open, setOpen] = useState(() => usesPerSeriesX(mapping));
  if (mapping.yKeys.length === 0) return null;
  if (!open) {
    return (
      <button type="button" className="qz-btn qzk-quick-builder-help" onClick={() => setOpen(true)}>
        Per-series X…
      </button>
    );
  }
  const candidates = (y: number) => seriesXCandidates(mapping, data.labels.length, y).filter((x) => x !== mapping.xKey);
  const count = mapping.yKeys.filter((y) => currentValue(mapping, y) !== SHARED).length;
  return (
    <section className="qzk-quick-builder-seriesx" aria-label="Per-series X">
      <p className="qzk-quick-builder-help">Per-series X{count > 0 ? ` (${count} with their own X)` : ""}</p>
      <ul className="qzk-quick-builder-columns">
        {mapping.yKeys.map((y) => (
          <li key={y}>
            <span><strong>{data.labels[y]}</strong></span>
            <select
              aria-label={`X for ${data.labels[y]}`}
              value={currentValue(mapping, y)}
              onChange={(event) => {
                const v = event.target.value;
                onChange(assignSeriesX(mapping, y, v === SHARED ? "shared" : v === ACQUISITION ? null : Number(v)));
              }}
            >
              <option value={SHARED}>{`Shared X (${xSourceName(data, mapping.xKey)})`}</option>
              {candidates(y).map((x) => (
                <option key={x ?? ACQUISITION} value={x === null ? ACQUISITION : String(x)}>
                  {xSourceName(data, x)}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <p className="qzk-quick-builder-help">
        Each series plots against its own X in acquisition order. X error columns pair with the shared X only.
      </p>
    </section>
  );
}
