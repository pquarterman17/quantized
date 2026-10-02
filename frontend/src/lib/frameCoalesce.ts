/** A latest-state callback that runs at most once per animation frame. */
export function frameCoalesced(callback: () => void): { request: () => void; cancel: () => void } {
  let frame: number | null = null;
  return {
    request(): void {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        callback();
      });
    },
    cancel(): void {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

/** Observe resizes while coalescing expensive paint work to one draw/frame. */
export function observeResizePaint(element: Element, paint: () => void): () => void {
  const scheduled = frameCoalesced(paint);
  const observer = new ResizeObserver(scheduled.request);
  observer.observe(element);
  return () => {
    observer.disconnect();
    scheduled.cancel();
  };
}
