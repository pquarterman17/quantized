// The debounced, abortable server-PNG preview shared by the ternary and
// vector-field workshops (the usePreviewRender.ts shape, minus the hit-map).

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postBlob } from "../../../lib/api/http";
import { PREVIEW_DPI, previewBody, useFigurePreview } from "./auxFigurePreview";

vi.mock("../../../lib/api/http", () => ({ postBlob: vi.fn() }));
const postBlobMock = vi.mocked(postBlob);

/** A postBlob that never resolves on its own, but exposes each call's signal. */
function pendingRenders(): { signals: AbortSignal[]; resolve: (i: number) => void } {
  const signals: AbortSignal[] = [];
  const resolvers: (() => void)[] = [];
  postBlobMock.mockImplementation((_path, _body, signal) => {
    signals.push(signal as AbortSignal);
    return new Promise<Blob>((resolve, reject) => {
      resolvers.push(() => resolve(new Blob(["png-bytes"], { type: "image/png" })));
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
  return { signals, resolve: (i) => resolvers[i]() };
}

beforeEach(() => {
  vi.useFakeTimers();
  postBlobMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("previewBody", () => {
  it("is the export body with the screen format and dpi, nothing else changed", () => {
    const body = { data: [[1, 2, 3]], title: "t", fmt: "pdf" };
    expect(previewBody(body)).toEqual({ data: [[1, 2, 3]], title: "t", fmt: "png", dpi: PREVIEW_DPI });
  });
});

describe("useFigurePreview", () => {
  it("renders after the debounce and settles into a data URL", async () => {
    const { resolve } = pendingRenders();
    // A stable body, as the workshops' useMemo gives the hook: a fresh literal
    // per render would re-arm the effect after every settle (see the hook).
    const { result } = renderHook((body: object) => useFigurePreview("/api/export/ternary-figure", body), {
      initialProps: { data: [[1, 1, 1]] },
    });
    expect(result.current.busy).toBe(true);
    expect(postBlobMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(postBlobMock).toHaveBeenCalledWith(
      "/api/export/ternary-figure",
      { data: [[1, 1, 1]], fmt: "png", dpi: PREVIEW_DPI },
      expect.any(AbortSignal),
    );

    await act(async () => {
      resolve(0);
      await vi.runAllTimersAsync();
    });
    expect(result.current.preview).toMatch(/^data:image\/png;base64,/);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("aborts a superseded render and keeps only the newest", async () => {
    const { signals } = pendingRenders();
    const { result, rerender } = renderHook((body: object) => useFigurePreview("/api/export/field-figure", body), {
      initialProps: { kind: "quiver" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(signals).toHaveLength(1);

    rerender({ kind: "streamline" });
    expect(signals[0].aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(signals).toHaveLength(2);
    expect(signals[1].aborted).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(true);
  });

  it("aborts the in-flight render on unmount and clears on a null body", async () => {
    const { signals } = pendingRenders();
    const { result, rerender, unmount } = renderHook(
      (body: object | null) => useFigurePreview("/api/export/field-figure", body),
      { initialProps: { kind: "quiver" } as object | null },
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    rerender(null);
    expect(signals[0].aborted).toBe(true);
    expect(result.current.preview).toBeNull();
    expect(result.current.busy).toBe(false);

    rerender({ kind: "quiver" });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it("reports a failed render", async () => {
    postBlobMock.mockRejectedValue(new Error("422: data must have 3 columns"));
    const { result } = renderHook((body: object) => useFigurePreview("/api/export/ternary-figure", body), {
      initialProps: { data: [] },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.error).toBe("422: data must have 3 columns");
    expect(result.current.busy).toBe(false);
  });
});
