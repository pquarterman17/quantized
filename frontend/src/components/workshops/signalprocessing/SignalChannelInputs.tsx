import type { Dataset } from "../../../lib/types";
import { Checkbox } from "../../primitives/Checkbox";

export default function SignalChannelInputs({ dataset, available, channels, setChannels }: {
  dataset: Dataset;
  available: number[];
  channels: number[];
  setChannels: (channels: number[]) => void;
}) {
  return (
    <fieldset className="qz-signal-channels">
      <legend>Signal columns</legend>
      {available.map((channel) => (
        <Checkbox
          key={channel}
          checked={channels.includes(channel)}
          onChange={(checked) => setChannels(checked
            ? [...channels, channel].sort((a, b) => a - b)
            : channels.filter((item) => item !== channel))}
        >
          {dataset.data.labels[channel]}{dataset.data.units[channel] ? ` (${dataset.data.units[channel]})` : ""}
        </Checkbox>
      ))}
      {available.length === 0 && <span className="qz-muted">No measured signal columns are available.</span>}
    </fieldset>
  );
}
