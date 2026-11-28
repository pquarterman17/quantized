// Significance marks from p-values the user supplies (plan item 23): the
// source picker (a saved post-hoc statistics result, or three worksheet
// columns -- NO default source), the editable thresholds, "show p" and "show
// ns". Each commit is ONE `setMarks` patch (one undo entry). The draw, the
// refusal text and the export come from `useStatComparisons` / `lib/sigSource`.

import { useState } from "react";

import { DEFAULT_SIG_LEVELS, levelsProblem, type SigLevel, type SigMarks } from "../../lib/sigMarks";
import type { StatMarks } from "../../lib/statMarks";
import { isCategoricalChannel } from "../../lib/categorical";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { Checkbox } from "../primitives/Checkbox";

const NONE = "";
const KINDS = [
  { value: NONE, label: "off" },
  { value: "result", label: "a statistics result" },
  { value: "sheet", label: "a worksheet" },
];

interface Props {
  sig: SigMarks | null;
  setMarks: (patch: StatMarks, label?: string) => void;
  /** Why nothing is drawn, or null. */
  error: string | null;
}

function Pick({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      {label}
      {children}
    </label>
  );
}

/** The three threshold rows: marks and cut-offs, committed together when valid. */
function Levels({ levels, commit }: { levels: SigLevel[]; commit: (l: SigLevel[]) => void }) {
  const [draft, setDraft] = useState<{ mark: string; below: string }[] | null>(null);
  const rows = draft ?? levels.map((l) => ({ mark: l.mark, below: String(l.below) }));
  const parsed = rows.map((r) => ({ mark: r.mark, below: Number(r.below) }));
  const problem = draft && (rows.some((r) => r.below.trim() === "") ? "Fill in every cut-off" : levelsProblem(parsed));
  const edit = (i: number, f: "mark" | "below", v: string) => setDraft(rows.map((r, k) => (k === i ? { ...r, [f]: v } : r)));
  const done = () => {
    if (draft && !problem) { commit(parsed); setDraft(null); }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }} data-testid="sig-levels">
      thresholds
      {rows.map((r, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <input
            className="qz-input" aria-label={`mark ${i + 1}`} size={3} value={r.mark}
            onChange={(e) => edit(i, "mark", e.target.value)} onBlur={done}
          />
          &lt;
          <input
            className="qz-input" aria-label={`cut-off ${i + 1}`} size={5} value={r.below}
            onChange={(e) => edit(i, "below", e.target.value)} onBlur={done}
          />
        </span>
      ))}
      {problem && <span role="status" data-testid="sig-levels-error" style={{ color: "var(--text-dim)" }}>{problem}</span>}
    </span>
  );
}

export default function StatSigControls({ sig, setMarks, error }: Props) {
  const results = useApp((s) => s.analysisResults);
  const datasets = useApp((s) => s.datasets);
  const kind = sig?.source.kind ?? NONE;
  const patch = (next: Partial<SigMarks>, label: string) => sig && setMarks({ sig: { ...sig, ...next } }, label);
  const choose = (k: string) => {
    if (k === NONE) return setMarks({ sig: undefined }, "remove significance marks");
    const source = k === "result" ? { kind: "result" as const, resultId: "" } : { kind: "sheet" as const, datasetId: "", a: -1, b: -1, p: -1 };
    setMarks({ sig: { source, levels: sig?.levels ?? DEFAULT_SIG_LEVELS.map((l) => ({ ...l })), showP: sig?.showP ?? false, showNs: sig?.showNs ?? false } }, "set p-value source");
  };
  const posthoc = results.filter((r) => r.producer.id === "statistical-test" && (r.parameters as { testId?: unknown } | undefined)?.testId === "posthoc");
  const s = sig?.source;
  const sheet = s?.kind === "sheet" ? datasets.find((d) => d.id === s.datasetId) : undefined;
  const cols = sheet?.data.labels ?? [];
  const colOptions = (want: (c: number) => boolean) => [
    { value: "-1", label: "pick…" },
    ...cols.flatMap((l, c) => (want(c) ? [{ value: String(c), label: l }] : [])),
  ];
  const setSheet = (f: Partial<Extract<SigMarks["source"], { kind: "sheet" }>>) =>
    s?.kind === "sheet" && patch({ source: { ...s, ...f } }, "set p-value columns");
  return (
    <span data-testid="stat-sig-controls" style={{ display: "contents" }}>
      <Pick label="p-values from">
        <Select aria-label="significance p-value source" options={KINDS} value={kind} onChange={(e) => choose(e.target.value)}
          title="Brackets and marks drawn from p-values you supply, from a saved post-hoc result or three worksheet columns" />
      </Pick>
      {s?.kind === "result" && (
        <Pick label="result">
          <Select
            aria-label="post-hoc result"
            options={[{ value: "", label: posthoc.length ? "pick…" : "none saved (run Post hoc pairwise comparisons)" }, ...posthoc.map((r) => ({ value: r.id, label: r.name }))]}
            value={s.resultId}
            onChange={(e) => patch({ source: { kind: "result", resultId: e.target.value } }, "set p-value result")}
          />
        </Pick>
      )}
      {s?.kind === "sheet" && (
        <>
          <Pick label="sheet">
            <Select
              aria-label="p-value worksheet"
              options={[{ value: "", label: "pick…" }, ...datasets.map((d) => ({ value: d.id, label: d.name }))]}
              value={s.datasetId}
              onChange={(e) => patch({ source: { kind: "sheet", datasetId: e.target.value, a: -1, b: -1, p: -1 } }, "set p-value worksheet")}
            />
          </Pick>
          {sheet && (
            <>
              <Pick label="group A">
                <Select aria-label="group A column" options={colOptions((c) => !!sheet && isCategoricalChannel(sheet.data, c))} value={String(s.a)} onChange={(e) => setSheet({ a: Number(e.target.value) })} />
              </Pick>
              <Pick label="group B">
                <Select aria-label="group B column" options={colOptions((c) => !!sheet && isCategoricalChannel(sheet.data, c))} value={String(s.b)} onChange={(e) => setSheet({ b: Number(e.target.value) })} />
              </Pick>
              <Pick label="p">
                <Select aria-label="p-value column" options={colOptions((c) => !!sheet && !isCategoricalChannel(sheet.data, c))} value={String(s.p)} onChange={(e) => setSheet({ p: Number(e.target.value) })} />
              </Pick>
            </>
          )}
        </>
      )}
      {sig && (
        <>
          <Levels key={JSON.stringify(sig.levels)} levels={sig.levels} commit={(levels) => patch({ levels }, "set significance thresholds")} />
          <Checkbox checked={sig.showP} onChange={(on) => patch({ showP: on }, "toggle p-value text")}>show p</Checkbox>
          <Checkbox checked={sig.showNs} onChange={(on) => patch({ showNs: on }, "toggle ns brackets")}>show ns</Checkbox>
          {error && <span data-testid="stat-sig-error" role="status" style={{ fontSize: 11, color: "var(--text-dim)" }}>{error}</span>}
        </>
      )}
    </span>
  );
}
