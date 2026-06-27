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

    % ── hysteresisAnalysis (clean symmetric saturated M-H loop) ───────────
    Hmx = 1000; Hc0 = 100; wch = 200; Ms0 = 5;
    Hdn = linspace(Hmx, -Hmx, 100).';  Mdn = Ms0 * tanh((Hdn + Hc0) / wch);
    Hup = linspace(-Hmx, Hmx, 100).';  Mup = Ms0 * tanh((Hup - Hc0) / wch);
    Hloop = [Hdn; Hup];  Mloop = [Mdn; Mup];
    rhy = utilities.hysteresisAnalysis(Hloop, Mloop);
    writeJson(struct('input', struct('H', Hloop.', 'M', Mloop.'), 'output', rhy), ...
        fullfile(goldenDir, 'calc_hysteresis.json'));

    % ── compareRelaxation (Arrhenius closed-form + VFT Nelder-Mead) ───────
    Tr = linspace(30, 100, 15).';
    kB2 = 8.617333e-5;
    lnTauClean = log(1e-9) + 0.05 ./ (kB2 * (Tr - 20));
    tauR = exp(lnTauClean + 0.02 * sin(Tr));  % deterministic perturbation
    rrx = utilities.compareRelaxation(Tr, tauR);
    writeJson(struct('input', struct('T', Tr.', 'tau', tauR.'), 'output', rrx), ...
        fullfile(goldenDir, 'calc_relaxation.json'));

    % ── baselineRollingBall + baselineModPoly ────────────────────────────
    xrb = linspace(0, 50, 300).';
    yrb = 100 + 30 * sin(xrb / 8) + 200 * exp(-((xrb - 20) / 0.5).^2) ...
        + 150 * exp(-((xrb - 35) / 0.7).^2);
    [blr, prmR] = utilities.baselineRollingBall(yrb);
    writeJson(struct('input', yrb.', 'params', struct('radius', 100), ...
        'output', struct('baseline', blr.', 'radius', prmR.radius, 'smooth', prmR.smooth)), ...
        fullfile(goldenDir, 'calc_rollingball.json'));
    [blm, prmM] = utilities.baselineModPoly(yrb, 'Order', 5);
    writeJson(struct('input', yrb.', 'params', struct('order', 5), ...
        'output', struct('baseline', blm.', 'order', prmM.order, ...
        'nIter', prmM.nIter, 'converged', prmM.converged)), ...
        fullfile(goldenDir, 'calc_modpoly.json'));

    % ── calc.constants (CODATA 2018) ──────────────────────────────────────
    writeJson(struct('output', calc.constants()), fullfile(goldenDir, 'calc_constants.json'));

    % ── calc.unitConvert (dimensional, temperature, bridges) ─────────────
    ucDefs = {1, 'mA/cm^2', 'A/m^2', 'dim'; 300, 'K', 'C', 'temp'; ...
              1.5406, 'Ang', 'nm', 'len'; 1, 'eV', 'nm', 'ewl'; ...
              1, 'Oe', 'T', 'oet'; 1, 'eV', 'THz', 'efreq'};
    for ui = 1:size(ucDefs, 1)
        [ucr, ucinfo] = calc.unitConvert(ucDefs{ui,1}, ucDefs{ui,2}, ucDefs{ui,3});
        writeJson(struct('input', struct('value', ucDefs{ui,1}, ...
            'from', ucDefs{ui,2}, 'to', ucDefs{ui,3}), ...
            'output', struct('result', ucr, 'factor', ucinfo.factor, ...
            'fromDims', ucinfo.fromParsed.dims, 'fromScale', ucinfo.fromParsed.scale, ...
            'toDims', ucinfo.toParsed.dims, 'toScale', ucinfo.toParsed.scale)), ...
            fullfile(goldenDir, sprintf('calc_unitconv_%s.json', ucDefs{ui,4})));
    end

    % ── calc.importCIF on the SrTiO3 test fixture ────────────────────────
    cifPath = fullfile(goldenDir, '..', 'fixtures', 'SrTiO3.cif');
    cif = calc.importCIF(cifPath);
    % NOTE: cif.tags is a dictionary (jsonencode can't serialize it) — omitted
    % from the golden; the structured outputs below cover the parse. Python
    % tests cif.tags structurally.
    writeJson(struct('output', struct('blockName', cif.blockName, ...
        'spaceGroup', cif.spaceGroup, 'formula', cif.formula, ...
        'cellParams', cif.cellParams, 'atomSites', cif.atomSites)), ...
        fullfile(goldenDir, 'calc_cif.json'));

    % ── calc.elementData: dump full table to a data file + freeze lookups ─
    elAll = calc.elementData();
    edPath = fullfile(repoRoot, 'src', 'quantized', 'calc', 'element_data.json');
    edFid = fopen(edPath, 'w'); fwrite(edFid, jsonencode(elAll)); fclose(edFid);
    fprintf('wrote %s\n', edPath);
    writeJson(struct('output', calc.elementData('bySymbol', 'Fe')), ...
        fullfile(goldenDir, 'calc_element_fe.json'));
    writeJson(struct('output', calc.elementData('byZ', 8)), ...
        fullfile(goldenDir, 'calc_element_o.json'));
    edProps.mass = calc.elementData('getProperty', 'mass');
    edProps.symbols = calc.elementData('getProperty', 'symbol');
    writeJson(struct('output', edProps), fullfile(goldenDir, 'calc_element_props.json'));

    % ── applyCorrections pipeline (XRD-like, derivative, magnetometry) ────
    xcr = linspace(10, 80, 200).';
    ycr = 100 + 0.5 * xcr + 500 * exp(-((xcr - 40) / 1).^2);
    rawc = struct('time', xcr, 'values', ycr, 'labels', {{'I'}}, ...
        'units', {{'cps'}}, 'metadata', struct());
    crIn = struct('time', xcr.', 'values', ycr.');
    % Case 1: trim + xoff + linear BG + yoff + smooth(moving) + peak-normalize
    p1 = struct('xOff', 2.0, 'yOff', 5.0, 'bgSlope', 0.5, 'bgInt', 100, ...
        'xTrimMin', 15, 'xTrimMax', 75, 'smoothEnabled', true, 'smoothWindow', 5, ...
        'smoothMethod', 'moving', 'normMethod', 'Peak (max=1)', 'derivativeMode', 'None');
    cc1 = bosonPlotter.applyCorrections(rawc, p1);
    writeJson(struct('input', crIn, 'output', struct('time', cc1.time.', 'values', cc1.values.')), ...
        fullfile(goldenDir, 'calc_corrections_xrd.json'));
    % Case 2: linear BG + first derivative
    p2 = struct('xOff', 0, 'yOff', 0, 'bgSlope', 0.5, 'bgInt', 100, ...
        'xTrimMin', NaN, 'xTrimMax', NaN, 'smoothEnabled', false, 'smoothWindow', 5, ...
        'smoothMethod', 'moving', 'normMethod', 'None', 'derivativeMode', 'dY/dX');
    cc2 = bosonPlotter.applyCorrections(rawc, p2);
    writeJson(struct('input', crIn, 'output', struct('time', cc2.time.', 'values', cc2.values.')), ...
        fullfile(goldenDir, 'calc_corrections_deriv.json'));
    % Case 3: magnetometry — field Oe->T, moment emu->emu/g (mass=2)
    xm = linspace(-5000, 5000, 120).';
    ym = 3 * tanh(xm / 1000) + 0.001 * xm;  % loop + small diamag slope
    rawm = struct('time', xm, 'values', ym, 'labels', {{'M'}}, ...
        'units', {{'emu'}}, 'metadata', struct());
    p3 = struct('xOff', 0, 'yOff', 0, 'bgSlope', 0.001, 'bgInt', 0, ...
        'xTrimMin', NaN, 'xTrimMax', NaN, 'smoothEnabled', false, 'smoothWindow', 5, ...
        'smoothMethod', 'moving', 'normMethod', 'None', 'derivativeMode', 'None', ...
        'isMag', true, 'fieldUnit', 'T', 'momentUnit', 'emu/g', 'sampleMass', 2.0);
    cc3 = bosonPlotter.applyCorrections(rawm, p3);
    writeJson(struct('input', struct('time', xm.', 'values', ym.'), ...
        'output', struct('time', cc3.time.', 'values', cc3.values.')), ...
        fullfile(goldenDir, 'calc_corrections_mag.json'));

    % ── fitting.models: evaluate every model at its p0 over a fixed grid ──
    fmCat = fitting.models();
    xfm = linspace(1, 10, 25).';  % x>=1 keeps VFT finite (Inf -> null -> nan otherwise)
    fmOut = cell(numel(fmCat), 1);
    for fi = 1:numel(fmCat)
        fm = fmCat(fi);
        yfm = fm.fcn(xfm, fm.p0);
        fmOut{fi} = struct('name', fm.name, 'p0', fm.p0, 'y', yfm(:).');
    end
    writeJson(struct('x', xfm.', 'models', {fmOut}), ...
        fullfile(goldenDir, 'calc_fit_models.json'));

    % ── fitting.hysteresisModels: M-H loop models at p0 over a field grid ─
    % Symmetric field sweep avoiding H=0 (40 pts → no sample at the origin,
    % so the approach-to-saturation 1/|H| and 1/H^2 terms stay well-behaved).
    hyCat = fitting.hysteresisModels();
    xhy = linspace(-5000, 5000, 40).';
    hyOut = cell(numel(hyCat), 1);
    for hi = 1:numel(hyCat)
        hm = hyCat(hi);
        yhy = hm.fcn(xhy, hm.p0);
        hyOut{hi} = struct('name', hm.name, 'p0', hm.p0, 'y', yhy(:).');
    end
    writeJson(struct('x', xhy.', 'models', {hyOut}), ...
        fullfile(goldenDir, 'calc_hysteresis_models.json'));

    % ── fitting.autoGuess: initial-parameter guess for every model ────────
    agCat = fitting.models();
    xag = linspace(1, 20, 50).';
    yag = 5 * exp(-((xag - 10) / 3).^2) + 1;  % positive peak (exercises branches)
    agOut = cell(numel(agCat), 1);
    for ai = 1:numel(agCat)
        nm = agCat(ai).name;
        gg = fitting.autoGuess(nm, xag, yag);
        agOut{ai} = struct('name', nm, 'p0', gg(:).');
    end
    writeJson(struct('x', xag.', 'y', yag.', 'guesses', {agOut}), ...
        fullfile(goldenDir, 'calc_autoguess.json'));

    % ── fitting.curveFit: bounded NLLS of a Gaussian on synthetic data ────
    xfit = linspace(0, 20, 80).';
    yfit = 5 * exp(-((xfit - 10) / 2).^2) + 0.05 * sin(xfit);  % gaussian + tiny det. noise
    cfCat = fitting.models();
    mg = cfCat(strcmp({cfCat.name}, 'Gaussian'));
    p0g = fitting.autoGuess('Gaussian', xfit, yfit);
    rf = fitting.curveFit(xfit, yfit, mg.fcn, p0g, 'Lower', mg.lb, 'Upper', mg.ub);
    writeJson(struct('input', struct('x', xfit.', 'y', yfit.'), 'p0', p0g, ...
        'output', struct('params', rf.params, 'R2', rf.R2, 'chiSqRed', rf.chiSqRed, ...
        'RMSE', rf.RMSE, 'AIC', rf.AIC, 'errors', rf.errors)), ...
        fullfile(goldenDir, 'calc_curvefit_gauss.json'));

    % ── fitCompare / residualDiagnostics / fitBands (from a Gaussian fit) ─
    xfb = linspace(0, 20, 80).';
    yfb = 5 * exp(-((xfb - 10) / 2).^2) + 0.05 * sin(xfb);
    fsCat = fitting.models();
    mgf = fsCat(strcmp({fsCat.name}, 'Gaussian'));
    mlf = fsCat(strcmp({fsCat.name}, 'Linear'));
    p0g = fitting.autoGuess('Gaussian', xfb, yfb);
    rg = fitting.curveFit(xfb, yfb, mgf.fcn, p0g, 'Lower', mgf.lb, 'Upper', mgf.ub);
    rl = fitting.curveFit(xfb, yfb, mlf.fcn, [0 0]);   % nested reference (2 params)
    % fitCompare with nested F-test
    mc = fitting.fitCompare(yfb, rg.residuals, rg.nFree, ...
        'ResidRef', rl.residuals, 'NParamsRef', rl.nFree);
    writeJson(struct('input', struct('y', yfb.', 'residuals', rg.residuals.', ...
        'nParams', rg.nFree, 'residRef', rl.residuals.', 'nParamsRef', rl.nFree), ...
        'output', struct('R2', mc.R2, 'adjR2', mc.adjR2, 'aic', mc.aic, 'aicc', mc.aicc, ...
        'bic', mc.bic, 'rmse', mc.rmse, 'fStat', mc.fStat, 'fPvalue', mc.fPvalue, ...
        'n', mc.n, 'p', mc.p)), fullfile(goldenDir, 'calc_fitcompare.json'));
    % residualDiagnostics
    rd = fitting.residualDiagnostics(rg.residuals);
    writeJson(struct('input', rg.residuals.', 'output', struct('qqX', rd.qqX.', ...
        'qqY', rd.qqY.', 'durbinWatson', rd.durbinWatson, 'runsTestZ', rd.runsTestZ, ...
        'runsTestP', rd.runsTestP, 'nRuns', rd.nRuns, 'nPos', rd.nPos, 'nNeg', rd.nNeg, ...
        'skewness', rd.skewness, 'kurtosis', rd.kurtosis)), ...
        fullfile(goldenDir, 'calc_residdiag.json'));
    % fitBands
    xgb = linspace(0, 20, 40).';
    bd = fitting.fitBands(xgb, mgf.fcn, rg.params, rg.covar, rg.nPoints, rg.nFree);
    writeJson(struct('input', struct('xGrid', xgb.', 'params', rg.params, 'covar', rg.covar, ...
        'nPoints', rg.nPoints, 'nFree', rg.nFree), 'output', struct('yFit', bd.yFit.', ...
        'ciLo', bd.ciLo.', 'ciHi', bd.ciHi.', 'piLo', bd.piLo.', 'piHi', bd.piHi.', ...
        'level', bd.level)), fullfile(goldenDir, 'calc_fitbands.json'));

    % ── fitting.parseEquation: parse + eval custom equation strings ───────
    xeq = linspace(0.5, 5, 20).';
    eqDefs = {
        'a*exp(-x/b)+c',        [2, 1.5, 0.3];
        'A*sin(w*x+phi)',       [3, 2, 0.7];
        '-x^2 + 2*x',           [];
        'k*tanh((x-x0)/d)',     [5, 2, 0.5];
        'sqrt(abs(x)) + log(x)', []
    };
    eqOut = cell(size(eqDefs, 1), 1);
    for ei = 1:size(eqDefs, 1)
        [efcn, epn] = fitting.parseEquation(eqDefs{ei, 1});
        ep = eqDefs{ei, 2};
        yv = efcn(xeq, ep);
        eqOut{ei} = struct('eqn', eqDefs{ei, 1}, 'paramNames', {epn}, ...
            'p', ep, 'y', yv(:).');
    end
    writeJson(struct('x', xeq.', 'equations', {eqOut}), ...
        fullfile(goldenDir, 'calc_parseeqn.json'));

    % ── parrattRefl: specular reflectivity of a 3-layer stack ─────────────
    reflLayers = [0,   0,        0, 0; ...    % ambient (vacuum)
                  200, 4.0e-6,   0, 5; ...    % film 200 Å
                  0,   2.07e-6,  0, 3];       % Si substrate
    Qr = linspace(0.01, 0.3, 100).';
    Rr = fitting.parrattRefl(Qr, reflLayers);
    writeJson(struct('input', struct('Q', Qr.', 'layers', reflLayers), ...
        'output', Rr.'), fullfile(goldenDir, 'calc_parratt.json'));
    Rres = fitting.parrattRefl(Qr, reflLayers, 'Resolution', 0.02);
    writeJson(struct('input', struct('Q', Qr.', 'layers', reflLayers, 'resolution', 0.02), ...
        'output', Rres.'), fullfile(goldenDir, 'calc_parratt_res.json'));

    % ── SLD profile helpers + presets (reuses reflLayers from above) ──────
    [zp, sldp] = fitting.sldProfile(reflLayers);
    writeJson(struct('input', reflLayers, 'output', struct('z', zp.', 'sld', sldp.')), ...
        fullfile(goldenDir, 'calc_sldprofile.json'));
    zk = [0; 50; 100; 150; 200];
    sk = [2e-6; 4e-6; 3e-6; 5e-6; 2.07e-6];
    [zs, slds] = fitting.splineSLD(zk, sk);
    writeJson(struct('input', struct('zKnots', zk.', 'sldKnots', sk.'), ...
        'output', struct('z', zs.', 'sld', slds.')), ...
        fullfile(goldenDir, 'calc_splinesld.json'));
    zpr = linspace(0, 200, 11).';
    sldpr = 2e-6 + 3e-6 * exp(-((zpr - 100) / 40).^2);
    plLayers = fitting.profileToLayers(zpr, sldpr);
    writeJson(struct('input', struct('z', zpr.', 'sld', sldpr.'), 'output', plLayers), ...
        fullfile(goldenDir, 'calc_profiletolayers.json'));
    prFid = fopen(fullfile(repoRoot, 'src', 'quantized', 'calc', 'refl_sld_presets.json'), 'w');
    fwrite(prFid, jsonencode(fitting.reflSLDPresets()));
    fclose(prFid);
    fprintf('wrote refl_sld_presets.json\n');

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

    % ── fitSinglePeak: one peak per model on synthetic data + tiny perturbation ─
    % Some utilities.* peak shapes return a row → force column before adding the
    % column-shaped perturbation, else MATLAB broadcasts to an N×N matrix.
    xpf = linspace(28, 32, 200).';  pfLo = 29; pfHi = 31;
    pfSeed = struct('center', 30, 'fwhm', NaN);
    pfLor = 100 ./ (1 + 4*((xpf-30)/0.4).^2) + 5 + 0.1*sin(3*xpf);  pfLor = pfLor(:);
    pfGau = 50 .* exp(-4*log(2)*((xpf-30)/0.5).^2) + 2 + 0.1*cos(2*xpf);  pfGau = pfGau(:);
    pfPV  = utilities.pseudoVoigt(xpf, 30, 0.45, 80, 0.6, 3);  pfPV = pfPV(:) + 0.1*sin(2.5*xpf);
    pfSPV = utilities.splitPearsonVII(xpf, [90 30 0.2 0.25 1.5 1.5 4]);  pfSPV = pfSPV(:) + 0.05*cos(2*xpf);
    pfTCH = utilities.tchPseudoVoigt(xpf, [85 30 0.3 0.15 3]);  pfTCH = pfTCH(:) + 0.05*sin(2*xpf);
    pfDefs = {'Lorentzian', pfLor; 'Gaussian', pfGau; 'Pseudo-Voigt', pfPV; ...
              'Split Pearson VII', pfSPV; 'TCH-pV', pfTCH};
    pfCases = cell(size(pfDefs, 1), 1);
    for pfi = 1:size(pfDefs, 1)
        pfRes = bosonPlotter.peak.fitSinglePeak(xpf, pfDefs{pfi,2}, pfLo, pfHi, ...
            pfSeed, pfDefs{pfi,1}, []);
        pfCases{pfi} = struct('model', pfDefs{pfi,1}, 'y', pfDefs{pfi,2}(:).', 'result', pfRes);
    end
    writeJson(struct('x', xpf.', 'xLo', pfLo, 'xHi', pfHi, 'cases', {pfCases}), ...
        fullfile(goldenDir, 'calc_peakfit.json'));

    % ── evalMultiPeak / evalMultiPeakPV: sum of peaks + linear background ──
    xmp = linspace(28, 32, 60).';
    mpLor = [100 29.5 0.3, 60 30.2 0.4, 40 31.0 0.25, 2, 5];  % [H x0 fw]*3, m, b
    mpPV  = [120 29.8 0.35 0.5, 80 30.6 0.30 0.8, 1.5, 3];    % [H x0 fw eta]*2, m, b
    writeJson(struct('x', xmp.', ...
        'lorentzian',  struct('p', mpLor, 'nP', 3, ...
            'y', bosonPlotter.peak.evalMultiPeak(mpLor, xmp, 3, false).'), ...
        'gaussian',    struct('p', mpLor, 'nP', 3, ...
            'y', bosonPlotter.peak.evalMultiPeak(mpLor, xmp, 3, true).'), ...
        'pseudovoigt', struct('p', mpPV, 'nP', 2, ...
            'y', bosonPlotter.peak.evalMultiPeakPV(mpPV, xmp, 2).')), ...
        fullfile(goldenDir, 'calc_multipeak.json'));

    % ── fitting.applyConstraints: expand free params via constraint exprs ──
    acDefs = {
        {3.5},  {'', '2*p1'},             {'a','b'};
        {1, 2}, {'', '', 'p1 + p2'},      {'a','b','c'};
        {2, 5}, {'', '', 'a + 2*tau'},    {'a','tau','C'};
        {2, 3}, {'b + c', '', ''},        {'a','b','c'};
        {9, 1}, {'', '', 'sqrt(p1) + 1'}, {'a','b','c'};
    };
    acCases = cell(size(acDefs, 1), 1);
    for aci = 1:size(acDefs, 1)
        acPFree = cell2mat(acDefs{aci, 1});
        [acFull, acFree] = fitting.applyConstraints(acPFree, acDefs{aci, 2}, acDefs{aci, 3});
        acCases{aci} = struct('pFree', acPFree, 'constraints', {acDefs{aci, 2}}, ...
            'names', {acDefs{aci, 3}}, 'pFull', acFull, 'freeIdx', acFree);
    end
    writeJson(struct('cases', {acCases}), fullfile(goldenDir, 'calc_constraints.json'));

    % ── fitting.odrFit: closed-form Deming regression + jackknife SEs ─────
    xodr = linspace(0, 10, 20).' + 0.05*sin((1:20).');
    yodr = 2*xodr + 1 + 0.1*cos((1:20).');
    xeOdr = 0.2*ones(20,1);  yeOdr = 0.4*ones(20,1);
    writeJson(struct('x', xodr.', 'y', yodr.', 'xerr', xeOdr.', 'yerr', yeOdr.', ...
        'default',    fitting.odrFit(xodr, yodr), ...
        'lambda4',    fitting.odrFit(xodr, yodr, 'Lambda', 4), ...
        'fromErrors', fitting.odrFit(xodr, yodr, 'XError', xeOdr, 'YError', yeOdr)), ...
        fullfile(goldenDir, 'calc_odr.json'));

    % ── fitting.trackPeak: follow a drifting peak across a scan series ────
    xtp = linspace(40, 50, 200).';
    tpCenters = [45.0, 45.3, 45.7, 46.1, 46.4];
    tpG = cell(1, numel(tpCenters));  tpL = cell(1, numel(tpCenters));
    tpYG = cell(1, numel(tpCenters));  tpYL = cell(1, numel(tpCenters));
    for ti = 1:numel(tpCenters)
        yG = 100 * exp(-(xtp - tpCenters(ti)).^2 / (2*0.5^2)) + 2 + 0.05*sin(xtp);
        yL = 100 ./ (1 + ((xtp - tpCenters(ti)) / 0.5).^2) + 2 + 0.05*sin(xtp);
        tpG{ti} = {xtp, yG};  tpL{ti} = {xtp, yL};
        tpYG{ti} = yG.';      tpYL{ti} = yL.';
    end
    writeJson(struct('x', xtp.', 'seed', 45.0, 'window', 2, ...
        'gaussian',   struct('y', {tpYG}, ...
            'result', fitting.trackPeak(tpG, 45.0, 'Window', 2, 'Shape', 'gaussian')), ...
        'lorentzian', struct('y', {tpYL}, ...
            'result', fitting.trackPeak(tpL, 45.0, 'Window', 2, 'Shape', 'lorentzian'))), ...
        fullfile(goldenDir, 'calc_trackpeak.json'));

    % ── fitting.batchFit: same fit across a series of {x,y} datasets ──────
    xbf = linspace(0, 10, 80).';
    bfTaus = [1.5, 2.0, 2.8, 3.5];
    bfData = cell(1, numel(bfTaus));  bfY = cell(1, numel(bfTaus));
    for bi = 1:numel(bfTaus)
        yb = 5*exp(-xbf/bfTaus(bi)) + 0.5 + 0.02*sin(3*xbf);
        bfData{bi} = {xbf, yb};  bfY{bi} = yb.';
    end
    bfCat = fitting.models();
    bfM = bfCat(strcmp({bfCat.name}, 'Exponential Decay'));
    bfS = fitting.batchFit(bfData, bfM.fcn, bfM.p0, 'Lower', bfM.lb, 'Upper', bfM.ub, ...
        'ModelName', 'Exponential Decay', 'Verbose', false);
    writeJson(struct('x', xbf.', 'y', {bfY}, 'p0', bfM.p0, 'lb', bfM.lb, 'ub', bfM.ub, ...
        'summary', bfS), fullfile(goldenDir, 'calc_batchfit.json'));

    % ── fitting.globalFit: shared-parameter fit across datasets ───────────
    gfFcn = @(x,p) p(1).*exp(-x./p(2)) + p(3);   % A free per dataset; tau,C shared
    xgf = linspace(0, 10, 60).';
    gfA = [5.0, 3.0, 7.0];  gfTau = 2.5;  gfC = 0.5;
    gfData = cell(1, 3);  gfY = cell(1, 3);
    for gi = 1:3
        yg = gfFcn(xgf, [gfA(gi), gfTau, gfC]) + 0.02*sin(3*xgf);
        gfData{gi} = {xgf, yg};  gfY{gi} = yg.';
    end
    gfShared = [false true true];  gfP0 = [4.0, 2.0, 0.0];
    gfR = fitting.globalFit(gfData, gfFcn, gfP0, gfShared, ...
        'Lower', [0 0 -Inf], 'Upper', [Inf Inf Inf], 'Verbose', false);
    writeJson(struct('x', xgf.', 'y', {gfY}, 'p0', gfP0, 'lb', [0 0 -Inf], ...
        'ub', [Inf Inf Inf], 'sharedMask', gfShared, 'result', gfR), ...
        fullfile(goldenDir, 'calc_globalfit.json'));

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

    % ── multi-peak simultaneous fit (peakAnalysis.onFitSimultaneous) ──────
    %   Replicates the GUI-nested fit driver (buildCompositeModel + compositeEval
    %   + computeArea, copied verbatim in mpfRunCase) and uses the EXPOSED
    %   bosonPlotter.buildLinkedPacker. Synthetic x/y are emitted so the Python
    %   port fits the identical curve. NB: onFitSimultaneous sets MaxIter=30000
    %   but leaves MaxFunEvals at fminsearch's default 200*nFree, so the fit is
    %   eval-limited — the Python port replicates that budget (see peak_multifit).
    writeJson(mpfFreeze(), fullfile(goldenDir, 'calc_multipeakfit.json'));

    % ── fitting.globalCurveFit: named per-group shared-parameter global fit ─
    %   Richer than globalFit (boolean mask, shared across ALL): each constraint
    %   names a param and the SUBSET of datasets sharing it. fminsearch over the
    %   curveFit bound transform; errors from a numerical Hessian. 4 cases:
    %   Gaussian shared-sigma / no-constraint / subset-share, + Exp shared-tau.
    writeJson(gcfFreeze(), fullfile(goldenDir, 'calc_globalcurvefit.json'));

    % ── fitting.{surfaceModels,surfaceAutoGuess,surfaceFit}: 2D surface fit ─
    %   Model evals (exact), per-model auto-guesses, and full fits (internal
    %   auto-guess + fminsearch over the curveFit bound transform, unbounded).
    writeJson(sfFreeze(), fullfile(goldenDir, 'calc_surfacefit.json'));

    % ── fitting.{rsmAnalyze,rsmStrain}: RSM peak extraction + strain ───────
    %   Deterministic synthetic 2-Gaussian map (substrate+film) + Q grids:
    %   smooth → local maxima → per-peak surfaceFit (angle + Q) → strain chain.
    writeJson(rsmFreeze(), fullfile(goldenDir, 'calc_rsm.json'));

    % ── BG-from-region: box-mask + polyfit (BosonPlotter onBGMouseUp core) ─
    writeJson(bgrFreeze(), fullfile(goldenDir, 'calc_bgregion.json'));

    % ── BG-from-file: subtract an interpolated reference-background dataset ─
    %   (applyCorrections step 4). Active x overhangs the bg range on both
    %   sides to exercise interp1's 0-fill; linear/pchip/spline interp methods.
    writeJson(bgfFreeze(), fullfile(goldenDir, 'calc_bgfromfile.json'));

    % ── Q-space: parser.computeQSpace coplanar RSM Qx/Qz from (omega,2theta) ─
    writeJson(qspFreeze(), fullfile(goldenDir, 'calc_qspace.json'));

    fprintf('Done.\n');
end

function writeJson(s, outPath)
    fid = fopen(outPath, 'w');
    assert(fid > 0, 'cannot open %s', outPath);
    fwrite(fid, jsonencode(s));
    fclose(fid);
    fprintf('froze %s\n', outPath);
end

% ════════════════════════════════════════════════════════════════════════
%  globalCurveFit freeze (named per-group shared parameters)
% ════════════════════════════════════════════════════════════════════════
function out = gcfFreeze()
    m = fitting.models();
    gauss = m(strcmp({m.name}, 'Gaussian'));            % p=[A,mu,sigma]
    expd  = m(strcmp({m.name}, 'Exponential Decay'));   % p=[A,tau,C]
    out = struct();

    xg = linspace(-5, 5, 80);
    gtrue = {[10 -1.0 1.2], [6 0.5 1.2], [8 1.5 1.2]};
    dsG = cell(1,3);
    for i=1:3, dsG{i} = {xg, gcfEval(gauss.fcn, xg, gtrue{i}) + 0.05*sin(2*xg)}; end
    ig = {[9 -0.8 1.0], [5 0.4 1.0], [7 1.3 1.0]};
    lbU = {[-Inf -Inf 0.1]}; ubU = {[Inf Inf 10]};

    cG = struct('paramName', 'sigma', 'datasets', [1 2 3]);   % ASCII -> Greek alias
    out.gauss_shared_sigma = gcfPack(dsG, gauss, ...
        fitting.globalCurveFit(dsG, gauss, cG, 'InitGuess', ig, 'LowerBound', lbU, 'UpperBound', ubU), cG, ig);

    out.gauss_no_constraint = gcfPack(dsG, gauss, ...
        fitting.globalCurveFit(dsG, gauss, [], 'InitGuess', ig, 'LowerBound', lbU, 'UpperBound', ubU), [], ig);

    cSub = struct('paramName', 'sigma', 'datasets', [1 2]);   % subset share
    out.gauss_subset = gcfPack(dsG, gauss, ...
        fitting.globalCurveFit(dsG, gauss, cSub, 'InitGuess', ig, 'LowerBound', lbU, 'UpperBound', ubU), cSub, ig);

    xe = linspace(0, 8, 70);
    etrue = {[5 2.5 0.5], [3 2.5 1.0], [7 2.5 0.2]};
    dsE = cell(1,3);
    for i=1:3, dsE{i} = {xe, gcfEval(expd.fcn, xe, etrue{i}) + 0.03*sin(3*xe)}; end
    ige = {[4 2 0], [2.5 2 0.5], [6 2 0]};
    lbE = {[-Inf 0 -Inf]}; ubE = {[Inf Inf Inf]};
    cE = struct('paramName', 'τ', 'datasets', [1 2 3]);
    out.exp_shared_tau = gcfPack(dsE, expd, ...
        fitting.globalCurveFit(dsE, expd, cE, 'InitGuess', ige, 'LowerBound', lbE, 'UpperBound', ubE), cE, ige);
end

function y = gcfEval(fcn, x, p), y = fcn(x(:), p); y = y(:)'; end

function s = gcfPack(ds, model, r, constraints, ig)
    K = numel(ds);
    s = struct();
    s.x = ds{1}{1};
    yy = cell(1,K); for i=1:K, yy{i} = ds{i}{2}; end
    s.y = yy;
    s.paramNames = model.paramNames;
    s.initGuess = ig;
    if isempty(constraints)
        s.constraints = {};
    else
        cc = cell(1, numel(constraints));
        for i=1:numel(constraints)
            cc{i} = struct('paramName', char(string(constraints(i).paramName)), ...
                           'datasets', constraints(i).datasets);
        end
        s.constraints = cc;
    end
    res = struct('params', {r.params}, 'errors', {r.errors}, 'R2', r.R2, 'RMSE', r.RMSE, ...
        'chiSqRed', r.chiSqRed, 'nTotal', r.nTotal, 'nFree', r.nFree, 'exitFlag', r.exitFlag);
    if isempty(r.shared)
        res.shared = {};
    else
        sh = cell(1, numel(r.shared));
        for i=1:numel(r.shared)
            sh{i} = struct('name', r.shared(i).name, 'paramIdx', r.shared(i).paramIdx, ...
                'datasets', r.shared(i).datasets, 'value', r.shared(i).value, 'error', r.shared(i).error);
        end
        res.shared = sh;
    end
    s.result = res;
end

% ════════════════════════════════════════════════════════════════════════
%  Multi-peak simultaneous fit freeze (onFitSimultaneous replica)
% ════════════════════════════════════════════════════════════════════════
function out = mpfFreeze()
    out = struct();
    x = linspace(10, 30, 300);
    y = 5 + 0.2*x + mpfLorz(20,16,1.5,x) + mpfLorz(12,24,2.0,x);
    out.lorentzian = mpfRunCase(x, y, mpfPeaks([15.6 24.4],[1.0 1.0],[18 11]), ...
        'Lorentzian', 1, false, 'None');

    x2 = linspace(0, 40, 350);
    y2 = 3 + 0.05*x2 + mpfGaus(30,14,2.0,x2) + mpfGaus(18,27,1.6,x2);
    out.gaussian = mpfRunCase(x2, y2, mpfPeaks([13.9 26.9],[1.9 1.7],[29 17]), ...
        'Gaussian', 1, false, 'None');

    x3 = linspace(20, 60, 320);
    y3 = 2 + 0.1*x3 + mpfPvgt(25,33,2.2,0.6,x3) + mpfPvgt(16,47,2.2,0.6,x3);
    out.pv_shared = mpfRunCase(x3, y3, mpfPeaksEta([32.6 47.4],[2.0 2.0],[23 15],[0.5 0.5]), ...
        'Pseudo-Voigt', 1, false, 'Shared FWHM');

    x4 = linspace(0, 50, 400);
    y4 = 4 + 0.08*x4 + mpfLorz(22,12,1.8,x4) + mpfLorz(15,25,2.2,x4) + mpfLorz(18,38,1.5,x4);
    out.lorentzian_constrained = mpfRunCase(x4, y4, ...
        mpfPeaks([12.5 24.5 38.4],[1.5 1.5 1.5],[20 14 16]), 'Lorentzian', 1, true, 'None');

    out.pv_shared_eta = mpfRunCase(x3, y3, ...
        mpfPeaksEta([32.6 47.4],[2.0 2.0],[23 15],[0.5 0.5]), ...
        'Pseudo-Voigt', 1, false, 'Shared FWHM + eta');

    % Direct golden of the exposed packer.
    p0d = [20 16 1.5,  12 24 2.0,  5 0.2];  ci = [2 5];
    lp = struct();
    [pf, ef, fci] = bosonPlotter.buildLinkedPacker(p0d, 2, 3, 2, 'Shared FWHM', ci);
    pfp = pf + 0.5;
    lp.shared_fwhm = struct('p0', p0d, 'pFree0', pf, 'expand_pFree0', ef(pf), ...
        'freeCenterIdx', fci, 'pFree_perturbed', pfp, 'expand_perturbed', ef(pfp));
    p0e = [20 16 1.5 0.6,  12 24 2.0 0.4,  5 0.2];
    [pf2, ef2, fci2] = bosonPlotter.buildLinkedPacker(p0e, 2, 4, 2, 'Shared FWHM + eta', [2 6]);
    lp.shared_eta = struct('p0', p0e, 'pFree0', pf2, 'expand_pFree0', ef2(pf2), ...
        'freeCenterIdx', fci2);
    [pf3, ~, fci3] = bosonPlotter.buildLinkedPacker(p0d, 2, 3, 2, 'None', ci);
    lp.none = struct('pFree0', pf3, 'freeCenterIdx', fci3);
    out.linked_packer = lp;
end

function res = mpfRunCase(xv, yv, detectedPeaks, modelName, bgDeg, constrain, linkMode)
    xv = xv(:)'; yv = yv(:)';
    nP = numel(detectedPeaks);
    xSpan = max(xv) - min(xv);
    [modelFun, p0, nPPerPeak, centerIndices, seedCenters] = ...
        mpfBuildComposite(xv, yv, detectedPeaks, modelName, bgDeg);
    nBgParams = bgDeg + 1;
    [pFree0, freeToFull, freeCenterIdx] = bosonPlotter.buildLinkedPacker( ...
        p0, nP, nPPerPeak, nBgParams, linkMode, centerIndices);
    if constrain && nP > 1
        centerBnd = zeros(1, nP);
        for k = 1:nP
            fwInit = abs(p0((k-1)*nPPerPeak + 3));
            centerBnd(k) = max(3 * fwInit, xSpan * 0.02);
        end
        penaltyWt = sum((yv - mean(yv)).^2) * 10;
        objFun = @(pFree) sum((modelFun(freeToFull(pFree), xv) - yv).^2) + ...
            penaltyWt * sum(max(0, ((pFree(freeCenterIdx) - seedCenters) ./ centerBnd).^2 - 1));
    else
        objFun = @(pFree) sum((modelFun(freeToFull(pFree), xv) - yv).^2);
    end
    opts = optimset('Display', 'off', 'MaxIter', 30000, 'TolX', 1e-10, 'TolFun', 1e-14);
    pFreeFit = fminsearch(objFun, pFree0, opts);
    pFit     = freeToFull(pFreeFit);
    bgParams = pFit(end-nBgParams+1:end);
    peaks = struct('center', {}, 'fwhm', {}, 'height', {}, 'bg', {}, ...
                   'eta', {}, 'area', {}, 'status', {});
    for k = 1:nP
        base = (k-1) * nPPerPeak;
        pk = struct();
        pk.center = pFit(base+2); pk.fwhm = abs(pFit(base+3)); pk.height = pFit(base+1);
        pk.bg = polyval(flip(bgParams), pk.center);
        if nPPerPeak == 4, pk.eta = max(0, min(1, pFit(base+4))); else, pk.eta = NaN; end
        pk.area = mpfArea(modelName, pk);
        pk.status = 'fitted(global)';
        peaks(k) = pk; %#ok<AGROW>
    end
    yFitted = modelFun(pFit, xv);
    ssRes = sum((yv - yFitted).^2); ssTot = sum((yv - mean(yv)).^2);
    res = struct('x', xv, 'y', yv, 'seeds', mpfPackSeeds(detectedPeaks), ...
        'model', modelName, 'bgDeg', bgDeg, 'constrain', constrain, 'linkMode', linkMode, ...
        'peaks', peaks, 'bgCoeffs', bgParams, 'params', pFit, ...
        'R2', 1 - ssRes / max(ssTot, eps), 'rmse', sqrt(ssRes / numel(yv)), 'nPeaks', nP);
end

function [modelFun, p0, nPPerPeak, centerIndices, seedCenters] = ...
        mpfBuildComposite(xv, yv, peaks, modelName, bgDeg)
    nP = numel(peaks); xSpan = max(xv) - min(xv);
    isPV = strcmp(modelName, 'Pseudo-Voigt');
    if isPV, nPPerPeak = 4; else, nPPerPeak = 3; end
    nBgParams = bgDeg + 1;
    p0 = zeros(1, nP * nPPerPeak + nBgParams);
    centerIndices = zeros(1, nP); seedCenters = zeros(1, nP);
    for k = 1:nP
        pk = peaks(k); base = (k-1) * nPPerPeak;
        p0(base+1) = max(pk.height, max(yv) * 0.01);
        p0(base+2) = pk.center;
        p0(base+3) = max(pk.fwhm, xSpan * 0.005);
        if isPV
            eta0 = 0.5;
            if isfield(pk, 'eta') && ~isnan(pk.eta), eta0 = pk.eta; end
            p0(base+4) = eta0;
        end
        centerIndices(k) = base + 2; seedCenters(k) = pk.center;
    end
    p0(end-nBgParams+1) = min(yv);
    if nBgParams >= 2, p0(end-nBgParams+2) = 0; end
    modelFun = @(p, x) mpfComposite(p, x, nP, nPPerPeak, nBgParams, modelName);
end

function y = mpfComposite(p, x, nP, nPPerPeak, nBgParams, modelName)
    bgCoeffs = p(end-nBgParams+1:end);
    y = polyval(flip(bgCoeffs), x);
    for k = 1:nP
        base = (k-1) * nPPerPeak;
        H = p(base+1); x0 = p(base+2); fw = p(base+3);
        if fw == 0, fw = eps; end
        switch modelName
            case 'Gaussian'
                y = y + H .* exp(-4 .* log(2) .* ((x - x0) ./ fw).^2);
            case 'Pseudo-Voigt'
                eta = max(0, min(1, p(base+4)));
                y = y + eta .* (H ./ (1 + 4 .* ((x - x0) ./ fw).^2)) + ...
                    (1 - eta) .* (H .* exp(-4 .* log(2) .* ((x - x0) ./ fw).^2));
            case 'Split Pearson VII'
                m = 1.5;
                y = y + H .* (1 + 4 .* (2^(1/m) - 1) .* ((x - x0) ./ fw).^2).^(-m);
            case 'TCH-pV'
                y = y + 0.5 .* (H ./ (1 + 4 .* ((x - x0) ./ fw).^2)) + ...
                    0.5 .* (H .* exp(-4 .* log(2) .* ((x - x0) ./ fw).^2));
            otherwise
                y = y + H ./ (1 + 4 .* ((x - x0) ./ fw).^2);
        end
    end
end

function area = mpfArea(modelName, pk)
    H = pk.height; fw = pk.fwhm;
    switch modelName
        case 'Gaussian'
            area = H * fw * sqrt(pi / log(2)) / 2;
        case 'Pseudo-Voigt'
            eta = 0.5;
            if isfield(pk, 'eta') && ~isnan(pk.eta), eta = pk.eta; end
            area = H * fw * (eta * (pi/2) + (1 - eta) * (sqrt(pi) / (2 * sqrt(log(2)))));
        otherwise
            area = H * fw * pi / 2;
    end
end

function y = mpfLorz(H, x0, fw, x), y = H ./ (1 + 4 .* ((x - x0) ./ fw).^2); end
function y = mpfGaus(H, x0, fw, x), y = H .* exp(-4 .* log(2) .* ((x - x0) ./ fw).^2); end
function y = mpfPvgt(H, x0, fw, eta, x)
    y = eta .* (H ./ (1 + 4 .* ((x - x0) ./ fw).^2)) + ...
        (1 - eta) .* (H .* exp(-4 .* log(2) .* ((x - x0) ./ fw).^2));
end
function s = mpfPeaks(centers, fwhms, heights)
    s = struct('center', {}, 'fwhm', {}, 'height', {});
    for k = 1:numel(centers)
        s(k) = struct('center', centers(k), 'fwhm', fwhms(k), 'height', heights(k));
    end
end
function s = mpfPeaksEta(centers, fwhms, heights, etas)
    s = struct('center', {}, 'fwhm', {}, 'height', {}, 'eta', {});
    for k = 1:numel(centers)
        s(k) = struct('center', centers(k), 'fwhm', fwhms(k), ...
                      'height', heights(k), 'eta', etas(k));
    end
end
function arr = mpfPackSeeds(detectedPeaks)
    arr = struct('center', {}, 'fwhm', {}, 'height', {}, 'eta', {});
    for k = 1:numel(detectedPeaks)
        pk = detectedPeaks(k); e = NaN;
        if isfield(pk, 'eta'), e = pk.eta; end
        arr(k) = struct('center', pk.center, 'fwhm', pk.fwhm, 'height', pk.height, 'eta', e);
    end
end

% ════════════════════════════════════════════════════════════════════════
%  2D surface fit freeze (surfaceModels / surfaceAutoGuess / surfaceFit)
% ════════════════════════════════════════════════════════════════════════
function out = sfFreeze()
    cat = fitting.surfaceModels();
    out = struct();
    [X, Y] = meshgrid(linspace(-4, 4, 11), linspace(-3, 3, 9));
    x = X(:); y = Y(:);
    out.x = x'; out.y = y';

    P = containers.Map();
    P('Plane')                = [2 3 1];
    P('Paraboloid')           = [0.5 -0.3 0.2 1 -1 2];
    P('2D Gaussian')          = [3 0.5 1.5 -0.5 1.2 0.4];
    P('2D Lorentzian')        = [3 0.5 1.5 -0.5 1.2 0.4];
    P('2D Pseudo-Voigt')      = [3 0.5 1.5 -0.5 1.2 0.4 0.6];
    P('Polynomial 2D')        = [2 0.5 -0.3 0.1 0.05 -0.2];
    P('Exponential Decay 2D') = [5 2 3 0.5];

    models = cell(1, numel(cat));
    for i = 1:numel(cat)
        nm = cat(i).name; p = P(nm);
        z = cat(i).func(p, x, y); z = z(:)';
        models{i} = struct('name', nm, 'p', p, 'z', z);
    end
    out.models = models;

    ag = cell(1, numel(cat));
    for i = 1:numel(cat)
        nm = cat(i).name; p = P(nm);
        zt = cat(i).func(p, x, y); zt = zt(:) + 0.02*sin(2*x).*cos(1.5*y);
        p0 = fitting.surfaceAutoGuess(string(nm), x, y, zt);
        ag{i} = struct('name', nm, 'z', zt', 'p0', p0(:)');
    end
    out.autoguess = ag;

    fitNames = {'Plane', 'Paraboloid', '2D Gaussian', '2D Lorentzian'};
    fits = cell(1, numel(fitNames));
    for i = 1:numel(fitNames)
        nm = fitNames{i}; p = P(nm);
        f = cat(strcmp({cat.name}, nm)).func;
        zt = f(p, x, y); zt = zt(:) + 0.03*sin(1.7*x + 0.5*y);
        r = fitting.surfaceFit(x, y, zt, nm);
        fits{i} = struct('name', nm, 'z', zt', ...
            'params', r.params, 'errors', r.errors, 'R2', r.R2, 'RMSE', r.RMSE, ...
            'chiSqRed', r.chiSqRed, 'nPoints', r.nPoints, 'nFree', r.nFree, ...
            'exitFlag', r.exitFlag);
    end
    out.fits = fits;
end

% ════════════════════════════════════════════════════════════════════════
%  RSM peak extraction + strain freeze (rsmAnalyze / rsmStrain)
% ════════════════════════════════════════════════════════════════════════
function out = rsmFreeze()
    omega = linspace(33.0, 35.0, 40);    % axis1 (deg), N=40
    tth   = linspace(68.0, 72.0, 50);    % axis2 (deg), M=50
    [TTH, OM] = meshgrid(tth, omega);
    g = @(A,o0,t0,so,st) A*exp(-((OM-o0).^2/(2*so^2) + (TTH-t0).^2/(2*st^2)));
    I = g(1000, 34.00, 70.00, 0.12, 0.25) + g(450, 34.45, 70.70, 0.10, 0.22) + 2.0;
    I = I + 0.5*sin(3*OM).*cos(2*TTH);
    Qx = -0.05 + 0.012*(TTH-70.0) + 0.004*(OM-34.0);
    Qz =  4.50 + 0.020*(TTH-70.0) + 0.001*(OM-34.0);

    map = struct('intensity', I, 'axis1', omega(:), 'axis2', tth(:), ...
                 'Qx', Qx, 'Qz', Qz, 'intensityUnit', 'cps');
    r = fitting.rsmAnalyze(map, 'NPeaks', 2, 'FitModel', '2D Gaussian');

    out = struct();
    out.intensity = I; out.axis1 = omega; out.axis2 = tth; out.Qx = Qx; out.Qz = Qz;
    out.analyze = struct('nPeaksFound', r.nPeaksFound, 'usedQSpace', r.usedQSpace, ...
        'intensityUnit', r.intensityUnit, 'peaks', {rsmPackPeaks(r.peaks)});
    out.strain_from_analyze = fitting.rsmStrain(r.peaks(1).centre_Q, r.peaks(2).centre_Q);

    strain = struct();
    strain.asym      = fitting.rsmStrain([-0.050, 4.500], [-0.048, 4.520]);
    strain.with_bulk = fitting.rsmStrain([-0.050, 4.500], [-0.048, 4.520], 'Bulk', [-0.040, 4.520]);
    strain.symmetric = fitting.rsmStrain([0.0, 4.500], [0.0, 4.530]);
    out.strain = strain;
end

function arr = rsmPackPeaks(peaks)
    n = numel(peaks);
    arr = cell(1, n);
    for k = 1:n
        p = peaks(k);
        arr{k} = struct('rank', p.rank, 'centre_angle', p.centre_angle, ...
            'centre_Q', p.centre_Q, 'fwhm_angle', p.fwhm_angle, 'fwhm_Q', p.fwhm_Q, ...
            'amplitude', p.amplitude, 'background', p.background, ...
            'classification', p.classification);
    end
end

% ════════════════════════════════════════════════════════════════════════
%  BG-from-region freeze (box-mask + polyfit; onBGMouseUp pure core)
% ════════════════════════════════════════════════════════════════════════
function out = bgrFreeze()
    x = linspace(20, 80, 400);
    y = 2 + 0.05*x + 30*exp(-((x-50)/3).^2) + 0.3*sin(0.5*x);
    out = struct();
    out.x = x; out.y = y;
    cases = {};
    cases{end+1} = bgrCase(x, y, 25, 45, min(y)-1, max(y)+1, 1);  % linear, left shoulder
    cases{end+1} = bgrCase(x, y, 20, 80, -5, 8, 1);              % linear, y-bounded (excludes peak)
    cases{end+1} = bgrCase(x, y, 25, 75, min(y)-1, max(y)+1, 2); % quadratic
    cases{end+1} = bgrCase(x, y, 22, 78, min(y)-1, max(y)+1, 3); % cubic
    out.cases = cases;
end

function c = bgrCase(x, y, xmin, xmax, ymin, ymax, order)
    mask = x>=xmin & x<=xmax & y>=ymin & y<=ymax & ~isnan(x) & ~isnan(y);
    xp = x(mask); yp = y(mask);
    p = polyfit(xp, yp, order);
    c = struct('x_min',xmin,'x_max',xmax,'y_min',ymin,'y_max',ymax,'order',order, ...
        'coeffs',p, 'n',numel(xp), 'mean',mean(yp), 'std',std(yp), ...
        'min',min(yp), 'max',max(yp), 'background', polyval(p, x));
end

% ════════════════════════════════════════════════════════════════════════
%  BG-from-file freeze (reference-background dataset subtraction)
% ════════════════════════════════════════════════════════════════════════
function out = bgfFreeze()
    % applyCorrections step 4: subtract interp1(bgX, bgY, x, method, 0) from
    % every channel. The active x-range [0,10] overhangs the bg range [2,8]
    % on both sides so interp1's 0-fill extrapolation is exercised; bg has
    % structure so pchip/spline genuinely differ from linear. Two channels
    % cover the per-channel subtraction loop. All other steps are no-ops.
    x   = linspace(0, 10, 60).';
    y1  = 100 + 5*x + 20*sin(x);
    y2  = 50 + 2*x.^2 - 10*cos(x);
    vals = [y1, y2];                       % 60×2 (kept un-transposed -> [pt][ch])
    raw = struct('time', x, 'values', vals, 'labels', {{'A','B'}}, ...
        'units', {{'u','u'}}, 'metadata', struct());
    bgx = linspace(2, 8, 25).';            % narrower than [0,10] -> 0-fill outside
    bgy = 10 + 2*bgx + 3*sin(2*bgx);
    bg  = struct('time', bgx, 'values', bgy, 'labels', {{'bg'}}, ...
        'units', {{'u'}}, 'metadata', struct());
    p = struct('xOff',0,'yOff',0,'bgSlope',0,'bgInt',0, ...
        'xTrimMin',NaN,'xTrimMax',NaN,'smoothEnabled',false, ...
        'normMethod','None','derivativeMode','None');
    out = struct();
    out.input = struct('active', struct('time', x, 'values', vals), ...
                       'bg', struct('time', bgx, 'values', bgy));
    methods = {'linear','pchip','spline'};
    cases = cell(numel(methods), 1);
    for mi = 1:numel(methods)
        cc = bosonPlotter.applyCorrections(raw, p, ...
            'BgDataset', bg, 'BgInterp', methods{mi});
        cases{mi} = struct('interp', methods{mi}, ...
            'time', cc.time, 'values', cc.values);  %#ok<AGROW>
    end
    out.cases = cases;
end

% ════════════════════════════════════════════════════════════════════════
%  Q-space freeze (parser.computeQSpace: coplanar RSM Qx/Qz)
% ════════════════════════════════════════════════════════════════════════
function out = qspFreeze()
    % Qx = (4pi/lambda) sin(theta) sin(omega-theta); Qz = ... cos(...), with
    % theta = 2theta/2. axis1 = omega (N×1), axis2 = 2theta (1×M); Qx/Qz are
    % N×M = [omega][2theta] (kept un-transposed). N != M catches any axis swap;
    % a Si(004)-ish window around 2theta~69, omega~34.5.
    map = struct();
    map.axis1 = linspace(33.5, 35.5, 5).';   % omega, N=5
    map.axis2 = linspace(68.0, 70.0, 7);     % 2theta, M=7
    map.intensity = zeros(5, 7);             % present but unused by computeQSpace
    map.wavelength_A = 1.5405980;            % Cu Kalpha1
    map = parser.computeQSpace(map);
    out = struct('axis1', map.axis1.', 'axis2', map.axis2, ...
        'wavelength_A', map.wavelength_A, 'Qx', map.Qx, 'Qz', map.Qz);
end
