import { useEffect, useMemo, useRef, useState } from "react";

import { applyCorrections } from "../../../lib/api";
import { runSpectralWorkbench } from "../../../lib/api/spectralWorkbench";
import { xUnitOf } from "../../../lib/transformResample";
import { droppedRows } from "../../../lib/rowstate";
import { saveSignalRecipeTemplate } from "../../../lib/signalRecipeTemplate";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { createSignalWorksheetFromApp } from "../../../store/signalWorksheetCommand";
import { toast } from "../../../store/toasts";
import ToolWindow from "../../overlays/ToolWindow";
import { askParams } from "../../overlays/ParamDialog";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import SignalPreview from "./SignalPreview";
import SpectralControls from "./SpectralControls";
import SpectralReadout from "./SpectralReadout";
import {
  DEFAULT_SIGNAL_SETTINGS,
  buildCorrectionRecipe,
  channelsWithoutFiniteValues,
  isSpectralOperation,
  measuredChannels,
  operationLabel,
  selectedBoundErrorTargets,
  settingsToParams,
  type SignalOperation,
  type SignalSettings,
} from "./signalProcessingModel";
import {
  DEFAULT_SPECTRAL_SETTINGS,
  buildSpectralRecipe,
  validateSpectralSettings,
} from "./spectralSettings";

const OPERATION_OPTIONS: { value: SignalOperation; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "normalize-range", label: "Normalize · 0–1" },
  { value: "normalize-peak", label: "Normalize · peak = 1" },
  { value: "normalize-zscore", label: "Normalize · Z-score" },
  { value: "normalize-area", label: "Normalize · area = 1" },
  { value: "normalize-reference", label: "Normalize · reference" },
  { value: "detrend", label: "Detrend" },
  { value: "derivative-first", label: "Derivative · dY/dX" },
  { value: "derivative-second", label: "Derivative · d²Y/dX²" },
  { value: "integral", label: "Integral · cumulative ∫Y dx" },
  { value: "log-derivative", label: "Derivative · dlog(Y)/dlog(X)" },
  { value: "fft", label: "Spectrum · FFT / PSD / phase" },
  { value: "filter", label: "Filter · frequency domain" },
  { value: "correlation", label: "Cross-correlation" },
];

function enteredFinite(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

export default function SignalProcessingPanel() {
  const setSignalProcessingOpen = useApp((s) => s.setSignalProcessingOpen);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const plotChannels = useApp((s) => s.yKeys);
  const setActive = useApp((s) => s.setActive);
  const setStatus = useApp((s) => s.setStatus);
  const active = datasets.find((dataset) => dataset.id === activeId) ?? null;
  const available = useMemo(() => active ? measuredChannels(active) : [], [active]);
  const [channels, setChannels] = useState<number[]>([]);
  const [settings, setSettings] = useState<SignalSettings>(DEFAULT_SIGNAL_SETTINGS);
  const [spectralSettings, setSpectralSettings] = useState(DEFAULT_SPECTRAL_SETTINGS);
  const [preview, setPreview] = useState<DataStruct | null>(null);
  const [previewFor, setPreviewFor] = useState<{
    datasetId: string;
    data: DataStruct;
    request: object;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const previewSequence = useRef(0);
  const commitInFlight = useRef(false);
  const commitController = useRef<AbortController | null>(null);
  const close = () => {
    commitController.current?.abort();
    setSignalProcessingOpen(false);
  };
  const spectralOperation = isSpectralOperation(settings.operation) ? settings.operation : null;
  const spectral = spectralOperation !== null;

  useEffect(() => {
    const plotted = (plotChannels ?? []).filter((channel) => available.includes(channel));
    setChannels(plotted.length ? plotted : available.slice(0, 1));
  }, [activeId, available, plotChannels]);

  useEffect(() => {
    const x = active?.data.time ?? [];
    let min = Infinity;
    let max = -Infinity;
    for (const value of x) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    setSpectralSettings((current) => ({
      ...current,
      xMin: String(min),
      xMax: String(max),
    }));
    setSettings((current) => ({ ...current, xMin: String(min), xMax: String(max) }));
  }, [activeId, active?.data.time]);

  const params = useMemo(
    () => spectral ? null : settingsToParams(settings, channels),
    [settings, channels, spectral],
  );
  const recipe = useMemo(
    () => !active
      ? null
      : spectralOperation
        ? buildSpectralRecipe(spectralOperation, spectralSettings, channels, active)
        : buildCorrectionRecipe(settings, channels, active),
    [active, channels, settings, spectralOperation, spectralSettings],
  );
  const requestSpec = recipe;
  const previewCurrent = Boolean(
    preview
    && active
    && requestSpec
    && previewFor?.datasetId === active.id
    && previewFor.data === active.data
    && previewFor.request === requestSpec,
  );
  const displayedPreview = previewCurrent ? preview : null;
  const boundTargets = active ? selectedBoundErrorTargets(active, channels) : [];
  const emptyOutputs = displayedPreview
    ? spectral
      ? displayedPreview.labels.flatMap((_, channel) => displayedPreview.values.some((row) => Number.isFinite(row[channel])) ? [] : [channel])
      : channelsWithoutFiniteValues(displayedPreview, channels)
    : [];
  const outputError = displayedPreview && emptyOutputs.length
    ? `No finite output was produced for ${emptyOutputs.map((channel) => spectral ? displayedPreview.labels[channel] : active?.data.labels[channel]).join(", ")}.`
    : "";
  const nonlinearWithErrors = !spectral && (
    settings.operation === "smooth" ||
    settings.operation === "detrend" ||
    settings.operation.startsWith("derivative") ||
    settings.operation === "log-derivative" ||
    settings.operation === "integral"
  );
  const operationValidation = spectralOperation
    ? validateSpectralSettings(spectralOperation, spectralSettings, channels)
    : settings.operation === "smooth" && (!Number.isInteger(settings.smoothWindow) || settings.smoothWindow < 1)
      ? "Smoothing half-window must be a positive integer."
      : settings.operation === "smooth" && settings.smoothMethod === "savitzky-golay" &&
          (!Number.isInteger(settings.smoothPolyOrder) || settings.smoothPolyOrder < 0 || settings.smoothPolyOrder >= 2 * settings.smoothWindow + 1)
        ? "Savitzky–Golay polynomial order must be a non-negative integer smaller than the full window."
      : settings.operation === "detrend" && (!Number.isInteger(settings.detrendOrder) || settings.detrendOrder < 0 || settings.detrendOrder > 5)
        ? "Detrend order must be an integer from 0 to 5."
      : settings.operation === "normalize-reference" && settings.referenceMode === "value" &&
          (!enteredFinite(settings.referenceValue) || Number(settings.referenceValue) === 0)
        ? "Reference value must be finite and non-zero."
      : settings.operation === "normalize-reference" && settings.referenceMode === "range" &&
          (!enteredFinite(settings.referenceMin) || !enteredFinite(settings.referenceMax) || Number(settings.referenceMin) >= Number(settings.referenceMax))
        ? "Reference X range must be finite and increasing."
      : settings.useRange && (!enteredFinite(settings.xMin) || !enteredFinite(settings.xMax) || Number(settings.xMin) >= Number(settings.xMax))
        ? "X range must be finite and increasing."
      : nonlinearWithErrors && boundTargets.length > 0
        ? "This operation cannot yet propagate bound Y uncertainty. Unassign that error column or use normalization."
        : "";
  const validation = !active
    ? "Select a dataset first."
    : active.pending
      ? "Wait for the full dataset to load."
      : channels.length === 0
        ? "Select at least one signal column."
        : operationValidation;

  useEffect(() => {
    const sequence = ++previewSequence.current;
    let cancelled = false;
    const controller = new AbortController();
    setPreview(null);
    setPreviewFor(null);
    setPreviewError("");
    if (!active || validation || !recipe || (!spectral && !params)) return;
    const timer = window.setTimeout(() => {
      const request = spectral
        ? runSpectralWorkbench(active.data, recipe as ReturnType<typeof buildSpectralRecipe>, controller.signal, true)
        : applyCorrections({
            dataset: active.data,
            params: params!,
            ...(active.errorRoles ? { error_bindings: active.errorRoles } : {}),
          }, controller.signal);
      void request.then((result) => {
        if (!cancelled && previewSequence.current === sequence) {
          setPreview(result);
          setPreviewFor({ datasetId: active.id, data: active.data, request: recipe });
        }
      }).catch((error: unknown) => {
        const aborted = typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
        if (!cancelled && previewSequence.current === sequence && !aborted) {
          setPreviewError(error instanceof Error ? error.message : "Preview failed");
        }
      });
    }, 180);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [active, params, recipe, spectral, validation]);

  const commit = async () => {
    if (!active || !displayedPreview || validation || outputError || commitInFlight.current) return;
    commitInFlight.current = true;
    const controller = new AbortController();
    commitController.current = controller;
    setBusy(true);
    try {
      const id = recipe ? await createSignalWorksheetFromApp(active.id, recipe, controller.signal) : null;
      if (id) {
        setActive(id);
        close();
      }
    } finally {
      if (commitController.current === controller) commitController.current = null;
      commitInFlight.current = false;
      setBusy(false);
    }
  };

  const saveRecipe = async () => {
    if (!active || !recipe || validation) return;
    const picked = await askParams("Save Signal Processing recipe", [
      { key: "name", label: "Recipe name", type: "text", default: `${operationLabel(settings.operation)} · ${active.data.labels[channels[0] ?? 0] ?? active.name}` },
    ], {
      message: "The recipe will appear in the Recipe Library and can be applied to compatible worksheets without changing their raw data.",
      confirmLabel: "Save recipe",
    });
    if (!picked) return;
    try {
      const saved = saveSignalRecipeTemplate(String(picked.name ?? ""), active, recipe);
      const message = `saved recipe “${saved.name}” (revision ${saved.revision})`;
      setStatus(message);
      toast(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "couldn't save recipe";
      setStatus(message);
      toast(message, "danger");
    }
  };

  const dropped = active ? droppedRows(active).size : 0;
  const totalRows = active?.data.time.length ?? 0;
  const xLabel = typeof active?.data.metadata.xLabel === "string" && active.data.metadata.xLabel.trim()
    ? active.data.metadata.xLabel.trim()
    : "X";
  const xUnit = active ? xUnitOf(active.data) : "";

  return (
    <ToolWindow id="signal-processing" title="Signal Processing" width={620} x={180} y={90} onClose={close}>
      <div className="qz-signal-workbench">
        <p className="qz-signal-intro">Transform selected signals with a live preview. Apply creates a linked worksheet; the source is never overwritten.</p>
        {!active ? <p className="qz-error">Select a dataset to begin.</p> : (
          <>
            <div className="qz-signal-note">
              Source: <strong>{active.name}</strong> · X: {xLabel}{xUnit ? ` (${xUnit})` : ""}
            </div>
            <label className="qz-signal-field">Operation
              <Select
                value={settings.operation}
                onChange={(event) => setSettings((current) => ({ ...current, operation: event.target.value as SignalOperation }))}
                options={OPERATION_OPTIONS}
              />
            </label>
            <fieldset className="qz-signal-channels">
              <legend>{settings.operation === "correlation" ? "Signal columns (choose two)" : "Signal columns"}</legend>
              {available.map((channel) => (
                <Checkbox
                  key={channel}
                  checked={channels.includes(channel)}
                  onChange={(checked) => setChannels((current) => checked
                    ? [...current, channel].sort((a, b) => a - b)
                    : current.filter((item) => item !== channel))}
                >
                  {active.data.labels[channel]}{active.data.units[channel] ? ` (${active.data.units[channel]})` : ""}
                </Checkbox>
              ))}
              {available.length === 0 && <span className="qz-muted">No measured signal columns are available.</span>}
            </fieldset>
            {!spectral && (
              <div className="qz-signal-smooth">
                <Checkbox checked={settings.useRange} onChange={(checked) => setSettings((current) => ({ ...current, useRange: checked }))}>
                  Limit output to an X range
                </Checkbox>
                {settings.useRange && (
                  <>
                    <label>X minimum
                      <NumberField value={settings.xMin} onChange={(value) => setSettings((current) => ({ ...current, xMin: String(value) }))} />
                    </label>
                    <label>X maximum
                      <NumberField value={settings.xMax} onChange={(value) => setSettings((current) => ({ ...current, xMax: String(value) }))} />
                    </label>
                  </>
                )}
              </div>
            )}
            {settings.operation === "smooth" && (
              <div className="qz-signal-smooth">
                <label>Smoothing
                  <Select
                    value={settings.smoothMethod}
                    onChange={(event) => setSettings((current) => ({ ...current, smoothMethod: event.target.value as SignalSettings["smoothMethod"] }))}
                    options={[
                      { value: "moving", label: "Moving average" },
                      { value: "gaussian", label: "Gaussian" },
                      { value: "savitzky-golay", label: "Savitzky–Golay" },
                    ]}
                  />
                </label>
                <label>Half-window
                  <NumberField min={1} step={1} value={settings.smoothWindow} onChange={(value) => setSettings((current) => ({ ...current, smoothWindow: Number(value) }))} />
                </label>
                {settings.smoothMethod === "savitzky-golay" && (
                  <label>Polynomial order
                    <NumberField min={0} step={1} value={settings.smoothPolyOrder} onChange={(value) => setSettings((current) => ({ ...current, smoothPolyOrder: Number(value) }))} />
                  </label>
                )}
              </div>
            )}
            {settings.operation === "detrend" && (
              <div className="qz-signal-smooth">
                <label>Polynomial order (0 = mean, 1 = linear)
                  <NumberField min={0} max={5} step={1} value={settings.detrendOrder} onChange={(value) => setSettings((current) => ({ ...current, detrendOrder: Number(value) }))} />
                </label>
              </div>
            )}
            {settings.operation === "normalize-reference" && (
              <div className="qz-signal-smooth">
                <label>Reference
                  <Select
                    value={settings.referenceMode}
                    onChange={(event) => setSettings((current) => ({ ...current, referenceMode: event.target.value as SignalSettings["referenceMode"] }))}
                    options={[
                      { value: "value", label: "Divide by value" },
                      { value: "range", label: "Divide by mean in X range" },
                    ]}
                  />
                </label>
                {settings.referenceMode === "value" ? (
                  <label>Value
                    <NumberField value={settings.referenceValue} onChange={(value) => setSettings((current) => ({ ...current, referenceValue: String(value) }))} />
                  </label>
                ) : (
                  <>
                    <label>X minimum
                      <NumberField value={settings.referenceMin} onChange={(value) => setSettings((current) => ({ ...current, referenceMin: String(value) }))} />
                    </label>
                    <label>X maximum
                      <NumberField value={settings.referenceMax} onChange={(value) => setSettings((current) => ({ ...current, referenceMax: String(value) }))} />
                    </label>
                  </>
                )}
              </div>
            )}
            {spectralOperation && <SpectralControls operation={spectralOperation} settings={spectralSettings} setSettings={setSpectralSettings} xUnit={xUnitOf(active.data)} />}
            <SignalPreview source={active.data} result={displayedPreview} channel={channels[0] ?? available[0] ?? 0} resultChannel={spectral ? 0 : channels[0] ?? available[0] ?? 0} showOriginal={!spectral || settings.operation === "filter"} />
            {spectral && <SpectralReadout result={displayedPreview} />}
            <div className="qz-signal-note">
              Scope: {totalRows.toLocaleString()} total rows ({(totalRows - dropped).toLocaleString()} included, {dropped.toLocaleString()} excluded or filtered). Signal Processing uses the full worksheet, including those {dropped.toLocaleString()} rows. The output stays linked to <strong>{active.name}</strong> and can be recalculated.
            </div>
            {spectral && boundTargets.length > 0 && <div className="qz-signal-note">Bound uncertainties are not propagated into spectral outputs; the linked source and full recipe remain recorded.</div>}
            {(validation || previewError || outputError) && <p className="qz-error" role="alert">{validation || previewError || outputError}</p>}
            <div className="qz-dialog-actions">
              <Button onClick={close}>Cancel</Button>
              <Button disabled={Boolean(validation) || !recipe} onClick={() => void saveRecipe()}>Save recipe…</Button>
              <Button variant="primary" disabled={Boolean(validation || outputError) || !displayedPreview || busy} onClick={() => void commit()}>
                {busy ? "Creating…" : "Create linked worksheet"}
              </Button>
            </div>
          </>
        )}
      </div>
    </ToolWindow>
  );
}
