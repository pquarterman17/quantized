import { useMemo, useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { restoreSubstituted, substituteGaps } from "../../../lib/api/finiteSubstitute";
import { demagCorrectField } from "../../../lib/api/magnetometry";
import { detectMagXKind, stampXIdentity } from "../../../lib/magDataKind";
import type { ErrorBinding } from "../../../lib/errorRoles";
import type { DataStruct, Dataset } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import {
  magXY,
  requestView,
  resolveCurrentRequest,
  resolvedSourceStillCurrent,
  sourceUnits,
} from "./useMagTools";

export const DEMAG_SHAPES = [
  "Sphere",
  "Thin film (in-plane)",
  "Thin film (out-of-plane)",
  "Long cylinder (axial)",
  "Long cylinder (transverse)",
] as const;

export type DemagShape = (typeof DEMAG_SHAPES)[number];
const VOLUME_MAG_UNITS = new Set(["emu/cm³", "A/m", "kA/m"]);
const CORRECTABLE_FIELD_UNITS = new Set(["Oe", "T", "mT", "A/m"]);

interface DemagReadout {
  owners: readonly string[];
  nFactor: number | null;
  nCgs: number | null;
  warning: string | null;
  error: string | null;
}

const EMPTY: DemagReadout = { owners: [], nFactor: null, nCgs: null, warning: null, error: null };

function correctionProblem(
  ds: Dataset | null,
  shape: string,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): string | null {
  if (!ds) return "Select a dataset first.";
  if (!shape) return "Choose the sample geometry and field orientation.";
  if (ds.data.metadata.magnetometry_demag_correction) {
    return "This dataset already uses internal field. Start from the applied-field dataset to avoid correcting it twice.";
  }
  const source = sourceUnits(ds, xKey, yKeys, seriesOrder);
  const detected = detectMagXKind(source.xLabel, source.xUnit);
  if (detected.kind !== "field") return `The plotted x axis is not a declared magnetic field (${detected.reason}).`;
  if (!source.fromField || !CORRECTABLE_FIELD_UNITS.has(source.fromField)) {
    return `Field unit ${source.fromField || "(blank)"} is not supported for this correction; convert it to Oe, T, mT, or A/m in the Units tab first.`;
  }
  if (!VOLUME_MAG_UNITS.has(source.fromMoment)) {
    return `Magnetization must be volume-normalized; convert ${source.fromMoment || "the response"} to emu/cm³, A/m, or kA/m in the Units tab first.`;
  }
  if ((ds.errorRoles ?? []).some((role) => role.axis === "x")) {
    return "This dataset has applied-field uncertainty. Combining it with magnetization uncertainty is not supported yet, so no understated error bars will be created.";
  }
  return null;
}

function keptErrorSeries(ds: Dataset, binding: ErrorBinding, keep: readonly number[]): number[] {
  return keep.map((row) => Math.abs(ds.data.values[row]?.[binding.channel] ?? Number.NaN));
}

function correctedFieldSide(side: ErrorBinding["side"]): ErrorBinding["side"] {
  // H_int = H_ext - N*M: an upper M bound moves H_int downward and vice
  // versa. Symmetric errors are unchanged, asymmetric directions swap.
  return side === "+" ? "-" : side === "-" ? "+" : "both";
}

export function useDemagCorrection() {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [shape, setShape] = useState<DemagShape | "">("");
  const [busy, setBusy] = useState(false);
  const [readout, setReadout] = useState<DemagReadout>(EMPTY);
  const activeId = active?.id ?? null;
  const visible = activeId && readout.owners.includes(activeId) ? readout : EMPTY;
  const problem = useMemo(
    () => correctionProblem(active, shape, xKey, yKeys, seriesOrder),
    [active, shape, xKey, yKeys, seriesOrder],
  );

  async function apply(): Promise<void> {
    if (!active) return;
    const request = requestView(active.id, xKey, yKeys, seriesOrder);
    const owners = [request.sourceId];
    setBusy(true);
    setReadout(EMPTY);
    try {
      const ds = await resolveCurrentRequest(request);
      if (!ds) return;
      const currentProblem = correctionProblem(ds, shape, request.xKey, request.yKeys, request.seriesOrder);
      if (currentProblem) {
        setReadout({ ...EMPTY, owners, error: currentProblem });
        return;
      }
      const source = sourceUnits(ds, request.xKey, request.yKeys, request.seriesOrder);
      const { x, y, yKey } = magXY(ds, request.xKey, request.yKeys, request.seriesOrder);
      const pairs = dropGapRows(x, y);
      if (pairs.keep.length === 0) {
        setReadout({ ...EMPTY, owners, error: "No rows have both a finite field and magnetization." });
        return;
      }

      // Only user-confirmed/imported roles are propagated. Inferring a sigma
      // column here would silently attach scientific meaning to a guess.
      const yRoles = (ds.errorRoles ?? []).filter(
        (role, index, roles) => role.axis === "y" && role.target === yKey &&
          role.channel >= 0 && role.channel < ds.data.labels.length &&
          roles.findIndex((other) => other.channel === role.channel && other.target === role.target && other.side === role.side) === index,
      );
      const substituted = yRoles.map((role) => substituteGaps(keptErrorSeries(ds, role, pairs.keep)));
      const response = await demagCorrectField({
        field: pairs.x,
        magnetization: pairs.y,
        shape,
        field_unit: source.fromField!,
        magnetization_unit: source.fromMoment,
        magnetization_errors: substituted.map((series) => series.safe),
      });
      if (!resolvedSourceStillCurrent(request, ds.data)) return;
      if (response.field_errors.length !== yRoles.length) {
        throw new Error(`backend returned ${response.field_errors.length} uncertainty columns for ${yRoles.length} sent`);
      }

      const correctedField = restoreGapRows(response.field, pairs);
      const outputValues = ds.data.values.map((row) => [row[yKey] ?? Number.NaN]);
      const labels = [ds.data.labels[yKey] ?? "Magnetization"];
      const units = [source.fromMoment];
      const errorRoles: ErrorBinding[] = [];
      response.field_errors.forEach((error, index) => {
        const sourceRole = yRoles[index];
        const sourceValues = ds.data.values.map(
          (row) => row[sourceRole.channel] ?? Number.NaN,
        );
        const yErrorChannel = labels.length;
        labels.push(ds.data.labels[sourceRole.channel] ?? "Magnetization uncertainty");
        units.push(ds.data.units[sourceRole.channel] || source.fromMoment);
        outputValues.forEach((row, rowIndex) => row.push(sourceValues[rowIndex]));
        errorRoles.push({ ...sourceRole, channel: yErrorChannel, target: 0 });

        const finiteFieldError = restoreSubstituted(error, substituted[index].finite);
        const fieldError = restoreGapRows(finiteFieldError, pairs);
        const xErrorChannel = labels.length;
        const fieldSide = correctedFieldSide(sourceRole.side);
        const side = fieldSide === "both" ? "" : ` ${fieldSide}`;
        labels.push(`Internal field uncertainty${side}`);
        units.push(response.field_unit);
        outputValues.forEach((row, rowIndex) => row.push(fieldError[rowIndex]));
        errorRoles.push({ channel: xErrorChannel, target: -1, axis: "x", side: fieldSide });
      });

      const baseMetadata = stampXIdentity(
        {
          ...ds.data.metadata,
          magnetometry_demag_correction: {
            version: 1,
            shape: response.shape,
            n_factor_si: response.n_factor,
            n_factor_cgs: response.n_cgs,
            formula: "H_internal = H_applied - N M (SI)",
            source_field_unit: response.field_unit,
            magnetization_unit: response.magnetization_unit,
            uncertainty: yRoles.length
              ? "Propagated from committed magnetization uncertainty; N treated as exact."
              : "No committed magnetization uncertainty was available; N treated as exact.",
          },
        },
        ds.data,
        request.xKey,
        response.field_unit,
      );
      // The output has a new channel schema. Keep file- and row-level
      // provenance, but never let Origin's old per-column names/designations
      // or the source bindings describe these rebuilt columns.
      for (const key of [
        "origin_column_names", "column_designations", "column_comments",
        "all_column_names", "all_column_units", "y_column_indices", "error_roles",
      ]) delete baseMetadata[key];
      const data: DataStruct = {
        time: correctedField,
        values: outputValues,
        labels,
        units,
        metadata: {
          ...baseMetadata,
          x_column_name: "Internal field",
          x_column_long: "Internal field",
          error_roles: errorRoles,
        },
      };
      const outId = nextDatasetId();
      addDataset({ id: outId, name: `${ds.name.replace(/\.[^.]+$/, "")} (internal field)`, data, errorRoles });
      const warnings = [];
      if (!pairs.complete) warnings.push(`${pairs.n - pairs.keep.length} gap rows remain gaps in the corrected field.`);
      if (yRoles.length === 0) warnings.push("No committed magnetization uncertainty was available to propagate.");
      setReadout({
        owners: [...owners, outId], nFactor: response.n_factor, nCgs: response.n_cgs,
        warning: warnings.length ? warnings.join(" ") : null, error: null,
      });
      setStatus(`created internal-field dataset (N = ${response.n_factor.toPrecision(4)})`);
    } catch (error) {
      setReadout({ ...EMPTY, owners, error: error instanceof Error ? error.message : "internal-field correction failed" });
    } finally {
      setBusy(false);
    }
  }

  return {
    shape, setShape, busy, problem, apply,
    nFactor: visible.nFactor, nCgs: visible.nCgs,
    warning: visible.warning, error: visible.error,
  };
}
