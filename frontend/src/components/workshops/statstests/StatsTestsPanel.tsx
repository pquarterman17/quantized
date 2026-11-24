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

import type { StatsTestId } from "../../../lib/api/statsTests";
import { STATS_TESTS } from "../../../lib/statsTests";
import { useStatsTestsStore } from "../../../store/statsTests";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import ReopenBanner from "../resultcommit/ReopenBanner";
import { useReopenScope } from "../resultcommit/useReopenSession";
import { OutOfDateNote } from "../workbench/WorkbenchParts";
import StatsInputReview from "../analysisselection/StatsInputReview";
import { statsTestsRows } from "../analysisselection/statsInputReviewRows";
import StatsTestsInputs from "./StatsTestsInputs";
import StatsTestsResultBook from "./StatsTestsResultBook";
import { useStatsTests } from "./useStatsTests";

const TEST_OPTIONS = STATS_TESTS.map((t) => ({ value: t.id, label: `${t.family} — ${t.label}` }));
const faint = { color: "var(--text-faint)" } as const;

export default function StatsTestsPanel() {
  const setOpen = useStatsTestsStore((s) => s.setOpen);
  const t = useStatsTests();
  useReopenScope("km-curve"); // closing the panel ends an "Open in" session

  return (
    <ToolWindow id="stats-tests" title="Statistical tests" width={440} onClose={() => setOpen(false)}>
      {t.testId === "kaplan-meier" && <ReopenBanner tool="km-curve" />}
      <label className="qzk-field-lbl">Test</label>
      <Select
        aria-label="Test"
        options={TEST_OPTIONS}
        value={t.testId}
        onChange={(e) => t.setTestId(e.target.value as StatsTestId)}
      />
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
          <div style={{ marginTop: 10 }}>
            <StatsTestsResultBook key={t.savedId ?? "unsaved"} t={t} output={t.output} />
          </div>
        </>
      )}
    </ToolWindow>
  );
}
