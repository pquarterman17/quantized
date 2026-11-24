import { useMemo, useState } from "react";

import type { SusceptibilityOutput } from "../../../lib/api/magnetic";
import { fieldChoices, type FieldChoice } from "../../../lib/magDerived";
import { massInGrams, type MassUnit } from "../../../lib/sampleGeometry";
import { datasetInputsToken } from "../workbench/inputsKey";
import { runSusceptibility, type DerivedReadout } from "../../../store/magDerivedRun";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { magColumns } from "./magInputs";

const fieldId = (c: FieldChoice): string => (c.kind === "x" ? "x" : `c${c.index}`);

/** The Derived tab's state: owned by the pane's parent so choices survive tab switches. */
export function useMagDerived() {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [output, setOutput] = useState<SusceptibilityOutput>("volume");
  const [system, setSystem] = useState<"cgs" | "si">("cgs");
  const [fieldPick, setFieldPick] = useState<string | null>(null);
  const [mass, setMass] = useState(0);
  const [massUnit, setMassUnit] = useState<MassUnit>("mg");
  const [volume, setVolume] = useState(0);
  const [molarMass, setMolarMass] = useState(0);
  const [busy, setBusy] = useState(false);
  const [readout, setReadout] = useState<DerivedReadout | null>(null);

  const yKey = active ? magColumns(active, xKey, yKeys, seriesOrder).yKey : 0;
  const choices = useMemo(() => (active ? fieldChoices(active, xKey, yKey) : []), [active, xKey, yKey]);
  const selected = choices.find((c) => fieldId(c) === fieldPick) ?? (choices.length === 1 ? choices[0]! : null);
  const sampleMassG = massInGrams(mass, massUnit) ?? 0;
  const liveKey = JSON.stringify([datasetInputsToken(active), xKey, yKey, output, system, selected && fieldId(selected), sampleMassG, volume, molarMass]);
  const problem = !active ? "Select a dataset first."
    : !(active.data.units[yKey] ?? "").trim() ? "The selected response has no declared unit; set it before deriving a susceptibility."
      : choices.length === 0 ? "No declared applied field was found: the X axis is not a field and no field column exists."
        : !selected ? "Choose which applied field the response is divided by." : null;

  async function createSusceptibility(): Promise<void> {
    if (problem || !active || !selected) return;
    setBusy(true);
    setReadout(null);
    try {
      setReadout(await runSusceptibility({ sourceId: active.id, yKey, key: liveKey }, {
        output, system, field: { kind: selected.kind, index: selected.index },
        sampleMassG, sampleVolumeCm3: volume, molarMass,
      }));
    } finally {
      setBusy(false);
    }
  }

  const mine = !!readout && !!active && readout.owners.includes(active.id);
  const stale = mine && active?.id === readout!.owners[0] && readout!.key !== liveKey;
  return {
    active, yKey, choices, selected, fieldPick, setFieldPick: (v: string | null) => setFieldPick(v),
    fieldId, output, setOutput, system, setSystem, mass, setMass, massUnit, setMassUnit,
    volume, setVolume, molarMass, setMolarMass, busy, problem, createSusceptibility,
    shown: mine && (!stale || readout!.error) ? readout : null, stale,
  };
}
export type MagDerivedState = ReturnType<typeof useMagDerived>;
