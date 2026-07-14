// Pure helpers for the corpus-wide Origin plot-fidelity acceptance matrix
// (ORIGIN_FILE_DECODE_PLAN #55). No project bytes or screenshots are read here.

export const REVIEW_KEYS = [
  "scales", "ticks", "legend", "colours", "markers", "annotations", "panels",
];

const FIDELITY_RANK = {
  exact: 0,
  best_effort: 1,
  reference_only: 2,
  unresolved: 3,
};

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

/** Summarize every layer in one graph-window family without guessing absent
 * decoder fields. Source books and curves remain in decoded draw order. */
export function summarizeFigureFamily(family) {
  const curves = family.flatMap((entry) => entry.figure?.curves || []).map((curve) => ({
    book: curve.book,
    x: curve.x,
    y: curve.y,
    ...(curve.style ? { style: curve.style } : {}),
  }));
  const fidelities = family.map((entry) => entry.figure?.fidelity).filter(Boolean);
  const statuses = fidelities.map((item) => item.status).filter((status) => status in FIDELITY_RANK);
  const status = statuses.length
    ? statuses.reduce((worst, value) => FIDELITY_RANK[value] > FIDELITY_RANK[worst] ? value : worst)
    : "unreported";
  const previews = family.map((entry) => entry.figure?.saved_preview).filter(Boolean);
  return {
    source_books: unique(curves.map((curve) => curve.book)),
    curves,
    fidelity: {
      status,
      recovered: unique(fidelities.flatMap((item) => item.recovered || [])),
      omissions: unique(fidelities.flatMap((item) => item.omissions || [])),
    },
    preview: {
      available: previews.length > 0,
      confidence: unique(previews.map((preview) => preview.confidence)),
    },
  };
}

export function screenshotReview(review, graph) {
  const marks = review?.figures?.[graph] || {};
  const values = REVIEW_KEYS.map((key) => marks[key] || "");
  const mismatches = REVIEW_KEYS.filter((key, index) => values[index] === "bad");
  const reviewed = values.filter((value) => value === "ok" || value === "bad").length;
  let status = "unreviewed";
  if (mismatches.length) status = "mismatch";
  else if (reviewed === REVIEW_KEYS.length) status = "reviewed";
  else if (reviewed) status = "partial";
  return { status, reviewed_checks: reviewed, mismatch_checks: mismatches };
}

/** Normalize browser exceptions for durable reports: preserve the first-seen
 * order, deduplicate repeated uPlot/React emissions, and cap noisy stacks. */
export function summarizeRuntimeErrors(errors, limit = 10) {
  const normalized = unique((errors || []).map((error) => {
    if (typeof error === "string") return error;
    return error?.stack || error?.message || String(error);
  }));
  return {
    count: normalized.length,
    errors: normalized.slice(0, limit),
    truncated: normalized.length > limit,
  };
}

/** Compare normalized DOM rectangles with decoded frame rectangles. Kept
 * pure so the browser harness's geometry assertion has positive + negative
 * controls independent of Puppeteer and the live store. */
export function normalizedRectsMatch(expected, actual, tolerance = 0.01) {
  if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false;
  const keys = ["left", "top", "width", "height"];
  return expected.every((rect, index) => {
    const observed = actual[index];
    return rect && observed && keys.every((key) =>
      Number.isFinite(rect[key])
      && Number.isFinite(observed[key])
      && Math.abs(rect[key] - observed[key]) <= tolerance
    );
  });
}

/** Convert layout-normalized decoded frames into host-normalized rectangles
 * after aspect-preserving letterboxing. Independent oracle for the frontend's
 * pixel-space `fittedLayoutRect` implementation. */
export function fitNormalizedLayoutRects(rects, layoutAspect, hostWidth, hostHeight) {
  if (!Number.isFinite(layoutAspect) || layoutAspect <= 0
      || !Number.isFinite(hostWidth) || hostWidth <= 0
      || !Number.isFinite(hostHeight) || hostHeight <= 0) return rects;
  const hostAspect = hostWidth / hostHeight;
  let pageLeft = 0;
  let pageTop = 0;
  let pageWidth = 1;
  let pageHeight = 1;
  if (hostAspect > layoutAspect) {
    pageWidth = layoutAspect / hostAspect;
    pageLeft = (1 - pageWidth) / 2;
  } else {
    pageHeight = hostAspect / layoutAspect;
    pageTop = (1 - pageHeight) / 2;
  }
  return rects.map((rect) => ({
    left: pageLeft + rect.left * pageWidth,
    top: pageTop + rect.top * pageHeight,
    width: rect.width * pageWidth,
    height: rect.height * pageHeight,
  }));
}

/** Join the three generated reports plus optional exported eyeball marks into
 * one durable row per graph. Missing inputs become explicit states. */
export function buildAcceptanceRows(project, originManifest, quantizedManifest, structuralReport, review) {
  const origin = originManifest?.graphs || {};
  const quantized = quantizedManifest?.figures || {};
  const structural = new Map((structuralReport?.figures || []).map((item) => [item.name, item]));
  const names = unique([...Object.keys(origin), ...Object.keys(quantized), ...structural.keys()]).sort();
  return names.map((graph) => {
    const o = origin[graph];
    const q = quantized[graph];
    const s = structural.get(graph);
    const reviewState = screenshotReview(review, graph);
    const originRendered = Boolean(o?.status === "ok" && o.file);
    const quantizedRendered = Boolean(q?.resolved && q.file);
    return {
      project,
      graph,
      folder: q?.folder || o?.folder || null,
      source_books: q?.source_books || [],
      curves: q?.curves || [],
      curve_count: Array.isArray(q?.curves) ? q.curves.length : null,
      layers: q?.layers ?? null,
      layout_mode: q?.mode ?? null,
      preview: q?.preview || { available: false, confidence: [] },
      fidelity_status: q?.fidelity?.status || "unreported",
      fidelity_omissions: q?.fidelity?.omissions || [],
      origin_render_status: o?.status || "missing",
      quantized_render_status: q ? (q.resolved ? (q.file ? "rendered" : "missing_screenshot") : "unresolved") : "missing",
      paired_screenshots: originRendered && quantizedRendered,
      structural_pass: typeof s?.pass === "boolean" ? s.pass : null,
      structural_failures: (s?.checks || []).filter((item) => !item.pass).map((item) => item.name),
      runtime_error_count: q?.runtime_errors?.count ?? 0,
      runtime_errors: q?.runtime_errors?.errors || [],
      screenshot_review_status: reviewState.status,
      screenshot_reviewed_checks: reviewState.reviewed_checks,
      screenshot_mismatches: reviewState.mismatch_checks,
      origin_screenshot: o?.file || null,
      quantized_screenshot: q?.file || null,
    };
  });
}

function csvCell(value) {
  const raw = Array.isArray(value) || (value && typeof value === "object")
    ? JSON.stringify(value)
    : String(value ?? "");
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function acceptanceCsv(rows) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((line) => line.map(csvCell).join(","))
    .join("\n") + "\n";
}
