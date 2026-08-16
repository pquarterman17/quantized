import type { LibraryViewMode } from "../../lib/libraryViewPrefs";

interface Props {
  mode: LibraryViewMode;
  onChange: (mode: LibraryViewMode) => void;
}

export default function LibraryViewSelector({ mode, onChange }: Props) {
  return (
    <div className="qzk-lib-view-switch" role="group" aria-label="Library view">
      <button
        type="button"
        className="qzk-lib-view-option"
        aria-pressed={mode === "tree"}
        title="Tree view — browse the folder and workbook hierarchy"
        onClick={() => onChange("tree")}
      >
        Tree
      </button>
      <button
        type="button"
        className="qzk-lib-view-option"
        aria-pressed={mode === "tiles"}
        title="Tiles view — browse the Library in the main workspace"
        onClick={() => onChange("tiles")}
      >
        Tiles
      </button>
      <button
        type="button"
        className="qzk-lib-view-option"
        aria-pressed={mode === "details"}
        title="Details view — compare and sort loaded items"
        onClick={() => onChange("details")}
      >
        Details
      </button>
    </div>
  );
}
