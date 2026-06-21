function freeze_reference_values()
%FREEZE_REFERENCE_VALUES  Freeze quantized_matlab parser outputs as golden JSON.
%
%   Run from MATLAB with the sibling ../quantized_matlab present:
%     addpath('<quantized>/tools/matlab'); freeze_reference_values()
%
%   Writes tests/golden/<case>.json files that the @golden pytest cases
%   assert against. Re-run + bump manifest.json source_commit when a MATLAB
%   formula changes. Path-independent (uses mfilename to locate itself).

    here     = fileparts(mfilename('fullpath'));        % <repo>/tools/matlab
    repoRoot = fullfile(here, '..', '..');              % <repo>
    qm       = fullfile(repoRoot, '..', 'quantized_matlab');
    assert(isfolder(qm), 'quantized_matlab not found at %s', qm);
    addpath(qm);                                        % exposes the +parser package

    goldenDir = fullfile(repoRoot, 'tests', 'golden');
    if ~isfolder(goldenDir), mkdir(goldenDir); end

    % ── Case: QD VSM default (Magnetic Field -> Moment) on the fixture ─────
    fixture = fullfile(repoRoot, 'tests', 'fixtures', 'qd_edp124.dat');
    d = parser.importQDVSM(fixture);   % defaults: XAxis=field, YAxis=moment
    freezeCase(d, fullfile(goldenDir, 'qd_edp124_default.json'), 'qd_edp124.dat');

    % ── Case: XRDML 1D default (2theta -> cps) on the fixture ─────────────
    xrdml = fullfile(repoRoot, 'tests', 'fixtures', 'xrdml_la2nio4.xrdml');
    dx = parser.importXRDML(xrdml);    % default: Intensity=cps
    freezeCase(dx, fullfile(goldenDir, 'xrdml_la2nio4_default.json'), 'xrdml_la2nio4.xrdml');

    % ── Case: NCNR reductus .refl (Qz -> Intensity/uncertainty/resolution) ─
    refl = fullfile(repoRoot, 'tests', 'fixtures', 'ncnr_j395.refl');
    dr = parser.importNCNRRefl(refl);
    freezeCase(dr, fullfile(goldenDir, 'ncnr_j395_default.json'), 'ncnr_j395.refl');

    % ── Case: MPMS default (Temperature -> dcmoment) ──────────────────────
    mpms = fullfile(repoRoot, 'tests', 'fixtures', 'mpms_mvst.dat');
    dm = parser.importMPMS(mpms);
    freezeCase(dm, fullfile(goldenDir, 'mpms_mvst_default.json'), 'mpms_mvst.dat');

    % ── Case: NCNR polarized .pnr (Q -> R++/R--/...) ──────────────────────
    pnr = fullfile(repoRoot, 'tests', 'fixtures', 'ncnr_s11_nsf.pnr');
    dp = parser.importNCNRPNR(pnr);
    freezeCase(dp, fullfile(goldenDir, 'ncnr_s11_nsf_default.json'), 'ncnr_s11_nsf.pnr');

    % ── Case: NCNR cross section .datA (Q -> dQ/R/dR/...) ──────────────────
    datA = fullfile(repoRoot, 'tests', 'fixtures', 'ncnr_s3.datA');
    dd = parser.importNCNRDat(datA);
    freezeCase(dd, fullfile(goldenDir, 'ncnr_s3_datA_default.json'), 'ncnr_s3.datA');

    % ── Case: refl1d profile .dat (z -> rho/irho/rhoM/theta) ──────────────
    r1d = fullfile(repoRoot, 'tests', 'fixtures', 'refl1d_nbau_profile.dat');
    d1 = parser.importRefl1dDat(r1d);
    freezeCase(d1, fullfile(goldenDir, 'refl1d_nbau_profile_default.json'), 'refl1d_nbau_profile.dat');

    % ── Case: PPMS plain-CSV .dat (synthetic fixture; field -> moment) ────
    ppms = fullfile(repoRoot, 'tests', 'fixtures', 'ppms_synth.dat');
    dpp = parser.importPPMS(ppms);
    freezeCase(dpp, fullfile(goldenDir, 'ppms_synth_default.json'), 'ppms_synth.dat');

    fprintf('Done.\n');
end

function freezeCase(d, outPath, srcName)
    out = struct();
    out.source_file = srcName;
    out.time        = d.time(:).';   % JSON row vector
    out.values      = d.values;      % N x M
    out.labels      = d.labels;      % cell -> JSON array of strings
    out.units       = d.units;
    fid = fopen(outPath, 'w');
    assert(fid > 0, 'cannot open %s for writing', outPath);
    fwrite(fid, jsonencode(out));
    fclose(fid);
    fprintf('froze %s  (%d x %d)\n', outPath, size(d.values, 1), size(d.values, 2));
end
