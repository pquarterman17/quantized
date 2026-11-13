// Preferences ▸ Interaction row: clear the on-disk copies of opened Origin
// projects (backend routes/_uploadcache.py; docs/opening_origin_files.md).
// Lives with the lazily loaded Preferences dialog, so it costs the eager
// bundle nothing. The body (commands/uploadCacheCommand.ts) asks before it
// deletes, naming the folder, the count and the size.

import { runClearUploadCache } from "../../commands/uploadCacheCommand";
import { useApp } from "../../store/useApp";
import { Button } from "../primitives";

export function UploadCachePref() {
  return (
    <div className="qzk-pref-row">
      <div className="qzk-pref-lbl">
        Origin upload cache
        <span className="hint">
          copies of opened Origin projects, kept on disk so their other books load later
        </span>
      </div>
      <div className="qzk-pref-ctl">
        <Button aria-label="Clear Origin upload cache" onClick={() => void runClearUploadCache(useApp.getState)}>
          Clear…
        </Button>
      </div>
    </div>
  );
}
