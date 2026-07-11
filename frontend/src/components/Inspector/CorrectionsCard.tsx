// Corrections panel: build a CorrectionParams from the form and hand it to the
// store, which posts to /api/corrections/apply and replaces the active
// dataset's displayed data (PlotStage re-renders off `active.data`). The select
// option strings are the backend's exact dispatch keys — do not "tidy" them.

import { useState } from "react";

import { Button, Card, Checkbox, NumberField, Select } from "../primitives";
import type { CorrectionParams, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

const NORM_METHODS = [
  "None",
  "Range [0,1]",
  "Peak (max=1)",
  "Z-score",
  "Area (integral=1)",
];
const DERIV_MODES = ["None", "dY/dX", "d²Y/dX²", "∫Y dx", "dlog/dlog"];
const SMOOTH_METHODS = ["moving", "gaussian", "savgol"];
// interp methods accepted by calc.corrections._interp_zero_fill (0-fill outside).
const INTERP_METHODS = ["linear", "pchip", "spline"];
const NO_BG = ""; // "— none —" sentinel for the background-dataset picker
const opts = (xs: string[]) => xs.map((v) => ({ value: v, label: v }));

interface FormState {
  xOff: string;
  yOff: string;
  bgSlope: string;
  bgInt: string;
  xTrimMin: string;
  xTrimMax: string;
  smoothEnabled: boolean;
  smoothWindow: string;
  smoothMethod: string;
  normMethod: string;
  derivativeMode: string;
  bgId: string; // reference-background dataset id ("" = none)
  bgInterp: string; // interpolation method for the bg subtraction
  // GOTO #7b beam-footprint correction (XRR/NR): geometry + axis convention.
  footprintEnabled: boolean;
  footprintW: string; // beam width (same length unit as L)
  footprintL: string; // sample length
  footprintTwoTheta: boolean; // x axis is the detector angle 2θ (θ = x/2)
}

function initialForm(active: Dataset | null): FormState {
  const c = active?.corrections;
  const s = (v: number | undefined) => (v === undefined ? "" : String(v));
  return {
    xOff: s(c?.xOff),
    yOff: s(c?.yOff),
    bgSlope: s(c?.bgSlope),
    bgInt: s(c?.bgInt),
    xTrimMin: s(c?.xTrimMin),
    xTrimMax: s(c?.xTrimMax),
    smoothEnabled: c?.smoothEnabled ?? false,
    smoothWindow: s(c?.smoothWindow) || "5",
    smoothMethod: c?.smoothMethod ?? "moving",
    normMethod: c?.normMethod ?? "None",
    derivativeMode: c?.derivativeMode ?? "None",
    bgId: active?.bgRef?.datasetId ?? NO_BG,
    bgInterp: active?.bgRef?.interp ?? "linear",
    footprintEnabled: (c?.footprintW ?? 0) > 0 && (c?.footprintL ?? 0) > 0,
    footprintW: s(c?.footprintW),
    footprintL: s(c?.footprintL),
    footprintTwoTheta: c?.footprintTwoTheta ?? false,
  };
}

/** Collect only the set fields into a CorrectionParams (empty = unset). */
function buildParams(f: FormState): CorrectionParams {
  const p: CorrectionParams = {};
  const num = (s: string): number | undefined => {
    if (s.trim() === "") return undefined;
    const n = Number(s);
    return Number.isNaN(n) ? undefined : n;
  };
  const set = (k: keyof CorrectionParams, v: number | undefined) => {
    if (v !== undefined) (p as Record<string, unknown>)[k] = v;
  };
  set("xOff", num(f.xOff));
  set("yOff", num(f.yOff));
  set("bgSlope", num(f.bgSlope));
  set("bgInt", num(f.bgInt));
  set("xTrimMin", num(f.xTrimMin));
  set("xTrimMax", num(f.xTrimMax));
  if (f.smoothEnabled) {
    p.smoothEnabled = true;
    p.smoothMethod = f.smoothMethod;
    const w = num(f.smoothWindow);
    if (w !== undefined) p.smoothWindow = w;
  }
  if (f.normMethod !== "None") p.normMethod = f.normMethod;
  if (f.derivativeMode !== "None") p.derivativeMode = f.derivativeMode;
  // GOTO #7b: only ship the footprint geometry when enabled AND complete —
  // the backend treats w > 0 && L > 0 as the on-switch (pipeline step 2b).
  if (f.footprintEnabled) {
    const w = num(f.footprintW);
    const l = num(f.footprintL);
    if (w !== undefined && w > 0 && l !== undefined && l > 0) {
      p.footprintW = w;
      p.footprintL = l;
      if (f.footprintTwoTheta) p.footprintTwoTheta = true;
    }
  }
  return p;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="qz-meta-row">
      <span className="qz-k">{label}</span>
      <span className="qz-v">{children}</span>
    </div>
  );
}

export default function CorrectionsCard({ active }: { active: Dataset | null }) {
  const applyCorrections = useApp((s) => s.applyCorrections);
  const resetCorrections = useApp((s) => s.resetCorrections);
  const datasets = useApp((s) => s.datasets);
  const [form, setForm] = useState<FormState>(() => initialForm(active));
  const [busy, setBusy] = useState(false);

  const upd = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Other loaded datasets can serve as a reference background to subtract.
  const bgOptions = [
    { value: NO_BG, label: "— none —" },
    ...datasets
      .filter((d) => d.id !== active?.id)
      .map((d) => ({ value: d.id, label: d.name })),
  ];

  if (!active) {
    return (
      <Card title="Corrections" defaultOpen={false}>
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Add a dataset to apply corrections.
        </div>
      </Card>
    );
  }

  const onApply = async () => {
    setBusy(true);
    try {
      const bg =
        form.bgId !== NO_BG ? { datasetId: form.bgId, interp: form.bgInterp } : undefined;
      // Preserve the anchor-baseline step the Baseline workshop owns —
      // buildParams rebuilds only the card's own fields, and the store
      // stores corrections as a FULL replacement (review 2026-07-11).
      const prior = active.corrections ?? {};
      const anchorFields =
        prior.bgAnchors && prior.bgAnchors.length >= 2
          ? { bgAnchors: prior.bgAnchors, bgAnchorMethod: prior.bgAnchorMethod }
          : {};
      await applyCorrections(active.id, { ...buildParams(form), ...anchorFields }, bg);
    } finally {
      setBusy(false);
    }
  };
  const onReset = () => {
    resetCorrections(active.id);
    setForm(initialForm(null));
  };

  return (
    <Card title="Corrections" defaultOpen={false}>
      <Field label="X offset">
        <NumberField value={form.xOff} placeholder="0" onChange={(v) => upd("xOff", v)} />
      </Field>
      <Field label="Y offset">
        <NumberField value={form.yOff} placeholder="0" onChange={(v) => upd("yOff", v)} />
      </Field>
      <Field label="BG slope">
        <NumberField value={form.bgSlope} placeholder="0" onChange={(v) => upd("bgSlope", v)} />
      </Field>
      <Field label="BG intercept">
        <NumberField value={form.bgInt} placeholder="0" onChange={(v) => upd("bgInt", v)} />
      </Field>
      <Field label="Trim min">
        <NumberField value={form.xTrimMin} placeholder="—" onChange={(v) => upd("xTrimMin", v)} />
      </Field>
      <Field label="Trim max">
        <NumberField value={form.xTrimMax} placeholder="—" onChange={(v) => upd("xTrimMax", v)} />
      </Field>

      {bgOptions.length > 1 && (
        <>
          <Field label="Background">
            <Select
              options={bgOptions}
              value={form.bgId}
              onChange={(e) => upd("bgId", e.target.value)}
            />
          </Field>
          {form.bgId !== NO_BG && (
            <Field label="Interp">
              <Select
                options={opts(INTERP_METHODS)}
                value={form.bgInterp}
                onChange={(e) => upd("bgInterp", e.target.value)}
              />
            </Field>
          )}
        </>
      )}

      <div style={{ marginTop: 8 }}>
        <Checkbox
          checked={form.footprintEnabled}
          onChange={(v) => upd("footprintEnabled", v)}
        >
          Footprint (XRR/NR)
        </Checkbox>
      </div>
      {form.footprintEnabled && (
        <>
          <Field label="Beam w">
            <NumberField
              value={form.footprintW}
              placeholder="mm"
              onChange={(v) => upd("footprintW", v)}
            />
          </Field>
          <Field label="Sample L">
            <NumberField
              value={form.footprintL}
              placeholder="mm"
              onChange={(v) => upd("footprintL", v)}
            />
          </Field>
          <Checkbox
            checked={form.footprintTwoTheta}
            onChange={(v) => upd("footprintTwoTheta", v)}
          >
            X axis is 2θ
          </Checkbox>
        </>
      )}

      <div style={{ marginTop: 8 }}>
        <Checkbox
          checked={form.smoothEnabled}
          onChange={(v) => upd("smoothEnabled", v)}
        >
          Smooth
        </Checkbox>
      </div>
      {form.smoothEnabled && (
        <>
          <Field label="Window">
            <NumberField
              value={form.smoothWindow}
              onChange={(v) => upd("smoothWindow", v)}
            />
          </Field>
          <Field label="Method">
            <Select
              options={opts(SMOOTH_METHODS)}
              value={form.smoothMethod}
              onChange={(e) => upd("smoothMethod", e.target.value)}
            />
          </Field>
        </>
      )}

      <Field label="Normalize">
        <Select
          options={opts(NORM_METHODS)}
          value={form.normMethod}
          onChange={(e) => upd("normMethod", e.target.value)}
        />
      </Field>
      <Field label="Derivative">
        <Select
          options={opts(DERIV_MODES)}
          value={form.derivativeMode}
          onChange={(e) => upd("derivativeMode", e.target.value)}
        />
      </Field>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button variant="primary" size="sm" disabled={busy} onClick={onApply}>
          {busy ? "Applying…" : "Apply"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || !active.raw} onClick={onReset}>
          Reset
        </Button>
      </div>
    </Card>
  );
}
