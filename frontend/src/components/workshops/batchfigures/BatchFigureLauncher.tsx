import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";

import { batchSeedDatasetIds } from "../../../store/batchFigureBuild";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";

// Gap audit 9 G20: the animation dialog and all its logic load on first click.
const AnimationExportDialog = lazy(() => import("../animation/AnimationExportDialog"));

function seedIds(): string[] {
  const state = useApp.getState();
  return batchSeedDatasetIds({
    datasets: state.datasets,
    folders: state.folders,
    workbooks: state.workbooks,
    selectedIds: state.selectedIds,
    activeId: state.activeId,
    librarySelection: state.librarySelection,
  });
}

/** Small Plot Recipe Manager entry point. Keeping selection expansion here
 * leaves the already-large manager view below its component ceiling. */
export default function BatchFigureLauncher({ onOpen }: { onOpen: (ids: string[]) => void }) {
  const [animation, setAnimation] = useState<string[] | null>(null);
  return (
    <>
      <Button size="sm" onClick={() => onOpen(seedIds())}>
        Batch figures…
      </Button>
      <Button size="sm" onClick={() => setAnimation(seedIds())}>
        Export animation…
      </Button>
      {animation &&
        // Portaled to the app root: inside the Recipe Library window the
        // dialog's `max-height: 100%` resolved against that window and clipped
        // it to ~120 px (ux-new audit).
        createPortal(
          <Suspense fallback={null}>
            <AnimationExportDialog seedDatasetIds={animation} onClose={() => setAnimation(null)} />
          </Suspense>,
          document.querySelector(".qzk-app") ?? document.body,
        )}
    </>
  );
}
