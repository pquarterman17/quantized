function freeze_calc_values()
%FREEZE_CALC_VALUES  Freeze quantized_matlab +utilities/+calc outputs as golden JSON.
%
%   Companion to freeze_reference_values.m (parsers). Each case freezes
%   {input, params, output} for a pure calc function on a fixed synthetic
%   input, so the Python port can be compared exactly. Run with the sibling
%   ../quantized_matlab present:
%     addpath('<quantized>/tools/matlab'); freeze_calc_values()

    here     = fileparts(mfilename('fullpath'));
    repoRoot = fullfile(here, '..', '..');
    qm       = fullfile(repoRoot, '..', 'quantized_matlab');
    assert(isfolder(qm), 'quantized_matlab not found at %s', qm);
    addpath(qm);
    goldenDir = fullfile(repoRoot, 'tests', 'golden');
    if ~isfolder(goldenDir), mkdir(goldenDir); end

    % ── normalize (range) on a 5x2 matrix ─────────────────────────────────
    y = [1 10; 3 20; 2 15; 5 5; 4 25];
    out = utilities.normalize(y, 'Method', 'range');
    writeJson(struct('input', y, 'params', struct('method', 'range'), 'output', out), ...
        fullfile(goldenDir, 'calc_normalize_range.json'));

    % ── descriptiveStats on a vector ──────────────────────────────────────
    x = [2.1 3.4 1.9 5.6 4.2 3.3 2.8 4.9 3.1 2.5]';
    s = utilities.descriptiveStats(x);
    writeJson(struct('input', x.', 'output', s), ...
        fullfile(goldenDir, 'calc_descriptive.json'));

    % ── derivative (order 1) on uniform x ─────────────────────────────────
    xv = (0:9).'; yv = xv.^2;
    dydx = utilities.derivative(xv, yv);
    writeJson(struct('input', struct('x', xv.', 'y', yv.'), ...
        'params', struct('order', 1), 'output', dydx.'), ...
        fullfile(goldenDir, 'calc_derivative.json'));

    % ── cumulative integral + log-derivative ──────────────────────────────
    ci = utilities.cumulativeIntegral(xv, yv);
    writeJson(struct('input', struct('x', xv.', 'y', yv.'), 'output', ci.'), ...
        fullfile(goldenDir, 'calc_cumint.json'));
    xl = (1:10).'; yl = xl.^2;
    ld = utilities.logDerivative(xl, yl);
    writeJson(struct('input', struct('x', xl.', 'y', yl.'), 'output', ld.'), ...
        fullfile(goldenDir, 'calc_logderiv.json'));

    % ── linRegress (order-1 fit on a noisy line) ──────────────────────────
    xr = (1:20).';
    yr = 2.5 * xr + 1.0 + 0.3 * sin(xr);
    lr = utilities.linRegress(xr, yr, 'Order', 1);
    lr = rmfield(lr, {'confBand', 'predBand'});  % strip fn handles (not JSON-able)
    writeJson(struct('input', struct('x', xr.', 'y', yr.'), ...
        'params', struct('order', 1), 'output', lr), ...
        fullfile(goldenDir, 'calc_linregress.json'));

    % ── tTest: one-sample and Welch two-sample ────────────────────────────
    xa = [5.1 4.9 5.3 5.0 4.8 5.2 5.05].';
    r1 = utilities.tTest(xa, 'Mu', 5.0);
    writeJson(struct('input', struct('x', xa.'), 'params', struct('mu', 5.0), ...
        'output', r1), fullfile(goldenDir, 'calc_ttest_onesample.json'));
    xb = [5.1 4.9 5.3 5.0 4.8 5.2 5.05].';
    yb = [4.6 4.7 4.5 4.8 4.4 4.9 4.7 4.55].';
    r2 = utilities.tTest(xb, yb);
    writeJson(struct('input', struct('x', xb.', 'y', yb.'), ...
        'output', r2), fullfile(goldenDir, 'calc_ttest_twosample.json'));

    % ── anova1: three groups ──────────────────────────────────────────────
    g1 = [20 21 19 18 22]; g2 = [28 27 29 30 26]; g3 = [24 25 23 26 22];
    ra = utilities.anova1({g1.', g2.', g3.'});
    writeJson(struct('input', {{g1, g2, g3}}, 'output', ra), ...
        fullfile(goldenDir, 'calc_anova1.json'));

    % ── PCA (classic 2-variable correlated dataset) ───────────────────────
    Xpca = [2.5 2.4; 0.5 0.7; 2.2 2.9; 1.9 2.2; 3.1 3.0; ...
            2.3 2.7; 2.0 1.6; 1.0 1.1; 1.5 1.6; 1.1 0.9];
    rp = utilities.pcaAnalysis(Xpca);
    writeJson(struct('input', Xpca, 'params', struct('center', true, 'scale', false), ...
        'output', rp), fullfile(goldenDir, 'calc_pca.json'));

    % ── confidenceBand across 3 datasets (mean + median) ──────────────────
    x1 = linspace(0, 10, 21).';   y1 = sin(x1);
    x2 = linspace(-1, 11, 25).';  y2 = sin(x2) + 0.15;
    x3 = linspace(0.5, 9.5, 19).'; y3 = sin(x3) - 0.1;
    d1.time = x1; d1.values = y1;
    d2.time = x2; d2.values = y2;
    d3.time = x3; d3.values = y3;
    cbsIn = struct('x1', x1.', 'y1', y1.', 'x2', x2.', 'y2', y2.', ...
        'x3', x3.', 'y3', y3.');
    % NOTE: NPoints passed explicitly (=maxLen) to work around a MATLAB bug —
    % confidenceBand.m declares `NPoints {mustBePositive} = 0`, and R2025b
    % validates defaults, so the documented default (0 -> use maxLen) is
    % uncallable. The Python port keeps n_points=0 as the intended default.
    cbMean = utilities.confidenceBand({d1, d2, d3}, 'Method', 'mean', 'NPoints', 25);
    writeJson(struct('input', cbsIn, 'params', struct('method', 'mean'), ...
        'output', cbMean), fullfile(goldenDir, 'calc_confband_mean.json'));
    cbMed = utilities.confidenceBand({d1, d2, d3}, 'Method', 'median', 'NPoints', 25);
    writeJson(struct('input', cbsIn, 'params', struct('method', 'median'), ...
        'output', cbMed), fullfile(goldenDir, 'calc_confband_median.json'));

    % ── smoothData: moving / gaussian / savitzky-golay ────────────────────
    xs = linspace(0, 4*pi, 50).';
    ys = sin(xs) + 0.2 * cos(7 * xs);   % deterministic structured signal
    smMov = utilities.smoothData(ys, 'Method', 'moving', 'Window', 5);
    writeJson(struct('input', ys.', 'params', struct('method', 'moving', 'window', 5), ...
        'output', smMov.'), fullfile(goldenDir, 'calc_smooth_moving.json'));
    smGau = utilities.smoothData(ys, 'Method', 'gaussian', 'Window', 5);
    writeJson(struct('input', ys.', 'params', struct('method', 'gaussian', 'window', 5), ...
        'output', smGau.'), fullfile(goldenDir, 'calc_smooth_gaussian.json'));
    smSG = utilities.smoothData(ys, 'Method', 'savitzky-golay', 'Window', 5, 'PolyOrder', 2);
    writeJson(struct('input', ys.', ...
        'params', struct('method', 'savitzky-golay', 'window', 5, 'polyOrder', 2), ...
        'output', smSG.'), fullfile(goldenDir, 'calc_smooth_savgol.json'));

    % ── peak shapes on a 2-theta grid ─────────────────────────────────────
    xp = linspace(28, 32, 50);
    pv = utilities.pseudoVoigt(xp, 30, 0.3, 1000, 0.5, 10);
    writeJson(struct('input', xp, ...
        'params', struct('x0', 30, 'fwhm', 0.3, 'H', 1000, 'eta', 0.5, 'bg', 10), ...
        'output', pv), fullfile(goldenDir, 'calc_pseudovoigt.json'));

    spvParams = [5000 30 0.15 0.25 8 2 20];
    spv = utilities.splitPearsonVII(xp.', spvParams);
    writeJson(struct('input', xp, 'params', struct('p', spvParams), 'output', spv.'), ...
        fullfile(goldenDir, 'calc_splitpearson.json'));

    tchParams = [1000 30 0.15 0.05 5];
    tch = utilities.tchPseudoVoigt(xp.', tchParams);
    writeJson(struct('input', xp, 'params', struct('p', tchParams), 'output', tch.'), ...
        fullfile(goldenDir, 'calc_tchpv.json'));

    % ── baselineALS on a synthetic spectrum (baseline + 2 peaks) ──────────
    xq = linspace(0, 10, 100).';
    yq = 2 + 0.5 * xq + 3 * exp(-((xq - 3) / 0.3).^2) + 2 * exp(-((xq - 7) / 0.4).^2);
    bl = utilities.baselineALS(yq);
    writeJson(struct('input', yq.', 'params', struct('lambda', 1e6, 'p', 0.01), ...
        'output', bl.'), fullfile(goldenDir, 'calc_baseline_als.json'));

    % ── error propagation (scalars) → [val, err] ──────────────────────────
    [va, ea] = utilities.errorAdd(2, 0.1, 3, 0.2);
    writeJson(struct('output', [va ea]), fullfile(goldenDir, 'calc_erroradd.json'));
    [vm, em] = utilities.errorMul(2, 0.1, 3, 0.2);
    writeJson(struct('output', [vm em]), fullfile(goldenDir, 'calc_errormul.json'));
    [vd, ed] = utilities.errorDiv(6, 0.1, 3, 0.2);
    writeJson(struct('output', [vd ed]), fullfile(goldenDir, 'calc_errordiv.json'));

    fprintf('Done.\n');
end

function writeJson(s, outPath)
    fid = fopen(outPath, 'w');
    assert(fid > 0, 'cannot open %s', outPath);
    fwrite(fid, jsonencode(s));
    fclose(fid);
    fprintf('froze %s\n', outPath);
end
