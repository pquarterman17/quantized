// Calculators ▸ Favorites tab — the user's pinned results (DiraCulator
// buildFavoritesTab). Same row UI as History; ★ unpins. Reads the standalone
// calcHistory store.

import { IconButton } from "../../primitives";
import { useCalcHistory } from "../../../store/calcHistory";

const META: React.CSSProperties = {
  color: "var(--text-dim)",
  fontSize: "var(--font-size-sm)",
};
const SUMMARY: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-sm)",
};

export default function FavoritesTab() {
  const favorites = useCalcHistory((s) => s.favorites);
  const toggleFavorite = useCalcHistory((s) => s.toggleFavorite);

  if (favorites.length === 0) {
    return (
      <div style={{ ...META, marginTop: 12, color: "var(--text-faint)" }}>
        No favorites yet — pin a result from History with the ☆ button.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {favorites.map((e) => (
        <div key={e.id} className="qz-meta-row" style={{ alignItems: "baseline", gap: 8 }}>
          <IconButton
            active
            aria-label="unpin from favorites"
            onClick={() => toggleFavorite(e.id)}
          >
            ★
          </IconButton>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div style={META}>
              {e.domain} · {e.label}
            </div>
            <div style={SUMMARY}>{e.summary}</div>
          </span>
        </div>
      ))}
    </div>
  );
}
