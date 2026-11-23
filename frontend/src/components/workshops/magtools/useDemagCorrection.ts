import { useMemo, useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { restoreSubstituted, substituteGaps } from "../../../lib/api/finiteSubstitute";
import { demagCorrectField } from "../../../lib/api/magnetometry";
import { analysisSeries } from "../../../lib/analysisInputs";
import { detectMagXKind, stampXIdentity } from "../../../lib/magDataKind";
import { ownXKey } from "../../../lib/perSeriesX";
import type { ErrorBinding } from "../../../lib/errorRoles";
import type { DataStruct, Dataset } from "../../../lib/types";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";
import {
  requestView,
  resolveCurrentRequest,
  resolvedSourceStillCurrent,
  sourceUnits,
} from "./useMagTools";
import { magColumns, resolveMagInputs } from "./magInputs";
import { magChannelsExtra } from "./magReopen";
import { seedChoice, useReopenSeed } from "../resultcommit/useReopenSession";
import { useReplaceLayoutBlock } from "../resultcommit/useReplaceLayoutBlock";

const DEMAG_PRODUCER = { id: "mag-demag", label: "Internal-field correction", version: 2 } as const;

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
  /** What the readout was produced for (source rows, plotted channels, geometry); null for an error. */
  key: string | null;
  nFactor: number | null;
  nCgs: number | null;
  warning: string | null;
  error: string | null;
}

const EMPTY: DemagReadout = { owners: [], key: null, nFactor: null, nCgs: null, warning: null, error: null };

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
  const xProblem = fieldErrorProblem(ds, xKey, yKeys, seriesOrder, source.fromField);
  if (xProblem) return xProblem;
  return null;
}

/** The committed applied-field uncertainty roles of the plotted x axis (target
 *  -1 = the dataset x axis, or the x column itself), deduplicated by channel. */
function fieldErrorRoles(
  ds: Dataset, xKey: number | null, yKeys: number[] | null, seriesOrder: number[] | null,
): { used: ErrorBinding[]; foreign: boolean } {
  const yKey = magColumns(ds, xKey, yKeys, seriesOrder).yKey;
  const ownX = ownXKey(ds, xKey, yKey);
  const all = (ds.errorRoles ?? []).filter((role) => role.axis === "x");
  const used = all.filter(
    (role, i, roles) => (role.target === -1 ? ownX === null : role.target === ownX) &&
      roles.findIndex((other) => other.channel === role.channel) === i,
  );
  return { used, foreign: all.length > used.length };
}

/** Fail closed when applied-field uncertainty exists but cannot be propagated
 *  exactly: asymmetric (+/-) bars, a column in another unit, or an x-error
 *  that describes a different x axis than the plotted one. */
function fieldErrorProblem(
  ds: Dataset, xKey: number | null, yKeys: number[] | null, seriesOrder: number[] | null, fromField: string,
): string | null {
  const { used, foreign } = fieldErrorRoles(ds, xKey, yKeys, seriesOrder);
  if (foreign) {
    return "This dataset has x uncertainty for a different x axis than the plotted field, so the internal-field uncertainty would be understated. Plot that axis or remove the unrelated x error binding.";
  }
  if (used.some((role) => role.side !== "both")) {
    return "The applied-field uncertainty is asymmetric (+/-). Only symmetric field uncertainty can be combined with magnetization uncertainty; no understated error bars will be created.";
  }
  const bad = used.find((role) => (ds.data.units[role.channel] ?? "") !== "" && ds.data.units[role.channel] !== fromField);
  if (bad) {
    return `The applied-field uncertainty column is in ${ds.data.units[bad.channel]}, not the field unit ${fromField}; convert it in the Units tab first.`;
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
  // Lane RO3: a reopened result starts from its recorded geometry; one that is
  // no longer a known geometry is not guessed (Replace stays off until chosen).
  const seed = useReopenSeed(DEMAG_PRODUCER.id, active?.id)?.settings;
  const [seedProblem, setSeedProblem] = useState<string | null>(() =>
    seed && !(DEMAG_SHAPES as readonly unknown[]).includes(seed["shape"])
      ? "The recorded geometry is not one this version knows, so choose it again. Replace is off until then." : null);
  useReplaceLayoutBlock(DEMAG_PRODUCER.id, active?.id, null, seedProblem);
  const [shape, setShapeState] = useState<DemagShape | "">(() => (seed ? seedChoice<DemagShape | "">(seed["shape"], DEMAG_SHAPES, "") : ""));
  const setShape = (next: DemagShape | ""): void => { setSeedProblem(null); setShapeState(next); };
  const [busy, setBusy] = useState(false);
  const [readout, setReadout] = useState<DemagReadout>(EMPTY);
  const activeId = active?.id ?? null;
  const owned = activeId && readout.owners.includes(activeId) ? readout : EMPTY;
  // Lane WB7: on the source the applied-N readout describes the RUN, so a moved
  // geometry / channel / row set withholds it (an "Applied N" beside another
  // geometry would read as that geometry's); on the corrected dataset it describes itself.
  const liveKey = JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, shape]);
  const stale = owned.key !== null && activeId === owned.owners[0] && owned.key !== liveKey;
  const visible = stale ? { ...EMPTY, owners: owned.owners, error: owned.error } : owned;
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
      const inputs = resolveMagInputs(ds, request.xKey, request.yKeys, request.seriesOrder);
      if (!inputs.ok) {
        setReadout({ ...EMPTY, owners, error: inputs.reason });
        return;
      }
      const { x, y, yKey } = analysisSeries(inputs);
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
      const xRoles = fieldErrorRoles(ds, request.xKey, request.yKeys, request.seriesOrder).used;
      const xSub = xRoles.map((role) => substituteGaps(keptErrorSeries(ds, role, pairs.keep)));
      // Row finite-ness of the applied-field uncertainty: a gap in it leaves a gap in the result.
      const xFinite = pairs.keep.map((_, i) => xSub.every((sub) => sub.finite[i]));
      const response = await demagCorrectField({
        field: pairs.x,
        magnetization: pairs.y,
        shape,
        field_unit: source.fromField!,
        magnetization_unit: source.fromMoment,
        magnetization_errors: substituted.map((series) => series.safe),
        ...(xSub.length ? { field_errors: xSub.map((series) => series.safe) } : {}),
      });
      if (!resolvedSourceStillCurrent(request, ds.data)) return;
      // Applied-field-only uncertainty comes back as one column with no M role.
      const expected = yRoles.length || (xSub.length ? 1 : 0);
      if (response.field_errors.length !== expected) {
        throw new Error(`backend returned ${response.field_errors.length} uncertainty columns for ${expected} expected`);
      }

      const correctedField = restoreGapRows(response.field, pairs);
      const outputValues = ds.data.values.map((row) => [row[yKey] ?? Number.NaN]);
      const labels = [ds.data.labels[yKey] ?? "Magnetization"];
      const units = [source.fromMoment];
      const errorRoles: ErrorBinding[] = [];
      response.field_errors.forEach((error, index) => {
        const sourceRole: ErrorBinding | undefined = yRoles[index];
        if (sourceRole) {
          const sourceValues = ds.data.values.map((row) => row[sourceRole.channel] ?? Number.NaN);
          const yErrorChannel = labels.length;
          labels.push(ds.data.labels[sourceRole.channel] ?? "Magnetization uncertainty");
          units.push(ds.data.units[sourceRole.channel] || source.fromMoment);
          outputValues.forEach((row, rowIndex) => row.push(sourceValues[rowIndex]));
          errorRoles.push({ ...sourceRole, channel: yErrorChannel, target: 0 });
        }

        const finiteMask = (substituted[index]?.finite ?? xFinite).map((ok, i) => ok && xFinite[i]);
        const finiteFieldError = restoreSubstituted(error, finiteMask);
        const fieldError = restoreGapRows(finiteFieldError, pairs);
        const xErrorChannel = labels.length;
        const fieldSide = sourceRole ? correctedFieldSide(sourceRole.side) : "both";
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
            uncertainty: yRoles.length || xRoles.length
              ? `Propagated in quadrature from committed ${[yRoles.length ? "magnetization" : "", xRoles.length ? "applied-field" : ""].filter(Boolean).join(" and ")} uncertainty; N treated as exact.`
              : "No committed uncertainty was available; N treated as exact.",
          },
        },
        ds.data,
        ownXKey(ds, request.xKey, yKey), // the X `time` was read from
        response.field_unit,
      );
      // The output has a new channel schema. Keep file- and row-level
      // provenance, but never let Origin's old per-column names/designations
      // or the source bindings describe these rebuilt columns.
      for (const key of [
        "origin_column_names", "column_designations", "column_comments",
        "all_column_names", "all_column_units", "y_column_indices", "error_roles", "label_rows",
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
      // One undo step, no duplicate on a repeat Apply, stale when the source
      // changes (store/analysisOutputCommit.ts).
      const outcome = commitComputedOutput({
        producer: DEMAG_PRODUCER,
        sources: [{ id: ds.id, computedOn: analysisDataFingerprint(ds) }],
        settings: { shape, xKey: request.xKey, yKey },
        reopenExtra: magChannelsExtra(ds, request.xKey, yKey),
        name: `${ds.name.replace(/\.[^.]+$/, "")} (internal field)`, data, errorRoles,
        status: `created internal-field dataset (N = ${response.n_factor.toPrecision(4)})`,
      });
      if (outcome.kind === "refused") {
        setReadout({ ...EMPTY, owners, error: outcome.reason });
        return;
      }
      const warnings = [];
      if (!pairs.complete) warnings.push(`${pairs.n - pairs.keep.length} gap rows remain gaps in the corrected field.`);
      if (yRoles.length === 0 && xRoles.length === 0) warnings.push("No committed magnetization or applied-field uncertainty was available to propagate.");
      setReadout({
        key: JSON.stringify([datasetInputsToken(ds), request.xKey, request.yKeys, request.seriesOrder, shape]),
        owners: [...owners, outcome.outputId], nFactor: response.n_factor, nCgs: response.n_cgs,
        warning: warnings.length ? warnings.join(" ") : null, error: null,
      });
    } catch (error) {
      setReadout({ ...EMPTY, owners, error: error instanceof Error ? error.message : "internal-field correction failed" });
    } finally {
      setBusy(false);
    }
  }

  return {
    shape, setShape, busy, problem, apply, stale, seedProblem,
    nFactor: visible.nFactor, nCgs: visible.nCgs,
    warning: visible.warning, error: visible.error,
  };
}
