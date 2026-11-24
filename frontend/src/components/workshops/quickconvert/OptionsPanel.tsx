// Quick Convert: the three choices. Output folder (default: next to each input),
// output format (default: guessed per file), and overwrite (default: off, so a
// file that already exists is skipped and said so).

import { useId } from "react";

import type { FormatInfo, OutDirStatus } from "../../../lib/api/convertQuick";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";

interface Props {
  formats: FormatInfo[];
  outDir: string;
  onOutDir: (v: string) => void;
  outStatus: OutDirStatus;
  needsFolder: boolean;
  format: string;
  onFormat: (v: string) => void;
  overwrite: boolean;
  onOverwrite: (v: boolean) => void;
  metadata: boolean;
  onMetadata: (v: boolean) => void;
  report: boolean;
  onReport: (v: boolean) => void;
  onBrowse: () => void;
  disabled: boolean;
}

export default function OptionsPanel(p: Props) {
  const folderId = useId();
  const folderHint = useId();
  const fmtId = useId();
  const fmt = p.formats.find((f) => f.id === p.format);
  const custom = p.outDir.trim() !== "";
  const hint =
    p.needsFolder
      ? "Dropped or uploaded files have no folder of their own: choose where the results go."
      : !custom
        ? "Each result is written next to its input file."
        : p.outStatus === "will_be_created"
          ? "This folder does not exist yet; it will be created."
          : p.outStatus === "not_a_folder"
            ? "That path is a file, not a folder."
            : "";
  const bad = p.needsFolder || (custom && p.outStatus === "not_a_folder");
  return (
    <div className="qzk-qc-options">
      <label className="qzk-qc-field" htmlFor={folderId}>
        Output folder
      </label>
      <div className="qzk-qc-folder">
        <input
          id={folderId}
          className="qz-input"
          type="text"
          value={p.outDir}
          placeholder="Same folder as each input file"
          aria-describedby={folderHint}
          aria-invalid={bad || undefined}
          disabled={p.disabled}
          spellCheck={false}
          onChange={(e) => p.onOutDir(e.target.value)}
        />
        <Button size="sm" onClick={p.onBrowse} disabled={p.disabled}>
          Browse…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => p.onOutDir("")} disabled={p.disabled || !custom} title="Write next to each input file again">
          Same folder
        </Button>
      </div>
      <p id={folderHint} className={bad ? "qzk-qc-note qzk-qc-danger" : "qzk-qc-note"} role={bad ? "alert" : undefined}>
        {hint}
      </p>

      <label className="qzk-qc-field" htmlFor={fmtId}>
        Output format
      </label>
      <Select
        id={fmtId}
        value={p.format}
        disabled={p.disabled}
        onChange={(e) => p.onFormat(e.target.value)}
        options={[{ value: "auto", label: "Auto (guessed)" }, ...p.formats.map((f) => ({ value: f.id, label: f.label }))]}
      />
      <p className="qzk-qc-note">
        {fmt
          ? fmt.container
            ? "One file holding every dataset (a sheet or group each)."
            : "One file per dataset; a 2-D map becomes a long table (X, Y, value)."
          : "Chosen per file from what it is (an XRD scan → .xy, a 2-D map → HDF5, anything else → CSV)."}
      </p>

      <Checkbox checked={p.overwrite} onChange={p.onOverwrite} disabled={p.disabled}>
        Replace existing files
      </Checkbox>
      <p className="qzk-qc-note">Off: a result whose file already exists is skipped and listed. An input file is never overwritten.</p>
      <Checkbox checked={p.metadata} onChange={p.onMetadata} disabled={p.disabled}>
        Include metadata (header lines in CSV / .xy, a sheet in Excel)
      </Checkbox>
      <Checkbox checked={p.report} onChange={p.onReport} disabled={p.disabled}>
        Save a run report (JSON, timestamped) next to the results
      </Checkbox>
    </div>
  );
}
