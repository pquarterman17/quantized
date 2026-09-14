import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TOAST_ACTION_TTL,
  TOAST_TTL,
  notificationCounts,
  notifyMigrationWarnings,
  resetNotificationCountsForTests,
  toast,
  useToasts,
} from "./toasts";

describe("toasts store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("pushes a toast with a kind and unique id", () => {
    toast("hello", "ok");
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe("hello");
    expect(toasts[0].kind).toBe("ok");
  });

  it("defaults kind to info", () => {
    toast("plain");
    expect(useToasts.getState().toasts[0].kind).toBe("info");
  });

  it("auto-dismisses after the TTL", () => {
    toast("bye");
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(TOAST_TTL + 10);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("caps the queue at 4 (drops the oldest)", () => {
    for (let i = 0; i < 6; i++) toast(`t${i}`);
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(4);
    expect(toasts.map((t) => t.msg)).toEqual(["t2", "t3", "t4", "t5"]);
  });

  it("dismiss removes a specific toast immediately", () => {
    toast("a");
    toast("b");
    const id = useToasts.getState().toasts[0].id;
    useToasts.getState().dismiss(id);
    expect(useToasts.getState().toasts.map((t) => t.msg)).toEqual(["b"]);
  });
});

describe("toast actions (PLOT_WORKFLOW_PLAN #4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("carries no action by default", () => {
    toast("plain");
    expect(useToasts.getState().toasts[0].action).toBeUndefined();
  });

  it("attaches an action label + callback when given one", () => {
    const onClick = vi.fn();
    toast("overlay?", "ok", { action: { label: "Overlay", onClick } });
    const t = useToasts.getState().toasts[0];
    expect(t.action).toEqual({ label: "Overlay", onClick });
  });

  it("uses the default TTL when no ttlMs override is given", () => {
    toast("plain");
    vi.advanceTimersByTime(TOAST_TTL - 10);
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(20);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("honors a ttlMs override (an action toast outlives the default TTL)", () => {
    toast("overlay?", "ok", { action: { label: "Overlay", onClick: vi.fn() }, ttlMs: TOAST_ACTION_TTL });
    vi.advanceTimersByTime(TOAST_TTL + 10);
    expect(useToasts.getState().toasts).toHaveLength(1); // still here — longer TTL
    vi.advanceTimersByTime(TOAST_ACTION_TTL);
    expect(useToasts.getState().toasts).toHaveLength(0); // gone — the override elapsed
  });
});

// BUG-010 review (F6/F7): the helper's own promises — "ONE toast, never one
// per warning", the "(+N more)" format, no-op on empty — had no direct test;
// every call-site test only ever passed exactly one warning. Also pins the
// review's F6 finding: this is the ONLY surface on two call sites whose
// later setStatus overwrites loadWorkspace's status-line fold, so it uses
// TOAST_ACTION_TTL (6s), not the default 1.9s, and the "info" kind — the
// same kind useWorkspaceAutosave.ts's "Recovered … check your latest edits"
// notice uses for an analogous silent-change-happened message (ToastKind has
// no dedicated "warning" value; "danger" is reserved for an outright failure,
// which a migration warning is not — the load still succeeded).
describe("notifyMigrationWarnings (BUG-010 review F6/F7)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("no warnings — no-op, no toast fired", () => {
    notifyMigrationWarnings([]);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("exactly one warning — fires it verbatim, no '(+N more)' suffix", () => {
    notifyMigrationWarnings(["skipped saved FigureDocument with unsupported version 99"]);
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toBe("skipped saved FigureDocument with unsupported version 99");
  });

  it("two or more warnings — exactly ONE toast, first warning's text plus '(+N more)'", () => {
    notifyMigrationWarnings(["a", "b", "c"]);
    const { toasts } = useToasts.getState();
    expect(toasts).toHaveLength(1); // never one toast per warning
    expect(toasts[0].msg).toBe("a (+2 more)");
  });

  it("uses the 'info' kind and TOAST_ACTION_TTL — the longer-lived, non-clobberable notice (F6)", () => {
    notifyMigrationWarnings(["a"]);
    const { toasts } = useToasts.getState();
    expect(toasts[0].kind).toBe("info");
    vi.advanceTimersByTime(TOAST_TTL + 10);
    expect(useToasts.getState().toasts).toHaveLength(1); // outlives the default TTL
    vi.advanceTimersByTime(TOAST_ACTION_TTL - TOAST_TTL);
    expect(useToasts.getState().toasts).toHaveLength(0); // gone once TOAST_ACTION_TTL elapses
  });
});

// P3.4 review round (2026-09-14, finding 1): notificationCounts() used to be
// DERIVED from a bounded {kind, at}[] ring (MARKS_MAX = 50) — a burst of
// "ok"/"info" toasts could evict an earlier "danger" one out of the window,
// so "errors" and "lastErrorAt" would silently go back to zero/null even
// though an error really had fired. These are now monotonic counters,
// incremented once per push and never trimmed, so neither figure can be
// evicted by later, unrelated traffic.
describe("notificationCounts (P3.4 diagnostics, monotonic counters)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToasts.setState({ toasts: [] });
    resetNotificationCountsForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("a danger toast survives 50 later ok toasts — still reports 1 error and a real last-error age", () => {
    toast("the thing that broke", "danger");
    vi.advanceTimersByTime(5000);
    for (let i = 0; i < 50; i++) toast(`ok ${i}`, "ok");
    const { totalCount, errorCount, lastErrorAt } = notificationCounts();
    expect(totalCount).toBe(51);
    expect(errorCount).toBe(1);
    expect(lastErrorAt).not.toBeNull();
    // The danger toast fired 5 s before the last read — a ring that evicted
    // it would report `null` here (renders "last error never" in the bundle)
    // instead of a real, non-zero age.
    expect(Date.now() - (lastErrorAt as number)).toBeGreaterThanOrEqual(5000);
  });

  it("500 pushes report a total of 500, not a windowed sample of 50", () => {
    for (let i = 0; i < 500; i++) toast(`t${i}`, "info");
    expect(notificationCounts().totalCount).toBe(500);
  });

  it("resetNotificationCountsForTests clears all three fields", () => {
    toast("x", "danger");
    resetNotificationCountsForTests();
    expect(notificationCounts()).toEqual({ totalCount: 0, errorCount: 0, lastErrorAt: null });
  });
});
