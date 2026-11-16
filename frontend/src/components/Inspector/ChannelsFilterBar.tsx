// Channels card, many-column mode: a name filter plus Select all / none for the
// rows the filter leaves visible. Presentational only -- ChannelsCard owns the
// selection rules (always keep one plotted channel).

export default function ChannelsFilterBar({
  query,
  onQuery,
  shown,
  total,
  onAll,
  onNone,
}: {
  query: string;
  onQuery: (q: string) => void;
  shown: number;
  total: number;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div className="qzk-channel-filter" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
      <input
        className="qz-input"
        type="search"
        style={{ flex: 1, minWidth: 0 }}
        placeholder="Filter channels…"
        aria-label="Filter channels"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <span className="qz-k" aria-live="polite" style={{ flex: "0 0 auto", color: "var(--text-faint)" }}>
        {shown}/{total}
      </span>
      <button type="button" className="qz-btn qz-ghost" onClick={onAll} title="Plot every channel shown by the filter">
        All
      </button>
      <button type="button" className="qz-btn qz-ghost" onClick={onNone} title="Hide every channel shown by the filter (one stays plotted)">
        None
      </button>
    </div>
  );
}
