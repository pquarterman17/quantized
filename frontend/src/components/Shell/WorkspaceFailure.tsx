import { useHistoryCommands } from "../history/useHistoryCommands";

/** The view WorkspaceErrorBoundary shows after a workspace render failure.
 *  Lazy (see the boundary): it only ever renders after a crash, so its markup
 *  stays off the eager bundle.
 *
 *  It replaces Stage, which owns the Ctrl+Z / Ctrl+Shift+Z listener, so it
 *  mounts the history commands itself: undoing the edit that broke the view
 *  is the most direct recovery. Stage takes them back when the view recovers. */
export default function WorkspaceFailure({ onRetry }: { onRetry: () => void }) {
  useHistoryCommands();
  return (
    <main className="qzk-workspace-failure" role="alert">
      <div>
        <h2>The workspace view hit a problem</h2>
        <p>The menus are still available. Retry the view, or use File to open or import your data again.</p>
        <button className="qz-btn" type="button" onClick={onRetry}>
          Retry workspace view
        </button>
      </div>
    </main>
  );
}
