import { useEffect, useMemo, useRef, useState } from "react";

import { applyCorrections } from "../../../lib/api";
import { runSpectralWorkbench } from "../../../lib/api/spectralWorkbench";
import { xUnitOf } from "../../../lib/transformResample";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { createSpectralWorksheetFromApp } from "../../../store/spectralWorksheetCommand";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { NumberField } from "../../primitives/NumberField";
import SignalPreview from "./SignalPreview";
import SpectralControls from "./SpectralControls";
import SpectralReadout from "./SpectralReadout";
import {
  DEFAULT_SIGNAL_SETTINGS,
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
  { value: "derivative-first", label: "Derivative · dY/dX" },
  { value: "derivative-second", label: "Derivative · d²Y/dX²" },
  { value: "integral", label: "Integral · cumulative ∫Y dx" },
  { value: "log-derivative", label: "Derivative · dlog(Y)/dlog(X)" },
  { value: "fft", label: "Spectrum · FFT / PSD / phase" },
  { value: "filter", label: "Filter · frequency domain" },
  { value: "correlation", label: "Cross-correlation" },
];

export default function SignalProcessingPanel() {
  const setSignalProcessingOpen = useApp((s) => s.setSignalProcessingOpen);
  const close = () => setSignalProcessingOpen(false);
  const datasets = useApp((s) => s.datasets);
  const activeId = useApp((s) => s.activeId);
  const plotChannels = useApp((s) => s.yKeys);
  const createDerived = useApp((s) => s.createDerivedWorksheet);
  const setActive = useApp((s) => s.setActive);
  const active = datasets.find((dataset) => dataset.id === activeId) ?? null;
  const available = useMemo(() => active ? measuredChannels(active) : [], [active]);
  const [channels, setChannels] = useState<number[]>([]);
  const [settings, setSettings] = useState<SignalSettings>(DEFAULT_SIGNAL_SETTINGS);
  const [spectralSettings, setSpectralSettings] = useState(DEFAULT_SPECTRAL_SETTINGS);
  const [preview, setPreview] = useState<DataStruct | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const previewSequence = useRef(0);
  const commitInFlight = useRef(false);
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
  }, [activeId, active?.data.time]);

  const params = useMemo(
    () => spectral ? null : settingsToParams(settings, channels),
    [settings, channels, spectral],
  );
  const recipe = useMemo(
    () => active && spectralOperation
      ? buildSpectralRecipe(spectralOperation, spectralSettings, channels, active)
      : null,
    [active, channels, spectralOperation, spectralSettings],
  );
  const boundTargets = active ? selectedBoundErrorTargets(active, channels) : [];
  const emptyOutputs = preview
    ? spectral
      ? preview.labels.flatMap((_, channel) => preview.values.some((row) => Number.isFinite(row[channel])) ? [] : [channel])
      : channelsWithoutFiniteValues(preview, channels)
    : [];
  const outputError = preview && emptyOutputs.length
    ? `No finite output was produced for ${emptyOutputs.map((channel) => spectral ? preview.labels[channel] : active?.data.labels[channel]).join(", ")}.`
    : "";
  const nonlinearWithErrors = !spectral && (
    settings.operation === "smooth" ||
    settings.operation.startsWith("derivative") ||
    settings.operation === "integral"
  );
  const operationValidation = spectralOperation
    ? validateSpectralSettings(spectralOperation, spectralSettings, channels)
    : settings.operation === "smooth" && (!Number.isInteger(settings.smoothWindow) || settings.smoothWindow < 1)
      ? "Smoothing half-window must be a positive integer."
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
    setPreviewError("");
    if (!active || validation || (!params && !recipe)) return;
    const timer = window.setTimeout(() => {
      const request = recipe
        ? runSpectralWorkbench(active.data, recipe, controller.signal, true)
        : applyCorrections({
            dataset: active.data,
            params: params!,
            ...(active.errorRoles ? { error_bindings: active.errorRoles } : {}),
          });
      void request.then((result) => {
        if (!cancelled && previewSequence.current === sequence) setPreview(result);
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
  }, [active, params, recipe, validation]);

  const commit = async () => {
    if (!active || validation || outputError || commitInFlight.current) return;
    commitInFlight.current = true;
    setBusy(true);
    const label = `${operationLabel(settings.operation)} · ${channels.map((channel) => active.data.labels[channel]).join(", ")}`;
    try {
      const id = recipe
        ? await createSpectralWorksheetFromApp(active.id, recipe, label)
        : await createDerived(active.id, params!, label);
      if (id) {
        setActive(id);
        close();
      }
    } finally {
      commitInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <ToolWindow id="signal-processing" title="Signal Processing" width={620} x={180} y={90} onClose={close}>
      <div className="qz-signal-workbench">
        <p className="qz-signal-intro">Transform selected signals with a live preview. Apply creates a linked worksheet; the source is never overwritten.</p>
        {!active ? <p className="qz-error">Select a dataset to begin.</p> : (
          <>
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
              </div>
            )}
            {spectralOperation && <SpectralControls operation={spectralOperation} settings={spectralSettings} setSettings={setSpectralSettings} xUnit={xUnitOf(active.data)} />}
            <SignalPreview source={active.data} result={preview} channel={channels[0] ?? available[0] ?? 0} resultChannel={spectral ? 0 : channels[0] ?? available[0] ?? 0} showOriginal={!spectral || settings.operation === "filter"} />
            {spectral && <SpectralReadout result={preview} />}
            <div className="qz-signal-note">Scope: selected X range over the full worksheet, including excluded rows. The output stays linked to <strong>{active.name}</strong> and can be recalculated.</div>
            {spectral && boundTargets.length > 0 && <div className="qz-signal-note">Bound uncertainties are not propagated into spectral outputs; the linked source and full recipe remain recorded.</div>}
            {(validation || previewError || outputError) && <p className="qz-error" role="alert">{validation || previewError || outputError}</p>}
            <div className="qz-dialog-actions">
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" disabled={Boolean(validation || outputError) || !preview || busy} onClick={() => void commit()}>
                {busy ? "Creating…" : "Create linked worksheet"}
              </Button>
            </div>
          </>
        )}
      </div>
    </ToolWindow>
  );
}
