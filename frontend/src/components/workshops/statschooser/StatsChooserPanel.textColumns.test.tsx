// A plain `id,grp,sub,val` CSV: the test chooser's "Group by" picker offers the text columns the
// importer left in `metadata.text_columns`. Driven through the real panel (Value by category, Group by
// grp, Which test?); the groups sent to the recommender are compared with pandas
// (`df.groupby("grp")["val"].apply(list)`).

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetBookTransportForTests } from "../../../lib/bookData";
import { useApp } from "../../../store/useApp";
import { TEXT_GROUP_DS, byLevel, GRP } from "../textGroupFixture";
import StatsChooserPanel from "./StatsChooserPanel";

const { recommendMock } = vi.hoisted(() => ({ recommendMock: vi.fn() }));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsRecommend: recommendMock,
}));

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  recommendMock.mockResolvedValue({
    recommendation: "Welch two-sample t-test", endpoint: "/api/stats/ttest", parametric: true, n_groups: 2, paired: false,
    checks: { alpha: 0.05, shapiro_p: [0.5, 0.6] }, reasons: [],
  });
  useApp.setState({ datasets: [TEXT_GROUP_DS], activeId: "tg", statsChooserOpen: true, reports: [], openReportId: null });
});

describe("Test chooser groups by a CSV text column", () => {
  it("offers grp and sub under Group by, and recommends on pandas' groups", async () => {
    render(<StatsChooserPanel />);
    fireEvent.click(screen.getByRole("radio", { name: "Value by category" }));
    const groupBy = screen.getAllByRole("combobox")[1];
    const labels = Array.from(groupBy.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(["grp", "sub"]));
    // The value picker stays on real columns: a text column's level codes are not a response.
    expect(Array.from(screen.getAllByRole("combobox")[0].querySelectorAll("option")).map((o) => o.textContent)).not.toContain("grp");
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "0" } }); // val
    fireEvent.change(groupBy, { target: { value: String(labels.indexOf("grp") - 1) } }); // index = option position - the X column
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));
    // pandas: df.groupby("grp")["val"].apply(list)
    const expected = byLevel(GRP);
    expect((await screen.findAllByText(/Welch two-sample t-test/)).length).toBeGreaterThan(0);
    expect(recommendMock).toHaveBeenCalledWith({ groups: [expected.A, expected.B], paired: false });
  });
});
