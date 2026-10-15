import { useMemo } from "react";

import type { Dataset } from "../../../lib/types";
import { Checkbox } from "../../primitives/Checkbox";
import { measuredChannels } from "./signalProcessingModel";

export type CorrelationSourceMode = "same" | "two";

interface Props {
  active: Dataset;
  datasets: Dataset[];
  available: number[];
  channels: number[];
  setChannels: (channels: number[]) => void;
  mode: CorrelationSourceMode;
  setMode: (mode: CorrelationSourceMode) => void;
  secondaryId: string;
  setSecondaryId: (id: string) => void;
  secondaryChannel: number | null;
  setSecondaryChannel: (channel: number | null) => void;
}

const channelText = (dataset: Dataset, channel: number): string =>
  `${dataset.data.labels[channel]}${dataset.data.units[channel] ? ` (${dataset.data.units[channel]})` : ""}`;

export default function CorrelationInputs(props: Props) {
  const candidates = useMemo(
    () => props.datasets.filter((dataset) => dataset.id !== props.active.id && !dataset.pending && measuredChannels(dataset).length > 0),
    [props.active.id, props.datasets],
  );
  const secondary = candidates.find((dataset) => dataset.id === props.secondaryId) ?? null;
  const secondaryChannels = secondary ? measuredChannels(secondary) : [];
  return (
    <fieldset className="qz-signal-channels">
      <legend>Correlation inputs</legend>
      <label>
        <input type="radio" name="correlation-source-mode" checked={props.mode === "same"} onChange={() => props.setMode("same")} />
        Two columns in {props.active.name}
      </label>
      <label>
        <input type="radio" name="correlation-source-mode" checked={props.mode === "two"} onChange={() => props.setMode("two")} />
        One column from each of two worksheets
      </label>
      {props.mode === "same" ? props.available.map((channel) => (
        <Checkbox
          key={channel}
          checked={props.channels.includes(channel)}
          onChange={(checked) => props.setChannels(checked
            ? [...props.channels, channel].sort((a, b) => a - b)
            : props.channels.filter((item) => item !== channel))}
        >
          {channelText(props.active, channel)}
        </Checkbox>
      )) : (
        <div className="qz-signal-smooth">
          <label>First signal · {props.active.name}
            <select value={props.channels[0] ?? ""} onChange={(event) => props.setChannels([Number(event.target.value)])}>
              <option value="" disabled>Choose a signal</option>
              {props.available.map((channel) => <option key={channel} value={channel}>{channelText(props.active, channel)}</option>)}
            </select>
          </label>
          <label>Second worksheet
            <select value={props.secondaryId} onChange={(event) => {
              const id = event.target.value;
              const dataset = candidates.find((item) => item.id === id);
              props.setSecondaryId(id);
              props.setSecondaryChannel(dataset ? measuredChannels(dataset)[0] ?? null : null);
            }}>
              <option value="">Choose a worksheet</option>
              {candidates.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
            </select>
          </label>
          <label>Second signal
            <select
              value={props.secondaryChannel ?? ""}
              disabled={!secondary}
              onChange={(event) => props.setSecondaryChannel(Number(event.target.value))}
            >
              <option value="" disabled>Choose a signal</option>
              {secondaryChannels.map((channel) => <option key={channel} value={channel}>{channelText(secondary!, channel)}</option>)}
            </select>
          </label>
        </div>
      )}
      {props.mode === "two" && candidates.length === 0 && (
        <span className="qz-muted">Load another worksheet with a measured signal to correlate across worksheets.</span>
      )}
    </fieldset>
  );
}
