import { useEffect, useMemo, useRef, useState } from "react";

import { magneticCurieWeissDataFit, type CurieWeissResponseBasis } from "../../../lib/api/magnetic";
import type { ErrorBinding } from "../../../lib/errorRoles";
import { massInGrams, type MassUnit } from "../../../lib/sampleGeometry";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { analysisSeries, ROW_POLICY } from "../../../lib/analysisInputs";
import { rowStateIdentity } from "../../../lib/rowstate";
import type { DataStruct, Dataset } from "../../../lib/types";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { useRunStamp } from "../workbench/useRunStamp";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import {
  curieWeissProblem,
  fieldColumns,
  isMolarSusceptibilityUnit,
  responseBasis,
  type CurieWeissBasisChoice,
} from "./curieWeissData";
import {
  currentRequestDataset,
  requestView,
  resolveCurrentRequest,
  resolvedSourceStillCurrent,
} from "./useMagTools";
import { magColumns, resolveMagInputs } from "./magInputs";
import { magChannelsExtra } from "./magReopen";
import { seedChoice, seedNumber, useReopenSeed, useSeedHold } from "../resultcommit/useReopenSession";
import { useReplaceLayoutBlock } from "../resultcommit/useReplaceLayoutBlock";

const CURIE_WEISS_PRODUCER = { id: "curie-weiss", label: "Curie–Weiss", version: 2 } as const;
const BASIS_CHOICES: readonly CurieWeissBasisChoice[] = ["auto", "molar", "moment"];

interface FitReadout {
  owners: readonly string[];
  theta: number | null;
  curie: number | null;
  moment: number | null;
  r2: number | null;
  nFit: number;
  warning: string | null;
  error: string | null;
}

const EMPTY: FitReadout = {
  owners: [], theta: null, curie: null, moment: null, r2: null, nFit: 0,
  warning: null, error: null,
};

function finiteRange(values: readonly number[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const top = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
    if (value >= top[2]) [top[0], top[1], top[2]] = [top[1], top[2], value];
    else if (value >= top[1]) [top[0], top[1]] = [top[1], value];
    else if (value > top[0]) top[0] = value;
  }
  if (!Number.isFinite(lo)) return [0, 0];
  // Curie--Weiss behaviour is normally assessed in the high-temperature
  // paramagnetic regime. Start with the upper 40% of the measured span, while
  // keeping both endpoints explicit and editable rather than silently using
  // the legacy backend's auto-range fallback.
  const highTemperatureStart = lo + 0.6 * (hi - lo);
  // A tiny worksheet still starts with the minimum three candidate rows
  // visible to the backend, rather than immediately failing its n>=3 guard.
  return [Math.min(highTemperatureStart, top[0]), hi];
}

function swappedSide(side: ErrorBinding["side"]): ErrorBinding["side"] {
  // d(1/chi)/dchi is negative: upper chi uncertainty is lower inverse-chi.
  return side === "+" ? "-" : side === "-" ? "+" : "both";
}

function scatter(values: readonly (number | null)[], keep: readonly number[], n: number): number[] {
  if (values.length !== keep.length) {
    throw new Error(`backend returned ${values.length} rows for ${keep.length} sent — cannot align the fit`);
  }
  const out = new Array<number>(n).fill(Number.NaN);
  for (let index = 0; index < keep.length; index++) out[keep[index]] = values[index] ?? Number.NaN;
  return out;
}

function yErrorRoles(dataset: Dataset, yKey: number): ErrorBinding[] {
  return (dataset.errorRoles ?? []).filter((role) =>
    role.axis === "y" && role.target === yKey && role.channel >= 0 &&
    role.channel < dataset.data.labels.length,
  );
}

export function useCurieWeiss() {
  const active = useActiveDataset();
  const xKey = useApp((state) => state.xKey);
  const yKeys = useApp((state) => state.yKeys);
  const seriesOrder = useApp((state) => state.seriesOrder);
  const yKey = active ? magColumns(active, xKey, yKeys, seriesOrder).yKey : 0;
  // Lane RO3: a reopened result starts from its recorded basis, field column,
  // masses and fit range (read once, only on the recorded source). The mass was
  // recorded in grams, so it is restored in grams.
  const seed = useReopenSeed(CURIE_WEISS_PRODUCER.id, active?.id, true)?.settings;
  const holdSeed = useSeedHold(!!seed, [active?.id, xKey, yKey]);
  const [basisChoice, setBasisChoiceState] = useState<CurieWeissBasisChoice>(() => seedChoice(seed?.["basisChoice"], BASIS_CHOICES, "auto"));
  const [fieldKey, setFieldKeyState] = useState<number | null>(() => (typeof seed?.["fieldKey"] === "number" ? seed["fieldKey"] : null));
  const [sampleMass, setSampleMass] = useState(() => seedNumber(seed?.["sampleMassG"], 0));
  const [massUnit, setMassUnit] = useState<MassUnit>(() => (seed ? "g" : "mg"));
  const [molarMass, setMolarMass] = useState(() => seedNumber(seed?.["molarMass"], 0));
  const [fitMin, setFitMin] = useState(() => seedNumber(seed?.["fitMin"], 0));
  const [fitMax, setFitMax] = useState(() => seedNumber(seed?.["fitMax"], 0));
  const [seedProblem, setSeedProblem] = useState<string | null>(() =>
    seed && (typeof seed["basisChoice"] !== "string" || !BASIS_CHOICES.includes(seed["basisChoice"] as CurieWeissBasisChoice))
      ? "The recorded response basis is not one this version knows, so it starts as Auto-detect. Replace is off until you choose it." : null);
  const setBasisChoice = (next: CurieWeissBasisChoice): void => { setSeedProblem(null); setBasisChoiceState(next); };
  const setFieldKey = (next: number | null): void => { setSeedProblem(null); setFieldKeyState(next); };
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [readout, setReadout] = useState<FitReadout>(EMPTY);

  const sourceRange = useMemo(
    () => {
      // Seeds the range inputs only (a lazy preview's extent is a fine default;
      // the run itself reads the resolver's full rows).
      if (!active) return [0, 0] as [number, number];
      return finiteRange(fullPlottedX(active.data, magColumns(active, xKey, yKeys, seriesOrder).xKey));
    },
    [active, xKey, yKeys, seriesOrder],
  );
  const holdSeedRef = useRef(holdSeed);
  holdSeedRef.current = holdSeed;
  useEffect(() => {
    // A reopen's recorded range and field column, not the defaults, until the source or plot changes.
    if (holdSeedRef.current()) return;
    setFitMin(sourceRange[0]);
    setFitMax(sourceRange[1]);
    setFieldKeyState(null);
  }, [active?.id, xKey, yKey, sourceRange]);

  const fields = active ? fieldColumns(active.data, yKey, (active.errorRoles ?? []).map((r) => r.channel)) : [];
  // A recorded applied-field column that is gone is not swapped for another one.
  const fieldGone = !!seed && typeof seed["fieldKey"] === "number" && fieldKey === seed["fieldKey"] && !fields.some((f) => f.index === fieldKey)
    ? "The recorded applied-field column is no longer there, so choose it again. Replace is off until then." : null;
  useReplaceLayoutBlock(CURIE_WEISS_PRODUCER.id, active?.id, null, seedProblem ?? fieldGone);
  const selectedField = fields.find((field) => field.index === fieldKey) ??
    (fieldKey == null && fields.length === 1 ? fields[0] : null);
  const basis = active ? responseBasis(basisChoice, active.data.units[yKey] ?? "") : null;
  const sampleMassG = massInGrams(sampleMass, massUnit) ?? 0;
  const paramsRef = useRef({ basisChoice, fieldKey, sampleMassG, molarMass, fitMin, fitMax });
  paramsRef.current = { basisChoice, fieldKey, sampleMassG, molarMass, fitMin, fitMax };
  const problem = curieWeissProblem(
    active, xKey, yKey, basisChoice, sampleMassG, molarMass, fitMin, fitMax,
    selectedField?.index ?? null,
  );
  const activeId = active?.id ?? null;
  const visible = activeId && readout.owners.includes(activeId) ? readout : EMPTY;

  // Out of date (lane WB5): the readout is stamped with the source's rows / data,
  // plotted channels and fit settings the fit was LAUNCHED with. It is judged
  // against the SOURCE worksheet and the form as they are now; on the output
  // worksheet itself (activated by the commit, which also re-seeds the range)
  // the readout simply describes that worksheet and is not marked.
  const datasets = useApp((state) => state.datasets);
  const sourceId = readout.owners[0] ?? activeId;
  const onSource = activeId !== null && activeId === sourceId;
  const liveKey = JSON.stringify([
    datasetInputsToken(datasets.find((d) => d.id === sourceId)),
    onSource ? [xKey, yKey] : null,
    basisChoice, fieldKey, sampleMassG, molarMass, fitMin, fitMax,
  ]);
  const stamp = useRunStamp(liveKey);
  const stale = onSource && visible.theta != null && stamp.stale;

  async function fit(): Promise<void> {
    if (!active || busyRef.current) return;
    busyRef.current = true;
    const request = requestView(active.id, xKey, yKeys, seriesOrder);
    const runParams = { ...paramsRef.current };
    const owners = [request.sourceId];
    setBusy(true);
    setReadout(EMPTY);
    stamp.record(null);
    try {
      const hadPending = currentRequestDataset(request.sourceId)?.pending !== undefined;
      const dataset = await resolveCurrentRequest(request);
      if (!dataset) return;
      // A lazy book that just arrived moved the data identity: let that commit
      // land, then stamp the run with the key it is launched under.
      if (hadPending) await afterCommit();
      const launchKey = JSON.stringify([
        datasetInputsToken(currentRequestDataset(dataset.id)),
        [request.xKey, magColumns(dataset, request.xKey, request.yKeys, request.seriesOrder).yKey],
        runParams.basisChoice, runParams.fieldKey, runParams.sampleMassG, runParams.molarMass, runParams.fitMin, runParams.fitMax,
      ]);
      const sourceRowState = rowStateIdentity(dataset);
      // Both reads go through the shared resolver: the analysis view the fit
      // uses, and every worksheet row (the output is row-aligned with those).
      const analysed = resolveMagInputs(dataset, request.xKey, request.yKeys, request.seriesOrder, ROW_POLICY.analysisView);
      const whole = resolveMagInputs(dataset, request.xKey, request.yKeys, request.seriesOrder);
      if (!analysed.ok || !whole.ok) {
        setReadout({ ...EMPTY, owners, error: !analysed.ok ? analysed.reason : !whole.ok ? whole.reason : "" });
        return;
      }
      const current = analysisSeries(analysed);
      const full = analysisSeries(whole);
      const sourceRows = analysed.rowIds;
      const currentFields = fieldColumns(analysed.data, current.yKey, (dataset.errorRoles ?? []).map((r) => r.channel));
      const field = currentFields.find((candidate) => candidate.index === runParams.fieldKey) ??
        (runParams.fieldKey == null && currentFields.length === 1 ? currentFields[0] : null);
      const currentBasis = responseBasis(runParams.basisChoice, dataset.data.units[current.yKey] ?? "");
      const currentProblem = curieWeissProblem(
        dataset, request.xKey, current.yKey, runParams.basisChoice,
        runParams.sampleMassG, runParams.molarMass,
        runParams.fitMin, runParams.fitMax, field?.index ?? null,
      );
      if (currentProblem || !currentBasis) {
        setReadout({ ...EMPTY, owners, error: currentProblem ?? "The response basis is not supported." });
        return;
      }
      // Applied-field uncertainty (a role targeting the field column) only
      // matters when the field is divided out. Symmetric, same-unit columns are
      // propagated in quadrature; anything else is refused, never understated.
      const fieldRoles = currentBasis === "molar_susceptibility" || !field ? [] :
        (dataset.errorRoles ?? []).filter((role, i, roles) => role.target === field.index &&
          role.channel >= 0 && role.channel < dataset.data.labels.length &&
          roles.findIndex((other) => other.channel === role.channel && other.target === role.target) === i);
      const badField = fieldRoles.find((role) => role.side !== "both" ||
        ((dataset.data.units[role.channel] ?? "") !== "" && dataset.data.units[role.channel] !== field!.unit));
      if (badField) {
        setReadout({
          ...EMPTY, owners,
          error: badField.side !== "both"
            ? "The applied-field uncertainty is asymmetric (+/-). Only symmetric field uncertainty can be propagated, so the fit was not run."
            : `The applied-field uncertainty column is in ${dataset.data.units[badField.channel]}, not the field unit ${field!.unit}; convert it first. The fit was not run.`,
        });
        return;
      }

      const fieldValues = field ? analysed.data.values.map((row) => row[field.index]) : null;
      const keep: number[] = [];
      const temperature: number[] = [];
      const response: number[] = [];
      const appliedField: number[] = [];
      for (let row = 0; row < current.x.length; row++) {
        const t = current.x[row];
        const y = current.y[row];
        const h = fieldValues?.[row];
        if (!Number.isFinite(t) || !Number.isFinite(y) ||
          (currentBasis !== "molar_susceptibility" && !Number.isFinite(h))) continue;
        keep.push(row);
        temperature.push(t);
        response.push(y);
        if (currentBasis !== "molar_susceptibility") appliedField.push(h!);
      }
      if (keep.length < 3) {
        setReadout({ ...EMPTY, owners, error: `Only ${keep.length} rows have the finite values required for this fit; need at least 3.` });
        return;
      }

      const responseRoles = yErrorRoles(dataset, current.yKey);
      // Field uncertainty alone still yields one propagated error column.
      const roles: ErrorBinding[] = responseRoles.length || !fieldRoles.length ? responseRoles :
        [{ channel: -1, target: current.yKey, axis: "y", side: "both" }];
      const errorFinite = roles.map((role) => keep.map((row) =>
        role.channel < 0 || Number.isFinite(analysed.data.values[row]?.[role.channel]),
      ));
      const fieldFinite = keep.map((row) => fieldRoles.every((role) => Number.isFinite(analysed.data.values[row]?.[role.channel])));
      const fieldErrors = fieldRoles.map((role) => keep.map((row, index) =>
        fieldFinite[index] ? Math.abs(analysed.data.values[row][role.channel]) : 0,
      ));
      const responseErrors = responseRoles.map((role, roleIndex) => keep.map((row, index) =>
        errorFinite[roleIndex][index] ? Math.abs(analysed.data.values[row][role.channel]) : 0,
      ));
      const result = await magneticCurieWeissDataFit({
        temperature,
        response,
        response_basis: currentBasis,
        fit_range: [runParams.fitMin, runParams.fitMax],
        field: currentBasis === "molar_susceptibility" ? null : appliedField,
        field_unit: field?.unit ?? "Oe",
        sample_mass_g: currentBasis === "total_moment" ? runParams.sampleMassG : null,
        molar_mass_g_mol: currentBasis === "molar_susceptibility" ? null : runParams.molarMass,
        response_errors: responseErrors,
        ...(fieldErrors.length ? { field_errors: fieldErrors } : {}),
      });
      if (!resolvedSourceStillCurrent(request, dataset.data)) return;
      const liveDataset = currentRequestDataset(dataset.id);
      const liveRowState = rowStateIdentity(liveDataset);
      const paramsChanged = Object.entries(runParams).some(
        ([key, value]) => paramsRef.current[key as keyof typeof runParams] !== value,
      );
      if (paramsChanged || liveRowState.some((value, index) => value !== sourceRowState[index])) {
        setReadout({
          ...EMPTY, owners,
          error: "The fit inputs changed while the calculation was running; review them and run the fit again.",
        });
        return;
      }

      const sourceKeep = keep.map((index) => sourceRows[index]);
      const inverse = scatter(result.inv_chi, sourceKeep, full.x.length);
      const fitted = scatter(result.fit_inv_chi, sourceKeep, full.x.length);
      const labels = ["Inverse molar susceptibility", "Curie–Weiss fit"];
      const units = ["mol/cm³", "mol/cm³"];
      const columns = [inverse, fitted];
      const errorRoles: ErrorBinding[] = [];
      roles.forEach((role, roleIndex) => {
        const values = scatter(result.inverse_errors[roleIndex] ?? [], sourceKeep, full.x.length);
        const outputSide = swappedSide(role.side);
        for (let index = 0; index < keep.length; index++) {
          if (!errorFinite[roleIndex][index] || !fieldFinite[index]) values[sourceKeep[index]] = Number.NaN;
        }
        const channel = columns.length;
        columns.push(values);
        labels.push(`Inverse susceptibility uncertainty ${outputSide === "both" ? "" : outputSide}`.trim());
        units.push("mol/cm³");
        errorRoles.push({ channel, target: 0, axis: "y", side: outputSide });
      });
      const values = full.x.map((_, row) => columns.map((column) => column[row]));
      const metadata = { ...dataset.data.metadata };
      for (const key of [
        "origin_column_names", "column_designations", "column_comments",
        "all_column_names", "all_column_units", "y_column_indices", "error_roles", "label_rows",
      ]) delete metadata[key];
      const fitRows = sourceKeep.filter((_, index) => result.fit_mask[index]);
      const data: DataStruct = {
        time: [...full.x], values, labels, units,
        metadata: {
          ...metadata,
          x_column_name: "Temperature",
          x_column_long: "Temperature",
          x_column_unit: "K",
          error_roles: errorRoles,
          curie_weiss_fit: {
            version: 1,
            source_dataset_id: dataset.id,
            source_dataset_name: dataset.name,
            source_response: dataset.data.labels[current.yKey] ?? "response",
            response_basis: currentBasis,
            field_column: field?.label ?? null,
            field_unit: field?.unit ?? null,
            sample_mass_g: currentBasis === "total_moment" ? runParams.sampleMassG : null,
            molar_mass_g_mol: currentBasis === "molar_susceptibility" ? null : runParams.molarMass,
            fit_range_k: result.fit_range_used,
            fit_rows: fitRows,
            theta_cw_k: result.theta_cw,
            curie_constant_cm3_k_mol: result.C,
            mu_eff_mu_b: result.mu_eff,
            r2: result.r2,
            n_fit: result.n_fit,
            field_and_sample_quantities_treated_exact: currentBasis !== "molar_susceptibility" && !fieldRoles.length,
            field_uncertainty_propagated: fieldRoles.length > 0,
            fit_weighting: "unweighted",
          },
        },
      };
      // One undo step, no duplicate on a repeat fit, stale when the source or
      // its row state changes (store/analysisOutputCommit.ts). The worksheet
      // stays linked to its source as before (`derivedFrom`).
      const outcome = commitComputedOutput({
        producer: CURIE_WEISS_PRODUCER,
        sources: [{ id: dataset.id, computedOn: analysisDataFingerprint(dataset) }],
        settings: { ...runParams, xKey: request.xKey, yKey: current.yKey },
        reopenExtra: magChannelsExtra(dataset, request.xKey, current.yKey),
        xKey: analysed.xKey, // the X the fit read (C9)
        name: `${dataset.name.replace(/\.[^.]+$/, "")} (Curie–Weiss)`, data,
        ...(errorRoles.length ? { errorRoles } : {}),
        derivedFrom: { datasetId: dataset.id, pipeline: "curie-weiss" },
        status: `Curie–Weiss fit: θ = ${result.theta_cw.toPrecision(4)} K, R² = ${result.r2.toFixed(4)}`,
      });
      if (outcome.kind === "refused") {
        setReadout({ ...EMPTY, owners, error: outcome.reason });
        return;
      }
      const warnings: string[] = [];
      if (sourceRows.length < full.x.length) warnings.push(`${full.x.length - sourceRows.length} excluded or filtered rows remain gaps.`);
      if (keep.length < current.x.length) warnings.push(`${current.x.length - keep.length} incomplete analysis rows remain gaps.`);
      if (result.excluded_nonpositive) warnings.push(`${result.excluded_nonpositive} non-positive susceptibility rows were excluded.`);
      if (roles.length) warnings.push("Response errors are shown but the linear fit is unweighted.");
      if ((dataset.errorRoles ?? []).some((role) => role.axis === "x" && role.target === -1)) {
        warnings.push("Temperature uncertainty is not used by this ordinary least-squares fit.");
      }
      if (currentBasis !== "molar_susceptibility") {
        warnings.push(`${fieldRoles.length ? "Sample mass and molar mass were" : "Field, sample mass, and molar mass were"} treated as exact${fieldRoles.length ? "; applied-field uncertainty was propagated" : ""}.`);
      }
      if (runParams.basisChoice === "molar" && !isMolarSusceptibilityUnit(dataset.data.units[current.yKey] ?? "")) {
        warnings.push("The selected response was explicitly treated as cm³/mol despite its unrecognized unit label.");
      }
      if (result.C <= 0) warnings.push("The fitted Curie constant is non-positive; μeff is not physically meaningful.");
      stamp.record(launchKey);
      setReadout({
        owners: [...owners, outcome.outputId], theta: result.theta_cw, curie: result.C,
        moment: result.mu_eff, r2: result.r2, nFit: result.n_fit,
        warning: warnings.length ? warnings.join(" ") : null, error: null,
      });
    } catch (error) {
      setReadout({ ...EMPTY, owners, error: error instanceof Error ? error.message : "Curie–Weiss fit failed" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return {
    active, yKey, fields, selectedField, fieldKey, setFieldKey,
    basisChoice, setBasisChoice, basis: basis as CurieWeissResponseBasis | null,
    sampleMass, setSampleMass, massUnit, setMassUnit, molarMass, setMolarMass,
    fitMin, setFitMin, fitMax, setFitMax, problem, busy, fit, seedProblem: seedProblem ?? fieldGone,
    theta: visible.theta, curie: visible.curie, moment: visible.moment,
    r2: visible.r2, nFit: visible.nFit, warning: visible.warning, error: visible.error, stale,
  };
}
