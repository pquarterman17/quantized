// Plot > Publication preview… with a map in front. The preview edits a plot, so it does not run the map's export
// on its own (owner, 2026-11-28): it says so and offers the map's Export map as a button. A plot in front, or a
// worksheet focused beside its plot, is not handled here and previews as before (lib/figureTarget decides).

import { toast } from "../store/toasts";
import type { StoreGet } from "./exportActive";
import { MAP_NOT_READY, resolveFigureTarget } from "./figureTarget";
import { mapExporterFor, STAGE_MAP_KEY } from "./mapExportBridge";

export const PREVIEW_IS_FOR_PLOTS = "Publication preview is for plots. To save this map as a figure, use Export map.";
export const EXPORT_MAP_LABEL = "Export map…";

/** True when the front figure is a map: the message and its Export map button are shown and the caller stops. */
export function offerMapExport(s: StoreGet): boolean {
  const target = resolveFigureTarget(s());
  if (target.kind !== "map") return false;
  s().setStatus(PREVIEW_IS_FOR_PLOTS, "warn");
  toast(PREVIEW_IS_FOR_PLOTS, "info", {
    action: {
      label: EXPORT_MAP_LABEL,
      onClick: () => {
        const run = mapExporterFor(target.windowId ?? STAGE_MAP_KEY); // looked up now: the map may have closed since
        if (run) run();
        else toast(MAP_NOT_READY, "info");
      },
    },
  });
  return true;
}
