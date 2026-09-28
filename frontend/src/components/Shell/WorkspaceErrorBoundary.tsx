import { Component, type ErrorInfo, type ReactNode } from "react";

import { lazyRegion } from "../../lib/lazyRegion";

// Only ever rendered after a crash, so its markup is a lazy chunk.
const WorkspaceFailure = lazyRegion(() => import("./WorkspaceFailure"), "Workspace recovery view");

interface Props {
  children: ReactNode;
  resetKey: string;
}

interface State {
  error: Error | null;
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
    return <WorkspaceFailure onRetry={() => this.setState({ error: null })} />;
  }
}
