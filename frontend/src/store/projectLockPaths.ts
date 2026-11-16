/** Stable lock key for the browser build's single shared autosave slot. */
export const BROWSER_AUTOSAVE_LOCK_PATH = "qz://browser-autosave-session";

/** Why a project opened read-only, with the next step (shared by the open flow and project-follows-history). */
export function readOnlyOpenReason(status: string): string {
  return status === "held-by-other-stale"
    ? "another (unresponsive) instance has this project open — Take Over Editing is available"
    : "another instance has this project open for editing — opened read-only";
}

