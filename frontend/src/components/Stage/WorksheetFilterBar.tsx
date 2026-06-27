// Presentational filter bar for the Worksheet: pick a column + operator + value
// to narrow the visible rows. All state lives in the parent (Worksheet); this is
// a thin props-driven view so the worksheet component stays under the size budget.

// Row-filter comparison operators: value = predicate key, label = glyph.
export const OP_OPTIONS: [string, string][] = [
  [">", ">"],
  [">=", "≥"],
  ["<", "<"],
  ["<=", "≤"],
  ["==", "="],
  ["!=", "≠"],
  ["between", "between"],
];

export interface WorksheetFilterBarProps {
  xName: string;
  labels: string[];
  filterCol: string;
  filterOp: string;
  filterV1: string;
  filterV2: string;
  setFilterCol: (v: string) => void;
  setFilterOp: (v: string) => void;
  setFilterV1: (v: string) => void;
  setFilterV2: (v: string) => void;
  filterActive: boolean;
  keptCount: number;
  totalCount: number;
  onExtract: () => void;
}

export default function WorksheetFilterBar(props: WorksheetFilterBarProps) {
  const {
    xName, labels, filterCol, filterOp, filterV1, filterV2,
    setFilterCol, setFilterOp, setFilterV1, setFilterV2,
    filterActive, keptCount, totalCount, onExtract,
  } = props;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderBottom: "1px solid var(--border, #333)",
        flexWrap: "wrap",
      }}
    >
      <span className="qzk-field-lbl" style={{ margin: 0 }}>
        filter
      </span>
      <select
        className="qz-select"
        aria-label="filter column"
        value={filterCol}
        onChange={(e) => setFilterCol(e.target.value)}
      >
        <option value="">(no filter)</option>
        <option value="-1">{xName}</option>
        {labels.map((lab, c) => (
          <option key={lab} value={String(c)}>
            {lab}
          </option>
        ))}
      </select>
      {filterCol !== "" && (
        <>
          <select
            className="qz-select"
            aria-label="filter operator"
            value={filterOp}
            onChange={(e) => setFilterOp(e.target.value)}
          >
            {OP_OPTIONS.map(([val, glyph]) => (
              <option key={val} value={val}>
                {glyph}
              </option>
            ))}
          </select>
          <input
            className="qz-input qz-num"
            aria-label="filter value"
            placeholder="value"
            value={filterV1}
            onChange={(e) => setFilterV1(e.target.value)}
            style={{ width: 80 }}
          />
          {filterOp === "between" && (
            <input
              className="qz-input qz-num"
              aria-label="filter value upper"
              placeholder="and"
              value={filterV2}
              onChange={(e) => setFilterV2(e.target.value)}
              style={{ width: 80 }}
            />
          )}
          <button className="qz-btn" disabled={!filterActive} onClick={onExtract}>
            Extract →
          </button>
        </>
      )}
      <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {filterActive ? `${keptCount} of ${totalCount} rows` : `${totalCount} rows`}
      </span>
    </div>
  );
}
