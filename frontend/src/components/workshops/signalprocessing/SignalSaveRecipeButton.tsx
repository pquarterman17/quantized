// "Save recipe…" for the filter operations and the spectrogram: the current setup
// (X range included) as a one-step recipe in the shared Recipe Library, the same
// control and prompt the recipe operations use (SignalProcessingPanel).

import { buildTransformRecipeTemplate, saveRecipeTemplate } from "../../../lib/signalRecipeTemplate";
import type { SigopParams } from "../../../lib/transformSigop";
import type { SpectrogramParams } from "../../../lib/transformSpectrogram";
import type { Dataset } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";
import { Button } from "../../primitives";

export default function SignalSaveRecipeButton({ dataset, params, defaultName, disabledReason }: {
  dataset: Dataset;
  /** The validated setup, or null while the form has a problem. */
  params: SigopParams | SpectrogramParams | null;
  defaultName: string;
  /** Why the button is off ("" = it can be used). */
  disabledReason: string;
}) {
  const setStatus = useApp((s) => s.setStatus);
  const save = async () => {
    if (!params || disabledReason) return;
    const picked = await askParams("Save Signal Processing recipe", [
      { key: "name", label: "Recipe name", type: "text", default: defaultName },
    ], {
      message: "The recipe will appear in the Recipe Library and can be applied to compatible worksheets without changing their raw data.",
      confirmLabel: "Save recipe",
    });
    if (!picked) return;
    try {
      const saved = saveRecipeTemplate(String(picked.name ?? ""), (name, revision) => buildTransformRecipeTemplate(name, dataset, params, revision));
      const message = `saved recipe “${saved.name}” (revision ${saved.revision})`;
      setStatus(message);
      toast(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "couldn't save recipe";
      setStatus(message);
      toast(message, "danger");
    }
  };
  return (
    <Button disabled={Boolean(disabledReason) || !params} title={disabledReason || undefined} onClick={() => void save()}>Save recipe…</Button>
  );
}
