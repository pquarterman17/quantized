// Magnetometry Units tab — state hook for explicit-basis sample normalization
// (MAIN_PLAN #42). Owns the SampleProfile form, the basis/output-unit choice,
// the live calculation summary, the explicit "Use metadata values" fill, the
// saved-profile actions, and Apply.
//
// Rules this hook enforces (the item's contract):
//  - The basis is only ever the user's choice. Nothing reads metadata to pick
//    one, and a fill or a loaded profile leaves it alone.
//  - Apply is NON-DESTRUCTIVE: it writes a NEW dataset, never the source's
//    values, and records every geometry input, original unit, canonical value,
//    basis, output unit, factor and formula in `magnetometry_normalization`.
//  - The summary is derived from the current form on every render, so it can
//    never describe a stale profile; the same summary gates Apply.
//
// Gaps (NaN) follow the elementwise contract of the old Units tab: each axis
// is substituted on the way out and restored on the way back
// (lib/api/finiteSubstitute.ts), so a moment gap never costs a good field.

import { useState } from "react";

import { restoreSubstituted, substituteGaps } from "../../../lib/api/finiteSubstitute";
import { normalizeMagMoment } from "../../../lib/api/magnetometry";
import { stampXIdentity } from "../../../lib/magDataKind";
import {
  convertQuantityUnit,
  emptySampleProfile,
  makeQuantity,
  profileWire,
  PROFILE_FIELDS,
  type ProfileField,
  type SampleGeometry,
  type SampleProfile,
} from "../../../lib/sampleGeometry";
import {
  geometriesFor,
  normalizationProvenance,
  outputUnitsFor,
  summarizeNormalization,
  type NormalizationBasis,
  type NormalizationSummary,
} from "../../../lib/sampleNormalization";
import { profileFromMetadata } from "../../../lib/sampleProfileMetadata";
import type { DataStruct, Dataset } from "../../../lib/types";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import {
  FIELD_UNITS,
  magXY,
  requestView,
  resolveCurrentRequest,
  resolvedSourceStillCurrent,
  sourceUnits,
} from "./useMagTools";
import { useSampleProfiles, type SampleProfilesApi } from "./useSampleProfiles";

type Texts = Record<ProfileField, string>;

const textOf = (v: number | null): string => (v === null || !Number.isFinite(v) ? "" : String(v));
const textsOf = (p: SampleProfile): Texts =>
  Object.fromEntries(PROFILE_FIELDS.map((f) => [f, textOf(p[f].value)])) as Texts;

/** "" -> null (blank); anything Number() cannot read -> NaN (named invalid). */
export function parseEntered(text: string): number | null {
  const t = text.trim();
  return t === "" ? null : Number(t);
}

/** Area basis cannot use a direct volume; fall back to the first area path. */
function fitGeometry(basis: NormalizationBasis, geometry: SampleGeometry): SampleGeometry {
  const allowed = geometriesFor(basis);
  return allowed.length && !allowed.includes(geometry) ? allowed[0] : geometry;
}

const NOTHING_TO_DO = "Nothing to change: choose a basis, another output unit, or another field unit.";

interface Readout {
  owners: readonly string[];
  warning: string | null;
  error: string | null;
  notice: string | null;
}
const EMPTY: Readout = { owners: [], warning: null, error: null, notice: null };

export interface MagNormalizationState {
  active: Dataset | null;
  fromField: string | null;
  xUnit: string;
  fromMoment: string;
  basis: NormalizationBasis;
  setBasis: (b: NormalizationBasis) => void;
  outputUnits: readonly string[];
  toMoment: string;
  setToMoment: (u: string) => void;
  fieldUnits: readonly string[];
  toField: string;
  setToField: (u: string) => void;
  profile: SampleProfile;
  texts: Texts;
  setGeometry: (g: SampleGeometry) => void;
  setFieldText: (f: ProfileField, text: string) => void;
  /** Re-express the field in `unit`, keeping the physical quantity. */
  setFieldUnit: (f: ProfileField, unit: string) => void;
  summary: NormalizationSummary;
  /** Why Apply is disabled, or null. Always names the exact field. */
  applyBlocked: string | null;
  busy: boolean;
  warning: string | null;
  error: string | null;
  notice: string | null;
  fillFromMetadata: () => void;
  profiles: SampleProfilesApi;
  saveProfile: (name: string) => void;
  loadProfile: (id: string) => void;
  apply: () => Promise<void>;
}

export function useMagNormalization(): MagNormalizationState {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const profiles = useSampleProfiles();
  const [basis, setBasisState] = useState<NormalizationBasis>("none");
  const [chosenMoment, setToMoment] = useState("");
  // "" = keep the source's own field unit: normalizing never silently
  // converts the field axis as a side effect.
  const [chosenField, setToField] = useState("");
  const [form, setForm] = useState(() => {
    const p = emptySampleProfile();
    return { profile: p, texts: textsOf(p) };
  });
  const [busy, setBusy] = useState(false);
  const [readout, setReadout] = useState<Readout>(EMPTY);
  const visible = active && readout.owners.includes(active.id) ? readout : EMPTY;

  const src = active ? sourceUnits(active, xKey, yKeys, seriesOrder) : null;
  const fromMoment = src?.fromMoment ?? "emu";
  // A non-field x (an M(T) curve) is never converted: its own unit is the only
  // choice. A field unit outside the standard list is offered as-is.
  const fieldUnits = src && src.fromField == null ? [src.xUnit]
    : src?.fromField && !FIELD_UNITS.includes(src.fromField) ? [src.fromField, ...FIELD_UNITS] : FIELD_UNITS;
  const toField = chosenField && fieldUnits.includes(chosenField) ? chosenField : (src?.fromField ?? src?.xUnit ?? "Oe");
  const outputUnits = outputUnitsFor(basis, fromMoment);
  // Derived, never stored: switching basis or dataset can never leave a unit
  // from another family selected.
  const toMoment = outputUnits.includes(chosenMoment) ? chosenMoment : (outputUnits[0] ?? "");
  const summary = summarizeNormalization(form.profile, basis, fromMoment, toMoment);
  const nothingToDo = basis === "none" && toMoment === fromMoment && (src?.fromField == null || src.fromField === toField);
  const applyBlocked = !active ? "Select a dataset first." : summary.problem ?? (nothingToDo ? NOTHING_TO_DO : null);

  const replaceProfile = (p: SampleProfile): void =>
    setForm({ profile: { ...p, geometry: fitGeometry(basis, p.geometry) }, texts: textsOf(p) });
  const setBasis = (b: NormalizationBasis): void => {
    setBasisState(b);
    setForm((f) => ({ ...f, profile: { ...f.profile, geometry: fitGeometry(b, f.profile.geometry) } }));
  };
  const setGeometry = (g: SampleGeometry): void => setForm((f) => ({ ...f, profile: { ...f.profile, geometry: g } }));
  const setFieldText = (field: ProfileField, text: string): void =>
    setForm((f) => ({
      profile: { ...f.profile, [field]: makeQuantity(field, parseEntered(text), f.profile[field].unit) },
      texts: { ...f.texts, [field]: text },
    }));
  const setFieldUnit = (field: ProfileField, unit: string): void =>
    setForm((f) => {
      const q = convertQuantityUnit(field, f.profile[field], unit);
      // An unparseable entry is kept verbatim under the new unit: there is no
      // physical value to preserve, and silently clearing it would hide it.
      const text = q.value !== null && Number.isFinite(q.value) ? String(q.value) : f.texts[field];
      return { profile: { ...f.profile, [field]: q }, texts: { ...f.texts, [field]: text } };
    });

  const note = (notice: string | null, error: string | null = null): void =>
    setReadout({ owners: active ? [active.id] : [], warning: null, error, notice });

  const fillFromMetadata = (): void => {
    if (!active) return;
    const fill = profileFromMetadata(active.data.metadata, form.profile);
    if (!fill) {
      note(null, "This dataset's metadata states no sample mass or geometry; nothing was filled.");
      return;
    }
    replaceProfile(fill.profile);
    note(`Filled from metadata: ${fill.filled.join("; ")}. Check the units before applying.`);
  };
  const saveProfile = (name: string): void => {
    const stored = profiles.save(name, form.profile);
    if (stored === null) note(null, "Name the profile before saving it.");
    else note(`Saved sample profile "${stored}".`);
  };
  const loadProfile = (id: string): void => {
    const p = profiles.get(id);
    if (!p) return;
    replaceProfile(p);
    note(`Loaded sample profile "${profiles.saved.find((s) => s.id === id)?.name ?? id}" into the form. Nothing is applied until you press Apply.`);
  };

  async function apply(): Promise<void> {
    if (!active) return;
    const request = requestView(active.id, xKey, yKeys, seriesOrder);
    const owners = [request.sourceId];
    const profile = form.profile;
    const fail = (error: string): void => setReadout({ owners, warning: null, error, notice: null });
    setBusy(true);
    setReadout(EMPTY);
    try {
      const ds = await resolveCurrentRequest(request);
      if (!ds) return;
      const from = sourceUnits(ds, request.xKey, request.yKeys, request.seriesOrder);
      // Re-derived from the RESOLVED source: a lazy book's real moment unit
      // decides the summary, not the placeholder the panel rendered with.
      const units = outputUnitsFor(basis, from.fromMoment);
      const outUnit = units.includes(chosenMoment) ? chosenMoment : (units[0] ?? "");
      const plan = summarizeNormalization(profile, basis, from.fromMoment, outUnit);
      if (plan.problem) return fail(plan.problem);
      const outField = from.fromField == null ? from.xUnit : chosenField || from.fromField;
      if (basis === "none" && outUnit === from.fromMoment && (from.fromField == null || from.fromField === outField)) return fail(NOTHING_TO_DO);
      const { x, y, yKey } = magXY(ds, request.xKey, request.yKeys, request.seriesOrder);
      const xs = substituteGaps(x);
      const ys = substituteGaps(y);
      const anyX = xs.finite.includes(true);
      const anyY = ys.finite.includes(true);
      if (x.length === 0 || (!anyX && !anyY)) return fail("No finite field or moment values to convert.");
      const warnings: string[] = [];
      if (!anyX) warnings.push("Every field value is a gap; the converted x column is all gaps.");
      if (!anyY) warnings.push("Every moment value is a gap; the converted y column is all gaps.");
      if (from.fromField == null) warnings.push(`x (${from.xLabel || "unnamed"}) is not a field, so only the moment was converted.`);
      const res = await normalizeMagMoment({
        x: xs.safe,
        y: ys.safe,
        from_field: from.fromField ?? from.xUnit,
        to_field: outField,
        from_moment: from.fromMoment,
        basis,
        to_moment: outUnit,
        geometry: plan.geometry ?? "",
        profile: profileWire(profile),
      });
      if (!resolvedSourceStillCurrent(request, ds.data)) return;
      const metadata = { ...ds.data.metadata };
      // A field-only change (basis none, moment unit kept) preserves an
      // earlier normalization record instead of claiming a new one.
      if (basis !== "none" || res.y_unit !== from.fromMoment) {
        metadata.magnetometry_normalization = normalizationProvenance({
          profile, summary: plan, record: res, toField: res.x_unit,
          source: { datasetId: ds.id, datasetName: ds.name, channel: ds.data.labels[yKey] ?? "", xUnit: from.fromField ?? from.xUnit },
        });
      }
      const data: DataStruct = {
        time: restoreSubstituted(res.x, xs.finite),
        values: restoreSubstituted(res.y, ys.finite).map((v) => [v]),
        labels: [ds.data.labels[yKey] ?? "Moment"],
        units: [res.y_unit],
        metadata: stampXIdentity(metadata, ds.data, request.xKey, res.x_unit),
      };
      const outId = nextDatasetId();
      addDataset({ id: outId, name: `${ds.name.replace(/\.[^.]+$/, "")} (${res.y_unit})`, data });
      if (res.warning) warnings.push(res.warning);
      setReadout({ owners: [...owners, outId], warning: warnings.length ? warnings.join(" ") : null, error: null, notice: null });
      setStatus(`normalized to ${res.x_unit} / ${res.y_unit}`);
    } catch (e) {
      fail(e instanceof Error ? e.message : "normalization failed");
    } finally {
      setBusy(false);
    }
  }

  return {
    active, fromField: src?.fromField ?? null, xUnit: src?.xUnit ?? "", fromMoment,
    basis, setBasis, outputUnits, toMoment, setToMoment,
    fieldUnits, toField, setToField,
    profile: form.profile, texts: form.texts, setGeometry, setFieldText, setFieldUnit,
    summary, applyBlocked, busy,
    warning: visible.warning, error: visible.error, notice: visible.notice,
    fillFromMetadata, profiles, saveProfile, loadProfile, apply,
  };
}
