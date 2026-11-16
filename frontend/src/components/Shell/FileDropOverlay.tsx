import "../../styles/fileDrop.css";

/** Full-window "drop to import" veil. Purely visual (pointer-events: none) so
 *  the drag still reaches whatever is underneath. */
export default function FileDropOverlay({ count }: { count: number }) {
  return (
    <div className="qzk-filedrop" role="status" aria-live="polite" data-testid="file-drop-overlay">
      <div>
        <strong>Drop to import</strong>
        <span>
          {count > 1 ? `${count} files` : "The file"} will be added to this project as {count > 1 ? "datasets" : "a dataset"}.
        </span>
      </div>
    </div>
  );
}
