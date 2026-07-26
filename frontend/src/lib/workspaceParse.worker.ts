// Module Web Worker (P3.4 slice 3): runs the `.dwk` parse off the main
// thread, so opening/appending a large workspace doesn't freeze the
// renderer the way a synchronous `JSON.parse` + validate did (measured
// 2026-07-26: 5.8 s of a 5.97 s reopen frozen, at a 188 MB workspace — see
// docs/performance_envelope.md's "Large derived workspace" case).
//
// Thin by design: `parseWorkspaceCore.parseWorkspaceBlob` is the ONLY logic
// here — this file just wires it to `postMessage`/`onmessage`, so it stays
// (deliberately) outside this repo's unit-test net; `parseWorkspaceBlob` and
// `parseWorkspaceFile.ts`'s orchestration around it are what's tested (see
// parseWorkspaceFile.test.ts).
//
// Deliberately typed against the "DOM" lib already in tsconfig.json rather
// than adding "webworker" — TypeScript's DOM and WebWorker libs redeclare
// overlapping globals (Blob, MessageEvent, postMessage, …) and combining
// them in one program produces duplicate-identifier errors. `self` resolves
// to `Window & typeof globalThis` under "DOM", but `Window`'s own
// `onmessage`/`postMessage` (via the `WindowEventHandlers` mixin) are
// structurally compatible enough with a Worker's — every parameter/return
// type involved is generic-`any`-backed (`MessageEvent<any>`, `message:
// any`) — for this file to typecheck AND behave correctly at runtime inside
// the real `DedicatedWorkerGlobalScope` the browser actually gives it.

import { parseWorkspaceBlob, type ViewportSize } from "./workspaceParseCore";

export interface WorkspaceParseRequest {
  file: File;
  viewport: ViewportSize;
}

self.onmessage = (e: MessageEvent<WorkspaceParseRequest>) => {
  void parseWorkspaceBlob(e.data.file, e.data.viewport).then((result) => {
    self.postMessage(result);
  });
};
