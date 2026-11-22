// Lane WB2 characterization: the equation check's timing and race contract,
// written BEFORE it moved onto useWorkbenchPreview and kept as the guard after.
// Requests are held open and answered by the test; nothing is waited out.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateEquation, type EquationValidateResult } from "../../../lib/api/curvefit";
import { useApp } from "../../../store/useApp";
import { useEquationFit } from "./useEquationFit";

vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ validateEquation: vi.fn(), fitEquation: vi.fn() }));

interface Held { equation: string; signal?: AbortSignal; ok: (params: string[]) => void; fail: (message: string) => void }
let held: Held[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  held = [];
  // A transport that ignores abort, so a superseded answer really does land.
  vi.mocked(validateEquation).mockImplementation(((equation: string, signal?: AbortSignal) =>
    new Promise<EquationValidateResult>((resolve, reject) => {
      held.push({
        equation,
        signal,
        ok: (params) => resolve({ ok: true, params }),
        fail: (m) => reject(new Error(m)),
      });
    })) as never);
  useApp.setState({ datasets: [], activeId: null, xKey: null, yKeys: null, seriesOrder: null, fitOverlay: null });
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("equation check timing and races", () => {
  it("checks 350 ms after the last keystroke, reporting 'checking' meanwhile", async () => {
    const { result } = renderHook(() => useEquationFit());
    act(() => result.current.setEquation("a*x"));
    expect(result.current.status).toBe("checking");
    tick(349);
    expect(held).toHaveLength(0);
    act(() => result.current.setEquation("a*x+b"));
    tick(349);
    expect(held).toHaveLength(0);
    tick(1);
    expect(held).toHaveLength(1);
    expect(held[0].equation).toBe("a*x+b");
    held[0].ok(["a", "b"]);
    await flush();
    expect(result.current.status).toBe("ok");
    expect(result.current.rows.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("never applies a superseded equation's late answer", async () => {
    const { result } = renderHook(() => useEquationFit());
    act(() => result.current.setEquation("a*x"));
    tick(350);
    act(() => result.current.setEquation("c*x"));
    tick(350);
    expect(held).toHaveLength(2);
    held[1].ok(["c"]);
    await flush();
    held[0].ok(["a"]); // the stale answer lands last
    await flush();
    expect(result.current.rows.map((r) => r.name)).toEqual(["c"]);
    expect(result.current.status).toBe("ok");
  });

  it("an answer that lands after the text was cleared changes nothing", async () => {
    const { result } = renderHook(() => useEquationFit());
    act(() => result.current.setEquation("a*x"));
    tick(350);
    act(() => result.current.setEquation(""));
    expect(result.current.status).toBe("idle");
    held[0].ok(["a"]);
    await flush();
    expect(result.current.status).toBe("idle");
    expect(result.current.rows).toEqual([]);
  });

  it("reports an unreachable validator as an error, then recovers on the next edit", async () => {
    const { result } = renderHook(() => useEquationFit());
    act(() => result.current.setEquation("a*x"));
    tick(350);
    held[0].fail("validation offline");
    await flush();
    expect(result.current.status).toBe("error");
    expect(result.current.validationError).toBe("validation offline");
    act(() => result.current.setEquation("a*x+1"));
    expect(result.current.status).toBe("checking");
    tick(350);
    held[1].ok(["a"]);
    await flush();
    expect(result.current.status).toBe("ok");
    expect(result.current.validationError).toBeNull();
  });

  it("aborts the check in flight on an edit and on unmount (new with the shared shell)", () => {
    const { result, unmount } = renderHook(() => useEquationFit());
    act(() => result.current.setEquation("a*x"));
    tick(350);
    expect(held[0].signal?.aborted).toBe(false);
    act(() => result.current.setEquation("a*x+b"));
    expect(held[0].signal?.aborted).toBe(true);
    tick(350);
    unmount();
    expect(held[1].signal?.aborted).toBe(true);
  });
});
