// The standalone converter: what `/convert` mounts (`qz convert --gui`, the
// right-click entry). Only the converter: no workspace, no Library, no plots,
// and none of the app's lazy chunks. The theme comes from the shared store's
// startup sync (importing it is what applies the data-* attributes).

import { useEffect } from "react";

import "../../../store/useApp";
import QuickConvertView from "./QuickConvertView";

export default function QuickConvertPage() {
  useEffect(() => {
    document.title = "Quick Convert";
  }, []);
  return (
    <main className="qzk-qc-page">
      <h1>Quick Convert</h1>
      <p className="qzk-qc-dim">Convert data files to CSV, Excel, HDF5 and more, without opening the full app.</p>
      <QuickConvertView prefill />
    </main>
  );
}
