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

    % ── convertUnits across families (field/moment/temp/angle/length) ─────
    defs = {5, 'Oe', 'T'; 2.5, 'emu', 'a/m2'; 25, 'C', 'K'; 98.6, 'F', 'C'; ...
            90, 'deg', 'rad'; 100, 'nm', 'm'; 7, 'Oe', 'Oe'};
    cv = cell(size(defs, 1), 1);
    for ci = 1:size(defs, 1)
        [cvOut, cvUnit] = utilities.convertUnits(defs{ci,1}, defs{ci,2}, defs{ci,3});
        cv{ci} = struct('value', defs{ci,1}, 'from', defs{ci,2}, 'to', defs{ci,3}, ...
            'out', cvOut, 'unit', cvUnit);
    end
    writeJson(cv, fullfile(goldenDir, 'calc_convert.json'));

    % ── resampleData: 4 interp methods (NPoints) + Step grid ──────────────
    xo = (0:1:10).';
    yo = [sin(xo), 0.5 * cos(xo) + 2];
    din = struct('time', xo, 'values', yo, 'labels', {{'s', 'c'}}, ...
        'units', {{'', ''}}, 'metadata', struct());
    rsIn = struct('time', xo.', 'values', yo);
    for m = ["linear", "pchip", "spline", "makima"]
        dm = utilities.resampleData(din, 'NPoints', 50, 'Method', m);
        writeJson(struct('input', rsIn, 'params', struct('npoints', 50, 'method', char(m)), ...
            'output', struct('time', dm.time.', 'values', dm.values)), ...
            fullfile(goldenDir, sprintf('calc_resample_%s.json', m)));
    end
    dstep = utilities.resampleData(din, 'Step', 0.5, 'Method', 'makima');
    writeJson(struct('input', rsIn, 'params', struct('step', 0.5, 'method', 'makima'), ...
        'output', struct('time', dstep.time.', 'values', dstep.values)), ...
        fullfile(goldenDir, 'calc_resample_step.json'));

    % ── fftSpectral + fftFilter on a 2-tone signal ────────────────────────
    xf = (0:0.01:5).';
    yf = sin(2*pi*5*xf) + 0.5 * sin(2*pi*12*xf);
    spIn = struct('x', xf.', 'y', yf.');
    sp1 = utilities.fftSpectral(xf, yf);
    writeJson(struct('input', spIn, 'params', struct('window', 'hanning', ...
        'outputType', 'psd', 'sided', 'one'), 'output', sp1), ...
        fullfile(goldenDir, 'calc_fft_psd.json'));
    sp2 = utilities.fftSpectral(xf, yf, 'Window', 'hamming', 'OutputType', 'magnitude');
    writeJson(struct('input', spIn, 'params', struct('window', 'hamming', ...
        'outputType', 'magnitude'), 'output', sp2), ...
        fullfile(goldenDir, 'calc_fft_magnitude.json'));
    sp3 = utilities.fftSpectral(xf, yf, 'Sided', 'two');
    writeJson(struct('input', spIn, 'params', struct('sided', 'two'), 'output', sp3), ...
        fullfile(goldenDir, 'calc_fft_twosided.json'));
    sp4 = utilities.fftSpectral(xf, yf, 'SegmentLen', 128, 'Window', 'hanning');
    writeJson(struct('input', spIn, 'params', struct('segmentLen', 128, ...
        'window', 'hanning'), 'output', sp4), fullfile(goldenDir, 'calc_fft_welch.json'));
    flp = utilities.fftFilter(xf, yf, 'Type', 'lowpass', 'Cutoff', 8);
    writeJson(struct('input', spIn, 'params', struct('type', 'lowpass', 'cutoff', 8), ...
        'output', flp), fullfile(goldenDir, 'calc_fftfilter_lowpass.json'));
    fbp = utilities.fftFilter(xf, yf, 'Type', 'bandpass', 'Cutoff', [8 15], 'Window', 'hanning');
    writeJson(struct('input', spIn, 'params', struct('type', 'bandpass', ...
        'window', 'hanning'), 'output', fbp), ...
        fullfile(goldenDir, 'calc_fftfilter_bandpass.json'));

    % ── crossCorrelation (shifted sine -> peak at lag 5) ──────────────────
    tcc = (0:63).';
    xcc = sin(2*pi*tcc/16);
    ycc = sin(2*pi*(tcc-5)/16);
    ccIn = struct('x', xcc.', 'y', ycc.');
    cc = utilities.crossCorrelation(xcc, ycc);
    writeJson(struct('input', ccIn, 'params', struct('normalize', 'coeff'), ...
        'output', cc), fullfile(goldenDir, 'calc_xcorr.json'));
    ccn = utilities.crossCorrelation(xcc, ycc, 'Normalize', 'none');
    writeJson(struct('input', ccIn, 'params', struct('normalize', 'none'), ...
        'output', ccn), fullfile(goldenDir, 'calc_xcorr_none.json'));

    % ── estimateBackground: snip / polynomial / snip-iterative ────────────
    xb = linspace(10, 80, 300).';
    trueBg = 50 + 0.5 * xb + 20 * exp(-((xb - 20) / 15).^2);
    pkb = 200 * exp(-((xb - 35) / 0.5).^2) + 150 * exp(-((xb - 55) / 0.8).^2);
    yb = trueBg + pkb;
    bgIn = struct('x', xb.', 'y', yb.');
    bgSnip = utilities.estimateBackground(xb, yb);
    writeJson(struct('input', bgIn, 'params', struct('method', 'snip'), ...
        'output', bgSnip.'), fullfile(goldenDir, 'calc_estbg_snip.json'));
    bgPoly = utilities.estimateBackground(xb, yb, 'Method', 'polynomial');
    writeJson(struct('input', bgIn, 'params', struct('method', 'polynomial'), ...
        'output', bgPoly.'), fullfile(goldenDir, 'calc_estbg_poly.json'));
    bgIter = utilities.estimateBackground(xb, yb, 'Iterative', true);
    writeJson(struct('input', bgIn, 'params', struct('method', 'snip', 'iterative', true), ...
        'output', bgIter.'), fullfile(goldenDir, 'calc_estbg_iter.json'));

    % ── findPeaksRobust: 2 strong peaks on a sloping background ───────────
    xp2 = linspace(20, 60, 400).';
    yp2 = 100 + 2 * xp2 + 5000 * exp(-((xp2 - 30) / 0.4).^2) ...
        + 4000 * exp(-((xp2 - 45) / 0.5).^2);
    [pkr, bge] = utilities.findPeaksRobust(xp2, yp2);
    writeJson(struct('input', struct('x', xp2.', 'y', yp2.'), ...
        'output', struct('peaks', pkr, 'bg', bge.')), ...
        fullfile(goldenDir, 'calc_findpeaks.json'));

    % ── interpolate2D (exact-parity methods) + regrid2D ───────────────────
    xs2 = [0.1 0.9 0.5 0.2 0.8 0.4 0.6 0.3 0.7 0.5 0.15 0.85].';
    ys2 = [0.2 0.3 0.8 0.6 0.7 0.1 0.5 0.9 0.4 0.5 0.75 0.25].';
    zs2 = sin(3*xs2) + cos(3*ys2) + xs2 .* ys2;
    [xqg, yqg] = meshgrid(linspace(0.3, 0.7, 5), linspace(0.3, 0.7, 5));
    i2In = struct('x', xs2.', 'y', ys2.', 'z', zs2.', 'xq', xqg, 'yq', yqg);
    % nearest omitted: Voronoi-boundary tie-break differs from scipy (tested structurally)
    for m = ["linear", "idw", "thinplate"]
        ri = utilities.interpolate2D(xs2, ys2, zs2, xqg, yqg, 'Method', m);
        writeJson(struct('input', i2In, 'params', struct('method', char(m)), ...
            'output', struct('zq', ri.zq, 'method', char(ri.method), ...
            'stats', struct('nPoints', ri.stats.nPoints, 'rmse', ri.stats.rmse))), ...
            fullfile(goldenDir, sprintf('calc_interp2d_%s.json', m)));
    end
    [Xqr, Yqr, Zqr] = utilities.regrid2D(xs2, ys2, zs2, 'Nx', 8, 'Ny', 8, 'Method', 'idw');
    writeJson(struct('input', struct('x', xs2.', 'y', ys2.', 'z', zs2.'), ...
        'params', struct('nx', 8, 'ny', 8, 'method', 'idw'), ...
        'output', struct('Xq', Xqr, 'Yq', Yqr, 'Zq', Zqr)), ...
        fullfile(goldenDir, 'calc_regrid_idw.json'));

    % ── datasetAlgebra (5 operations, pchip interp of B onto A) ───────────
    % NOTE: utilities.datasetAlgebra is BROKEN in this MATLAB — it calls
    % parser.createDataStruct('Time',...,'Values',...) but createDataStruct takes
    % POSITIONAL (timeVec, valuesMatrix), so it always errors at the size assert.
    % Freeze the intended algebra inline (interp1 pchip + op + label/unit rules);
    % the Python port assembles the DataStruct correctly. 3rd golden-found bug.
    xAa = linspace(0, 10, 40).';  yAa = sin(xAa) + 2;
    xBb = linspace(-1, 11, 55).'; yBb = cos(xBb) + 2;
    daIn = struct('xA', xAa.', 'yA', yAa.', 'xB', xBb.', 'yB', yBb.');
    yBi = interp1(xBb, yBb, xAa, 'pchip', NaN);
    TIMES = char(215); SUP2 = char(178);  % '×' and '²' (avoid source-encoding issues)
    yDiv = yAa ./ yBi;  yDiv(yBi == 0) = NaN;
    yAsym = (yAa - yBi) ./ (yAa + yBi);  yAsym((yAa + yBi) == 0) = NaN;
    daDefs = {
        'A+B', 'aplusb', yAa + yBi, 'A + B', 'V';
        'A-B', 'aminusb', yAa - yBi, 'A - B', 'V';
        'A*B', 'atimesb', yAa .* yBi, ['A ' TIMES ' B'], ['V' SUP2];
        'A/B', 'adivb', yDiv, 'A / B', 'ratio';
        '(A-B)/(A+B)', 'asym', yAsym, '(A - B) / (A + B)', 'asymmetry'
    };
    for oi = 1:size(daDefs, 1)
        writeJson(struct('input', daIn, 'params', struct('op', daDefs{oi, 1}), ...
            'output', struct('time', xAa.', 'values', daDefs{oi, 3}.', ...
            'label', daDefs{oi, 4}, 'unit', daDefs{oi, 5})), ...
            fullfile(goldenDir, sprintf('calc_dsalg_%s.json', daDefs{oi, 2})));
    end

    % ── subtractMagBackground (linear high-T fit) ─────────────────────────
    Tm = linspace(2, 300, 120).';
    Mm = 0.02 * Tm + 1.5 + 8 * exp(-Tm / 20);  % linear bg + low-T Curie tail
    [corr, bgS, bgI] = utilities.subtractMagBackground(Tm, Mm);
    writeJson(struct('input', struct('T', Tm.', 'M', Mm.'), 'params', struct('autoFraction', 0.1), ...
        'output', struct('corrected', corr.', 'bgSlope', bgS, 'bgIntercept', bgI)), ...
        fullfile(goldenDir, 'calc_submagbg_auto.json'));
    [corr2, bgS2, bgI2] = utilities.subtractMagBackground(Tm, Mm, 'FitRange', [200 300]);
    writeJson(struct('input', struct('T', Tm.', 'M', Mm.'), 'params', struct('fitLo', 200, 'fitHi', 300), ...
        'output', struct('corrected', corr2.', 'bgSlope', bgS2, 'bgIntercept', bgI2)), ...
        fullfile(goldenDir, 'calc_submagbg_range.json'));

    % ── convertMagUnits (field + sample-aware moment; success paths) ──────
    AM2 = ['A' char(183) 'm' char(178)];      % 'A·m²'
    EMUCM3 = ['emu/cm' char(179)];            % 'emu/cm³'
    xf = [0 100 -250 5000].';
    yf = [0 0.5 -1.2 3.4].';
    cmDefs = {
        'Oe', 'T',  'emu', 'emu',  0,   0,   'field_oe_t';
        'A/m', 'Oe', 'emu', AM2,   0,   0,   'amts';
        'Oe', 'Oe', 'emu', 'emu/g', 2.0, 0,  'emu_g';
        'mT', 'T',  'emu', EMUCM3, 0,   4.0, 'emu_cm3'
    };
    for ci2 = 1:size(cmDefs, 1)
        [xo, yo, xu, yu, wm] = utilities.convertMagUnits(xf, yf, ...
            'FromField', cmDefs{ci2,1}, 'ToField', cmDefs{ci2,2}, ...
            'FromMoment', cmDefs{ci2,3}, 'ToMoment', cmDefs{ci2,4}, ...
            'SampleMass', cmDefs{ci2,5}, 'SampleVolume', cmDefs{ci2,6});
        writeJson(struct('input', struct('x', xf.', 'y', yf.'), ...
            'params', struct('fromField', cmDefs{ci2,1}, 'toField', cmDefs{ci2,2}, ...
            'fromMoment', cmDefs{ci2,3}, 'toMoment', cmDefs{ci2,4}, ...
            'mass', cmDefs{ci2,5}, 'vol', cmDefs{ci2,6}), ...
            'output', struct('xOut', xo.', 'yOut', yo.', 'xUnit', xu, 'yUnit', yu, 'warn', wm)), ...
            fullfile(goldenDir, sprintf('calc_convmag_%s.json', cmDefs{ci2,7})));
    end

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
