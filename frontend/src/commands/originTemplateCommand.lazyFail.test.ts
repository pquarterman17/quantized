// File ▸ "Import Origin template…" opens its picker in the click's own task
// and loads the upload client (lib/originTemplate.ts) only once files come
// back (bundle diet slice 21, plans/BUNDLE_HEADROOM.md). A cancel loads
// nothing; a client that will not load is toasted and imports nothing; the
// next pick retries the load. Its own file because `vi.doMock` must be
// registered before the client's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAppActions } from "../appCommands";
import { loadGraphTemplates } from "../lib/figuredoc";
import { openFilePicker } from "../lib/openFilePicker";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";

vi.mock("../lib/openFilePicker", () => ({ IMPORT_ACCEPT: ".dat", openFilePicker: vi.fn() }));

const WIRE = { name: "SLD_DoubleY", style: "default", overrides: null, seriesStyles: null };

/** Run the command and return what the picker was opened with. */
function openPicker(): { onPick: (files: File[]) => void; accept: string } {
  const action = buildAppActions(useApp.getState).find((a) => a.id === "import-origin-template");
  if (!action) throw new Error("import-origin-template not registered");
  vi.mocked(openFilePicker).mockClear();
  void action.run();
  expect(openFilePicker).toHaveBeenCalledTimes(1);
  const [onPick, accept] = vi.mocked(openFilePicker).mock.calls[0];
  return { onPick, accept: accept ?? "" };
}

const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);
const templateNames = () => loadGraphTemplates().map((t) => t.name);

beforeEach(() => {
  localStorage.clear();
  useToasts.setState({ toasts: [] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(WIRE) }));
});

afterEach(() => {
  vi.doUnmock("../lib/originTemplate");
  vi.unstubAllGlobals();
});

describe("Import Origin template: the upload client loads after the pick", () => {
  it("opens the template picker synchronously and imports the picked file", async () => {
    const { onPick, accept } = openPicker();
    expect(accept).toBe(".otp,.otpu");

    onPick([new File(["b"], "SLD_DoubleY.otp")]);

    await vi.waitFor(() => expect(templateNames()).toEqual(["SLD_DoubleY"]));
    expect(dangerToasts()).toEqual([]);
  });

  it("loads nothing and imports nothing when the picker is cancelled", async () => {
    const factory = vi.fn(() => {
      throw new Error("must not load on cancel");
    });
    vi.doMock("../lib/originTemplate", factory);

    openPicker().onPick([]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(factory).not.toHaveBeenCalled();
    expect(templateNames()).toEqual([]);
    expect(dangerToasts()).toEqual([]);
  });

  it("reports a client that will not load and imports nothing", async () => {
    vi.doMock("../lib/originTemplate", () => {
      throw new Error("network error");
    });

    openPicker().onPick([new File(["b"], "SLD_DoubleY.otp")]);

    await vi.waitFor(() => expect(dangerToasts()).toEqual([expect.stringMatching(/^Could not load the template import: .+/)]));
    expect(templateNames()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retries the load on the next pick instead of staying broken", async () => {
    vi.doMock("../lib/originTemplate", () => {
      throw new Error("network error");
    });
    openPicker().onPick([new File(["b"], "SLD_DoubleY.otp")]);
    await vi.waitFor(() => expect(dangerToasts()).toHaveLength(1));

    // A rejected dynamic import is not cached, so the next pick refetches.
    vi.doUnmock("../lib/originTemplate");
    vi.resetModules();
    openPicker().onPick([new File(["b"], "SLD_DoubleY.otp")]);
    await vi.waitFor(() => expect(templateNames()).toEqual(["SLD_DoubleY"]));
  });
});
