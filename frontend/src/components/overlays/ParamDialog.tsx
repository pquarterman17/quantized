// Ported from fermiviewer frontend/src/components/overlays/ParamDialog.tsx.
// Promise-based parameter dialog: askParams(title, fields) resolves with typed
// values or null on cancel. Mount one <ParamDialog/> at the app root.
//
// Bundle diet slice 8 (plans/BUNDLE_HEADROOM.md): this file is now the thin,
// EAGER half -- it re-exports `askParams` and the field types (so every call
// site and every test that mocks this module is untouched) and mounts the
// dialog body, `ParamDialogBody.tsx`, from a lazy chunk once a request is
// pending -- only after that chunk has LOADED (`useRegionLoaded`), so the
// first open costs one localhost fetch and never React's retry throttle.
//
// Load failure (UX-003): nothing throws during render, so the React root is
// never at risk; the pending request resolves `null` (cancel -- the contract
// every caller already handles) so nothing hangs, and a toast says why. The
// next ask tries the fetch again.

import { lazyRegion, useRegionLoaded } from "../../lib/lazyRegion";
import { cancelPendingParams, useParamDialog } from "../../store/paramDialog";
import { toast } from "../../store/toasts";

export { askParams } from "../../store/paramDialog";
export type { ParamField, ParamValues } from "../../lib/params";

const Body = lazyRegion(() => import("./ParamDialogBody"), "Parameter dialog");

function loadFailed(): void {
  cancelPendingParams();
  toast("The dialog failed to load, so the action was cancelled. Try again.", "danger");
}

export default function ParamDialog() {
  const open = useParamDialog((s) => s.title !== null);
  const ready = useRegionLoaded(Body, open, loadFailed);
  return open && ready ? <Body /> : null;
}
