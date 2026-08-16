// E-c1: the visible-only thumbnail scheduler. Owns the React side of the
// lib/thumbnailCache contract: IntersectionObserver-gated generation,
// AbortController cancellation on unmount/entity-change/scroll-out, and
// the revision check that keeps a late result from a replaced entity out
// of the UI (the useCard provenance pattern, applied to tiles).
//
// States a consumer renders:
//   unsupported — no generator for this kind; keep the static placeholder
//   idle        — supported, waiting for the tile to become visible
//   loading     — generation in flight
//   ready       — cached or freshly generated image
//   error       — generation failed (E-c2 owns the visual treatment)

import { useEffect, useState, type RefObject } from "react";

import type { LibraryNode } from "../../lib/libraryHierarchy";
import {
  getCachedThumbnail,
  revisionOf,
  setCachedThumbnail,
  thumbnailGeneratorFor,
  type ThumbnailResult,
} from "../../lib/thumbnailCache";
import { registerDefaultThumbnailGenerators } from "../../lib/thumbnailGenerators";

registerDefaultThumbnailGenerators(); // idempotent

export type ThumbnailState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: ThumbnailResult }
  | { status: "error" };

/** True once `el` has intersected the viewport (sticky — a generated
 *  thumbnail stays generated when scrolled back out). Environments without
 *  IntersectionObserver (jsdom, ancient WebViews) degrade to eager
 *  generation: correctness first, laziness where the platform allows. */
function useBecameVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
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
  const revision = revisionOf(node);
  const visible = useBecameVisible(ref);
  const cached = generator ? getCachedThumbnail(node.key, revision) : null;

  // Async outcome for THIS key+revision only. A keyed record (not a bare
  // status) makes staleness structural: a leftover state from the previous
  // entity revision simply doesn't match and is ignored below.
  const [outcome, setOutcome] = useState<{ key: string; revision: number; state: ThumbnailState } | null>(null);

  useEffect(() => {
    if (!generator || !visible) return;
    if (getCachedThumbnail(node.key, revision)) return; // sync path below serves it
    const controller = new AbortController();
    setOutcome({ key: node.key, revision, state: { status: "loading" } });
    generator(node, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setCachedThumbnail(node.key, revision, result);
        setOutcome({ key: node.key, revision, state: { status: "ready", result } });
      },
      () => {
        if (controller.signal.aborted) return; // cancellation is not an error
        setOutcome({ key: node.key, revision, state: { status: "error" } });
      },
    );
    return () => controller.abort();
    // `node` is captured for the generator call but keyed by (key, revision):
    // a rebuilt hierarchy node wrapping the SAME entity must not regenerate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generator, visible, node.key, revision]);

  // Late-result guard belt: render whatever matches the CURRENT key+revision.
  const current = outcome && outcome.key === node.key && outcome.revision === revision ? outcome.state : null;

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
