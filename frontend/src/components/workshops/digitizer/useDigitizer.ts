// Graph-digitizer state hook: a small state machine over image-pixel clicks.
// Steps: click X-axis ref 1 & 2 (enter their data values), Y-axis ref 1 & 2,
// then trace the curve. "Create" maps the traced pixels to data via the
// calibration (lib/digitizer, tested) and adds a DataStruct to the library.

import { useRef, useState } from "react";

import { calibrate, tracedToData } from "../../../lib/digitizer";
import type { DataStruct } from "../../../lib/types";
import { nextDatasetId, useApp } from "../../../store/useApp";

type CalMode = "x1" | "x2" | "y1" | "y2";
export type Mode = CalMode | "trace";
const ORDER: Mode[] = ["x1", "x2", "y1", "y2", "trace"];

interface Ref {
  px: number;
  py: number;
  value: number;
}
interface Pt {
  px: number;
  py: number;
}

export interface DigitizerState {
  image: string | null;
  mode: Mode;
  refs: Partial<Record<CalMode, Ref>>;
  traced: Pt[];
  pending: Pt | null;
  ready: boolean;
  setImage: (src: string | null) => void;
  click: (px: number, py: number) => void;
  commit: (value: number) => void;
  cancelPending: () => void;
  undo: () => void;
  reset: () => void;
  create: (name: string) => void;
}

export function useDigitizer(): DigitizerState {
  const addDataset = useApp((s) => s.addDataset);
  const datasets = useApp((s) => s.datasets);
  const setActive = useApp((s) => s.setActive);
  const setStatus = useApp((s) => s.setStatus);
  const [image, setImageState] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("x1");
  const [refs, setRefs] = useState<Partial<Record<CalMode, Ref>>>({});
  const [traced, setTraced] = useState<Pt[]>([]);
  const [pending, setPending] = useState<Pt | null>(null);
  // The last worksheet "Create" wrote, by the exact calibration + trace + name:
  // a repeat click on the same digitization adds nothing (there is no source
  // worksheet, so no stale marking applies; the image is the only input).
  const made = useRef<{ key: string; id: string } | null>(null);

  const ready = !!(refs.x1 && refs.x2 && refs.y1 && refs.y2);

  function clearAll(): void {
    setMode("x1");
    setRefs({});
    setTraced([]);
    setPending(null);
  }

  function setImage(src: string | null): void {
    setImageState(src);
    clearAll();
  }

  function click(px: number, py: number): void {
    if (mode === "trace") setTraced((t) => [...t, { px, py }]);
    else setPending({ px, py });
  }

  function commit(value: number): void {
    if (!pending || mode === "trace" || !Number.isFinite(value)) return;
    setRefs((r) => ({ ...r, [mode]: { ...pending, value } }));
    setPending(null);
    setMode(ORDER[Math.min(ORDER.indexOf(mode) + 1, ORDER.length - 1)]);
  }

  function cancelPending(): void {
    setPending(null);
  }

  function undo(): void {
    if (mode === "trace") setTraced((t) => t.slice(0, -1));
  }

  function create(name: string): void {
    if (!ready || traced.length < 2) return;
    const cal = calibrate(
      { px: refs.x1!.px, value: refs.x1!.value },
      { px: refs.x2!.px, value: refs.x2!.value },
      { px: refs.y1!.py, value: refs.y1!.value }, // Y refs calibrate on pixel-y
      { px: refs.y2!.py, value: refs.y2!.value },
    );
    const { x, y } = tracedToData(cal, traced);
    const data: DataStruct = {
      time: x,
      values: y.map((v) => [v]),
      labels: ["y"],
      units: [""],
      metadata: { x_column_name: "x", x_column_unit: "", source: "digitized" },
    };
    const title = name.trim() || "digitized";
    const key = JSON.stringify([title, refs, traced]);
    const prior = made.current;
    const live = prior?.key === key ? datasets.find((d) => d.id === prior.id) : undefined;
    if (live) {
      setActive(live.id);
      setStatus(`this digitization is already added as “${live.name}”; nothing was duplicated`);
      return;
    }
    const id = nextDatasetId();
    addDataset({ id, name: title, data });
    made.current = { key, id };
    setStatus(`digitized ${x.length} points → ${title}`);
  }

  return {
    image,
    mode,
    refs,
    traced,
    pending,
    ready,
    setImage,
    click,
    commit,
    cancelPending,
    undo,
    reset: clearAll,
    create,
  };
}
