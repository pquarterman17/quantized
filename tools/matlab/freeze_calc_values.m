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
