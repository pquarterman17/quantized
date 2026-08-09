// Saved ROIs card — name the current working box/ruler and reuse it later or
// on another dataset (RSM_CUTS_PLAN item 8; the store's `saveRoi`/
// `applySavedRoi`/`removeSavedRoi` — store/rois.ts, item 4 — already carry
// the CRUD + undo wiring, this card is presentation only). A sector
// definition has no "current working" slot of its own (it lives entirely in
// this workshop's local fields), so only a drawn/typed box or ruler can be
// saved here — matches store/rois.ts's own `saveRoi` contract.

import { useState } from "react";
import { Button, NumberField } from "../../primitives";
import Card from "../../primitives/Card";
import type { RoiCutsState } from "./useRoiCuts";

function kindLabel(kind: "rect" | "ruler" | "sector"): string {
  return kind === "rect" ? "box" : kind === "ruler" ? "ruler" : "sector";
}

export default function SavedRoisCard({ roi }: { roi: RoiCutsState }) {
  const [name, setName] = useState("");

  return (
    <Card title="Saved ROIs" count={roi.savedRois.length || undefined} defaultOpen={false}>
      <div style={{ display: "flex", gap: 8 }}>
        <NumberField
          numeric={false}
          width={140}
          value={name}
          onChange={setName}
          placeholder="name"
        />
        <Button
          size="sm"
          disabled={!roi.canSaveCurrent}
          title={roi.canSaveCurrent ? undefined : "Draw or type a box/ruler first"}
          onClick={() => {
            if (roi.saveCurrentRoi(name)) setName("");
          }}
        >
          Save
        </Button>
      </div>

      {roi.savedRois.length === 0 ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8 }}>
          No saved ROIs yet.
        </div>
      ) : (
        <table style={{ width: "100%", marginTop: 10, fontSize: 11 }}>
          <tbody>
            {roi.savedRois.map((def) => (
              <tr key={def.id}>
                <td style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {def.name}
                </td>
                <td className="qzk-ds-meta" style={{ textAlign: "right", paddingRight: 6 }}>
                  {kindLabel(def.kind)}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <Button size="sm" onClick={() => roi.applySaved(def.id)}>
                    Apply
                  </Button>{" "}
                  <Button size="sm" variant="danger" onClick={() => roi.removeSaved(def.id)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
