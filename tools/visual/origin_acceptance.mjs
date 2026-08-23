// Pure helpers for the corpus-wide Origin plot-fidelity acceptance matrix
// (ORIGIN_FILE_DECODE_PLAN #55). No project bytes or screenshots are read here.
//
// `compareFigureToState` (below) also carries the per-figure structural
// check `origin_figures.mjs` runs against the REAL store state a headless
// apply produced -- moved here (2026-08-21, structural-report regression)
// specifically so it is a plain function of data, importable and unit
// testable WITHOUT Puppeteer/a browser/a running backend. `origin_figures.mjs`
// itself can't be `import`ed for a unit test: it runs `parseArgs`/
// `process.exit(1)` at module load. Keeping the actual comparison logic
// here, and only the state-collection glue over there, is what makes the
// class of bug that motivated the move -- comparing against a store field
// name that no longer exists -- something a `node --test` run can catch
// before ever touching a browser.

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

function rankedCounts(values) {
  const counts = new Map();
  for (const value of values.filter((item) => item !== null && item !== undefined && item !== "")) {
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Deterministic corpus evidence ledger: stable headline totals plus ranked
 * categories that make the next fidelity slice a data-driven choice. */
export function summarizeAcceptanceRows(rows, projectCount = null) {
  return {
    projects: projectCount ?? new Set(rows.map((row) => row.project)).size,
    graphs: rows.length,
    paired_screenshots: rows.filter((row) => row.paired_screenshots).length,
    structural_mismatches: rows.filter((row) =>
      row.structural_pass === false && row.quantized_render_status !== "unresolved"
    ).length,
    runtime_error_graphs: rows.filter((row) => row.runtime_error_count > 0).length,
    unresolved_graphs: rows.filter((row) => row.quantized_render_status === "unresolved").length,
    visually_reviewed: rows.filter((row) => row.screenshot_review_status === "reviewed").length,
    visual_mismatches: rows.filter((row) => row.screenshot_review_status === "mismatch").length,
    rankings: {
      fidelity_statuses: rankedCounts(rows.map((row) => row.fidelity_status)),
      fidelity_omissions: rankedCounts(rows.flatMap((row) => row.fidelity_omissions || [])),
      layout_modes: rankedCounts(rows.map((row) => row.layout_mode)),
      structural_failure_checks: rankedCounts(rows.flatMap((row) => row.structural_failures || [])),
      screenshot_review_statuses: rankedCounts(rows.map((row) => row.screenshot_review_status)),
      unresolved_projects: rankedCounts(rows
        .filter((row) => row.quantized_render_status === "unresolved")
        .map((row) => row.project)),
    },
  };
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

/** Static corpus entry point for the owner screenshot gate. Per-project
 * galleries retain the interactive chips/review export; this page ranks and
 * links the remaining paired review queue without duplicating that state. */
export function acceptanceDashboardHtml(rows, totals) {
  const byProject = new Map();
  for (const row of rows) {
    if (!byProject.has(row.project)) byProject.set(row.project, []);
    byProject.get(row.project).push(row);
  }
  const projects = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b));
  const cards = projects.map(([project, projectRows]) => {
    const paired = projectRows.filter((row) => row.paired_screenshots).length;
    const unresolved = projectRows.filter((row) => row.quantized_render_status === "unresolved").length;
    const reviewed = projectRows.filter((row) => row.screenshot_review_status === "reviewed").length;
    const content = `<strong>${htmlEscape(project)}</strong><span>${paired} paired · ${reviewed} reviewed · ${unresolved} unresolved</span>`;
    return paired > 0
      ? `<a class="card" href="${encodeURIComponent(project)}/gallery.html">${content}</a>`
      : `<div class="card unavailable" title="No Origin PNG oracle is available for this project">${content}</div>`;
  }).join("\n");
  const queue = rows.filter((row) => row.paired_screenshots && row.screenshot_review_status !== "reviewed")
    .sort((a, b) => a.project.localeCompare(b.project) || a.graph.localeCompare(b.graph));
  const queueRows = queue.map((row) => {
    const href = `${encodeURIComponent(row.project)}/gallery.html#fig-${encodeURIComponent(row.graph)}`;
    return `<tr><td>${htmlEscape(row.project)}</td><td><a href="${href}">${htmlEscape(row.graph)}</a></td><td>${htmlEscape(row.layout_mode || "n/a")}</td><td>${htmlEscape(row.screenshot_review_status)}</td></tr>`;
  }).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Origin corpus review queue</title>
<style>
:root{color-scheme:light dark;font:14px/1.45 system-ui,sans-serif}body{max-width:1200px;margin:auto;padding:28px}h1{font-size:22px}.summary{color:#777}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:20px 0}.card{display:flex;flex-direction:column;padding:12px;border:1px solid #8886;border-radius:8px;text-decoration:none;color:inherit}.card span{color:#777;font-size:12px;margin-top:4px}.card.unavailable{opacity:.55}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #8884}th{position:sticky;top:0;background:Canvas}code{font-size:12px}</style>
<h1>Origin corpus screenshot review</h1>
<p class="summary">${totals.graphs} rows · ${totals.paired_screenshots} paired · ${totals.visually_reviewed} fully reviewed · ${totals.unresolved_graphs} unresolved. Structural checks are necessary but not visual sign-off.</p>
<div class="cards">${cards}</div>
<h2>Paired review queue (${queue.length})</h2>
<table><thead><tr><th>Project</th><th>Graph</th><th>Layout</th><th>Status</th></tr></thead><tbody>${queueRows}</tbody></table>`;
}

// ---- per-figure structural check (moved from origin_figures.mjs) ---------

/** Relative-tolerance numeric/structural equality. Non-numeric or non-finite
 * values fall back to `Object.is`/`===` so `null`, `undefined`, and `NaN`
 * compare exactly rather than silently passing through a numeric branch. */
export function approxEq(a, b, eps = 1e-6) {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (typeof a === "number" && typeof b === "number") {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b) || a === b;
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= eps * scale;
  }
  return a === b;
}

export const check = (name, pass, detail) => ({ name, pass: !!pass, detail: detail ?? (pass ? "ok" : "mismatch") });

/** Compare a graph window family's decoded figure record(s) against the store
 *  state `applyOriginFigure` produced. Mode is inferred from the OBSERABLE
 *  post-apply state (stackMode+spatialPanels => multi-panel; family of 2 with
 *  y2Keys populated => double-Y combine; else single-layer) -- the harness
 *  seam doesn't expose the pure classifier functions
 *  (lib/originFigures.figureLayerFamily/doubleYPartner/resolveFigurePanels),
 *  so this mirrors their OUTCOME rather than calling them directly. "First
 *  cut" per the plan: catches apply-routing regressions (wrong axis, dropped
 *  panel, stale cross-figure state), not deep rendering fidelity.
 *
 *  `applied.spatialPanels` MUST be the resolved panel array (or `null`) --
 *  callers read it through the real `lib/composition.ts` `spatialPanelsOf`
 *  accessor (exposed on the harness seam as `window.__qz.spatialPanelsOf`),
 *  never a raw `state.spatialPanels` field. That field does not exist: the
 *  store collapsed it into the `composition` discriminated union (commit
 *  5cdc7303, 2026-07-19). Reading a stale raw field here silently
 *  misclassifies every spatial multi-panel apply as "single" and compares
 *  it against the wrong (untouched) top-level singleton axis fields --
 *  the exact regression this comment and its unit tests guard against. */
export function compareFigureToState(family, representative, applied) {
  const checks = [];
  const isMultiPanel = applied.stackMode && Array.isArray(applied.spatialPanels) && applied.spatialPanels.length >= 2;
  if (isMultiPanel) {
    const panels = applied.spatialPanels;
    const expectedSources = family.map((entry) => entry.id).sort();
    const actualSources = panels.flatMap((panel) => panel.sourceFigureIds || []).sort();
    checks.push(check(
      "source_layer_coverage",
      JSON.stringify(actualSources) === JSON.stringify(expectedSources),
      `expected ${expectedSources.join(",")}; got ${actualSources.join(",")}`,
    ));
    panels.forEach((p, i) => {
      const sourceIds = p.sourceFigureIds || [];
      const entry = family.find((candidate) => candidate.id === sourceIds[0]);
      checks.push(check(`panel_${i}_primary_source`, !!entry, sourceIds[0] || "missing provenance"));
      if (!entry) return;
      const fig = entry.figure;
      checks.push(check(`panel_${i}_xrange`, approxEq(p.xLim?.[0], fig.x_from) && approxEq(p.xLim?.[1], fig.x_to)));
      checks.push(check(`panel_${i}_yrange`, approxEq(p.yLim?.[0], fig.y_from) && approxEq(p.yLim?.[1], fig.y_to)));
      checks.push(check(`panel_${i}_xlog`, p.xLog === fig.x_log));
      checks.push(check(`panel_${i}_ylog`, p.yLog === fig.y_log));
      checks.push(check(`panel_${i}_xstep`, approxEq(p.xStep ?? null, fig.x_step ?? null)));
      checks.push(check(`panel_${i}_ystep`, approxEq(p.yStep ?? null, fig.y_step ?? null)));
      if (sourceIds.length > 1) {
        const y2Entry = family.find((candidate) => candidate.id === sourceIds[1]);
        checks.push(check(`panel_${i}_y2_source`, !!y2Entry, sourceIds[1]));
        if (y2Entry) {
          const y2 = y2Entry.figure;
          checks.push(check(`panel_${i}_y2range`, approxEq(p.y2Lim?.[0], y2.y_from) && approxEq(p.y2Lim?.[1], y2.y_to)));
          checks.push(check(`panel_${i}_y2log`, p.y2Log === y2.y_log));
          checks.push(check(`panel_${i}_y2step`, approxEq(p.y2Step ?? null, y2.y_step ?? null)));
        }
      }
    });
    checks.push(
      check("canvas_count", applied.canvasCount === panels.length, `expected ${panels.length}, saw ${applied.canvasCount}`),
    );
    const expectedRects = panels.map((panel) => panel.frameRect);
    if (expectedRects.every(Boolean)) {
      const aspects = panels.map((panel) => panel.layoutAspect);
      const aspect = aspects[0];
      const useAspect = aspect != null && Number.isFinite(aspect) && aspect > 0
        && aspects.every((value) => value != null && Math.abs(value - aspect) <= 1e-9);
      const expectedDomRects = useAspect
        ? fitNormalizedLayoutRects(expectedRects, aspect, applied.hostWidth, applied.hostHeight)
        : expectedRects;
      const geometryPass = normalizedRectsMatch(expectedDomRects, applied.panelRects);
      checks.push(check(
        "decoded_frame_geometry",
        geometryPass,
        geometryPass
          ? `${expectedRects.length} panel rectangles match decoded geometry`
          : `expected ${JSON.stringify(expectedDomRects)}; got ${JSON.stringify(applied.panelRects)}`,
      ));
    }
    return { mode: "multiPanel", checks };
  }
  const isDoubleY = family.length === 2 && Array.isArray(applied.y2Keys) && applied.y2Keys.length > 0;
  if (isDoubleY) {
    const sorted = [...family].sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
    const [lower, upper] = [sorted[0].figure, sorted[1].figure];
    checks.push(check("x_range", approxEq(applied.xLim?.[0], lower.x_from) && approxEq(applied.xLim?.[1], lower.x_to)));
    checks.push(check("y_range", approxEq(applied.yLim?.[0], lower.y_from) && approxEq(applied.yLim?.[1], lower.y_to)));
    checks.push(check("x_log", applied.xLog === lower.x_log));
    checks.push(check("y_log", applied.yLog === lower.y_log));
    checks.push(check("x_step", approxEq(applied.xStep ?? null, lower.x_step ?? null)));
    checks.push(check("y_step", approxEq(applied.yStep ?? null, lower.y_step ?? null)));
    checks.push(check("y2_range", approxEq(applied.y2Lim?.[0], upper.y_from) && approxEq(applied.y2Lim?.[1], upper.y_to)));
    checks.push(check("y2_log", applied.y2Log === upper.y_log));
    checks.push(check("y2_step", approxEq(applied.y2Step ?? null, upper.y_step ?? null)));
    return { mode: "doubleY", checks };
  }
  const fig = representative.figure; // single-layer, or a family that degraded to single
  checks.push(check("x_range", approxEq(applied.xLim?.[0], fig.x_from) && approxEq(applied.xLim?.[1], fig.x_to)));
  checks.push(check("y_range", approxEq(applied.yLim?.[0], fig.y_from) && approxEq(applied.yLim?.[1], fig.y_to)));
  checks.push(check("x_log", applied.xLog === fig.x_log));
  checks.push(check("y_log", applied.yLog === fig.y_log));
  checks.push(check("x_step", approxEq(applied.xStep ?? null, fig.x_step ?? null)));
  checks.push(check("y_step", approxEq(applied.yStep ?? null, fig.y_step ?? null)));
  return { mode: "single", checks };
}

/** Summarize sequential real-browser project runs. Unresolved graphs remain
 * explicit but are not renderer regressions; child-process failures and any
 * resolved graph whose strengthened structural checks fail are strict
 * failures. */
export function summarizeCorpusReports(runs) {
  const projects = runs.map(({ project, exitCode = 0, report = null }) => {
    const figures = report?.figures || [];
    const resolved = figures.filter((figure) => figure.resolved);
    const failures = resolved.filter((figure) => !figure.pass).map((figure) => ({
      graph: figure.name,
      checks: (figure.checks || []).filter((item) => !item.pass).map((item) => item.name),
    }));
    return {
      project,
      process_exit: exitCode,
      graphs: figures.length,
      resolved: resolved.length,
      unresolved: figures.length - resolved.length,
      passed: resolved.length - failures.length,
      failures,
      strict_pass: exitCode === 0 && failures.length === 0 && report != null,
    };
  });
  return {
    version: 1,
    generated: new Date().toISOString(),
    totals: {
      projects: projects.length,
      graphs: projects.reduce((sum, project) => sum + project.graphs, 0),
      resolved: projects.reduce((sum, project) => sum + project.resolved, 0),
      unresolved: projects.reduce((sum, project) => sum + project.unresolved, 0),
      renderer_failures: projects.reduce((sum, project) => sum + project.failures.length, 0),
      process_failures: projects.filter((project) => project.process_exit !== 0).length,
    },
    projects,
    strict_pass: projects.length > 0 && projects.every((project) => project.strict_pass),
  };
}
