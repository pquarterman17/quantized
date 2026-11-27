import { useEffect, useMemo, useRef, useState } from "react";

import { applyCorrections } from "../../../lib/api";
import { runSpectralWorkbench } from "../../../lib/api/spectralWorkbench";
import { tokenOf } from "../../../lib/previewKey";
import { xUnitOf } from "../../../lib/transformResample";
import { buildSignalRecipeTemplate, saveSignalRecipeTemplate } from "../../../lib/signalRecipeTemplate";
import BatchApplyLauncher from "../pipeline/BatchApplyLauncher";
import { lazyRegion } from "../../../lib/lazyRegion";
import { SEED_TTL_MS, useSignalOperationSeed } from "../../../store/signalOperationSeed";
import { useApp } from "../../../store/useApp";
import { createSignalWorksheetFromApp } from "../../../store/signalWorksheetCommand";
import { toast } from "../../../store/toasts";
import ToolWindow from "../../overlays/ToolWindow";
import { askParams } from "../../overlays/ParamDialog";
import { Button, Select } from "../../primitives";
import { useWorkbenchCommit } from "../workbench/useWorkbenchCommit";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { WorkbenchActions, WorkbenchMessage, WorkbenchPreviewFrame } from "../workbench/WorkbenchParts";
import { NumberField } from "../../primitives/NumberField";
import SignalPreview from "./SignalPreview";
import SignalRangeFields, { xExtent } from "./SignalRangeFields";
import CorrelationInputs, { type CorrelationSourceMode } from "./CorrelationInputs";
import SignalChannelInputs from "./SignalChannelInputs";
import SignalOperationPicker, { useAppliedOperationSeed } from "./SignalOperationPicker";
import SigopBody from "./SigopBody";
import { isSigopFilter, type SigopFilterMethod } from "./sigopModel";
import { REFERENCE_MODE_OPTIONS, SMOOTH_METHOD_OPTIONS } from "./signalOptions";
import SpectrogramBody from "./SpectrogramBody";
import { useReopenScope } from "../resultcommit/useReopenSession";
import { SPECTROGRAM_REOPEN_TOOL } from "../../../lib/spectrogramReopenSeed";
import SpectralControls from "./SpectralControls";
import { nyquistOf } from "./iirSettings";
import SpectralReadout from "./SpectralReadout";
import SignalInputSummary from "./SignalInputSummary";
import SignalScopeAndBy from "./SignalScopeAndBy";
import SignalUncertaintyControls from "./SignalUncertaintyControls";
import {
  DEFAULT_SIGNAL_SETTINGS,
  boundErrorBlock,
  correlatedBoundErrors,
  buildCorrectionRecipe,
  channelsWithoutFiniteValues,
  enteredFinite,
  isSpectralOperation,
  measuredChannels,
  operationLabel,
  selectedBoundErrorTargets,
  settingsToParams,
  signalInputData,
  withInputRows,
  type SignalSettings,
} from "./signalProcessingModel";
import {
  DEFAULT_SPECTRAL_SETTINGS,
  buildSpectralRecipe,
  validateSpectralSettings,
} from "./spectralSettings";

// Named settings: the shared preset bar, lazy.
const SignalPresetBar = lazyRegion(() => import("./SignalPresetBar"), "Presets");

export default function SignalProcessingPanel() {
  const setSignalProcessingOpen = useApp((s) => s.setSignalProcessingOpen);
  const datasets = useApp((s) => s.datasets);
  const workbooks = useApp((s) => s.workbooks);
  const activeId = useApp((s) => s.activeId);
  const plotChannels = useApp((s) => s.yKeys);
  const setActive = useApp((s) => s.setActive);
  const setStatus = useApp((s) => s.setStatus);
  const active = datasets.find((dataset) => dataset.id === activeId) ?? null;
  const available = useMemo(() => active ? measuredChannels(active) : [], [active]);
  const [channels, setChannels] = useState<number[]>([]);
  const [settings, setSettings] = useState<SignalSettings>(DEFAULT_SIGNAL_SETTINGS);
  const [sigop, setSigop] = useState<SigopFilterMethod | null>(null); // median / despike / LOWESS / (de)convolution / Hilbert / inverse FFT
  const [spectrogram, setSpectrogram] = useState(false); // short-time FFT: its own body, committed as a map worksheet
  const [spectralSettings, setSpectralSettings] = useState(DEFAULT_SPECTRAL_SETTINGS);
  const [correlationMode, setCorrelationMode] = useState<CorrelationSourceMode>("same");
  const [secondaryId, setSecondaryId] = useState("");
  const [secondaryChannel, setSecondaryChannel] = useState<number | null>(null);
  // A deep-link operation waiting at mount is an explicit choice: it outranks last used.
  const [fromResult] = useState(() => { const seed = useSignalOperationSeed.getState(); return seed.op !== null && Date.now() - seed.at <= SEED_TTL_MS; });
  const committing = useWorkbenchCommit(); // in-flight guard; Cancel aborts a pending Create
  const busy = committing.busy;
  const close = () => {
    committing.abort();
    setSignalProcessingOpen(false);
  };
  const pick = (op: string) => {
    setSigop(isSigopFilter(op) ? op : null);
    setSpectrogram(op === "spectrogram");
    if (!isSigopFilter(op) && op !== "spectrogram") setSettings((c) => ({ ...c, operation: op as SignalSettings["operation"] }));
  };
  useAppliedOperationSeed(pick, busy);
  // "Open in Signal Processing" from a Spectrogram result: show the Spectrogram body, remounted per session so it seeds afresh.
  const spectrogramScope = useReopenScope(SPECTROGRAM_REOPEN_TOOL);
  useEffect(() => {
    if (spectrogramScope) pick("spectrogram");
  }, [spectrogramScope]);
  const spectralOperation = isSpectralOperation(settings.operation) ? settings.operation : null;
  const spectral = spectralOperation !== null;
  const crossWorksheet = settings.operation === "correlation" && correlationMode === "two";
  const secondary = crossWorksheet ? datasets.find((dataset) => dataset.id === secondaryId) ?? null : null;
  useEffect(() => {
    const plotted = (plotChannels ?? []).filter((channel) => available.includes(channel));
    setChannels(plotted.length ? plotted : available.slice(0, 1));
  }, [activeId, available, plotChannels]);

  useEffect(() => {
    setSecondaryId("");
    setSecondaryChannel(null);
    setSettings((current) => ({ ...current, dropUncertainty: false })); // a choice about THIS dataset's errors
  }, [activeId]);

  // Seed the X range from the extent on a new worksheet, or while the range is off; a ticked
  // range survives the data merely changing identity (e.g. a row-state edit).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const extent = xExtent(active?.data.time ?? []);
    if (!extent) return;
    const changed = seededFor.current !== activeId;
    seededFor.current = activeId;
    setSpectralSettings((current) => (changed || !current.useRange ? { ...current, ...extent } : current));
    setSettings((current) => (changed || !current.useRange ? { ...current, ...extent } : current));
  }, [activeId, active?.data.time]);

  const inputData = useMemo(() => active ? signalInputData(active, settings.useAllRows) : undefined, [active, settings.useAllRows]);
  const secondaryInput = useMemo(() => secondary ? signalInputData(secondary, settings.useAllRows) : undefined, [secondary, settings.useAllRows]);
  const params = useMemo(
    () => spectral ? null : settingsToParams(settings, channels),
    [settings, channels, spectral],
  );
  const recipe = useMemo(
    () => !active
      ? null
      : withInputRows(spectralOperation
        ? buildSpectralRecipe(
            spectralOperation,
            spectralSettings,
            channels,
            active,
            crossWorksheet && secondary && secondaryChannel !== null
              ? { dataset: secondary, channel: secondaryChannel }
              : undefined,
          )
        : buildCorrectionRecipe(settings, channels, active), settings.useAllRows),
    [active, channels, crossWorksheet, secondary, secondaryChannel, settings, spectralOperation, spectralSettings],
  );
  const nyquist = useMemo(() => nyquistOf((inputData ?? active?.data)?.time ?? []), [inputData, active]);
  const boundTargets = active ? selectedBoundErrorTargets(active, channels) : [];
  const secondaryBoundTargets = secondary && secondaryChannel !== null
    ? selectedBoundErrorTargets(secondary, [secondaryChannel])
    : [];
  const correctionOp = isSpectralOperation(settings.operation) ? null : settings.operation;
  const errorBlock = correctionOp && active ? boundErrorBlock(correctionOp, boundTargets.length, settings.dropUncertainty, correlatedBoundErrors(active, channels)) : "";
  const operationValidation = spectralOperation
    ? validateSpectralSettings(spectralOperation, spectralSettings, channels, crossWorksheet, nyquist)
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
      : errorBlock;
  const validation = !active
    ? "Select a dataset first."
    : active.pending
      ? "Wait for the full dataset to load."
      : inputData?.time.length === 0 ? "No rows remain after excluded and filtered-out rows are left out."
      : channels.length === 0
        ? "Select at least one signal column."
        : crossWorksheet && (!secondary || secondary.pending || secondaryChannel === null)
          ? "Choose a loaded second worksheet and signal column."
        : operationValidation;
  // Shared workbench shell: debounced, stale-rejecting, aborted on change/unmount.
  // `current` is only ever the preview of exactly these inputs (by identity).
  const preview = useWorkbenchPreview({
    key: sigop || spectrogram || !active || !inputData || validation || !recipe || (!spectral && !params) ? ""
      : JSON.stringify([active.id, tokenOf(active), tokenOf(inputData), secondaryInput ? tokenOf(secondaryInput) : null, tokenOf(recipe), params ? tokenOf(params) : null]),
    delayMs: 180,
    run: (signal) => spectral
      ? secondary
        ? runSpectralWorkbench(inputData!, recipe as ReturnType<typeof buildSpectralRecipe>, signal, true, secondaryInput!)
        : runSpectralWorkbench(inputData!, recipe as ReturnType<typeof buildSpectralRecipe>, signal, true)
      : applyCorrections({
          dataset: inputData!,
          params: params!,
          ...(active!.errorRoles ? { error_bindings: active!.errorRoles } : {}),
        }, signal),
  });
  const displayedPreview = preview.current;
  const previewError = preview.error;
  const emptyOutputs = displayedPreview
    ? spectral
      ? displayedPreview.labels.flatMap((_, channel) => displayedPreview.values.some((row) => Number.isFinite(row[channel])) ? [] : [channel])
      : channelsWithoutFiniteValues(displayedPreview, channels)
    : [];
  const outputError = displayedPreview && emptyOutputs.length
    ? `No finite output was produced for ${emptyOutputs.map((channel) => spectral ? displayedPreview.labels[channel] : active?.data.labels[channel]).join(", ")}.`
    : "";

  const commit = async () => {
    if (!active || !displayedPreview || validation || outputError) return;
    await committing.run(async (signal) => {
      const id = recipe ? await createSignalWorksheetFromApp(active.id, recipe, signal, true) : null;
      if (id) {
        void import("./presetAdapter").then((m) => m.recordSignalRun(settings, spectralSettings)).catch(() => undefined); // last used: a successful Create only
        setActive(id);
        close();
      }
    });
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

  // The REAL X column name ("Raman shift"), not the generic metadata fallback.
  return (
    <ToolWindow id="signal-processing" title="Signal processing" width={620} y={90} dockable onClose={close}>
      <div className="qz-signal-workbench">
        <p className="qz-signal-intro">Transform selected signals with a live preview. Apply creates a new worksheet linked to its source; the source is never overwritten.</p>
        {!active ? <p className="qz-error">Select a dataset to begin.</p> : sigop ? <SigopBody active={active} method={sigop} onPick={pick} onClose={close} /> : spectrogram ? <SpectrogramBody key={spectrogramScope} active={active} onPick={pick} onClose={close} /> : (
          <>
            <SignalPresetBar panel={{ settings, setSettings, spectral: spectralSettings, setSpectral: setSpectralSettings }} fromResult={fromResult} running={busy} />
            <SignalInputSummary channels={channels} useAllRows={settings.useAllRows} onUseAllRows={(useAllRows) => setSettings((c) => ({ ...c, useAllRows }))} />
            <SignalOperationPicker value={settings.operation} onChange={pick} />
            {settings.operation === "correlation" ? (
              <CorrelationInputs
                active={active}
                datasets={datasets}
                workbooks={workbooks}
                available={available}
                channels={channels}
                setChannels={setChannels}
                mode={correlationMode}
                setMode={(mode) => {
                  setCorrelationMode(mode);
                  setChannels((current) => mode === "two" ? current.slice(0, 1) : current);
                }}
                secondaryId={secondaryId}
                setSecondaryId={setSecondaryId}
                secondaryChannel={secondaryChannel}
                setSecondaryChannel={setSecondaryChannel}
              />
            ) : <SignalChannelInputs dataset={active} available={available} channels={channels} setChannels={setChannels} />}
            {!spectral && <SignalRangeFields value={settings} onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))} />}
            {settings.operation === "smooth" && (
              <div className="qz-signal-smooth">
                <label>Smoothing
                  <Select
                    value={settings.smoothMethod}
                    onChange={(event) => setSettings((current) => ({ ...current, smoothMethod: event.target.value as SignalSettings["smoothMethod"] }))}
                    options={SMOOTH_METHOD_OPTIONS}
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
                    options={REFERENCE_MODE_OPTIONS}
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
            {spectralOperation && <SpectralControls operation={spectralOperation} settings={spectralSettings} setSettings={setSpectralSettings} xUnit={xUnitOf(active.data)} nyquist={nyquist} />}
            <WorkbenchPreviewFrame loading={preview.loading}>
              <SignalPreview source={inputData ?? active.data} result={displayedPreview} channel={channels[0] ?? available[0] ?? 0} resultChannel={spectral ? 0 : channels[0] ?? available[0] ?? 0} showOriginal={!spectral || settings.operation === "filter"} />
              {spectral && <SpectralReadout result={displayedPreview} />}
            </WorkbenchPreviewFrame>
            {correctionOp && <SignalUncertaintyControls operation={correctionOp} boundLabels={boundTargets.map((c) => active.data.labels[c])} blocked={Boolean(errorBlock)} drop={settings.dropUncertainty} setDrop={(dropUncertainty) => setSettings((current) => ({ ...current, dropUncertainty }))} />}
            <SignalScopeAndBy source={active} secondary={secondary} settings={settings} spectral={spectralSettings} channels={channels} sigopFilter={sigop !== null} crossWorksheet={crossWorksheet} validation={validation} />
            {spectral && (boundTargets.length > 0 || secondaryBoundTargets.length > 0) && <div className="qz-signal-note">Bound uncertainties are not propagated into spectral outputs; the linked source and full recipe remain recorded.</div>}
            <WorkbenchMessage refusal={validation || outputError} error={previewError} />
            {/* Worksheet audit #15: the same setup on each selected Library sheet. */}
            <BatchApplyLauncher groupName={operationLabel(settings.operation)} setup={recipe} build={() => buildSignalRecipeTemplate(`${operationLabel(settings.operation)} (Signal Processing)`, active, recipe!)} disabledReason={crossWorksheet ? "A cross-worksheet correlation is tied to its two worksheets." : validation || (recipe ? "" : "Set up the operation first.")} />
            {/* A disabled control always says why (worksheet audit #9). */}
            <WorkbenchActions onCancel={close} commitLabel="Create new worksheet" busyLabel="Creating…" busy={busy} disabledReason={validation || outputError || previewError || (!displayedPreview ? "Waiting for the live preview…" : null)} onCommit={() => void commit()}>
              <Button disabled={Boolean(validation) || !recipe || crossWorksheet} title={crossWorksheet ? "Cross-worksheet recipes retain project-specific source links and cannot yet be saved as reusable templates." : validation || undefined} onClick={() => void saveRecipe()}>Save recipe…</Button>
            </WorkbenchActions>
          </>
        )}
      </div>
    </ToolWindow>
  );
}
