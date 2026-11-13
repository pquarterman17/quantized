// Peak Analyzer wizard — step ① (range & baseline), moved out of steps.tsx
// (which sat at the 400-line component ceiling) when the baseline picker grew
// the Baseline workshop's SNIP, anchor-point, Shirley and polynomial methods.

import { useState } from "react";

import { PEAK_ANCHOR_METHODS, peakClamp } from "../../../lib/peakwizard";
import { Select } from "../../primitives";
import { clamped, faint, Num } from "./stepFields";
import type { PeakWizardState } from "./usePeakWizard";

/** ① Range & baseline: cut the fit window, pick a baseline, live preview. */
export function StepRangeBaseline({ w }: { w: PeakWizardState }) {
  const b = w.recipe.baseline;
  return (
    <>
      <label className="qzk-field-lbl">X range (blank = full)</label>
      <div style={{ display: "flex", gap: 6 }}>
        <Num
          value={w.recipe.range.lo}
          placeholder="from"
          onValue={(v) => w.patchRecipe({ range: { lo: v } })}
        />
        <Num
          value={w.recipe.range.hi}
          placeholder="to"
          onValue={(v) => w.patchRecipe({ range: { hi: v } })}
        />
      </div>
      <label className="qzk-field-lbl" style={{ marginTop: 8 }}>
        Baseline
      </label>
      <Select
        aria-label="Peak baseline method"
        options={[
          { value: "none", label: "None" },
          { value: "als", label: "ALS (asymmetric least squares)" },
          { value: "rollingball", label: "Rolling ball" },
          { value: "modpoly", label: "Modified polynomial" },
          { value: "snip", label: "SNIP" },
          { value: "anchor", label: "Anchor points" },
          { value: "shirley", label: "Shirley (XPS/XAS)" },
          { value: "poly", label: "Polynomial (n)" },
        ]}
        value={b.method}
        onChange={(e) =>
          w.patchRecipe({ baseline: { method: e.target.value as typeof b.method } })
        }
      />
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {b.method === "als" && (
          <>
            <Num label="λ" value={b.lam} onValue={clamped(peakClamp.lam, (lam) => w.patchRecipe({ baseline: { lam } }))} />
            <Num label="p" value={b.p} onValue={clamped(peakClamp.p, (p) => w.patchRecipe({ baseline: { p } }))} />
          </>
        )}
        {b.method === "rollingball" && (
          <Num
            label="radius (pts)"
            value={b.radius}
            onValue={clamped(peakClamp.radius, (radius) => w.patchRecipe({ baseline: { radius } }))}
          />
        )}
        {(b.method === "modpoly" || b.method === "poly") && (
          <Num
            label="order"
            value={b.order}
            onValue={clamped(peakClamp.order, (order) => w.patchRecipe({ baseline: { order } }))}
          />
        )}
        {b.method === "shirley" && (
          <Num
            label="max iterations"
            value={b.maxIter ?? 50}
            onValue={clamped(peakClamp.maxIter, (maxIter) => w.patchRecipe({ baseline: { maxIter } }))}
          />
        )}
      </div>
      {b.method === "anchor" && <AnchorFields w={w} />}
      {w.baselineBusy && <div className="qzk-ds-meta">estimating baseline…</div>}
      {w.baselineError && (
        <div className="qzk-ds-meta" style={{ color: "var(--danger)" }}>
          {w.baselineError}
        </div>
      )}
      {b.method !== "none" && !w.baselineBusy && !w.baselineError && (
        <div className="qzk-ds-meta" style={{ ...faint, marginTop: 6 }}>
          Baseline previewed on the plot; later steps fit the subtracted signal.
        </div>
      )}
    </>
  );
}

/** Parse "x1, x2; x3" into finite numbers; null when any token is not one. */
export function parseAnchorX(text: string): number[] | null {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const values = tokens.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

/** Anchor-point X positions (each anchored at the trace's y there) and the
 *  interpolation — the Baseline workshop's anchor method, typed instead of
 *  clicked so a recipe replays on every batch dataset. */
function AnchorFields({ w }: { w: PeakWizardState }) {
  const b = w.recipe.baseline;
  const [text, setText] = useState((b.anchorX ?? []).join(", "));
  const parsed = parseAnchorX(text);
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input
        className="qz-input"
        value={text}
        placeholder="anchor X, e.g. 10, 25, 40"
        aria-label="Baseline anchor X positions"
        aria-invalid={parsed === null}
        onChange={(e) => {
          setText(e.target.value);
          const xs = parseAnchorX(e.target.value);
          if (xs) w.patchRecipe({ baseline: { anchorX: xs } });
        }}
      />
      <Select
        aria-label="Anchor interpolation"
        options={PEAK_ANCHOR_METHODS.map((m) => ({ value: m, label: m }))}
        value={b.anchorMethod ?? "pchip"}
        onChange={(e) => w.patchRecipe({ baseline: { anchorMethod: e.target.value as (typeof PEAK_ANCHOR_METHODS)[number] } })}
      />
      <span className="qzk-ds-meta" style={faint}>
        {parsed === null ? "numbers only, separated by commas" : "each anchor sits on the data at that X"}
      </span>
    </div>
  );
}
