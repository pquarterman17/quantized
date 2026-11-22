// Shared workbench shell (lane WB4): the one "this tool will not run on these
// inputs" error, as opposed to a backend failure. A tool throws it from its
// run and records its text; the tool's panel renders
// `WorkbenchMessage refusal={...}` for that text and `error={...}` otherwise.
export class Refusal extends Error {}
