// Export / Copy figure: say when the figure leaves out an analysis overlay
// (fit / baseline / peak markers) the canvas draws.
//
// `figureSpecStage.buildStageFigureSpec` fails closed -- an overlay is never
// drawn at a guessed X (I1/I2, lib/overlayPlacement) -- and reports the
// overlays it could not carry through `onDroppedOverlays`. A command may build
// more than one candidate spec (the excluded-rows twins, lib/excludedRowsChoice)
// and only then pick one, so each build's report is remembered against the
// spec object that build returned, and read back for the one actually sent.
// The sentence is Send to report's own (`overlaySpecShape.overlaysNotCarriedReason`),
// so the three commands cannot drift apart in what they tell the user.

import { overlaysNotCarriedReason } from "./overlaySpecShape";

export interface OverlayDropTracker {
  /** Run one spec build, remembering the overlays it dropped against the
   *  object it returns (`make` gets the sink to hand the builder). */
  build<T extends object>(make: (onDroppedOverlays: (labels: string[]) => void) => T): T;
  /** The note to append to the success message for the spec sent ("" = none). */
  note(spec: object | null | undefined): string;
}

export function overlayDropTracker(): OverlayDropTracker {
  const dropped = new WeakMap<object, string[]>();
  return {
    build(make) {
      let labels: string[] = [];
      const spec = make((l) => { labels = l; });
      dropped.set(spec, labels);
      return spec;
    },
    note(spec) {
      const labels = spec ? dropped.get(spec) ?? [] : [];
      return labels.length ? `— ${overlaysNotCarriedReason(labels)}` : "";
    },
  };
}

/** `outcome` (a command's success note, possibly empty) with `note` appended. */
export function withDropNote(outcome: string, note: string): string {
  return [outcome, note].filter(Boolean).join(" ");
}
