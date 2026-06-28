// Reflectometry two-frame view — state hook. Pairs a reflectivity-curve dataset
// with its SLD-profile dataset (auto-paired by filename stem) and derives the two
// frames. Pure packing lives in lib/reflview.ts.

import { useMemo, useState } from "react";

import { autoPair, buildReflPanels, isProfile, isReflCurve, type ReflPanels } from "../../../lib/reflview";
import { useApp } from "../../../store/useApp";

export interface ReflViewState {
  reflOptions: { id: string; name: string }[];
  profileOptions: { id: string; name: string }[];
  reflId: string | null;
  profileId: string | null;
  logY: boolean;
  panels: ReflPanels;
  setReflId: (id: string) => void;
  setProfileId: (id: string) => void;
  setLogY: (on: boolean) => void;
}

export function useReflView(): ReflViewState {
  const datasets = useApp((s) => s.datasets);

  const reflOptions = datasets.filter((d) => isReflCurve(d.data)).map((d) => ({ id: d.id, name: d.name }));
  const profileOptions = datasets.filter((d) => isProfile(d.data)).map((d) => ({ id: d.id, name: d.name }));

  // Seed the pickers from a stem-matched pair (once).
  const seed = useMemo(() => autoPair(datasets), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [reflId, setReflId] = useState<string | null>(seed.reflId);
  const [profileId, setProfileId] = useState<string | null>(seed.profileId);
  const [logY, setLogY] = useState(true);

  const reflDs = datasets.find((d) => d.id === reflId)?.data ?? null;
  const profileDs = datasets.find((d) => d.id === profileId)?.data ?? null;
  const panels = useMemo(() => buildReflPanels(reflDs, profileDs), [reflDs, profileDs]);

  return {
    reflOptions,
    profileOptions,
    reflId,
    profileId,
    logY,
    panels,
    setReflId,
    setProfileId,
    setLogY,
  };
}
