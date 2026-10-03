// P2.5 live data preview: the first rows of a transform's RESULT, with column
// names and units, as a small table — shown before anything is created by the
// Reshape & combine workshop and the Split dialog. Categorical cells show
// their level text, text columns their strings, blanks "NaN". Only lazy
// dialogs import this.

import { levelLabel } from "../../lib/categorical";
import { originTextColumns } from "../../lib/originTextColumns";
import type { DataStruct } from "../../lib/types";

/** Rows shown. */
export const PREVIEW_ROWS = 20;

const num = (v: number | undefined): string =>
  v === undefined || !Number.isFinite(v) ? "NaN" : String(Number(v.toPrecision(6)));

const head = (name: string, unit: string | undefined) => (unit ? `${name} (${unit})` : name);

export default function TransformPreviewTable({ data, label = "Preview rows" }: { data: DataStruct; label?: string }) {
  const total = data.time.length;
  const shown = Math.min(PREVIEW_ROWS, total);
  const text = originTextColumns(data);
  const xName = String(data.metadata?.x_column_name ?? "") || "X";
  const xUnit = typeof data.metadata?.x_column_unit === "string" ? data.metadata.x_column_unit : "";
  const rows = Array.from({ length: shown }, (_, r) => r);
  return (
    <div className="qzk-dense-table" style={{ marginTop: 6, maxHeight: 220, overflow: "auto" }}>
      <table className="qz-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{head(xName, xUnit)}</th>
            {data.labels.map((l, c) => (
              <th scope="col" key={`c${c}`}>{head(l || `column ${c + 1}`, data.units[c])}</th>
            ))}
            {text.map((t) => (
              <th scope="col" key={`t${t.shortName}`}>{t.shortName}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <td>{num(data.time[r])}</td>
              {data.labels.map((_, c) => {
                const v = data.values[r]?.[c];
                return <td key={`c${c}`}>{levelLabel(data, c, v ?? Number.NaN) ?? num(v)}</td>;
              })}
              {text.map((t) => (
                <td key={`t${t.shortName}`}>{t.rows[r] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="qzk-ds-meta" style={{ marginTop: 2 }}>
        {total > shown ? `First ${shown} of ${total} rows.` : `All ${total} row${total === 1 ? "" : "s"}.`}
      </div>
    </div>
  );
}
