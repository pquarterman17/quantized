// J2 Recode workshop's OPEN FLAG, split out of the heavy store/recode.ts
// (bundle headroom slice 13, plans/BUNDLE_HEADROOM.md) — the
// store/levelOrderPanel.ts shape: a dependency-free store (zustand only) so
// AppOverlays.tsx can gate the lazy RecodePanel without importing
// store/recode.ts, which was eager for that one `s.open` read alone.
//
// A MIRROR, not the source of truth: store/recode.ts still owns `open` (and
// every refusal check in `openRecode`), and copies it here from a
// subscription registered when that module evaluates. Only store/recode.ts
// can make `open` true, and it has to be loaded to do so (WorksheetPane's
// "Recode…" entry and the panel both import it), so this flag can never
// disagree with it. The copy runs inside the heavy store's own `set`, so
// AppOverlays sees the change in the same tick it always did.

import { create } from "zustand";

export const useRecodePanel = create<{ open: boolean }>(() => ({ open: false }));
