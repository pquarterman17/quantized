// Preferences ▸ Data & files: how imported data opens and what is asked before
// it is removed. Split out of the Interaction tab (UX10-D); lazy with the rest
// of the Preferences dialog.

import { workflowPrefsSlot } from "../../lib/workflowPrefs";
import { setWorkflowPrefs } from "../../lib/workflowPrefsEdit";
import { useApp } from "../../store/useApp";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { Switch } from "../primitives/Switch";
import { OpjMatrixPref } from "./OpjMatrixPref";
import PrefRow from "./PrefRow";
import { UploadCachePref } from "./UploadCachePref";

export default function PrefsFilesPane() {
  const p = useApp((s) => s);
  const setPref = useApp((s) => s.setPref);
  const { rememberImportSettings, importMemory } = workflowPrefsSlot.use();
  return (
    <>
      <PrefRow
        label="Origin book click opens"
        hint="clicking an imported Origin workbook in the Library"
      >
        <SegmentedControl
          options={["Worksheet", "Plot"]}
          value={p.originBookClickOpens === "plot" ? "Plot" : "Worksheet"}
          onChange={(v) =>
            setPref("originBookClickOpens", v === "Plot" ? "plot" : "worksheet")
          }
        />
      </PrefRow>
      <UploadCachePref />
      <OpjMatrixPref />
      <PrefRow label="Confirm before removing data">
        <Switch
          aria-label="Confirm removal"
          checked={p.confirmRemove}
          onChange={(v) => setPref("confirmRemove", v)}
        />
      </PrefRow>
      <PrefRow
        label="Remember import wizard settings"
        hint="start the next wizard import with the last delimiter and header / units lines (encoding is always UTF-8)"
      >
        <Switch
          aria-label="Remember import settings"
          checked={rememberImportSettings}
          onChange={(v) => setWorkflowPrefs({ rememberImportSettings: v, ...(v ? {} : { importMemory: null }) })}
        />
        {rememberImportSettings && importMemory && (
          <span className="hint">last: delimiter {importMemory.delimiter || "auto"}</span>
        )}
      </PrefRow>
    </>
  );
}
