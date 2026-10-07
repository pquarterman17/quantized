import { describe, expect, it } from "vitest";

import { samplePreviewRows } from "./SignalPreview";

describe("signal preview sampling", () => {
  it("preserves narrow extrema while respecting the preview point budget", () => {
    const rows: (readonly [number, number])[] = Array.from(
      { length: 10_000 },
      (_, index) => [index, index === 4_999 ? 1_000 : index === 7_501 ? -500 : 0] as const,
    );

    const sampled = samplePreviewRows(rows, 400);

    expect(sampled.length).toBeLessThanOrEqual(400);
    expect(sampled).toContainEqual([4_999, 1_000]);
    expect(sampled).toContainEqual([7_501, -500]);
    expect(sampled[0]).toEqual(rows[0]);
    expect(sampled.at(-1)).toEqual(rows.at(-1));
  });
});
