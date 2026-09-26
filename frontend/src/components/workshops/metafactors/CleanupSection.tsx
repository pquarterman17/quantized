// "Metadata → factors" — the CLEAN UP tab: the keys present across the picked
// datasets with their coverage; tick synonyms and merge them into one key, or
// normalize one key's values (trim, case, "300 K" → 300 + unit). Each rule
// joins a draft, and every change the draft would make is listed — with what
// was refused and why — before Apply writes anything.

import { useState } from "react";

import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import type { LetterCase, MetaChange } from "../../../lib/metadataCleanup";
import { pathId, pathLabel } from "../../../lib/metadataKeys";
import type { MetaFactorsState } from "./useMetaFactors";

const gap = { marginTop: 8 };
const faint = { marginTop: 4, color: "var(--text-faint)" };
const shown = (v: MetaChange["before"]): string => (v === undefined ? "—" : String(v));

function KeysTable({ m, ticked, toggle }: { m: MetaFactorsState; ticked: string[]; toggle: (id: string, on: boolean) => void }) {
  const names = (ids: string[]) => m.picked.filter((id) => !ids.includes(id)).map((id) => m.datasets.find((d) => d.id === id)?.name ?? id);
  return (
    <div className="qzk-dense-table" style={{ marginTop: 6, maxHeight: 180, overflow: "auto" }}>
      <table className="qz-table" aria-label="Metadata keys">
        <thead>
          <tr>
            <th scope="col">Merge</th>
            <th scope="col">Key</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {m.keys.map((k) => {
            const id = pathId(k.path);
            const miss = names(k.ids);
            return (
              <tr key={id}>
                <td>
                  <input type="checkbox" aria-label={`Merge ${k.label}`} checked={ticked.includes(id)} onChange={(e) => toggle(id, e.target.checked)} />
                </td>
                <td>{k.label}</td>
                <td>{`${k.ids.length}/${m.picked.length}${miss.length ? ` — not in ${miss.join(", ")}` : ""}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ m }: { m: MetaFactorsState }) {
  const rows = m.cleanup.datasets.flatMap((d) => d.changes.map((c) => ({ d, c })));
  return (
    <>
      {rows.length > 0 && (
        <div className="qzk-dense-table" style={{ marginTop: 8, maxHeight: 200, overflow: "auto" }}>
          <table className="qz-table" aria-label="Cleanup preview">
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Key</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, c }, i) => (
                <tr key={i} title={c.note}>
                  <td>{d.name}</td>
                  <td>{c.key}</td>
                  <td>{shown(c.before)}</td>
                  <td>{c.after === undefined ? `(removed — ${c.note})` : shown(c.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {m.cleanup.refusals.length > 0 && (
        <ul className="qzk-ds-meta" aria-label="Refused" style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--warn)" }}>
          {m.cleanup.refusals.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <Button
        variant="primary"
        size="sm"
        disabled={!rows.length || m.busy}
        onClick={() => void m.applyCleanup()}
        style={{ marginTop: 12, width: "100%" }}
      >
        {m.busy ? "Applying…" : `Apply ${rows.length} change${rows.length === 1 ? "" : "s"}`}
      </Button>
      <div className="qzk-ds-meta" style={faint}>
        Every original value is kept in the metadata_cleanup log; Ctrl+Z undoes the whole apply.
      </div>
    </>
  );
}

export default function CleanupSection({ m }: { m: MetaFactorsState }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [normKey, setNormKey] = useState("");
  const [trim, setTrim] = useState(true);
  const [letterCase, setLetterCase] = useState<LetterCase>("keep");
  const [units, setUnits] = useState(false);
  if (!m.picked.length) return <div className="qzk-ds-meta" style={{ ...gap, ...faint }}>Tick at least one dataset.</div>;

  const tickedPaths = ticked.flatMap((id) => { const p = m.pathFromId(id); return p ? [p] : []; });
  const suggested = tickedPaths.find((p) => p.length === 1)?.[0] ?? tickedPaths[0]?.[tickedPaths[0].length - 1] ?? "";
  const to = target.trim() || suggested;
  const topKeys = [
    ...new Set([...m.keys.filter((k) => k.path.length === 1).map((k) => k.path[0]), ...m.draft.unify.map((u) => u.to)]),
  ];
  const nk = topKeys.includes(normKey) ? normKey : (topKeys[0] ?? "");
  const rules = [
    ...m.draft.unify.map((u, i) => ({ kind: "unify" as const, i, text: `Merge ${u.from.map(pathLabel).join(", ")} → ${u.to}` })),
    ...m.draft.normalize.map((n, i) => ({
      kind: "normalize" as const,
      i,
      text: `Normalize ${n.key}: ${[n.trim && "trim", n.letterCase !== "keep" && `${n.letterCase} case`, n.units && "parse units"].filter(Boolean).join(", ") || "no-op"}`,
    })),
  ];

  return (
    <>
      <label className="qzk-field-lbl" style={gap}>Keys across the picked datasets</label>
      <KeysTable m={m} ticked={ticked} toggle={(id, on) => setTicked((t) => (on ? [...t, id] : t.filter((x) => x !== id)))} />
      <label className="qzk-field-lbl" style={gap} htmlFor="meta-unify-to">Merge the ticked keys into</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input id="meta-unify-to" className="qz-input" value={target} placeholder={suggested} onChange={(e) => setTarget(e.target.value)} style={{ flex: 1 }} />
        <Button
          size="sm"
          disabled={!tickedPaths.length || !to}
          onClick={() => {
            m.addUnify({ to, from: tickedPaths });
            setTicked([]);
            setTarget("");
          }}
        >
          Add merge
        </Button>
      </div>
      <label className="qzk-field-lbl" style={gap}>Normalize the values of</label>
      <Select aria-label="Key to normalize" options={topKeys.map((k) => ({ value: k, label: k }))} value={nk} onChange={(e) => setNormKey(e.target.value)} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4, alignItems: "center" }}>
        <Checkbox checked={trim} onChange={setTrim}>Trim spaces</Checkbox>
        <Checkbox checked={units} onChange={setUnits}>Parse number + unit</Checkbox>
        <Select
          aria-label="Letter case"
          options={[
            { value: "keep", label: "Keep case" },
            { value: "lower", label: "lower case" },
            { value: "upper", label: "UPPER CASE" },
          ]}
          value={letterCase}
          onChange={(e) => setLetterCase(e.target.value as LetterCase)}
        />
        <Button size="sm" disabled={!nk} onClick={() => m.addNormalize({ key: nk, trim, letterCase, units })}>
          Add normalize
        </Button>
      </div>
      {rules.length > 0 && (
        <ul aria-label="Cleanup rules" className="qzk-ds-meta" style={{ margin: "8px 0 0", paddingLeft: 16 }}>
          {rules.map((r) => (
            <li key={`${r.kind}${r.i}`}>
              {r.text}{" "}
              <button type="button" className="qz-btn" aria-label={`Remove rule: ${r.text}`} onClick={() => m.removeRule(r.kind, r.i)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <Preview m={m} />
    </>
  );
}
