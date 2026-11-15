// Audit-6 lane O: browser Save in place through the File System Access API.
// A fake in-memory file handle stands in for Chromium's; with no API (Firefox,
// jsdom) the download fallback must be unchanged apart from its file name.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commitOpened, resetBrowserFile } from "../lib/browserFileHandle";
import { saveBlob } from "../lib/download";
import { useApp } from "./useApp";
import { useToasts } from "./toasts";

vi.mock("../lib/download", () => ({ saveBlob: vi.fn() }));

class FakeFile {
  content = "";
  mtime = 1000;
  permission: PermissionState = "granted";
  /** Edit the file behind the app's back. */
  externalEdit(text: string): void {
    this.content = text;
    this.mtime += 5;
  }
  pending = "";
  handle = (name: string) => ({
    name,
    getFile: () => Promise.resolve({ lastModified: this.mtime, size: this.content.length } as File),
    createWritable: () =>
      Promise.resolve({
        write: (d: string) => {
          this.pending = d;
          return Promise.resolve();
        },
        close: () => {
          this.content = this.pending;
          this.mtime += 1;
          return Promise.resolve();
        },
      }),
    queryPermission: () => Promise.resolve(this.permission),
    requestPermission: () => Promise.resolve(this.permission),
  });
}

type Picker = ReturnType<typeof vi.fn>;
const win = window as unknown as { showSaveFilePicker?: Picker };

function installPicker(...files: [FakeFile, string][]): Picker {
  const picker = vi.fn();
  for (const [file, name] of files) picker.mockResolvedValueOnce(file.handle(name));
  win.showSaveFilePicker = picker;
  return picker;
}

const names = () => useApp.getState().datasets.map((d) => d.name);

beforeEach(() => {
  vi.clearAllMocks();
  resetBrowserFile();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [{ id: "a", name: "first.dat", data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } }],
    activeId: "a",
    plotWindows: [],
    focusedWindowId: null,
    currentProject: null,
    projectDirty: false,
  });
});

afterEach(() => {
  delete win.showSaveFilePicker;
});

describe("browser Save in place (File System Access API)", () => {
  it("the first Save asks where; the second Ctrl+S overwrites the SAME file with no new picker", async () => {
    const file = new FakeFile();
    const picker = installPicker([file, "run7.dwk"]);
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledOnce();
    expect(picker.mock.calls[0][0].suggestedName).toBe("workspace.dwk");
    expect(names()).toEqual(["first.dat"]);
    expect(file.content).toContain("first.dat");

    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0], name: "second.dat" }] });
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledOnce();
    expect(file.content).toContain("second.dat");
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("Save As (Ctrl+Shift+S) always asks, even with a kept handle, and keeps the new one", async () => {
    const one = new FakeFile();
    const two = new FakeFile();
    const picker = installPicker([one, "a.dwk"], [two, "b.dwk"]);
    await useApp.getState().saveWorkspace();
    await useApp.getState().saveWorkspaceToFile();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker.mock.calls[1][0].suggestedName).toBe("a.dwk");
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0], name: "later.dat" }] });
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(two.content).toContain("later.dat");
    expect(one.content).not.toContain("later.dat");
  });

  it("a cancelled picker neither downloads nor reports a save", async () => {
    const picker = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
    win.showSaveFilePicker = picker;
    await useApp.getState().saveWorkspace();
    expect(saveBlob).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("fails closed when the file was changed outside: it is not overwritten, the picker re-prompts", async () => {
    const file = new FakeFile();
    const fresh = new FakeFile();
    const picker = installPicker([file, "run7.dwk"], [fresh, "run7-copy.dwk"]);
    await useApp.getState().saveWorkspace();
    file.externalEdit("SOMEONE ELSE'S WORK");
    await useApp.getState().saveWorkspace();
    expect(file.content).toBe("SOMEONE ELSE'S WORK");
    expect(picker).toHaveBeenCalledTimes(2);
    expect(fresh.content).toContain("first.dat");
    expect(useApp.getState().status).toContain("run7-copy.dwk");
  });

  it("fails closed when write permission was revoked: nothing written, picker re-prompts", async () => {
    const file = new FakeFile();
    const fresh = new FakeFile();
    const picker = installPicker([file, "run7.dwk"], [fresh, "other.dwk"]);
    await useApp.getState().saveWorkspace();
    const saved = file.content;
    file.permission = "denied";
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0], name: "after.dat" }] });
    await useApp.getState().saveWorkspace();
    expect(file.content).toBe(saved);
    expect(picker).toHaveBeenCalledTimes(2);
    expect(fresh.content).toContain("after.dat");
  });

  it("opening another workspace drops the kept handle (it names the OLD file)", async () => {
    const one = new FakeFile();
    const two = new FakeFile();
    const picker = installPicker([one, "old.dwk"], [two, "x.dwk"]);
    await useApp.getState().saveWorkspace();
    commitOpened("opened.dwk");
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker.mock.calls[1][0].suggestedName).toBe("opened.dwk");
    expect(one.content).not.toContain("opened");
  });
});

describe("browser Save with no File System Access API (download fallback)", () => {
  it("is named workspace.dwk when nothing was opened", async () => {
    await useApp.getState().saveWorkspaceToFile();
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("workspace.dwk");
  });

  it("is named after the opened file", async () => {
    commitOpened("Fe3O4_series.dwk");
    await useApp.getState().saveWorkspaceToFile();
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("Fe3O4_series.dwk");
  });


  it("Ctrl+S downloads again each time (no handle to reuse)", async () => {
    await useApp.getState().saveWorkspace();
    await useApp.getState().saveWorkspace();
    expect(saveBlob).toHaveBeenCalledTimes(2);
  });
});
