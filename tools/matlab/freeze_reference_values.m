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
