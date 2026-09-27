import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));

import { askParams } from "../components/overlays/ParamDialog";
import { useApp } from "../store/useApp";
import { promptAddFigureToReport } from "./addFigureToReport";

const askParamsMock = vi.mocked(askParams);
const addFigureToReport = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  askParamsMock.mockReset();
  addFigureToReport.mockClear();
  useApp.setState({
    reports: [{
      id: "r1", name: "Results", datasetId: null,
      report: { title: "Results", sections: [] },
    }],
    openReportId: "r1",
    addFigureToReport,
  });
});

describe("promptAddFigureToReport", () => {
  it("defaults to the open report and forwards a caption", async () => {
    askParamsMock.mockResolvedValueOnce({ destination: "Results", caption: "Panel A" });

    await expect(promptAddFigureToReport(
      { kind: "library", figureId: "f1" }, "Loop",
    )).resolves.toBe(true);

    expect(askParamsMock.mock.calls[0][1][0]).toMatchObject({ default: "Results" });
    expect(addFigureToReport).toHaveBeenCalledWith(
      { kind: "library", figureId: "f1" },
      { kind: "existing", reportId: "r1" },
      "Panel A",
    );
  });

  it("collects a report name only when New report is selected", async () => {
    askParamsMock
      .mockResolvedValueOnce({ destination: "New report…", caption: "Caption" })
      .mockResolvedValueOnce({ name: "Summary" });

    await expect(promptAddFigureToReport(
      { kind: "window", windowId: "w1" }, "Live plot",
    )).resolves.toBe(true);

    expect(askParamsMock).toHaveBeenCalledTimes(2);
    expect(addFigureToReport).toHaveBeenCalledWith(
      { kind: "window", windowId: "w1" },
      { kind: "new", name: "Summary" },
      "Caption",
    );
  });

  it("does not mutate reports when either dialog is cancelled", async () => {
    askParamsMock.mockResolvedValueOnce(null);
    await expect(promptAddFigureToReport(
      { kind: "library", figureId: "f1" }, "Loop",
    )).resolves.toBe(false);
    expect(addFigureToReport).not.toHaveBeenCalled();

    askParamsMock
      .mockResolvedValueOnce({ destination: "New report…", caption: "Caption" })
      .mockResolvedValueOnce(null);
    await expect(promptAddFigureToReport(
      { kind: "library", figureId: "f1" }, "Loop",
    )).resolves.toBe(false);
    expect(addFigureToReport).not.toHaveBeenCalled();
  });
});
