import { useEffect, useMemo, useState } from "react";

import { parseMaxFields, temperatureProblem } from "../../../lib/magIsotherms";
import { datasetsInputsToken } from "../workbench/inputsKey";
import { isothermKey, readIsothermHints, runIsotherms, type IsothermReadout, type IsothermView } from "../../../store/magIsothermRun";
import { pickCompareIds } from "../../../store/magSeriesCompareRun";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { magColumns } from "./magInputs";

/** The Isotherms tab's state: owned by the panel body so choices survive tab switches. */
export function useMagIsotherms() {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const selectedIds = useApp((s) => s.selectedIds);
  const datasets = useApp((s) => s.datasets);
  const [view, setView] = useState<IsothermView>("entropy");
  const [tempText, setTempText] = useState<Record<string, string>>({});
  const [fieldsEdit, setFieldsText] = useState<string | null>(null);
  const [defaultField, setDefaultField] = useState<number | null>(null);
  const [lo, setLo] = useState("0");
  const [hi, setHi] = useState("");
  const [beta, setBeta] = useState("0.5");
  const [gamma, setGamma] = useState("1");
  const [busy, setBusy] = useState(false);
  const [readout, setReadout] = useState<IsothermReadout | null>(null);
  const [suggested, setSuggested] = useState<Record<string, number | null>>({});
  const [fieldUnit, setFieldUnit] = useState("");

  const channel = active ? (active.data.labels[magColumns(active, xKey, yKeys, seriesOrder).yKey] ?? "") : "";
  const picked = useMemo(() => pickCompareIds(active?.id ?? null, selectedIds), [active?.id, selectedIds]);
  const ids = picked.ids;
  const idsKey = ids.join("|");
  const inputs = datasetsInputsToken(ids, datasets);

  // Pre-fill each worksheet's temperature from its own K column (a steady one only); never overwrites an entry.
  useEffect(() => {
    let live = true;
    void readIsothermHints(idsKey ? idsKey.split("|") : [], channel).then((h) => {
      if (live) { setSuggested(h.suggested); setFieldUnit(h.fieldUnit); setDefaultField(h.maxField); }
    });
    return () => { live = false; };
  }, [idsKey, channel, inputs]);

  const rows = ids.map((id) => {
    const text = tempText[id];
    const value = text !== undefined ? text : suggested[id] != null ? String(Number(suggested[id]!.toPrecision(6))) : "";
    return { id, name: datasets.find((d) => d.id === id)?.name ?? id, text: value, fromColumn: text === undefined && suggested[id] != null };
  });
  const temps = rows.map((r) => (r.text.trim() === "" ? null : Number(r.text)));
  // Blank until edited shows the largest field every isotherm reaches (provisional, owner to confirm).
  const fieldsText = fieldsEdit ?? (defaultField !== null ? String(defaultField) : "");
  const maxFields = parseMaxFields(fieldsText);
  const window: [number, number] = [Number(lo), Number(hi)];
  const params = { view, temps, maxFields: Array.isArray(maxFields) ? maxFields : [], window, beta: Number(beta), gamma: Number(gamma) } as const;
  const problem = picked.problem
    ?? (!channel ? "The plotted response has no name, so other worksheets cannot be matched to it." : null)
    ?? (xKey !== null ? "The isotherms read each worksheet's own X axis; set the plot X to the worksheet's X axis first." : null)
    ?? temperatureProblem(rows.map((r) => r.name), temps)
    ?? (view === "entropy" ? (typeof maxFields === "string" ? maxFields : null)
      : !(Number.isFinite(window[0]) && Number.isFinite(window[1]) && window[0] >= 0 && window[1] > window[0]) ? "The Arrott window needs 0 <= low < high."
        : !(params.beta > 0 && params.gamma > 0) ? "β and γ must be positive." : null);
  const liveKey = isothermKey(ids, channel, inputs, params);

  async function run(): Promise<void> {
    if (problem || !active) return;
    setBusy(true);
    setReadout(null);
    try {
      setReadout(await runIsotherms(ids, channel, (all) => datasetsInputsToken(ids, all), params));
    } finally {
      setBusy(false);
    }
  }

  const mine = !!readout && !!active && readout.owners.includes(active.id);
  const stale = mine && active?.id === readout!.owners[0] && readout!.key !== liveKey;
  return {
    view, setView, rows, setTemp: (id: string, v: string) => setTempText((t) => ({ ...t, [id]: v })),
    fieldsText, setFieldsText, lo, setLo, hi, setHi, beta, setBeta, gamma, setGamma,
    channel, fieldUnit, problem, busy, run, count: ids.length, stale, shown: mine && (!stale || readout!.error) ? readout : null,
  };
}
export type MagIsothermState = ReturnType<typeof useMagIsotherms>;
