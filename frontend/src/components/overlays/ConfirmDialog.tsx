// Promise-based confirm dialog: askConfirm(title, message?, confirmLabel?, danger?)
// resolves true on confirm, false on cancel / backdrop / Escape. Mount one
// <ConfirmDialog/> at the app root (next to <ParamDialog/>).
//
// Bundle diet slice 8 (plans/BUNDLE_HEADROOM.md): this file is now the thin,
// EAGER half -- it re-exports `askConfirm` (so the ~20 call sites and every
// test that mocks this module are untouched) and mounts the dialog body,
// `ConfirmDialogBody.tsx`, from a lazy chunk once a question is pending. The
// body used to sit in the entry chunk on every launch although it renders
// nothing until somebody asks. Cost: the FIRST confirm of a session waits one
// localhost chunk fetch before it paints. The body is mounted only after its
// chunk has LOADED (`useRegionLoaded`), never into a suspending boundary, so
// that first open does not also pay React's ~300 ms retry throttle. While
// that fetch is in flight `usePendingDialogGuard` owns Escape (it cancels the
// ask) and swallows Enter/Space, so nothing behind the dialog reacts.
//
// Load failure (UX-003): `lazyRegion`'s tagged loader reports it without
// anything throwing during render, so the React root is never at risk. The
// pending ask is answered `false` -- the safe answer, nothing destructive runs
// behind a dialog nobody saw -- so its caller does not hang, and a toast says
// why. The next ask tries the fetch again.

import { lazyRegion, useRegionLoaded } from "../../lib/lazyRegion";
import { cancelPendingConfirm, useConfirm } from "../../store/confirmDialog";
import { toast } from "../../store/toasts";
import { usePendingDialogGuard } from "./usePendingDialogGuard";

export { askConfirm } from "../../store/confirmDialog";

const Body = lazyRegion(() => import("./ConfirmDialogBody"), "Confirm dialog");

function loadFailed(): void {
  cancelPendingConfirm();
  toast("The confirmation dialog failed to load, so nothing was changed. Try again.", "danger");
}

export default function ConfirmDialog() {
  const open = useConfirm((s) => s.title !== null);
  const ready = useRegionLoaded(Body, open, loadFailed);
  // Asked, chunk still in flight: own Escape/Enter/Space until the body does.
  usePendingDialogGuard(open && !ready, cancelPendingConfirm);
  return open && ready ? <Body /> : null;
}
