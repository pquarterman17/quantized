function freeze_export_extra()
%FREEZE_EXPORT_EXTRA  Freeze Origin (.ogs+CSV) and consolidated-CSV exporters.
%
%   Run from MATLAB with the sibling ../quantized_matlab present:
%     addpath('<repo>/tools/matlab'); freeze_export_extra()
%
%   Writes tests/golden/{origin_export,consolidated_csv_*}.json that the
%   @golden pytest cases assert against. Text exporters are frozen as line
%   arrays; the .ogs Date line is non-deterministic and exempted in the test.

    here     = fileparts(mfilename('fullpath'));
    repoRoot = fullfile(here, '..', '..');
    qm       = fullfile(repoRoot, '..', 'quantized_matlab');
    assert(isfolder(qm), 'quantized_matlab not found at %s', qm);
    addpath(qm);

    goldenDir = fullfile(repoRoot, 'tests', 'golden');
    if ~isfolder(goldenDir), mkdir(goldenDir); end

    % ── Origin export: XRDML fixture -> CSV + .ogs (explicit book/sheet) ──
    xrdml = fullfile(repoRoot, 'tests', 'fixtures', 'xrdml_la2nio4.xrdml');
    d = parser.importXRDML(xrdml);
    tmp = tempname;
    ogsPath = [tmp, '.ogs'];
    utilities.exportOriginScript(d, ogsPath, ...
        'BookName', 'test', 'SheetName', 'test', 'MakeGraph', true);
    [tdir, tbase, ~] = fileparts(ogsPath);
    csvName = [tbase, '_data.csv'];
    csvPath = fullfile(tdir, csvName);

    s = struct();
    s.csv      = readLines(csvPath);
    s.ogs      = readLines(ogsPath);
    s.csv_name = csvName;
    s.book     = 'test';
    s.sheet    = 'test';
    writeJSON(s, fullfile(goldenDir, 'origin_export.json'));
    if isfile(ogsPath), delete(ogsPath); end
    if isfile(csvPath), delete(csvPath); end

    % ── Consolidated CSV: two synthetic same-measurement neutron scans ──
    % Per-dataset-block path (each scan keeps its own Q + R/dR), ragged rows.
    ds1 = synthNeutron('meas_a.refl', [0.01; 0.02; 0.03], ...
        [1.0 0.10; 0.5 0.05; 0.25 0.02], {'R', 'dR'}, {'', ''}, 'Qz', '1/A');
    ds2 = synthNeutron('meas_b.refl', [0.01; 0.02], ...
        [0.9 0.09; 0.45 0.04], {'R', 'dR'}, {'', ''}, 'Qz', '1/A');

    for fmt = {'standard', 'origin'}
        f = fmt{1};
        outp = [tempname, '.csv'];
        bosonPlotter.saveConsolidatedNeutronCSV(ds1, outp, f, {ds1, ds2});
        c = struct();
        c.csv = readLines(outp);
        c.fmt = f;
        writeJSON(c, fullfile(goldenDir, ['consolidated_csv_', f, '.json']));
        if isfile(outp), delete(outp); end
    end

    fprintf('freeze_export_extra: wrote origin_export + consolidated_csv_{standard,origin}\n');
end

function ds = synthNeutron(fname, q, vals, labels, units, xName, xUnit)
%SYNTHNEUTRON  Minimal neutron dataset struct for the consolidated writer.
    data = struct();
    data.time     = q;
    data.values   = vals;
    data.labels   = labels;
    data.units    = units;
    data.metadata = struct('xColumnName', xName, 'xColumnUnit', xUnit, ...
                           'source', fname);
    ds = struct();
    ds.data       = data;
    ds.corrData   = [];
    ds.filepath   = fname;
    ds.parserName = 'importNCNRRefl';
    ds.legendName = fname;
end

function lines = readLines(p)
    txt = fileread(p);
    lines = regexp(txt, '\r?\n', 'split');
    if ~isempty(lines) && isempty(lines{end}), lines(end) = []; end
    lines = lines(:)';
end

function writeJSON(s, path)
    fid = fopen(path, 'w');
    fwrite(fid, jsonencode(s));
    fclose(fid);
end
