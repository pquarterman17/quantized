// Lazy host for the Export animation window, mounted by AppOverlays while
// store/animationExportOpen.ts holds a seed (File > Export > Export animation…
// and the Recipe library button both open it).

import { closeAnimationExport, useAnimationExport } from "../../../store/animationExportOpen";
import AnimationExportDialog from "./AnimationExportDialog";

export default function AnimationExportHost() {
  const seeds = useAnimationExport((s) => s.seeds);
  return seeds ? <AnimationExportDialog seedDatasetIds={seeds} onClose={closeAnimationExport} /> : null;
}
