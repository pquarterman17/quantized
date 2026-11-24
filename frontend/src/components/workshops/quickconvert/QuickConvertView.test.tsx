// The Quick Convert window against a fake backend (lib/api/convertQuick is
// mocked): guessed type / format / status per file, the three options and their
// defaults (folder = next to each input, format = Auto, overwrite = off),
// per-file errors in words, dropped files needing a folder, the chooser's Esc.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConvertEntry, ConvertResult, FilePreview } from "../../../lib/api/convertQuick";
import QuickConvertView from "./QuickConvertView";

const api = vi.hoisted(() => ({
  convertConfig: vi.fn(),
  convertPreview: vi.fn(),
  startConvert: vi.fn(),
  convertJob: vi.fn(),
  convertJobResult: vi.fn(),
  cancelConvert: vi.fn(),
  stageConvertFile: vi.fn(),
  browseFolder: vi.fn(),
}));
vi.mock("../../../lib/api/convertQuick", () => api);

const FORMATS = ["csv", "xlsx", "xy", "h5", "nxs", "mat", "json", "npz"].map((id) => ({
  id, label: `Fmt ${id}`, container: ["xlsx", "h5", "nxs", "mat", "json", "npz"].includes(id),
}));

function preview(path: string, over: Partial<FilePreview> = {}): FilePreview {
  const name = path.split("/").pop() ?? path;
  return {
    path, name, staged: false, kind: "import_xrdml", kind_label: "PANalytical / Malvern XRDML", technique: "xrd.powder",
    format: "xy", format_source: "default (provisional, owner to confirm)",
    datasets: [{ name: "Scan1", rows: 1801, is_map: false, columns: [{ name: "2-Theta", unit: "deg" }, { name: "Intensity", unit: "cps" }] }],
    outputs: [`${name}.xy`], existing: [], notes: [], error: null, ...over,
  };
}
const entry = (source: string, over: Partial<ConvertEntry> = {}): ConvertEntry => ({
  source, format: "xy", status: "ok", outcome: "done", reason: null, error: null,
  outputs: [`${source.split("/").pop()}.xy`], notes: [], omissions: [], books: [], ...over,
});

let lastPreviewReq: { paths: string[]; out_dir: string | null; format: string } | null = null;
function wire(opts: { prefill?: string[]; previews?: Record<string, Partial<FilePreview>>; entries?: ConvertEntry[] } = {}) {
  api.convertConfig.mockResolvedValue({ formats: FORMATS, prefill: opts.prefill ?? [], home: "/home/u" });
  api.convertPreview.mockImplementation(async (req: { paths: string[]; out_dir: string | null; format: string }) => {
    lastPreviewReq = req;
    return {
      out_dir_status: req.out_dir ? "will_be_created" : "same",
      files: req.paths.map((p) => preview(p, opts.previews?.[p])),
    };
  });
  api.startConvert.mockResolvedValue("job1");
  api.convertJob.mockResolvedValue({ status: "done", progress: 1, message: "" });
  api.convertJobResult.mockImplementation(async (): Promise<ConvertResult> => {
    const files = opts.entries ?? [];
    return {
      report: { summary: { ok: files.filter((f) => f.status === "ok").length, partial: 0, failed: files.filter((f) => f.status === "failed").length }, files },
      report_path: "/d/convert-report-20261124-101500.json", report_error: null, cancelled: false,
    };
  });
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  lastPreviewReq = null;
});
afterEach(() => vi.useRealTimers());

const A = "/d/scan1.xrdml";
const B = "/d/run2.dat";

describe("Quick Convert view", () => {
  it("lists the launcher's files with the guessed type and format, ready to convert", async () => {
    wire({ prefill: [A, B], previews: { [B]: { kind_label: "Quantum Design magnetometry .dat", format: "csv", outputs: ["run2.dat.csv"] } } });
    render(<QuickConvertView prefill />);
    const rows = await screen.findAllByRole("listitem");
    const a = rows.find((r) => within(r).queryByText("scan1.xrdml"))!;
    await waitFor(() => expect(within(a).getByText("PANalytical / Malvern XRDML")).toBeTruthy());
    expect(within(a).getByText("Fmt xy")).toBeTruthy();
    expect(within(a).getByText(/guessed/)).toBeTruthy();
    expect(within(a).getByText(/Ready/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Convert 2 files" })).toBeEnabled();
  });

  it("starts with the safe defaults: next to the input, Auto format, overwrite off", async () => {
    wire({ prefill: [A], entries: [entry(A)] });
    render(<QuickConvertView prefill />);
    expect(screen.getByLabelText("Output folder")).toHaveValue("");
    expect(screen.getByPlaceholderText("Same folder as each input file")).toBeTruthy();
    expect((screen.getByLabelText("Output format") as HTMLSelectElement).value).toBe("auto");
    expect(screen.getByRole("checkbox", { name: /Replace existing files/ })).not.toBeChecked();
    const go = await screen.findByRole("button", { name: "Convert 1 file" });
    await waitFor(() => expect(go).toBeEnabled());
    await userEvent.click(go);
    await waitFor(() => expect(screen.getByText(/1 converted/)).toBeTruthy());
    expect(api.startConvert).toHaveBeenCalledWith({
      paths: [A], out_dir: null, format: "auto", overwrite: false, metadata: true, allow_partial: false, report: true,
    });
    expect(screen.getByText("/d/convert-report-20261124-101500.json")).toBeTruthy();
    expect(screen.getByText("Converted")).toBeTruthy();
  });

  it("offers Auto (guessed) plus every format in a qz-select", async () => {
    wire();
    render(<QuickConvertView />);
    const sel = (await screen.findByLabelText("Output format")) as HTMLSelectElement;
    expect(sel.className).toContain("qz-select");
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["Auto (guessed)", ...FORMATS.map((f) => f.label)]);
  });

  it("sends the chosen folder, format and a ticked overwrite", async () => {
    wire({ prefill: [A], entries: [entry(A)] });
    render(<QuickConvertView prefill />);
    await screen.findByText("scan1.xrdml");
    await userEvent.type(screen.getByLabelText("Output folder"), "/out/here");
    await userEvent.selectOptions(screen.getByLabelText("Output format"), "xlsx");
    await userEvent.click(screen.getByRole("checkbox", { name: /Replace existing files/ }));
    await waitFor(() => expect(lastPreviewReq).toMatchObject({ out_dir: "/out/here", format: "xlsx" }));
    expect(await screen.findByText(/does not exist yet; it will be created/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Convert 1 file" }));
    await waitFor(() => expect(api.startConvert).toHaveBeenCalled());
    expect(api.startConvert).toHaveBeenCalledWith(expect.objectContaining({ out_dir: "/out/here", format: "xlsx", overwrite: true }));
  });

  it("says, per file and in words, what cannot be converted and what already exists", async () => {
    wire({
      prefill: [A, B],
      previews: {
        [A]: { error: "ValueError: no parser registered for 'scan1.xrdml' (extension '.zzz')", kind_label: "", datasets: [], outputs: [] },
        [B]: { existing: ["run2.dat.xy"] },
      },
    });
    render(<QuickConvertView prefill />);
    expect(await screen.findByText(/does not know the \.zzz file type/)).toBeTruthy();
    expect(screen.getByText("Can’t convert")).toBeTruthy();
    expect(screen.getByText(/Output exists: will skip/)).toBeTruthy();
    // one bad file does not stop the others
    expect(screen.getByRole("button", { name: "Convert 2 files" })).toBeEnabled();
  });

  it("shows a run's per-file failures, skips and the unwritable-folder reason", async () => {
    wire({
      prefill: [A, B],
      entries: [
        entry(A, { status: "failed", outcome: "failed", outputs: [], reason: "writing failed: PermissionError: [Errno 13] Permission denied: '/ro'" }),
        entry(B, { status: "failed", outcome: "skipped-exists", outputs: [], reason: "output already exists (use --overwrite to replace it)" }),
      ],
    });
    render(<QuickConvertView prefill />);
    const go = await screen.findByRole("button", { name: "Convert 2 files" });
    await waitFor(() => expect(go).toBeEnabled());
    await userEvent.click(go);
    expect(await screen.findByText(/No permission to write there/)).toBeTruthy();
    expect(screen.getByText("Skipped: already exists")).toBeTruthy();
    expect(screen.getByText(/1 skipped \(already exist\), 1 failed/)).toBeTruthy();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("a dropped file is uploaded, and converting waits for an output folder", async () => {
    wire({ entries: [] });
    api.stageConvertFile.mockResolvedValue({ path: "/tmp/qz-convert-stage/ab/dropped.dat", name: "dropped.dat" });
    render(<QuickConvertView />);
    const zone = await screen.findByRole("group", { name: "Add files to convert" });
    const file = new File(["x"], "dropped.dat");
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"], files: [file], items: [] } });
    act(() => void zone.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(await screen.findByText("dropped.dat")).toBeTruthy();
    expect(screen.getByText("uploaded copy")).toBeTruthy();
    await waitFor(() => expect(api.stageConvertFile).toHaveBeenCalledWith(file));
    const go = await screen.findByRole("button", { name: "Convert 1 file" });
    expect(go).toBeDisabled();
    expect(screen.getAllByText(/choose an output folder|choose where the results go/i).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText("Output folder"), "/out");
    await waitFor(() => expect(go).toBeEnabled());
  });

  it("a drop outside the zone is left alone (the app's own import handles it)", async () => {
    wire();
    render(<QuickConvertView />);
    await screen.findByRole("group", { name: "Add files to convert" });
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"], files: [new File(["x"], "z.dat")], items: [] } });
    act(() => void document.body.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
    expect(api.stageConvertFile).not.toHaveBeenCalled();
  });

  it("refuses a dropped folder in words", async () => {
    wire();
    render(<QuickConvertView />);
    const zone = await screen.findByRole("group", { name: "Add files to convert" });
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    const dir = { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => ({ name: "data" }) };
    Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"], files: [], items: [dir] } });
    act(() => void zone.dispatchEvent(ev));
    expect(await screen.findByText(/Folders can’t be dropped \(data\)/)).toBeTruthy();
  });

  it("the chooser lists a folder, picks files, and Esc leaves only the chooser", async () => {
    wire();
    api.browseFolder.mockResolvedValue({
      path: "/home/u", parent: null,
      entries: [{ name: "sub", path: "/home/u/sub", is_dir: true, size: 0 }, { name: "a.dat", path: "/home/u/a.dat", is_dir: false, size: 2048 }],
    });
    render(<QuickConvertView />);
    await userEvent.click(await screen.findByRole("button", { name: "Add files…" }));
    const chooser = await screen.findByRole("group", { name: "Choose files to convert" });
    await userEvent.click(await within(chooser).findByRole("button", { name: /a\.dat/ }));
    await userEvent.click(within(chooser).getByRole("button", { name: "Add 1 file" }));
    expect(await screen.findByText("a.dat")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Choose files to convert" })).toBeNull();
    // open the folder chooser, then Esc: back to the window, nothing changed
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(await screen.findByRole("group", { name: "Choose the output folder" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Choose the output folder" })).toBeNull();
    expect(screen.getByLabelText("Output folder")).toHaveValue("");
  });

  it("the chooser's folder pick fills the output folder", async () => {
    wire();
    api.browseFolder.mockResolvedValue({ path: "/home/u/out", parent: "/home/u", entries: [] });
    render(<QuickConvertView />);
    await userEvent.click(await screen.findByRole("button", { name: "Browse…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use this folder" }));
    expect(screen.getByLabelText("Output folder")).toHaveValue("/home/u/out");
  });

  it("the folder chooser opens on home when the typed output folder does not exist yet", async () => {
    wire();
    api.browseFolder
      .mockRejectedValueOnce(new Error("cannot open /nope: No such file"))
      .mockResolvedValueOnce({ path: "/home/u", parent: null, entries: [] });
    render(<QuickConvertView />);
    await userEvent.type(await screen.findByLabelText("Output folder"), "/nope");
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(screen.getByLabelText("Folder path")).toHaveValue("/home/u"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removing a file and a stopped backend are handled", async () => {
    wire({ prefill: [A, B] });
    render(<QuickConvertView prefill />);
    await screen.findByText("scan1.xrdml");
    await userEvent.click(screen.getByRole("button", { name: "Remove scan1.xrdml" }));
    expect(screen.queryByText("scan1.xrdml")).toBeNull();
    expect(screen.getByRole("button", { name: "Convert 1 file" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));
    expect(screen.queryByText("run2.dat")).toBeNull();
  });

  it("reports an unreachable server instead of a blank window", async () => {
    api.convertConfig.mockRejectedValue(new Error("Failed to fetch"));
    render(<QuickConvertView />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not reach Quantized: Failed to fetch/);
  });

  it("every control is a real button, input or select (keyboard reachable)", async () => {
    wire({ prefill: [A] });
    const { container } = render(<QuickConvertView prefill />);
    await screen.findByText("scan1.xrdml");
    const clickables = container.querySelectorAll("[onclick], [role=button]:not(button)");
    expect(clickables.length).toBe(0);
    for (const el of container.querySelectorAll("button, input, select")) expect((el as HTMLElement).tabIndex).toBeGreaterThanOrEqual(0);
  });
});
