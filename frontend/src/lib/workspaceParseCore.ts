// Shared core for off-main-thread workspace parsing (P3.4 slice 3). Both
// `workspaceParse.worker.ts` (the module Worker) and `parseWorkspaceFile.ts`'s
// synchronous fallback call this SAME function, so the two paths can never
// diverge on what counts as valid input or how a failure is reported —
// exactly one place decides "read the Blob, parse it, and catch every
// failure into a plain result object" instead of the validation logic
// existing twice.
//
// The result is a plain discriminated union (no `Error` instances, no
// functions) because it doubles as the message posted back across the
// worker boundary: structured clone handles plain objects/strings/booleans
// natively but does not reliably preserve everything about a thrown `Error`
// across every embedding (older WebViews in particular), so the message
// carries just the string the caller already used
// (`e instanceof Error ? e.message : "error"` — the same fallback every
// other catch site in this codebase uses).

import { parseWorkspace, type LoadedWorkspace } from "./workspace";

export interface ViewportSize {
  width: number;
  height: number;
}

export type WorkspaceParseResult =
  | { ok: true; workspace: LoadedWorkspace }
  | { ok: false; error: string };

/** Read `blob`'s text and parse it as a `.dwk` workspace. Never throws —
 *  every failure (bad JSON, wrong format/version, an invalid dataset, a
 *  `Blob.text()` read error) becomes `{ ok: false, error }` instead, so a
 *  caller on either side of a worker boundary handles success and failure
 *  the same uniform way. */
export async function parseWorkspaceBlob(
  blob: Blob,
  viewport: ViewportSize,
): Promise<WorkspaceParseResult> {
  try {
    const text = await blob.text();
    return { ok: true, workspace: parseWorkspace(text, viewport) };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "error" };
  }
}
