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

    % ── Case: XRDML 1D beam-attenuation correction (per-pixel factors) ─────
    % counts .* beamAttenuationFactors (6×1.0 then 4×100.0), then /countingTime.
    xatt = fullfile(repoRoot, 'tests', 'fixtures', 'xrdml_attenuation.xrdml');
    da = parser.importXRDML(xatt);
    freezeCase(da, fullfile(goldenDir, 'xrdml_attenuation.json'), 'xrdml_attenuation.xrdml');

    % ── Case: XRDML 2D RSM mesh — map2D matrix from importXRDML ────────────
    % The Python port returns the mesh as a scattered DataStruct; this freezes
    % MATLAB's map2D matrix (N omega frames × M 2theta pixels) for the Python
    % test to compare against after reshaping by map_shape.
    rsm = fullfile(repoRoot, 'tests', 'fixtures', 'xrdml_rsm_synthetic.xrdml');
    dr = parser.importXRDML(rsm);
    ps = dr.metadata.parserSpecific;
    assert(ps.is2D, 'expected a 2D RSM mesh from synthetic_rsm');
    m2 = ps.map2D;
    om = struct();
    om.source_file   = 'xrdml_rsm_synthetic.xrdml';
    om.axis1Name     = m2.axis1Name;     % 'Omega'
    om.axis1         = m2.axis1(:).';    % N omega values
    om.axis2         = m2.axis2(:).';    % M 2theta values
    om.intensity     = m2.intensity;     % N×M (kept 2-D; jsonencode → nested rows)
    om.intensityUnit = m2.intensityUnit;
    fidm = fopen(fullfile(goldenDir, 'xrdml_rsm_map.json'), 'w');
    assert(fidm > 0, 'cannot open xrdml_rsm_map.json for writing');
    fwrite(fidm, jsonencode(om));
    fclose(fidm);
    fprintf('froze xrdml_rsm_map.json  (%d x %d)\n', ...
        size(m2.intensity, 1), size(m2.intensity, 2));

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

    % ── Case: Lake Shore VSM (synthetic fixture; temp -> moment) ──────────
    ls = fullfile(repoRoot, 'tests', 'fixtures', 'lakeshore_synth.csv');
    dls = parser.importLakeShore(ls);
    freezeCase(dls, fullfile(goldenDir, 'lakeshore_synth_default.json'), 'lakeshore_synth.csv');

    % ── Case: generic CSV (XRD batch export; col1 x -> col2 values) ───────
    csv = fullfile(repoRoot, 'tests', 'fixtures', 'csv_xrd.csv');
    dc = parser.importCSV(csv);
    freezeCase(dc, fullfile(goldenDir, 'csv_xrd_default.json'), 'csv_xrd.csv');

    % ── Case: generic Excel (synthetic fixture; col1 x -> rest values) ────
    xls = fullfile(repoRoot, 'tests', 'fixtures', 'excel_synth.xlsx');
    dxl = parser.importExcel(xls);
    freezeCase(dxl, fullfile(goldenDir, 'excel_synth_default.json'), 'excel_synth.xlsx');

    % ── Case: SIMS shared-depth (synthetic; no interpolation) ─────────────
    sims1 = fullfile(repoRoot, 'tests', 'fixtures', 'sims_shared.csv');
    ds1 = parser.importSIMS(sims1);
    freezeCase(ds1, fullfile(goldenDir, 'sims_shared_default.json'), 'sims_shared.csv');

    % ── Case: SIMS paired-column (real; union-grid interpolation) ─────────
    sims2 = fullfile(repoRoot, 'tests', 'fixtures', 'sims_barrier.csv');
    ds2 = parser.importSIMS(sims2);
    freezeCase(ds2, fullfile(goldenDir, 'sims_barrier_default.json'), 'sims_barrier.csv');

    % ── Case: Rigaku SmartLab .raw (binary; 2theta -> counts) ─────────────
    rgk = fullfile(repoRoot, 'tests', 'fixtures', 'rigaku_yig.raw');
    drg = parser.importRigaku_raw(rgk);
    freezeCase(drg, fullfile(goldenDir, 'rigaku_yig_default.json'), 'rigaku_yig.raw');

    % ── Writer: XRD CSV exporter (utilities.writeXRDcsv) ──────────────────
    % Freeze the writer output text (IncludeMetadata=false -> fully
    % deterministic, parser-independent). Source DataStruct is the XRDML
    % fixture parsed with defaults (Intensity=cps, countingTime present).
    dwr = parser.importXRDML(xrdml);   % cps, countingTime=23.97
    freezeWriterCase(dwr, fullfile(goldenDir, 'xrdcsv_standard_both.json'), ...
        'xrdml_la2nio4.xrdml', 'standard', 'both');
    freezeWriterCase(dwr, fullfile(goldenDir, 'xrdcsv_standard_counts.json'), ...
        'xrdml_la2nio4.xrdml', 'standard', 'counts');
    freezeWriterCase(dwr, fullfile(goldenDir, 'xrdcsv_standard_cps.json'), ...
        'xrdml_la2nio4.xrdml', 'standard', 'cps');
    freezeWriterCase(dwr, fullfile(goldenDir, 'xrdcsv_origin_both.json'), ...
        'xrdml_la2nio4.xrdml', 'origin', 'both');

    % ── Writer: HDF5 exporter (utilities.exportHDF5) ──────────────────────
    % Binary HDF5 bytes differ between MATLAB h5write and Python h5py, so we
    % freeze the *logical* content: read the MATLAB-written .h5 back via
    % h5info/h5read/h5readatt and emit JSON capturing every dataset path,
    % shape, class, numeric values, and every attribute name->value. The
    % Python golden test writes the same logical DataStruct with
    % quantized.io.hdf5.write_hdf5 and asserts the tree/dtypes/values/attrs
    % match within tolerance.
    %
    % A synthetic DataStruct (built in freeze_hdf5_only) keeps the case fully
    % deterministic and parser-naming-agnostic so the Python side can
    % construct an identical logical input. Defined standalone in
    % freeze_hdf5_only.m so a worktree can call it directly.
    freeze_hdf5_only(fullfile(goldenDir, 'hdf5_synth_default.json'));

    fprintf('Done.\n');
end

function freezeWriterCase(d, outPath, srcName, fmt, intensity)
%FREEZEWRITERCASE  Run utilities.writeXRDcsv and freeze the text as JSON lines.
    tmp = [tempname '.csv'];
    cleanup = onCleanup(@() deleteIfExists(tmp)); %#ok<NASGU>
    utilities.writeXRDcsv(d, tmp, Format=fmt, Intensity=intensity, ...
        IncludeMetadata=false);
    raw = fileread(tmp);
    raw = strrep(raw, sprintf('\r\n'), sprintf('\n'));   % normalise newlines
    lines = strsplit(raw, sprintf('\n'), 'CollapseDelimiters', false);
    % strsplit on a trailing "\n" yields a trailing '' element; kept so the
    % Python side can assert the trailing-newline contract too.
    out = struct();
    out.source_file = srcName;
    out.format      = fmt;
    out.intensity   = intensity;
    out.lines       = lines;     % cell -> JSON array of strings
    fid = fopen(outPath, 'w');
    assert(fid > 0, 'cannot open %s for writing', outPath);
    fwrite(fid, jsonencode(out));
    fclose(fid);
    fprintf('froze writer %s  (%d lines)\n', outPath, numel(lines));
end

function deleteIfExists(p)
    if isfile(p)
        delete(p);
    end
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
