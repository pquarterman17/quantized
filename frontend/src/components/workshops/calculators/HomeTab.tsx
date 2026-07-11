// Calculators ▸ Home tab — the landing panel (DiraCulator buildHomeTab). A short
// intro plus the calculator domains grouped exactly as the panel selector, each
// a one-click jump to that tab. Reuses TAB_GROUPS so the two never drift.

import { Button } from "../../primitives";
import { TAB_GROUPS } from "./CalculatorsContent";
import type { CalcTab } from "./useCalculators";

export default function HomeTab({ onPick }: { onPick: (tab: CalcTab) => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <p
        style={{
          marginTop: 0,
          marginBottom: 4,
          color: "var(--text-dim)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        Materials-science calculators. Pick a domain to begin — every result is
        saved to History, and you can pin the ones you reuse to Favorites.
      </p>

      {TAB_GROUPS.filter((g) => g.group !== "Session").map((g) => (
        <div key={g.group} style={{ marginTop: 10 }}>
          <div className="qzk-field-lbl" style={{ marginTop: 0, marginBottom: 6 }}>
            {g.group}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {g.tabs.map((t) => (
              <Button key={t.value} size="sm" onClick={() => onPick(t.value)}>
                {t.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
