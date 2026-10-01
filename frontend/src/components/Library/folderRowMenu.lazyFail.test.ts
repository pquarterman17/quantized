// Silent-failure audit (2026-10-01): the folder row's context-menu actions
// loaded folderOps through a bare `import("./folderOps").then(...)`, so a
// failed chunk load (a stale hash after a deploy, offline) made Properties,
// Export, Apply corrections, Run template and Delete-with-datasets silent
// no-ops. MultiSelectBar's Export over the same chunk already went through
// runLazy; these now do too. Its own file because the failing module mock
// would break every other folder-menu test.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { folderBulkActions, folderCoreActions, type FolderActionTarget } from "./folderRowMenu";
import { usePendingOps } from "../../store/pendingOps";
import { useToasts } from "../../store/toasts";

vi.mock("./folderOps", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

const target: FolderActionTarget = {
  folder: { id: "f", name: "grp", parentId: null, order: 0 },
  count: 2,
  onRename: () => {},
  onExpand: () => {},
};

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  usePendingOps.setState({ ops: [] });
});

describe("folder row actions when the folderOps chunk fails to load", () => {
  it.each(["folder.properties", "folder.exportCsv"])("%s shows the standard error toast", async (id) => {
    const action = [...folderCoreActions, ...folderBulkActions].find((a) => a.id === id)!;
    action.run(target);
    await vi.waitFor(() =>
      expect(useToasts.getState().toasts.map((t) => [t.kind, t.msg])).toEqual([
        ["danger", expect.stringMatching(/^Could not load the folder actions: /)],
      ]),
    );
    expect(usePendingOps.getState().ops).toEqual([]);
  });
});
