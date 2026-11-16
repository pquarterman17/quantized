// usePreviewRender against the real transport (lib/api/figures -> http ->
// datasetCache), with only `fetch` stubbed: every property edit re-renders the
// preview, so the dataset must go over the wire once and a handle after that,
// and a superseded in-flight render must be aborted rather than left to land.

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "../../../lib/api/figures";
import type { DataStruct } from "../../../lib/types";
import { previewDpiFor } from "./previewSizing";
import { usePreviewRender } from "./usePreviewRender";

const dataset: DataStruct = {
  time: [1, 2, 3],
  values: [[1], [4], [9]],
  labels: ["a"],
  units: ["V"],
  metadata: {},
};

function hitmapResponse(image: string): Response {
  const body = { image, width: 10, height: 10, elements: [], axes: null };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Dataset-Handle": "h-preview" },
  });
}

type Sent = { body: Record<string, unknown>; signal: AbortSignal | null | undefined };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePreviewRender transport", () => {
  it("sends the dataset once, then its handle on the next preview", async () => {
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init: RequestInit) => {
        sent.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, signal: init.signal });
        return hitmapResponse(`img${sent.length}`);
      }),
    );
    const first: FigureSpec = { dataset, title: "one" };
    const { result, rerender } = renderHook(({ spec }) => usePreviewRender(spec, false), {
      initialProps: { spec: first },
    });
    await waitFor(() => expect(result.current.preview).toBe("data:image/png;base64,img1"));

    rerender({ spec: { dataset, title: "two" } });
    await waitFor(() => expect(result.current.preview).toBe("data:image/png;base64,img2"));

    expect(sent[0].body.dataset).toEqual(dataset);
    expect(sent[1].body.dataset).toBeUndefined();
    expect(sent[1].body.dataset_handle).toBe("h-preview");
    expect(sent[1].body.title).toBe("two");
  });

  it("aborts a superseded in-flight preview and never shows its picture", async () => {
    const sent: Sent[] = [];
    let releaseFirst: () => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((_path: string, init: RequestInit) => {
        sent.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, signal: init.signal });
        if (sent.length === 1) {
          // The stale render: held open until the test releases it, as a
          // render queued behind the server's render lock would be.
          return new Promise<Response>((resolve) => {
            releaseFirst = () => resolve(hitmapResponse("stale"));
          });
        }
        return Promise.resolve(hitmapResponse("fresh"));
      }),
    );
    const { result, rerender } = renderHook(({ spec }) => usePreviewRender(spec, false), {
      initialProps: { spec: { dataset, title: "one" } as FigureSpec },
    });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].signal?.aborted).toBe(false);

    rerender({ spec: { dataset, title: "two" } });
    expect(sent[0].signal?.aborted).toBe(true);

    await waitFor(() => expect(result.current.preview).toBe("data:image/png;base64,fresh"));
    releaseFirst();
    await Promise.resolve();
    expect(result.current.preview).toBe("data:image/png;base64,fresh");
    expect(result.current.error).toBeNull();
  });

  it("aborts the in-flight preview on unmount", async () => {
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_path: string, init: RequestInit) => {
        sent.push({ body: JSON.parse(String(init.body)) as Record<string, unknown>, signal: init.signal });
        return new Promise<Response>(() => {});
      }),
    );
    const { unmount } = renderHook(() => usePreviewRender({ dataset, title: "one" }, false));
    await waitFor(() => expect(sent).toHaveLength(1));
    unmount();
    expect(sent[0].signal?.aborted).toBe(true);
  });
});

// UX-H review item 12: the preview renders at previewDpiFor(spec) — never the
// export's own `spec.dpi` — and reports the resolution of the picture it shows.
describe("usePreviewRender resolution (UX-H)", () => {
  it("sends previewDpiFor(spec), not spec.dpi, and reports that dpi with the picture", async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_path: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return hitmapResponse(`img${sent.length}`);
      }),
    );
    const spec: FigureSpec = { dataset, style: "aps", dpi: 600 };
    const { result } = renderHook(() => usePreviewRender(spec, false));
    expect(result.current.previewDpi).toBeNull();
    await waitFor(() => expect(result.current.preview).toBe("data:image/png;base64,img1"));
    expect(sent[0].dpi).toBe(previewDpiFor(spec, window.devicePixelRatio));
    expect(sent[0].dpi).not.toBe(600);
    expect(result.current.previewDpi).toBe(sent[0].dpi);
  });

  it("pins the Stage's auto-legend corner only when asked (a session on the focused window)", async () => {
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return hitmapResponse(`img${sent.length}`);
    }));
    const stage = document.createElement("div");
    stage.className = "qzk-stage";
    stage.dataset.lc = "ne";
    stage.innerHTML = '<div class="qzk-legend auto"></div>';
    document.body.append(stage);
    const spec = { dataset, overrides: { legend: { loc: "auto" } } } as unknown as FigureSpec;
    const { result, rerender } = renderHook(({ pin }) => usePreviewRender(spec, true, pin), { initialProps: { pin: false } });
    await waitFor(() => expect(result.current.preview).toBe("data:image/png;base64,img1"));
    rerender({ pin: true });
    await waitFor(() => expect(result.current.preview).toBe("data:image/png;base64,img2"));
    stage.remove();
    const loc = (s: Record<string, unknown>) => (s.overrides as { legend: { loc: string } }).legend.loc;
    expect(loc(sent[0])).toBe("auto");
    expect(loc(sent[1])).not.toBe("auto");
  });
});
