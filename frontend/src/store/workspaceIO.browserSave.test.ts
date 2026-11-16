// Audit-6 lane O: browser Save in place through the File System Access API.
// A fake in-memory file handle stands in for Chromium's; with no API (Firefox,
// jsdom) the download fallback must be unchanged apart from its file name.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commitOpened, hasSaveHandle, resetBrowserFile } from "../lib/browserFileHandle";
import { saveBlob } from "../lib/download";
import { useApp } from "./useApp";
import { useToasts } from "./toasts";

vi.mock("../lib/download", () => ({ saveBlob: vi.fn() }));

class FakeFile {
  content = "";
  mtime = 1000;
  pending = "";
  writes = 0;
  permission: PermissionState = "granted";
  requestThrows = false;
  failWrite = false;
  getFileThrows = false;
  /** getFile starts throwing once a write has closed (the stamp read-back fails). */
  getFileThrowsAfterWrite = false;
  /** Park close() until releaseClose() (an in-flight write). */
  holdClose = false;
  closeWaiters: (() => void)[] = [];
  releaseClose = () => this.closeWaiters.splice(0).forEach((f) => f());
  /** Edit the file behind the app's back. */
  externalEdit(text: string): void {
    this.content = text;
    this.mtime += 5;
  }
  handle = (name: string) => ({
    name,
    getFile: () => {
      if (this.getFileThrows || (this.getFileThrowsAfterWrite && this.writes > 0)) return Promise.reject(new Error("gone"));
      return Promise.resolve({ lastModified: this.mtime, size: this.content.length } as File);
    },
    createWritable: () => {
      if (this.failWrite) return Promise.reject(new Error("disk full"));
      return Promise.resolve({
        write: (d: string) => {
          this.pending = d;
          return Promise.resolve();
        },
        close: () => {
          const finish = () => {
            this.content = this.pending;
            this.mtime += 1;
            this.writes += 1;
          };
          if (!this.holdClose) {
            finish();
            return Promise.resolve();
          }
          return new Promise<void>((r) => this.closeWaiters.push(() => (finish(), r())));
        },
      });
    },
    queryPermission: () => Promise.resolve(this.permission),
    requestPermission: () => (this.requestThrows ? Promise.reject(new Error("SecurityError")) : Promise.resolve(this.permission)),
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

const gestureError = () => Object.assign(new Error("User activation is required to show a file picker"), { name: "SecurityError" });
const names = () => useApp.getState().datasets.map((d) => d.name);
const dataset = (name: string) => ({ id: name, name, data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } });
/** A minimal replacement workspace, the shape clearAll hands loadWorkspace. */
const wsWith = (name: string) => ({
  datasets: [dataset(name)],
  folders: [],
  activeId: name,
  selectedIds: [],
  expandedFolders: [],
  originFigures: [],
  originFidelity: [],
  reports: [],
  figureDocs: [],
  editableFigures: [],
});
/** File > Open: an undoable replace of the whole workspace. */
const openWorkspace = (name: string) => {
  useApp.getState().recordHistory("open workspace");
  useApp.getState().loadWorkspace(wsWith(name));
};
const rename = (name: string) => useApp.setState({ datasets: [{ ...useApp.getState().datasets[0], name }] });
const toastText = () => useToasts.getState().toasts.map((t) => t.msg).join(" | ");

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
    expect(file.content).toContain("first.dat");

    rename("second.dat");
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledOnce();
    expect(file.content).toContain("second.dat");
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("marks the workspace clean after a successful save", async () => {
    installPicker([new FakeFile(), "a.dwk"]);
    useApp.setState({ projectDirty: true });
    await useApp.getState().saveWorkspace();
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("writes the same serializer output: a workspace with a gated (v6) feature stays version 6", async () => {
    const file = new FakeFile();
    installPicker([file, "a.dwk"]);
    await useApp.getState().saveWorkspace();
    expect((JSON.parse(file.content) as { version: number }).version).toBeLessThan(6);
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0], hiddenCols: [0] }] });
    await useApp.getState().saveWorkspace(); // in place
    expect((JSON.parse(file.content) as { version: number }).version).toBe(6);
  });

  it("Save As (Ctrl+Shift+S) always asks, even with a kept handle, and keeps the new one", async () => {
    const one = new FakeFile();
    const two = new FakeFile();
    const picker = installPicker([one, "a.dwk"], [two, "b.dwk"]);
    await useApp.getState().saveWorkspace();
    await useApp.getState().saveWorkspaceToFile();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker.mock.calls[1][0].suggestedName).toBe("a.dwk");
    rename("later.dat");
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(two.content).toContain("later.dat");
    expect(one.content).not.toContain("later.dat");
  });

  it("a cancelled picker neither downloads nor reports a save", async () => {
    win.showSaveFilePicker = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
    await useApp.getState().saveWorkspace();
    expect(saveBlob).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("two saves started together are one write (a held Ctrl+S / double press)", async () => {
    const file = new FakeFile();
    const picker = installPicker([file, "a.dwk"]);
    await useApp.getState().saveWorkspace();
    const before = file.writes;
    await Promise.all([useApp.getState().saveWorkspace(), useApp.getState().saveWorkspace(), useApp.getState().saveWorkspace()]);
    expect(file.writes).toBe(before + 1);
    expect(picker).toHaveBeenCalledOnce();
  });

  it("the stamp is refreshed after each write: consecutive saves never cry 'changed outside'", async () => {
    const file = new FakeFile();
    const picker = installPicker([file, "a.dwk"]);
    for (let i = 0; i < 4; i++) {
      rename(`n${i}.dat`);
      await useApp.getState().saveWorkspace();
    }
    expect(picker).toHaveBeenCalledOnce();
    expect(file.writes).toBe(4);
  });
});

describe("browser Save fails closed", () => {
  it("file changed outside: not overwritten, picker re-prompts", async () => {
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
    expect(toastText()).toContain("changed outside Quantized");
  });

  it("changed outside AND the re-prompt is refused: reports it, downloads under the user's file name", async () => {
    const file = new FakeFile();
    win.showSaveFilePicker = vi.fn().mockResolvedValueOnce(file.handle("run7.dwk")).mockRejectedValueOnce(gestureError());
    await useApp.getState().saveWorkspace();
    file.externalEdit("SOMEONE ELSE'S WORK");
    await useApp.getState().saveWorkspace();
    expect(file.content).toBe("SOMEONE ELSE'S WORK");
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("run7.dwk");
    expect(toastText()).toContain("changed outside Quantized");
    expect(useApp.getState().status).toMatch(/saved workspace/);
  });

  it("permission revoked: nothing written, picker re-prompts", async () => {
    const file = new FakeFile();
    const fresh = new FakeFile();
    const picker = installPicker([file, "run7.dwk"], [fresh, "other.dwk"]);
    await useApp.getState().saveWorkspace();
    const saved = file.content;
    file.permission = "denied";
    rename("after.dat");
    await useApp.getState().saveWorkspace();
    expect(file.content).toBe(saved);
    expect(picker).toHaveBeenCalledTimes(2);
    expect(fresh.content).toContain("after.dat");
  });

  it("a permission request that throws (expired gesture) keeps the handle: no picker, no download, retry works", async () => {
    const file = new FakeFile();
    const picker = installPicker([file, "run7.dwk"]);
    await useApp.getState().saveWorkspace();
    file.permission = "prompt";
    file.requestThrows = true;
    await useApp.getState().saveWorkspace();
    expect(useApp.getState().status).toMatch(/press Ctrl\+S again/);
    expect(picker).toHaveBeenCalledOnce();
    expect(saveBlob).not.toHaveBeenCalled();
    expect(hasSaveHandle()).toBe(true);
    file.permission = "granted";
    file.requestThrows = false;
    rename("retry.dat");
    await useApp.getState().saveWorkspace();
    expect(file.content).toContain("retry.dat");
  });

  it("file moved or deleted: not recreated silently, picker re-prompts", async () => {
    const file = new FakeFile();
    const fresh = new FakeFile();
    const picker = installPicker([file, "run7.dwk"], [fresh, "elsewhere.dwk"]);
    await useApp.getState().saveWorkspace();
    const writes = file.writes;
    file.getFileThrows = true;
    await useApp.getState().saveWorkspace();
    expect(file.writes).toBe(writes);
    expect(picker).toHaveBeenCalledTimes(2);
    expect(toastText()).toContain("moved or deleted");
  });

  it("a failed write is reported, keeps the previous file and downloads nothing", async () => {
    const file = new FakeFile();
    installPicker([file, "run7.dwk"]);
    await useApp.getState().saveWorkspace();
    const saved = file.content;
    file.failWrite = true;
    rename("lost.dat");
    await useApp.getState().saveWorkspace();
    expect(file.content).toBe(saved);
    expect(useApp.getState().status).toMatch(/save failed — disk full; the previous file was not replaced/);
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("a write that landed but cannot be verified says so and does not claim nothing changed", async () => {
    const file = new FakeFile();
    const fresh = new FakeFile();
    file.getFileThrowsAfterWrite = true;
    const picker = installPicker([file, "run7.dwk"], [fresh, "next.dwk"]);
    await useApp.getState().saveWorkspace();
    expect(file.content).toContain("first.dat");
    expect(useApp.getState().status).toMatch(/saved workspace.*could not be re-read.*next save will ask where/);
    expect(useApp.getState().status).not.toMatch(/not replaced/);
    await useApp.getState().saveWorkspace(); // the handle was dropped: asks again
    expect(picker).toHaveBeenCalledTimes(2);
  });

  it("Save As with a picker refused for lack of a gesture still saves, as a download", async () => {
    win.showSaveFilePicker = vi.fn().mockRejectedValue(gestureError());
    await useApp.getState().saveWorkspaceToFile();
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("workspace.dwk");
    expect(useApp.getState().status).toMatch(/saved workspace/);
  });
});

describe("the kept file belongs to one document", () => {
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

  it("Remove all drops it: the next Ctrl+S asks instead of overwriting the old project with new work", async () => {
    const one = new FakeFile();
    const two = new FakeFile();
    const picker = installPicker([one, "A.dwk"], [two, "B.dwk"]);
    await useApp.getState().saveWorkspace();
    const projectA = one.content;
    useApp.getState().clearAll();
    useApp.getState().addDataset(dataset("unrelated.dat"));
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(one.content).toBe(projectA);
    expect(two.content).toContain("unrelated.dat");
  });

  it("Remove all in a session with no datasets still starts a new document", async () => {
    const one = new FakeFile();
    const two = new FakeFile();
    const picker = installPicker([one, "P.dwk"], [two, "Q.dwk"]);
    await useApp.getState().saveWorkspace();
    const projectP = one.content;
    useApp.setState({ datasets: [], activeId: null }); // the datasets were deleted one by one
    useApp.getState().clearAll(); // [] -> []: no emptiness transition to notice
    useApp.getState().addDataset(dataset("csv.dat"));
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(one.content).toBe(projectP);
  });

  it("Remove all then Undo gives the document back: Ctrl+S saves in place, no re-prompt, name kept", async () => {
    const one = new FakeFile();
    const picker = installPicker([one, "A.dwk"]);
    await useApp.getState().saveWorkspace();
    useApp.getState().clearAll();
    useApp.getState().undo();
    expect(names()).toEqual(["first.dat"]);
    rename("edited.dat");
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledOnce();
    expect(one.content).toContain("edited.dat");
  });

  it("undoing an Open must not let Ctrl+S write the old workspace over the opened file", async () => {
    const opened = new FakeFile();
    const picker = installPicker([opened, "B.dwk"], [new FakeFile(), "other.dwk"]);
    openWorkspace("b.dat");
    await useApp.getState().saveWorkspace(); // Save As B.dwk: contains b.dat
    expect(opened.content).toContain("b.dat");
    useApp.getState().undo(); // back to first.dat
    expect(names()).toEqual(["first.dat"]);
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(opened.content).toContain("b.dat");
    expect(opened.content).not.toContain("first.dat");
  });

  it("redoing an Open must not let Ctrl+S write the opened workspace into the other document's file", async () => {
    const t1 = new FakeFile();
    const t2 = new FakeFile();
    const picker = installPicker([t1, "T1.dwk"], [t2, "T2.dwk"], [new FakeFile(), "T3.dwk"]);
    await useApp.getState().saveWorkspace(); // X -> T1
    openWorkspace("b.dat");
    useApp.getState().undo(); // X again
    await useApp.getState().saveWorkspace(); // epoch differs from T1's? no: same document X -> in place T1
    expect(picker).toHaveBeenCalledOnce();
    await useApp.getState().saveWorkspaceToFile(); // Save As T2 under document X
    useApp.getState().redo(); // B.dat is back
    expect(names()).toEqual(["b.dat"]);
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(3);
    expect(t2.content).not.toContain("b.dat");
  });

  it("a workspace loaded directly (startup autosave restore, recovery) is a new document", async () => {
    const one = new FakeFile();
    const picker = installPicker([one, "late.dwk"], [new FakeFile(), "next.dwk"]);
    await useApp.getState().saveWorkspace();
    const saved = one.content;
    useApp.getState().loadWorkspace(wsWith("restored.dat")); // no history, no commitOpened
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(one.content).toBe(saved);
  });

  it("a save that finishes after the handle was replaced does not resurrect the old handle", async () => {
    const slow = new FakeFile();
    const next = new FakeFile();
    const picker = installPicker([slow, "slow.dwk"], [next, "next.dwk"]);
    await useApp.getState().saveWorkspace();
    slow.holdClose = true;
    const inFlight = useApp.getState().saveWorkspace(); // in-place write parked at close()
    await vi.waitFor(() => expect(slow.closeWaiters.length).toBe(1));
    resetBrowserFile(); // an Open/undo dropped the handle meanwhile
    slow.releaseClose();
    await inFlight;
    expect(hasSaveHandle()).toBe(false);
    await useApp.getState().saveWorkspace();
    expect(picker).toHaveBeenCalledTimes(2);
  });
});

describe("a failed native write on desktop", () => {
  it("never reaches the browser picker or marks the project clean", async () => {
    const picker = installPicker([new FakeFile(), "no.dwk"]);
    (globalThis as { pywebview?: unknown }).pywebview = {
      api: {
        save_file_dialog: () => Promise.resolve({ path: "/p/x.dwk" }),
        write_project_file: () => Promise.resolve({ ok: false, error: "disk full" }),
      },
    };
    useApp.setState({ projectDirty: true });
    try {
      await useApp.getState().saveWorkspaceToFile();
    } finally {
      delete (globalThis as { pywebview?: unknown }).pywebview;
    }
    expect(picker).not.toHaveBeenCalled(); // the pre-lane-O behaviour: a plain download
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(useApp.getState().projectDirty).toBe(true);
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
