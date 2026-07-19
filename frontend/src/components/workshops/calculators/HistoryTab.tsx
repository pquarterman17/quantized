// Calculators ▸ History tab — the running log of computed results (DiraCulator
// buildHistoryTab). Newest-first; each row shows domain · label + the result
// (mono), with a ☆/★ toggle to pin it to Favorites. "Clear" empties the log
// (favorites are kept). Reads the standalone calcHistory store.

import { askConfirm } from "../../overlays/ConfirmDialog";
import { Button, IconButton } from "../../primitives";
import { useCalcHistory } from "../../../store/calcHistory";

const META: React.CSSProperties = {
  color: "var(--text-dim)",
  fontSize: "var(--font-size-sm)",
};
const SUMMARY: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-sm)",
};

export default function HistoryTab() {
  const history = useCalcHistory((s) => s.history);
  const favorites = useCalcHistory((s) => s.favorites);
  const toggleFavorite = useCalcHistory((s) => s.toggleFavorite);
  const clearHistory = useCalcHistory((s) => s.clearHistory);
  const favIds = new Set(favorites.map((e) => e.id));

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={META}>{history.length} result{history.length === 1 ? "" : "s"}</span>
        {/* GUI_INTERACTION #17: an irrecoverable wipe of accumulated work
            (every result would have to be re-run) gets a named label and a
            confirm, rather than a bare verb on a one-click ghost button.
            Favourites survive, so the confirm says so. */}
        <Button
          size="sm"
          variant="ghost"
          disabled={history.length === 0}
          onClick={() => {
            void askConfirm(
              `Clear ${history.length} calculator result${history.length === 1 ? "" : "s"}?`,
              "Favourites are kept. This cannot be undone.",
              "Clear history",
              true,
            ).then((ok) => {
              if (ok) clearHistory();
            });
          }}
        >
          Clear history
        </Button>
      </div>

      {history.length === 0 ? (
        <div style={{ ...META, marginTop: 10, color: "var(--text-faint)" }}>
          No results yet — run a calculator and it will appear here.
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {history.map((e) => {
            const fav = favIds.has(e.id);
            return (
              <div
                key={e.id}
                className="qz-meta-row"
                style={{ alignItems: "baseline", gap: 8 }}
              >
                <IconButton
                  active={fav}
                  aria-label={fav ? "unpin from favorites" : "pin to favorites"}
                  onClick={() => toggleFavorite(e.id)}
                >
                  {fav ? "★" : "☆"}
                </IconButton>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={META}>
                    {e.domain} · {e.label}
                  </div>
                  <div style={SUMMARY}>{e.summary}</div>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
