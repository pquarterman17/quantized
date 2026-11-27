// Statistical tests workshop — view. One ToolWindow for the tests the Test
// chooser does not cover: normality (Anderson-Darling, KS), two-sample and
// paired comparisons, Dunnett / Friedman / repeated-measures / two-way ANOVA,
// multiple and stepwise regression, partial correlation, t-test power, ROC /
// AUC / Youden, logistic and Poisson regression, chi-square goodness of fit and
// p-value adjustment.
// Pick a test and its columns, Run, read one plain-language sentence plus the
// results table, then Copy / Export CSV / → Report. All state lives in
// useStatsTests; the pickers are StatsTestsInputs; the result reads as one
// result book (lane RB4, StatsTestsResultBook).

import { useState } from "react";

import type { StatsTestId } from "../../../lib/api/statsTests";
import { lazyRegion } from "../../../lib/lazyRegion";
import { statsTestGroups } from "../../../lib/statsTestGroups";
import { useStatsTestsStore } from "../../../store/statsTests";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import ReopenBanner from "../resultcommit/ReopenBanner";
import { useReopenScope } from "../resultcommit/useReopenSession";
import { useRevealResult } from "../resultbook/useRevealResult";
import { OutOfDateNote } from "../workbench/WorkbenchParts";
import StatsInputReview from "../analysisselection/StatsInputReview";
import { statsTestsRows } from "../analysisselection/statsInputReviewRows";
import StatsTestsInputs from "./StatsTestsInputs";
import StatsTestsResultBook from "./StatsTestsResultBook";
import { useStatsTests } from "./useStatsTests";

// Grouped by family (UX menus audit M3): a flat 33-row list had no order to scan.
const TEST_GROUPS = statsTestGroups();
// Named settings: the shared preset bar, lazy.
const StatsTestsPresetBar = lazyRegion(() => import("./StatsTestsPresetBar"), "Presets");
const faint = { color: "var(--text-faint)" } as const;

export default function StatsTestsPanel() {
  const setOpen = useStatsTestsStore((s) => s.setOpen);
  // Opened from a saved result (its request is waiting at mount): the result outranks a preset.
  const [fromResult] = useState(() => useStatsTestsStore.getState().request !== null);
  const t = useStatsTests();
  const resultRef = useRevealResult(t.output);
  useReopenScope("km-curve"); // closing the panel ends an "Open in" session
  useReopenScope("row-t-tests");

  return (
    <ToolWindow id="stats-tests" title="Statistical tests" width={440} onClose={() => setOpen(false)}>
      {t.testId === "kaplan-meier" && <ReopenBanner tool="km-curve" />}
      {t.testId === "row-t-tests" && <ReopenBanner tool="row-t-tests" />}
      <StatsTestsPresetBar t={t} fromResult={fromResult} />
      <label className="qzk-field-lbl">Test</label>
      <select
        className="qz-select"
        style={{ width: "100%", textOverflow: "ellipsis" }}
        aria-label="Test"
        value={t.testId}
        onChange={(e) => t.setTestId(e.target.value as StatsTestId)}
      >
        {TEST_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.tests.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </optgroup>
        ))}
      </select>
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
        {t.def.blurb}
      </div>

      {(t.def.input === "none" || (t.inputs && t.active)) && <StatsInputReview inputs={t.inputs} rows={statsTestsRows(t.inputs, t)} />}
      <StatsTestsInputs t={t} />

      <div style={{ marginTop: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={t.busy || (t.def.input !== "none" && !t.active)}
          onClick={() => void t.run()}
        >
          Run test
        </Button>
        {t.busy && (
          <span className="qzk-ds-meta" style={{ ...faint, marginLeft: 8 }}>
            running…
          </span>
        )}
      </div>

      {t.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {t.error}
        </div>
      )}

      {t.output && (
        <>
          {t.stale && <OutOfDateNote block>the data or rows changed after this test ran. Run it again.</OutOfDateNote>}
          <div ref={resultRef} style={{ marginTop: 10 }}>
            <StatsTestsResultBook key={t.savedId ?? "unsaved"} t={t} output={t.output} />
          </div>
        </>
      )}
    </ToolWindow>
  );
}
