// Status note when a log axis hides non-positive points (lib/logAxisNotice, lazy).

import { useEffect } from "react";

import type { LogAxisView } from "../../lib/logAxisNotice";
import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";

export function useLogAxisNotice(payload: PlotPayload | null, plotted: readonly number[], view: LogAxisView): void {
  const { xScale, yScale, y2Scale, y2Keys } = view;
  const setStatus = useApp((s) => s.setStatus);
  useEffect(() => {
    if (xScale !== "log" && yScale !== "log" && y2Scale !== "log") return;
    let live = true;
    void import("../../lib/logAxisNotice")
      .then((m) => {
        const note = live ? m.logHiddenNote(payload, plotted, { xScale, yScale, y2Scale, y2Keys }) : null;
        if (note) setStatus(note);
      })
      .catch(() => {}); // a missing note is not worth a toast
    return () => {
      live = false;
    };
  }, [payload, plotted, xScale, yScale, y2Scale, y2Keys, setStatus]);
}
