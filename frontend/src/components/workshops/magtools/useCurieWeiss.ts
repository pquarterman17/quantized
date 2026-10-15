import { useEffect, useMemo, useRef, useState } from "react";

import { magneticCurieWeissDataFit, type CurieWeissResponseBasis } from "../../../lib/api/magnetic";
import type { ErrorBinding } from "../../../lib/errorRoles";
import { massInGrams, type MassUnit } from "../../../lib/sampleGeometry";
import { analysisView, rowStateIdentity } from "../../../lib/rowstate";
import type { DataStruct, Dataset } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import {
  curieWeissProblem,
  fieldColumns,
  isMolarSusceptibilityUnit,
  responseBasis,
  type CurieWeissBasisChoice,
} from "./curieWeissData";
import {
  magXY,
  currentRequestDataset,
  requestView,
  resolveCurrentRequest,
  resolvedSourceStillCurrent,
} from "./useMagTools";

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
  const addDataset = useApp((state) => state.addDataset);
  const setStatus = useApp((state) => state.setStatus);
  const yKey = active ? magXY(active, xKey, yKeys, seriesOrder).yKey : 0;
  const [basisChoice, setBasisChoice] = useState<CurieWeissBasisChoice>("auto");
  const [fieldKey, setFieldKey] = useState<number | null>(null);
  const [sampleMass, setSampleMass] = useState(0);
  const [massUnit, setMassUnit] = useState<MassUnit>("mg");
  const [molarMass, setMolarMass] = useState(0);
  const [fitMin, setFitMin] = useState(0);
  const [fitMax, setFitMax] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [readout, setReadout] = useState<FitReadout>(EMPTY);

  const sourceRange = useMemo(
    () => active ? finiteRange(magXY(active, xKey, yKeys, seriesOrder).x) : [0, 0] as [number, number],
    [active, xKey, yKeys, seriesOrder],
  );
  useEffect(() => {
    setFitMin(sourceRange[0]);
    setFitMax(sourceRange[1]);
    setFieldKey(null);
  }, [active?.id, xKey, yKey, sourceRange]);

  const fields = active ? fieldColumns(active.data, yKey) : [];
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

  async function fit(): Promise<void> {
    if (!active || busyRef.current) return;
    busyRef.current = true;
    const request = requestView(active.id, xKey, yKeys, seriesOrder);
    const runParams = { ...paramsRef.current };
    const owners = [request.sourceId];
    setBusy(true);
    setReadout(EMPTY);
    try {
      const dataset = await resolveCurrentRequest(request);
      if (!dataset) return;
      const sourceRowState = rowStateIdentity(dataset);
      const view = analysisView(dataset);
      if (!view.data) return;
      const analysisDataset = { ...dataset, data: view.data };
      const current = magXY(analysisDataset, request.xKey, request.yKeys, request.seriesOrder);
      const full = magXY(dataset, request.xKey, request.yKeys, request.seriesOrder);
      const sourceRows = view.rowIds ?? current.x.map((_, index) => index);
      const currentFields = fieldColumns(view.data, current.yKey);
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
      if (field && (dataset.errorRoles ?? []).some((role) => role.target === field.index)) {
        setReadout({
          ...EMPTY, owners,
          error: "The applied-field column has uncertainty. Field-error propagation is not supported yet, so the fit was not run.",
        });
        return;
      }

      const fieldValues = field ? view.data.values.map((row) => row[field.index]) : null;
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

      const roles = yErrorRoles(dataset, current.yKey);
      const errorFinite = roles.map((role) => keep.map((row) =>
        Number.isFinite(view.data!.values[row]?.[role.channel]),
      ));
      const responseErrors = roles.map((role, roleIndex) => keep.map((row, index) =>
        errorFinite[roleIndex][index] ? Math.abs(view.data!.values[row][role.channel]) : 0,
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
          if (!errorFinite[roleIndex][index]) values[sourceKeep[index]] = Number.NaN;
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
        "all_column_names", "all_column_units", "y_column_indices", "error_roles",
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
            field_and_sample_quantities_treated_exact: currentBasis !== "molar_susceptibility",
            fit_weighting: "unweighted",
          },
        },
      };
      const outId = nextDatasetId();
      addDataset({
        id: outId, name: `${dataset.name.replace(/\.[^.]+$/, "")} (Curie–Weiss)`, data,
        ...(errorRoles.length ? { errorRoles } : {}),
        derivedFrom: { datasetId: dataset.id, pipeline: "curie-weiss" },
      });
      const warnings: string[] = [];
      if (sourceRows.length < full.x.length) warnings.push(`${full.x.length - sourceRows.length} excluded or filtered rows remain gaps.`);
      if (keep.length < current.x.length) warnings.push(`${current.x.length - keep.length} incomplete analysis rows remain gaps.`);
      if (result.excluded_nonpositive) warnings.push(`${result.excluded_nonpositive} non-positive susceptibility rows were excluded.`);
      if (roles.length) warnings.push("Response errors are shown but the linear fit is unweighted.");
      if ((dataset.errorRoles ?? []).some((role) => role.axis === "x" && role.target === -1)) {
        warnings.push("Temperature uncertainty is not used by this ordinary least-squares fit.");
      }
      if (currentBasis !== "molar_susceptibility") warnings.push("Field, sample mass, and molar mass were treated as exact.");
      if (runParams.basisChoice === "molar" && !isMolarSusceptibilityUnit(dataset.data.units[current.yKey] ?? "")) {
        warnings.push("The selected response was explicitly treated as cm³/mol despite its unrecognized unit label.");
      }
      if (result.C <= 0) warnings.push("The fitted Curie constant is non-positive; μeff is not physically meaningful.");
      setReadout({
        owners: [...owners, outId], theta: result.theta_cw, curie: result.C,
        moment: result.mu_eff, r2: result.r2, nFit: result.n_fit,
        warning: warnings.length ? warnings.join(" ") : null, error: null,
      });
      setStatus(`Curie–Weiss fit: θ = ${result.theta_cw.toPrecision(4)} K, R² = ${result.r2.toFixed(4)}`);
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
    fitMin, setFitMin, fitMax, setFitMax, problem, busy, fit,
    theta: visible.theta, curie: visible.curie, moment: visible.moment,
    r2: visible.r2, nFit: visible.nFit, warning: visible.warning, error: visible.error,
  };
}
