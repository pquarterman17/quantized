// Curve Fit's parameter table (UX audit 8 #5, lane UX8-D). One line per value
// and per CI, no wrapping (UX-F) -- while the dock is wide enough. In the
// docked Inspector at 1280-1440 px the "95 % CI" column was clipped behind a
// sideways scroll nobody saw ("95" in the header, values ending in "×").
// So when the one-line table is wider than its box, the CI moves onto a
// second line under "Value ± SE" and its column goes: nothing is clipped. The
// box is measured, not guessed (the widths depend on the model's names and
// the numbers' magnitudes); it goes back to one line once the box is as wide
// as the one-line table was. The sideways scroll stays as a last resort.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { DataTable } from "../../primitives/DataTable";

const CI = "95 % CI";
const VALUE = "Value ± SE";

export default function FitParamTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const box = useRef<HTMLDivElement>(null);
  // The one-line layout's width for THIS content, once it was seen to overflow.
  const sig = JSON.stringify([columns, rows]);
  const [wide, setWide] = useState<{ sig: string; width: number } | null>(null);
  const ci = columns.indexOf(CI);
  const value = columns.indexOf(VALUE);
  const stacked = wide?.sig === sig && ci >= 0 && value >= 0;
  const state = useRef({ sig, stacked, wide });
  state.current = { sig, stacked, wide };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const s = state.current;
      if (!s.stacked) {
        if (el.scrollWidth > el.clientWidth + 1) setWide({ sig: s.sig, width: el.scrollWidth });
      } else if (s.wide && el.clientWidth >= s.wide.width) {
        setWide(null);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sig, stacked]);

  // Stacked: the value column carries the CI as a faint second line, its
  // header both names.
  const two = (top: string, under: string | undefined, key: number) => (
    <span key={key} style={{ display: "inline-flex", flexDirection: "column" }}>
      <span>{top}</span>
      {under && under !== "—" && <span style={{ color: "var(--text-faint)" }}>{under}</span>}
    </span>
  );
  const fold = (cells: string[], under: string | undefined): ReactNode[] =>
    cells.flatMap((cell, i) => (i === ci ? [] : [i === value ? two(cell, under, i) : cell]));
  const shownColumns = stacked ? fold(columns, CI) : columns;
  const shownRows = stacked ? rows.map((r) => fold(r, r[ci])) : rows;
  return (
    <div
      ref={box}
      className="qzk-nowrap-table qzk-dense-table"
      data-ci-stacked={stacked ? "" : undefined}
      style={{ marginTop: 12, overflowX: "auto" }}
    >
      <DataTable columns={shownColumns} rows={shownRows} />
    </div>
  );
}
