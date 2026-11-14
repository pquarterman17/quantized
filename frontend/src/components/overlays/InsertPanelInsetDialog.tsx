// Insert panel inset (#15): the thin, EAGER gate -- mirrors ConfirmDialog.tsx's
// split (bundle diet slice 8). `InsertPanelInsetDialogBody.tsx` is the lazy
// chunk with the real form; this file only reads the store's open flag and
// mounts the body once its chunk has loaded (`useRegionLoaded`), never into
// a suspending boundary. Mount one <InsertPanelInsetDialog/> at the app root
// (next to <ConfirmDialog/>).

import { lazyRegion, useRegionLoaded } from "../../lib/lazyRegion";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";

const Body = lazyRegion(() => import("./InsertPanelInsetDialogBody"), "Insert panel");

export default function InsertPanelInsetDialog() {
  const open = useApp((s) => s.insertDialogOpen);
  const close = useApp((s) => s.closeInsertPanelInsetDialog);
  const loadFailed = () => {
    close();
    toast("The insert-panel dialog failed to load. Try again.", "danger");
  };
  const ready = useRegionLoaded(Body, open, loadFailed);
  return open && ready ? <Body /> : null;
}
