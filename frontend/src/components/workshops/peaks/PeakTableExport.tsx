// Peaks window — Export CSV / Copy for the peak list the window is showing
// (UX9-F: was 6 steps via the Library's "Peak analysis" row; now one click).
// The table itself is built by ./peakWindowExport.

import { copyText } from "../../../lib/clipboard";
import { csvBlob } from "../../../lib/csvCell";
import { saveBlob } from "../../../lib/download";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { peakWindowCsv, peakWindowTable, peakWindowTsv, type DContext, type ExportPeak } from "./peakWindowExport";

interface Props {
  peaks: readonly ExportPeak[];
  kind: "fitted" | "detected";
  d: DContext | null;
  datasetName: string;
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "peaks";

export default function PeakTableExport({ peaks, kind, d, datasetName }: Props) {
  const setStatus = useApp((s) => s.setStatus);
  const n = peaks.length;
  const what = `${n} ${kind} peak${n === 1 ? "" : "s"}`;
  const exportCsv = () => {
    saveBlob(csvBlob(peakWindowCsv(peakWindowTable(peaks, kind, d))), `${stem(datasetName)}_${kind}_peaks.csv`);
    setStatus(`exported ${what}`);
  };
  const copy = async () => {
    const ok = await copyText(peakWindowTsv(peakWindowTable(peaks, kind, d)));
    if (ok) setStatus(`copied ${what}`);
    else toast("could not copy — the clipboard is not available here", "danger");
  };
  return (
    <>
      <Button size="sm" disabled={n === 0} title={`Save the ${kind} peak table as CSV`} onClick={exportCsv}>
        Export CSV
      </Button>
      <Button size="sm" disabled={n === 0} title={`Copy the ${kind} peak table (tab-separated)`} onClick={() => void copy()}>
        Copy
      </Button>
    </>
  );
}
