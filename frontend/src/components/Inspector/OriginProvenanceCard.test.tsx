import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import OriginProvenanceCard from "./OriginProvenanceCard";
import type { Dataset } from "../../lib/types";

const ds = (metadata: Record<string, unknown>): Dataset => ({
  id: "d1",
  name: "t.opj",
  data: { time: [1], values: [[2]], labels: ["A"], units: [""], metadata },
});

describe("OriginProvenanceCard", () => {
  it("renders nothing when the dataset has neither notes nor a results log", () => {
    const { container } = render(<OriginProvenanceCard active={ds({ sample: "MnN 30nm" })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when active is null", () => {
    const { container } = render(<OriginProvenanceCard active={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one block per notes window, preserving the window name and text", () => {
    render(
      <OriginProvenanceCard
        active={ds({
          origin_notes: {
            NProbe: "QZNOTE line one: sample MnN 30nm\nQZNOTE line two: field sweep at 300K",
          },
        })}
      />,
    );
    expect(screen.getByText("NProbe")).toBeInTheDocument();
    expect(screen.getByText(/QZNOTE line one/)).toBeInTheDocument();
    expect(screen.getByText(/QZNOTE line two/)).toBeInTheDocument();
  });

  it("renders a compact expandable row per structured results-log record", () => {
    render(
      <OriginProvenanceCard
        active={ds({
          origin_results_log: "raw log text",
          origin_results_log_records: [
            {
              timestamp: "5/6/2019 15:16:34",
              operation: "subtract_line",
              params: {
                Input: { iy: '[Book4]Sheet1!(C"H",M)', x1: "-3789.29580" },
                Output: { oy: '[Book4]Sheet1!(C"H",N"Subtracted Data")' },
              },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("5/6/2019 15:16:34")).toBeInTheDocument();
    expect(screen.getByText("subtract_line")).toBeInTheDocument();
    // Section headers + key/value rows are present in the DOM (inside the
    // collapsed <details>, which testing-library still queries).
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getByText("iy")).toBeInTheDocument();
    expect(screen.getByText('[Book4]Sheet1!(C"H",M)')).toBeInTheDocument();
  });

  it("surfaces unparsed lines in a record's extra list", () => {
    render(
      <OriginProvenanceCard
        active={ds({
          origin_results_log: "raw log text",
          origin_results_log_records: [
            {
              timestamp: "1/2/2020 10:00:00",
              operation: "fit_line",
              params: {},
              extra: ["some malformed trailing line"],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("some malformed trailing line")).toBeInTheDocument();
  });

  it("falls back to the raw log text when structured records are absent", () => {
    render(
      <OriginProvenanceCard
        active={ds({
          origin_results_log: "[5/6/2019 15:16:34] some raw provenance text",
        })}
      />,
    );
    expect(screen.getByText(/some raw provenance text/)).toBeInTheDocument();
  });

  it("falls back to the raw log text when records parse to an empty list", () => {
    render(
      <OriginProvenanceCard
        active={ds({
          origin_results_log: "unparseable raw text with no timestamp headers",
          origin_results_log_records: [],
        })}
      />,
    );
    expect(screen.getByText(/unparseable raw text/)).toBeInTheDocument();
  });

  it("renders a Copy button for the raw log", () => {
    render(
      <OriginProvenanceCard
        active={ds({ origin_results_log: "[5/6/2019 15:16:34] some log" })}
      />,
    );
    expect(screen.getByRole("button", { name: /copy results log/i })).toBeInTheDocument();
  });

  it("omits the Copy button when there is no raw log text (notes only)", () => {
    render(<OriginProvenanceCard active={ds({ origin_notes: { N1: "just a note" } })} />);
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });
});
