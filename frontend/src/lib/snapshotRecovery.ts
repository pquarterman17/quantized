// What a saved snapshot result offers the user for reopening its tool, by
// freshness state. One pure function feeds BOTH the result book and the
// toolbar, so the guidance text and the button state cannot disagree (they did:
// the book told a stale result's reader to "reopen in the tool" while the same
// state disabled the button). It reads the existing freshness authority
// (`snapshotResultState`) and the reopener's own bind check (`recipeReady`: the
// saved recipe parsed AND its columns exist in the live source); it adds no
// persisted field.

import type { SnapshotResultState } from "./analysisResultFreshness";

export type SnapshotRecoveryKind =
  | "reopen"        // current / pending: the saved settings on the saved data
  | "review-rerun"  // stale, recipe still binds: review settings on the CURRENT data
  | "unbindable"    // recipe can't bind (to the current columns, or at all)
  | "source-missing";

export interface SnapshotRecovery {
  kind: SnapshotRecoveryKind;
  /** The action is enabled (still subject to a busy panel). */
  canReopen: boolean;
  /** Hover text for the action. */
  title: string;
  /** Visible guidance for a result that is not current, else null. */
  note: string | null;
}

export function snapshotRecovery(
  state: SnapshotResultState, recipeReady: boolean, toolLabel: string, sourceName?: string,
  /** `snapshotColumnIssues(result, source)`: the saved columns that no longer fit, by name. */
  columnIssues: readonly string[] = [],
): SnapshotRecovery {
  const source = sourceName ? `“${sourceName}”` : "the source worksheet";
  const named = columnIssues.join("; ");
  if (state === "source-missing") {
    return {
      kind: "source-missing", canReopen: false,
      title: "The source worksheet is missing, so there is nothing to rerun on.",
      note: "The source worksheet is missing, so this result can't be rerun. Restore or re-import the worksheet, then run the tool again. The saved values stay available here.",
    };
  }
  if (!recipeReady) {
    return {
      kind: "unbindable", canReopen: false,
      title: state === "out-of-date"
        ? `The saved settings no longer fit ${source}${named ? `: ${named}` : ""}. Run ${toolLabel} again from the analysis launcher.`
        : "This result does not contain a compatible saved question.",
      note: state === "out-of-date"
        ? `The source changed since this result was saved, and the saved settings no longer fit ${source}: ${named ? `${named}.` : "a column they use is missing or changed, or the saved question can't be read."} Open the data to check its columns, then run ${toolLabel} from the analysis launcher. This result stays available.`
        : null,
    };
  }
  if (state === "out-of-date") {
    return {
      kind: "review-rerun", canReopen: true,
      title: `Reopen ${toolLabel} with the saved settings on the current data to review them. Running it creates a new result; this one is kept unchanged.`,
      note: `The source changed since this result was saved. The values below are the saved ones and stay available.${named ? ` Check before rerunning: ${named}.` : ""} Review and rerun reopens the tool with the saved settings on the current data; running it creates a new result and leaves this one unchanged.`,
    };
  }
  return {
    kind: "reopen", canReopen: true,
    title: `Reopen ${toolLabel} with this result's source and settings.`,
    note: state === "pending"
      ? "The full source worksheet is still loading, so the saved input cannot be verified yet. The values below are the saved ones."
      : null,
  };
}
