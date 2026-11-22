// Shared workbench shell (lane WB4): the one "this tool will not run on these
// inputs" error, as opposed to a backend failure. A tool throws it from its
// run; the marker is the CLASS, carried with the error (`useWorkbenchPreview`
// reports `refusal`, `failureOf` does the same for a tool's own state), never a
// comparison of message text. The tool's panel renders
// `WorkbenchMessage refusal={...}` for a refusal and `error={...}` otherwise.
export class Refusal extends Error {}

/** A shown failure with its kind. */
export interface Failure { message: string; refusal: boolean }

/** The failure for a thrown value: a `Refusal` is flagged, anything else is not. */
export const failureOf = (e: unknown, fallback: string): Failure =>
  ({ message: e instanceof Error ? e.message : fallback, refusal: e instanceof Refusal });
