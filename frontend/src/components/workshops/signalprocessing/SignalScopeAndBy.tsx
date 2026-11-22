// The scope note, the worksheet batch and the "By" block under the Signal
// Processing preview. One component so the panel (at its line ceiling) mounts a
// single element.

import { useCallback } from "react";

import type { Dataset } from "../../../lib/types";
import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePlottedPair } from "../byrun/usePlottedPair";
import SignalBatchSection from "./SignalBatchSection";
import SignalScopeNote from "./SignalScopeNote";
import type { SignalSettings } from "./signalProcessingModel";
import { runSignalOn, SIGNAL_SUMMARY_HEADERS, signalSummary } from "./signalRun";
import type { SpectralUiSettings } from "./spectralSettings";

interface Props {
  source: Dataset;
  secondary: Dataset | null;
  settings: SignalSettings;
  spectral: SpectralUiSettings;
  /** The panel's selected signal columns on `source`. */
  channels: number[];
  /** True for the median / despike / LOWESS / (de)convolution / Hilbert filters. */
  sigopFilter: boolean;
  crossWorksheet: boolean;
  /** The panel's own validation message for the current setup ("" when valid). */
  validation: string;
}

export default function SignalScopeAndBy({ source, secondary, settings, spectral, channels, sigopFilter, crossWorksheet, validation }: Props) {
  const { active, data, columns, xKey, yKey } = usePlottedPair();
  const blockedReason = sigopFilter
    ? "By and batch are not available for this filter yet."
    : crossWorksheet ? "A cross-worksheet correlation is tied to its two worksheets." : validation || null;
  const run = useCallback(async (level: ByLevel, signal: AbortSignal): Promise<ByCell[]> =>
    signalSummary(await runSignalOn(settings, spectral, channels, source, level.data, signal)),
  [settings, spectral, channels, source]);
  // The By levels are cut from the analysis view (exclusions and filters left
  // out), like the worksheet batch: the single run's "Use excluded/filtered
  // rows" choice neither applies to them nor is recorded as if it did.
  const { useAllRows: _singleRunRows, ...bySettings } = settings;
  return (
    <>
      <SignalScopeNote source={source} secondary={secondary} useAllRows={settings.useAllRows} />
      <SignalBatchSection settings={settings} spectral={spectral} blockedReason={blockedReason} />
      <ByLevelRunSection
        tool="Signal processing"
        active={active}
        data={data}
        columns={columns}
        headers={SIGNAL_SUMMARY_HEADERS}
        run={run}
        runKey={JSON.stringify([bySettings, spectral, channels])}
        blockedReason={blockedReason}
        save={{ toolId: "signal-processing", parameters: { settings: bySettings, spectral: { ...spectral }, channels }, xKey, yKeys: yKey == null ? [] : [yKey] }}
      />
    </>
  );
}
