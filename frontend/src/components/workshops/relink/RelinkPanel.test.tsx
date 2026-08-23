// RelinkPanel — smoke + wiring: renders per the store's open/preview state,
// and the row/commit/import-as-new-version buttons dispatch to the right
// store actions. The relink LOGIC itself (path matching, probing, atomic
// commit) is store/relink.test.ts's job; this only checks the view reflects
// that state and wires its controls correctly.

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRelink } from "../../../store/relink";
import RelinkPanel from "./RelinkPanel";

const fakeAppState = {
  datasets: [],
  toolWindowLayout: {},
  setToolWindowLayout: vi.fn(),
  toggleToolWindowCollapsed: vi.fn(),
};
function useAppMock<T>(selector: (s: typeof fakeAppState) => T): T {
  return selector(fakeAppState);
}
useAppMock.getState = () => fakeAppState;
vi.mock("../../../store/useApp", () => ({ useApp: useAppMock }));

beforeEach(() => {
  useRelink.setState({
    open: true,
    oldRoot: "",
    newRoot: "",
    preview: [],
    busy: false,
    bridgeAvailable: true,
    newRootConsented: false,
  });
});

describe("RelinkPanel", () => {
  it("renders nothing when closed", () => {
    useRelink.setState({ open: false });
    const { container } = render(<RelinkPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the old/new root inputs and updates the store on change", () => {
    render(<RelinkPanel />);
    fireEvent.change(screen.getByLabelText("Old folder (as recorded)"), {
      target: { value: "/old/data" },
    });
    fireEvent.change(screen.getByLabelText("New folder (where it moved)"), {
      target: { value: "/new/place" },
    });
    expect(useRelink.getState().oldRoot).toBe("/old/data");
    expect(useRelink.getState().newRoot).toBe("/new/place");
  });

  it("disables Relink until there is a resolved, unchanged row", () => {
    render(<RelinkPanel />);
    expect(screen.getByRole("button", { name: /^Relink\s*$/ })).toBeDisabled();

    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/a.csv",
          candidatePath: "/new/a.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: null,
          candidateMtime: null,
          candidateSize: null,
        },
      ],
    });
    render(<RelinkPanel />);
    expect(screen.getAllByRole("button", { name: /^Relink 1$/ })[0]).toBeEnabled();
  });

  // P1-2 defect 2b/2c (RED-FIRST): the pre-fix panel rendered an "unknown"
  // row IDENTICALLY to a verified "unchanged" one — no visual distinction,
  // no way to tell a user "this one still needs verification" from "this
  // one is fine". It must render distinctly (a "needs verification" label,
  // a distinct color token) and offer a per-row escalation.
  it("renders an 'unknown' row distinctly (needs-verification wording) and excludes it from the Relink count", () => {
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/a.csv",
          candidatePath: "/new/a.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: null,
          candidateSize: null,
        },
        {
          datasetId: "b",
          datasetName: "b.csv",
          oldPath: "/old/b.csv",
          candidatePath: "/new/b.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:b",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    render(<RelinkPanel />);

    // Only the "unchanged" row counts toward the committable total.
    expect(screen.getByRole("button", { name: /^Relink 1$/ })).toBeEnabled();
    expect(screen.getByText(/could not verify/i)).toBeInTheDocument();
  });

  it("a per-row 'use anyway' action escalates ONLY that row (per-row consent, not a global bypass)", () => {
    const spy = vi.fn();
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/a.csv",
          candidatePath: "/new/a.csv",
          status: "resolved",
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: null,
          candidateSize: null,
        },
      ],
      escalateUnknownRow: spy,
    });
    render(<RelinkPanel />);
    fireEvent.click(screen.getByRole("button", { name: /use anyway/i }));
    expect(spy).toHaveBeenCalledWith("a");
  });

  it("offers 'Import as new version' only for a changed row, and it calls the store action", () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/a.csv",
          candidatePath: "/new/a.csv",
          status: "resolved",
          changeVerdict: "changed",
          candidateChecksum: "sha256:new",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
      importChangedAsNewVersion: spy,
    });
    render(<RelinkPanel />);
    const btn = screen.getByText("Import as new version");
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledWith("a");
  });

  // C1: the required one-sentence explanation the contract quotes verbatim.
  it("shows the old/new-root explanation sentence", () => {
    render(<RelinkPanel />);
    expect(
      screen.getByText(
        "Files under the old location will be looked up under the new location; nothing changes until you choose Relink.",
      ),
    ).toBeInTheDocument();
  });

  describe("Browse… (C1 native folder grant)", () => {
    // The BEHAVIOR behind Browse… (a real dialog mints the grant, cancel
    // changes nothing, typing never does) is store/relink.test.ts's job —
    // this only checks the button is wired to the store's `browseNewRoot`
    // action, the same "spy on the action" convention every other control
    // in this file uses.
    it("Browse… calls the store's browseNewRoot action", () => {
      const spy = vi.fn().mockResolvedValue(undefined);
      useRelink.setState({ browseNewRoot: spy });
      render(<RelinkPanel />);
      fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
      expect(spy).toHaveBeenCalledOnce();
    });

    it("Browse… is disabled without a desktop bridge", () => {
      useRelink.setState({ bridgeAvailable: false });
      render(<RelinkPanel />);
      expect(screen.getByRole("button", { name: "Browse…" })).toBeDisabled();
    });

    it("a typed (unconsented) New folder shows 'Choose folder to verify'", () => {
      render(<RelinkPanel />);
      fireEvent.change(screen.getByLabelText("New folder (where it moved)"), {
        target: { value: "/typed/path" },
      });
      expect(screen.getByText(/Choose folder to verify/)).toBeInTheDocument();
    });

    it("a consented (Browse…-picked) New folder does NOT show 'Choose folder to verify'", () => {
      useRelink.setState({ newRoot: "/new/place", newRootConsented: true });
      render(<RelinkPanel />);
      expect(screen.queryByText(/Choose folder to verify/)).not.toBeInTheDocument();
    });

    it("a typed New folder with a non-empty preview shows the stat-only/unverified banner", () => {
      useRelink.setState({
        newRoot: "/typed/path",
        newRootConsented: false,
        preview: [
          {
            datasetId: "a",
            datasetName: "a.csv",
            oldPath: "/old/a.csv",
            candidatePath: "/typed/path/a.csv",
            status: "resolved",
            changeVerdict: "unchanged",
            candidateChecksum: null,
            candidateMtime: 1,
            candidateSize: 1,
          },
        ],
      });
      render(<RelinkPanel />);
      expect(screen.getByText(/unverified/i)).toBeInTheDocument();
    });

    it("the unverified banner does not appear once the folder was chosen via Browse…", () => {
      useRelink.setState({
        newRoot: "/new/place",
        newRootConsented: true,
        preview: [
          {
            datasetId: "a",
            datasetName: "a.csv",
            oldPath: "/old/a.csv",
            candidatePath: "/new/place/a.csv",
            status: "resolved",
            changeVerdict: "unchanged",
            candidateChecksum: "sha256:a",
            candidateMtime: 1,
            candidateSize: 1,
          },
        ],
      });
      render(<RelinkPanel />);
      expect(screen.queryByText(/unverified/i)).not.toBeInTheDocument();
    });
  });

  describe("Cancel (C1 revocation)", () => {
    it("calls the store's closePanel action (revokes consent, zero mutation) — never Relink's commit", () => {
      const closeSpy = vi.fn();
      const commitSpy = vi.fn().mockResolvedValue(undefined);
      useRelink.setState({ newRoot: "/new/place", newRootConsented: true, closePanel: closeSpy, commit: commitSpy });
      render(<RelinkPanel />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(closeSpy).toHaveBeenCalledOnce();
      expect(commitSpy).not.toHaveBeenCalled();
      expect(fakeAppState.datasets).toEqual([]); // zero mutation
    });
  });

  it("plain-language row labels: 'Verified identical' for a resolved, unchanged row", () => {
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/a.csv",
          candidatePath: "/new/a.csv",
          status: "resolved",
          changeVerdict: "unchanged",
          candidateChecksum: "sha256:a",
          candidateMtime: 1,
          candidateSize: 1,
        },
      ],
    });
    render(<RelinkPanel />);
    expect(screen.getByText("Verified identical")).toBeInTheDocument();
  });

  it.each([
    ["missing", "Missing"],
    ["offline", "Offline (volume unreachable)"],
    ["permission_denied", "Permission denied"],
  ] as const)("plain-language row label for status %s", (status, label) => {
    useRelink.setState({
      preview: [
        {
          datasetId: "a",
          datasetName: "a.csv",
          oldPath: "/old/a.csv",
          candidatePath: "/new/a.csv",
          status,
          changeVerdict: "unknown",
          candidateChecksum: null,
          candidateMtime: null,
          candidateSize: null,
        },
      ],
    });
    render(<RelinkPanel />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
