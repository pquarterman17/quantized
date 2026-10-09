import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { reflectivityFitAnalysisResult } from "../../../lib/reflFitAnalysisResult";
import { encodeRecord } from "../reflectivity/reflFitRecord";
import { makeRecord, xrrDataset } from "../reflectivity/reflFit.testkit";
import AnalysisResultRefl, { liveReflectivityFit } from "./AnalysisResultRefl";

describe("reflectivity Analysis Result view", () => {
  it("reads overview and parameter values from the live saved-fit authority", () => {
    const record = makeRecord();
    const dataset = { ...xrrDataset("xrr"), reflFits: [encodeRecord(record)] };
    const result = reflectivityFitAnalysisResult(encodeRecord(record), [dataset])!;
    expect(liveReflectivityFit(result, [dataset])?.id).toBe(record.id);

    const { rerender } = render(<AnalysisResultRefl result={result} record={record} datasets={[dataset]} view="overview" />);
    expect(screen.getByText("Reflectivity Fit")).toBeInTheDocument();
    expect(screen.getByText(record.result.objective.label)).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();

    rerender(<AnalysisResultRefl result={result} record={record} datasets={[dataset]} view="table" />);
    expect(screen.getByRole("columnheader", { name: "Parameter" })).toBeInTheDocument();
    expect(screen.getByText(record.result.parameters[0].name)).toBeInTheDocument();
  });

  it("explains a missing record instead of rendering cached fit values", () => {
    const record = makeRecord();
    const dataset = xrrDataset("xrr");
    const result = reflectivityFitAnalysisResult(encodeRecord(record), [dataset])!;
    render(<AnalysisResultRefl result={result} record={null} datasets={[dataset]} view="overview" />);
    expect(screen.getByText(/saved reflectivity fit is unavailable/i)).toBeInTheDocument();
  });
});
