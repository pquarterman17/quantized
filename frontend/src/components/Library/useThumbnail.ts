// E-c1: the visible-only thumbnail scheduler. Owns the React side of the
// lib/thumbnailCache contract: IntersectionObserver-gated generation,
// AbortController cancellation, and the fingerprint check that keeps a
// late result from a replaced entity OR dependency out of the UI (the
// useCard provenance pattern, applied to tiles).
//
// CANCELLATION PROMISE (narrowed per Sol review, PR #149): generation is
// aborted on unmount and whenever the request fingerprint changes
// mid-flight — entity or any dependency replaced. Visibility is STICKY
// while the tile stays MOUNTED: scrolling within the rendered window never
// aborts or discards. E-c3's virtualized grid UNMOUNTS tiles far outside
// the window, which aborts their in-flight generation like any unmount —
// completed thumbnails survive in the LRU, so a tile scrolled back in is
// a cache hit, and only not-yet-finished work is redone.
//
// DEPENDENCY-AWARE INVALIDATION: the hook subscribes to the store slices
// previews are transitively live against (datasets, editable figures) and
// re-resolves the canonical ThumbnailRequest on every change, so editing a
// figure regenerates the pages that reference it, and replacing a source
// dataset regenerates the live figures bound to it.
//
// States a consumer renders:
//   unsupported — no generator for this kind; keep the static placeholder
//   idle        — supported, waiting for the tile to become visible
//   loading     — generation in flight
//   ready       — cached or freshly generated image
//   error       — generation failed (E-c2 owns the visual treatment)

import { useEffect, useMemo, useState, type RefObject } from "react";

import type { LibraryNode } from "../../lib/libraryHierarchy";
import {
  getCachedThumbnail,
  setCachedThumbnail,
  thumbnailGeneratorFor,
  type ThumbnailResult,
} from "../../lib/thumbnailCache";
import { registerDefaultThumbnailGenerators } from "../../lib/thumbnailGenerators";
import { resolveThumbnailRequest } from "../../lib/thumbnailRequest";
import { useApp } from "../../store/useApp";

registerDefaultThumbnailGenerators(); // idempotent

export type ThumbnailState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: ThumbnailResult }
  | { status: "error" };

/** True once `el` has intersected the viewport (sticky — see the header's
 *  cancellation promise). Environments without IntersectionObserver
 *  (jsdom, ancient WebViews) degrade to eager generation: correctness
 *  first, laziness where the platform allows. */
function useBecameVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

export function useThumbnail(node: LibraryNode, ref: RefObject<HTMLElement | null>): ThumbnailState {
  const generator = thumbnailGeneratorFor(node.kind);
  const visible = useBecameVisible(ref);
  // The store slices previews are transitively live against. Subscribing
  // (not getState) is the invalidation mechanism: a replaced dependency
  // re-renders this hook with a new fingerprint.
  const datasets = useApp((s) => s.datasets);
  const editableFigures = useApp((s) => s.editableFigures);
  // Null for generator-less kinds: hook-order rules keep the subscriptions,
  // but an unsupported tile never pays for dependency resolution.
  const request = useMemo(
    () => (generator ? resolveThumbnailRequest(node, { datasets, editableFigures }) : null),
    [generator, node, datasets, editableFigures],
  );
  const cached = request ? getCachedThumbnail(node.key, request.fingerprint) : null;

  // Async outcome for THIS key+fingerprint only. A keyed record (not a
  // bare status) makes staleness structural: a leftover state from a
  // previous fingerprint simply doesn't match and is ignored below.
  const [outcome, setOutcome] = useState<{ key: string; fingerprint: string; state: ThumbnailState } | null>(null);

  useEffect(() => {
    if (!generator || !request || !visible) return;
    if (getCachedThumbnail(request.node.key, request.fingerprint)) return; // sync path below serves it
    const controller = new AbortController();
    const { key } = request.node;
    const { fingerprint } = request;
    setOutcome({ key, fingerprint, state: { status: "loading" } });
    generator(request, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setCachedThumbnail(key, fingerprint, result);
        setOutcome({ key, fingerprint, state: { status: "ready", result } });
      },
      () => {
        if (controller.signal.aborted) return; // cancellation is not an error
        setOutcome({ key, fingerprint, state: { status: "error" } });
      },
    );
    return () => controller.abort();
    // Keyed by (key, fingerprint), NOT the request object: a hierarchy
    // rebuild wraps the same entities in a fresh node/request, and an
    // unchanged fingerprint must not abort-and-restart a mid-flight run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generator, visible, request?.node.key, request?.fingerprint]);

  // Late-result guard belt: render whatever matches the CURRENT request.
  const current =
    outcome && request && outcome.key === node.key && outcome.fingerprint === request.fingerprint
      ? outcome.state
      : null;

  if (!generator) return UNSUPPORTED;
  if (cached) return { status: "ready", result: cached };
  if (current) return current;
  return visible ? LOADING_PENDING : IDLE;
}

const UNSUPPORTED: ThumbnailState = { status: "unsupported" };
const IDLE: ThumbnailState = { status: "idle" };
// Between "became visible" and the effect's first run the state is morally
// loading already — reporting it immediately avoids a one-frame idle flash.
const LOADING_PENDING: ThumbnailState = { status: "loading" };
