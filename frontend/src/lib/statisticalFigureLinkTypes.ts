/** Compact, bounded source-row relation stored beside a frozen statistical
 * figure. It records how to recover rows, never the source values themselves. */
export type StatisticalFigureLinkDescriptor =
  | { kind: "direct"; rows: number[] }
  | {
      kind: "match";
      responseColumn: number;
      rows: { levels: [column: number, label: string][] }[];
    }
  | {
      kind: "histogram";
      responseColumn: number;
      level?: { column: number; label: string };
      bins: [left: number, right: number][];
    };
