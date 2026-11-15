// Live preview + commit for one `sigop` transform on the ACTIVE dataset, shared
// by the Signal Processing filters and the Resample workshop's Reduce XY. The
// preview and the commit run the same `computeSigop` (through `runTransform`),
// so what is previewed is what is created.

import { useEffect, useRef, useState } from "react";

import { analysisData } from "../../../lib/rowstate";
import { computeSigop, type SigopComputed, type SigopParams } from "../../../lib/transformSigop";
import type { Dataset } from "../../../lib/types";
import { createSigopFromApp } from "../../../store/sigopCommand";

export interface SigopRun {
  /** The preview for the CURRENT inputs (null while a new one loads). */
  result: SigopComputed | null;
  error: string;
  loading: boolean;
  busy: boolean;
  /** Create the dataset; resolves true when one was made. */
  commit: () => Promise<boolean>;
}

const isAbort = (e: unknown): boolean => typeof e === "object" && e !== null && "name" in e && e.name === "AbortError";

export function useSigopRun(dataset: Dataset | null, params: SigopParams | string | null): SigopRun {
  const [done, setDone] = useState<SigopComputed | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // `params` is rebuilt every render; its JSON is the stable identity.
  const paramsKey = typeof params === "object" && params ? JSON.stringify(params) : "";
  const data = dataset?.data;

  useEffect(() => {
    setDone(null);
    setError("");
    if (!dataset || dataset.pending || typeof params !== "object" || !params) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      const source = { name: dataset.name, data: analysisData(dataset) ?? dataset.data };
      computeSigop(params, source, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setDone(result);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || isAbort(e)) return;
          setError(e instanceof Error ? e.message : "Preview failed");
          setLoading(false);
        });
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `params` is covered by `paramsKey`; `dataset` by its id + data identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.id, data, dataset?.pending, paramsKey]);

  const commit = async (): Promise<boolean> => {
    if (!dataset || typeof params !== "object" || !params || inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      return await createSigopFromApp(params, dataset.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the dataset");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { result: done, error, loading, busy, commit };
}
