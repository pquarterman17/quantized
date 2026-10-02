import { batchFigureAppState, batchSeedDatasetIds } from "../../../store/batchFigureBuild";
import { Button } from "../../primitives";

/** Small Plot Recipe Manager entry point. Keeping selection expansion here
 * leaves the already-large manager view below its component ceiling. */
export default function BatchFigureLauncher({ onOpen }: { onOpen: (ids: string[]) => void }) {
  return (
    <Button
      size="sm"
      onClick={() => {
        const state = batchFigureAppState();
        onOpen(batchSeedDatasetIds({
          datasets: state.datasets,
          folders: state.folders,
          workbooks: state.workbooks,
          selectedIds: state.selectedIds,
          activeId: state.activeId,
          librarySelection: state.librarySelection,
        }));
      }}
    >
      Batch figures…
    </Button>
  );
}
