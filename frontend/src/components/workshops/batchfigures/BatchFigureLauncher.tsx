import { batchSeedDatasetIds } from "../../../store/batchFigureBuild";
import { openAnimationExport } from "../../../store/animationExportOpen";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";

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
 * leaves the already-large manager view below its component ceiling. "Export
 * animation" opens the app-level window (store/animationExportOpen.ts), the
 * same one File > Export opens, outside this window's box (ux-new audit P1-1). */
export default function BatchFigureLauncher({ onOpen }: { onOpen: (ids: string[]) => void }) {
  return (
    <>
      <Button size="sm" onClick={() => onOpen(seedIds())}>
        Batch figures…
      </Button>
      <Button size="sm" onClick={() => void openAnimationExport()}>
        Export animation…
      </Button>
    </>
  );
}
