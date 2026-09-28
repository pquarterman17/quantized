import { Component, type ErrorInfo, type ReactNode } from "react";

import { useHistoryCommands } from "../history/useHistoryCommands";

interface Props {
  children: ReactNode;
  resetKey: string;
}

interface State {
  error: Error | null;
}

/** The fallback replaces Stage, which owns the Ctrl+Z / Ctrl+Shift+Z listener.
 *  Keep undo on the keyboard while the failure shows: undoing the edit that
 *  broke the view is the most direct recovery. */
function KeepUndoAvailable(): null {
  useHistoryCommands();
  return null;
}

/** Keep the application chrome usable if a workspace child fails to render. */
export default class WorkspaceErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Workspace view failed", error, info.componentStack);
  }

  componentDidUpdate(previous: Props): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="qzk-workspace-failure" role="alert">
        <KeepUndoAvailable />
        <div>
          <h2>The workspace view hit a problem</h2>
          <p>The menus are still available. Retry the view, or use File to open or import your data again.</p>
          <button className="qz-btn" type="button" onClick={() => this.setState({ error: null })}>
            Retry workspace view
          </button>
        </div>
      </main>
    );
  }
}
