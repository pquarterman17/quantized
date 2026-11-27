// On the level-crossings chip: when the measured curve looks like an M-H loop, point at the tool that
// measures what a user crossing M = 0 is after (coercivity, with remanence, saturation, squareness). A
// bare level crossing on a noisy loop reports a burst of crossings, not an Hc (acceptance pass 6
// usability 2). Lazy with the chip; the loop test is `lib/hysteresisLoopLook`.

import { useMemo } from "react";

import { looksLikeHysteresisLoop } from "../../lib/hysteresisLoopLook";
import type { GadgetMeasure } from "../../lib/gadgetMeasure";
import { useApp } from "../../store/useApp";
import { Button } from "../primitives";

export default function GadgetHysteresisPointer({ m }: { m: Extract<GadgetMeasure, { mode: "levelcrossing" }> }) {
  const ds = useApp((s) => s.datasets.find((d) => d.id === m.source.id));
  const setOpen = useApp((s) => s.setHysteresisOpen);
  const { xKey, yKey } = m.source.a;
  const loop = useMemo(() => {
    if (!ds) return false;
    const x = xKey === null ? ds.data.time : ds.data.values.map((r) => r[xKey]);
    return looksLikeHysteresisLoop(x, ds.data.values.map((r) => r[yKey]));
  }, [ds, xKey, yKey]);
  if (!loop) return null;
  return (
    <Button size="sm" onClick={() => setOpen(true)} title="Open the Hysteresis tool on this curve: coercivity, remanence, saturation and squareness, without the noise counting as crossings">
      Coercivity and remanence: Analyze › Spectroscopy &amp; magnetometry › Hysteresis analysis…
    </Button>
  );
}
