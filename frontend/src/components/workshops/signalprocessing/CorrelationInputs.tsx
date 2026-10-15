import { useMemo } from "react";

import type { Dataset } from "../../../lib/types";
import { Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { measuredChannels } from "./signalProcessingModel";

export type CorrelationSourceMode = "same" | "two";

interface Props {
  active: Dataset;
  datasets: Dataset[];
  workbooks: { id: string; name: string }[];
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
  const datasetLabel = (dataset: Dataset): string => {
    const workbook = props.workbooks.find((item) => item.id === dataset.workbookId);
    return workbook ? `${workbook.name} › ${dataset.name}` : dataset.name;
  };
  return (
    <fieldset className={`qz-signal-channels${props.mode === "two" ? " qz-correlation-inputs" : ""}`}>
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
            <Select
              value={String(props.channels[0] ?? "")}
              onChange={(event) => props.setChannels([Number(event.target.value)])}
              options={props.available.map((channel) => ({ value: String(channel), label: channelText(props.active, channel) }))}
            />
          </label>
          <label>Second worksheet
            <Select
              value={props.secondaryId}
              onChange={(event) => {
                const id = event.target.value;
                const dataset = candidates.find((item) => item.id === id);
                props.setSecondaryId(id);
                props.setSecondaryChannel(dataset ? measuredChannels(dataset)[0] ?? null : null);
              }}
              options={[
                { value: "", label: "Choose a worksheet" },
                ...candidates.map((dataset) => ({ value: dataset.id, label: datasetLabel(dataset) })),
              ]}
            />
          </label>
          <label>Second signal
            <Select
              value={String(props.secondaryChannel ?? "")}
              disabled={!secondary}
              onChange={(event) => props.setSecondaryChannel(Number(event.target.value))}
              options={secondary
                ? secondaryChannels.map((channel) => ({ value: String(channel), label: channelText(secondary, channel) }))
                : [{ value: "", label: "Choose a signal" }]}
            />
          </label>
        </div>
      )}
      {props.mode === "two" && candidates.length === 0 && (
        <span className="qz-muted">Load another worksheet with a measured signal to correlate across worksheets.</span>
      )}
    </fieldset>
  );
}
