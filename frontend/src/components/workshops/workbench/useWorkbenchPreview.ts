// Shared workbench shell (lane WB): the PREVIEW half of "preview -> commit ->
// rerun/edit", extracted from the Signal Processing workbench so every tool
// gets the same rules instead of inventing its own:
//
// - a preview is computed for a KEY (a string naming every input it depends
//   on; "" = nothing previewable yet). Use `tokenOf` (lib/previewKey) for
//   objects the store replaces on edit (a Dataset, its analysis rows).
// - `current` is the result for the current key ONLY. A result computed for an
//   older key is never `current`, so a tool cannot commit a preview of
//   settings the user has since changed. `latest` keeps the most recent result
//   whatever its key, for a tool that wants to keep showing it marked stale.
// - stale responses are rejected twice: each run has a sequence number and an
//   AbortSignal, and only the newest run that was not aborted may write state.
// - the in-flight run is aborted when the key changes, on `discard()`, and on
//   unmount. An AbortError is never shown as an error.
// - `auto` (default) debounces a run after every key change; with `auto`
//   false nothing runs until `refresh()` (an explicit "Estimate" button).
//   `refresh()` runs for the key of the last committed render (what the user
//   sees) and resolves when it settles or is aborted; an edit that lands
//   while it runs aborts it, so its result can never carry the new key.
//
// Pure React: no store or API imports. Commit lives in useWorkbenchCommit /
// useAnalysisCommit; display in WorkbenchPreviewFrame / WorkbenchMessage.

import { useCallback, useEffect, useRef, useState } from "react";

import { useLatestRef } from "../../../lib/previewKey";

export interface WorkbenchPreviewOptions<T> {
  /** Every input the preview depends on; "" when there is nothing to preview. */
  key: string;
  /** Compute the preview. Honour `signal` where the transport can. */
  run: (signal: AbortSignal) => Promise<T>;
  /** Debounce between a key change and an automatic run. */
  delayMs: number;
  /** Run automatically after each key change (default true). */
  auto?: boolean;
  /** Message for a rejection that is not an Error. */
  fallbackError?: string;
}

export interface WorkbenchPreview<T> {
  /** The result for the CURRENT key, or null (none yet, pending, or stale). */
  current: T | null;
  /** The most recent result, possibly for an older key. */
  latest: { key: string; value: T } | null;
  /** A result exists but was computed for different inputs. */
  stale: boolean;
  /** The failure for the current key ("" when none). */
  error: string;
  /** A run for the current key is scheduled or in flight. */
  loading: boolean;
  /** Some run is in flight right now (not merely scheduled). */
  running: boolean;
  /** Run now for the next render's key; resolves when that run settles. */
  refresh: () => Promise<void>;
  /** Abort any run and forget every result (Cancel / Clear). */
  discard: () => void;
}

export const isAbortError = (e: unknown): boolean =>
  typeof e === "object" && e !== null && "name" in e && (e as { name: unknown }).name === "AbortError";

interface State<T> {
  latest: { key: string; value: T } | null;
  error: { key: string; message: string } | null;
  pendingKey: string | null;
  /** Discarded while auto: nothing is scheduled for this key any more. */
  discardedKey: string | null;
}

export function useWorkbenchPreview<T>({
  key, run, delayMs, auto = true, fallbackError = "Preview failed",
}: WorkbenchPreviewOptions<T>): WorkbenchPreview<T> {
  const [state, setState] = useState<State<T>>({ latest: null, error: null, pendingKey: null, discardedKey: null });
  const seq = useRef(0);
  const live = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestInputs = useLatestRef({ key, run, fallbackError });

  // Start a run for `forKey`, superseding (aborting) any run in flight.
  const start = useCallback((forKey: string): Promise<void> => {
    const id = ++seq.current;
    live.current?.abort();
    const c = new AbortController();
    live.current = c;
    const owns = () => mounted.current && seq.current === id && !c.signal.aborted;
    // A rerun for a key that earlier failed starts clean: the old failure is
    // not the answer for this run.
    setState((s) => ({ ...s, pendingKey: forKey, error: s.error?.key === forKey ? null : s.error }));
    // Started synchronously (the request goes out now); a run that throws
    // before returning its promise is an error like any other.
    let launched: Promise<T>;
    try {
      launched = latestInputs.current.run(c.signal);
    } catch (e) {
      launched = Promise.reject(e instanceof Error ? e : new Error(latestInputs.current.fallbackError));
    }
    const settled = launched.then(
      (value) => { if (owns()) setState({ latest: { key: forKey, value }, error: null, pendingKey: null, discardedKey: null }); },
      (e: unknown) => {
        if (!owns() || isAbortError(e)) return;
        const message = e instanceof Error ? e.message : latestInputs.current.fallbackError;
        setState((s) => ({ ...s, error: { key: forKey, message }, pendingKey: null }));
      },
    );
    // A superseded run must not leave "loading" behind for its key.
    void settled.then(() => {
      if (mounted.current && seq.current === id) setState((s) => (s.pendingKey === forKey ? { ...s, pendingKey: null } : s));
    });
    // An aborted run settles at once for its caller, even when its transport
    // cannot be aborted and answers later (the answer is then ignored).
    return Promise.race([settled, new Promise<void>((resolve) => c.signal.addEventListener("abort", () => resolve(), { once: true }))]);
    // Refs and setState only: stable for the hook's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refresh = useCallback(
    () => (latestInputs.current.key === "" ? Promise.resolve() : start(latestInputs.current.key)),
    [latestInputs, start],
  );
  const discard = useCallback(() => {
    clearTimeout(timer.current);
    seq.current += 1;
    live.current?.abort();
    live.current = null;
    setState({ latest: null, error: null, pendingKey: null, discardedKey: latestInputs.current.key });
    // Refs and setState only: stable for the hook's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      live.current?.abort();
    };
  }, []);

  // Every key change aborts the run in flight (its inputs are gone); in auto
  // mode it also schedules a debounced run for the new key.
  useEffect(() => {
    timer.current = key !== "" && auto ? setTimeout(() => void start(key), delayMs) : undefined;
    return () => {
      clearTimeout(timer.current);
      seq.current += 1;
      live.current?.abort();
      live.current = null;
      // A failure belongs to its key: leaving the key forgets it, so coming
      // back to that key does not show it again while the rerun is scheduled.
      setState((s) => (s.pendingKey === null && s.error === null ? s : { ...s, pendingKey: null, error: null }));
    };
  }, [key, auto, delayMs, start]);

  const latest = state.latest;
  const current = latest && key !== "" && latest.key === key ? latest.value : null;
  const error = state.error && state.error.key === key ? state.error.message : "";
  const scheduled = auto && key !== "" && current === null && error === "" && state.discardedKey !== key;
  return {
    current,
    latest,
    stale: latest !== null && current === null,
    error,
    loading: key !== "" && (state.pendingKey === key || scheduled),
    running: state.pendingKey !== null,
    // Runs for the key of the last COMMITTED render: the inputs the user sees.
    refresh,
    discard,
  };
}
