// Where a measurement label sits, against the table the export asserts too
// (tests/fixtures/wire/annotation_measures.json: label_origin, label_fit,
// angle_label; tests/test_annotation_label_placement.py).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { angleLabelCentre, fitLabelBox, labelOrigin, segmentHitsBox } from "./annotationMeasure";

type P = [number, number];
const F = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "annotation_measures.json"),
    "utf8",
  ),
);

describe("labelOrigin", () => {
  it.each<{ anchor: P; size: P; align: [string, string]; out: P }>(F.label_origin)("$align", (c) => {
    expect(labelOrigin(c.anchor[0], c.anchor[1], c.size[0], c.size[1], c.align[0] as "left", c.align[1] as "top")).toEqual(c.out);
  });
});

describe("fitLabelBox", () => {
  it.each<{ name: string; box: number[]; plot: [number, number, number, number]; out: P }>(F.label_fit)("$name", (c) => {
    expect(fitLabelBox(c.box[0], c.box[1], c.box[2], c.box[3], c.plot)).toEqual(c.out);
  });
});

describe("angleLabelCentre", () => {
  it.each<{ name: string; vertex: P; a: P; b: P; w: number; h: number; radius: number; pad: number; step: number; centre: P }>(F.angle_label)("$name", (c) => {
    const got = angleLabelCentre(c.vertex, c.a, c.b, c.w, c.h, c.radius, c.pad, c.step);
    expect(got[0]).toBeCloseTo(c.centre[0], 6);
    expect(got[1]).toBeCloseTo(c.centre[1], 6);
    const box: [number, number, number, number] = [got[0] - c.w / 2 - c.pad, got[1] - c.h / 2 - c.pad, c.w + 2 * c.pad, c.h + 2 * c.pad];
    expect(segmentHitsBox(c.vertex, c.a, box)).toBe(false);
    expect(segmentHitsBox(c.vertex, c.b, box)).toBe(false);
    expect(Math.hypot(got[0] - c.vertex[0], got[1] - c.vertex[1])).toBeGreaterThanOrEqual(c.radius);
  });
});
