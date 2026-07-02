function freeze_xrdml_map2d()
%FREEZE_XRDML_MAP2D  Freeze importXRDML's map2D output for all three mesh kinds.
%
%   Runs the MATLAB reference parser (../quantized_matlab, needs the
%   snapshot/coupled cloud support, commit aee70d1+) on the three committed
%   fixtures and writes tests/golden/xrdml_map2d.json:
%     mesh     - tests/fixtures/xrdml_rsm_synthetic.xrdml       (classic RSM)
%     snapshot - tests/fixtures/xrdml_snapshot_synthetic.xrdml  (PIXcel3D-style)
%     coupled  - tests/fixtures/xrdml_coupled_synthetic.xrdml   (schema-1.0-style)
%   Each case stores meshKind, intensity [NxM] (cps), axis1/axis2 vectors, the
%   exact per-point grid when non-rectilinear, and the Qx/Qz grids.
%
%   Run: /Applications/MATLAB_R2025b.app/bin/matlab -batch ...
%        "addpath('tools/matlab'); freeze_xrdml_map2d"    (from the repo root)

    here = fileparts(mfilename('fullpath'));
    root = fileparts(fileparts(here));
    addpath(fullfile(fileparts(root), 'quantized_matlab'));

    fixtures = fullfile(root, 'tests', 'fixtures');
    cases = { ...
        'mesh',     'xrdml_rsm_synthetic.xrdml'; ...
        'snapshot', 'xrdml_snapshot_synthetic.xrdml'; ...
        'coupled',  'xrdml_coupled_synthetic.xrdml'};

    out = struct();
    for c = 1:size(cases, 1)
        d = parser.importXRDML(fullfile(fixtures, cases{c, 2}));
        m = d.metadata.parserSpecific.map2D;
        m = parser.computeQSpace(m);
        s = struct( ...
            'meshKind',      m.meshKind, ...
            'intensity',     m.intensity, ...
            'axis1',         m.axis1, ...
            'axis2',         m.axis2, ...
            'axis1Name',     m.axis1Name, ...
            'intensityUnit', m.intensityUnit, ...
            'Qx',            m.Qx, ...
            'Qz',            m.Qz);
        if isfield(m, 'axis2Grid'); s.axis2Grid = m.axis2Grid; end
        if isfield(m, 'axis1Grid'); s.axis1Grid = m.axis1Grid; end
        out.(cases{c, 1}) = s;
        fprintf('  %-8s %s -> %dx%d (%s)\n', cases{c, 1}, cases{c, 2}, ...
            size(m.intensity, 1), size(m.intensity, 2), m.intensityUnit);
    end

    fid = fopen(fullfile(root, 'tests', 'golden', 'xrdml_map2d.json'), 'w');
    fwrite(fid, jsonencode(out));
    fclose(fid);
    fprintf('frozen tests/golden/xrdml_map2d.json\n');
end
