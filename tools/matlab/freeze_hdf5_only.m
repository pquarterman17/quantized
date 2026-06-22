function freeze_hdf5_only(outPath)
%FREEZE_HDF5_ONLY  Freeze utilities.exportHDF5 logical content as golden JSON.
%
%   Standalone so it can be invoked directly (e.g. from a worktree where the
%   relative quantized_matlab path in freeze_reference_values.m does not
%   resolve). Run with utilities.exportHDF5 on the MATLAB path:
%
%     addpath('<quantized_matlab>'); addpath('<this dir>');
%     freeze_hdf5_only('<golden>/hdf5_synth_default.json');
%
%   Binary HDF5 bytes differ between MATLAB h5write and Python h5py, so this
%   freezes the *logical* content: every dataset path/shape/class/values and
%   every attribute name->value, read back via h5info/h5read/h5readatt.

    % Synthetic DataStruct: 4 rows x 2 channels, labels/units with punctuation,
    % parserSpecific with mixed types (scalar, string).
    d = struct();
    d.time   = [10.0; 20.0; 30.0; 40.0];
    d.values = [1.5 -2.0; 3.25 4.0; 5.0 6.5; 7.75 8.0];
    d.labels = {'2-Theta', 'Intensity (a.u.)'};
    d.units  = {'deg', 'cps'};
    meta = struct();
    meta.parserName  = 'importSynthetic';
    meta.xColumnName = '2-Theta';
    meta.xColumnUnit = 'deg';
    meta.source      = 'synth.dat';
    ps = struct();
    ps.countingTime = 23.97;
    ps.numPoints    = 4;
    ps.detector     = 'PIXcel';
    ps.scanAxis     = '2Theta-Omega';
    meta.parserSpecific = ps;
    d.metadata = meta;

    corrData = struct();
    corrData.time   = d.time;
    corrData.values = d.values + 0.1;
    corrData.labels = d.labels;
    corrData.units  = d.units;
    corrData.metadata = meta;

    corrections = struct('xOff', 0.05, 'yOff', 0, 'bgSlope', 0, 'bgInt', 0);

    peaks = struct('center', {31.2, 45.8}, 'fwhm', {0.12, 0.20}, ...
                   'height', {1000, 500}, 'xRange', {[30 32], [45 47]}, ...
                   'status', {'fitted', 'manual'}, 'bg', {10, 12}, ...
                   'model', {'Gaussian', 'Lorentzian'});

    tmp = [tempname '.h5'];
    cleanup = onCleanup(@() deleteIfExists(tmp)); %#ok<NASGU>
    utilities.exportHDF5(d, tmp, 'CorrData', corrData, ...
        'Corrections', corrections, 'IncludePeaks', true, 'Peaks', peaks);

    out = struct();
    out.source_file = 'synthetic';
    out.datasets    = readAllDatasets(tmp);
    out.attributes  = readAllAttributes(tmp);
    fid = fopen(outPath, 'w');
    assert(fid > 0, 'cannot open %s for writing', outPath);
    fwrite(fid, jsonencode(out));
    fclose(fid);
    fprintf('froze hdf5 %s\n', outPath);
end

function deleteIfExists(p)
    if isfile(p)
        delete(p);
    end
end

function ds = readAllDatasets(filepath)
%READALLDATASETS  Walk the HDF5 tree; return struct array of dataset content.
    info = h5info(filepath);
    paths = collectDatasetPaths(info, '');
    ds = struct('path', {}, 'shape', {}, 'class', {}, ...
                'values', {}, 'strvalue', {});
    for i = 1:numel(paths)
        p = paths{i};
        raw = h5read(filepath, p);
        entry = struct();
        entry.path  = p;
        entry.class = class(raw);
        entry.shape = size(raw);
        isStrMat = isa(raw, 'uint8') && ~strcmp(p, '/file_schema_version') ...
            && ~endsWith(p, 'schema_version') && ~endsWith(p, '/nRows');
        if isStrMat
            entry.strvalue = decodeAsciiRows(raw);
            entry.values   = double(raw(:)');
        else
            entry.strvalue = {};
            entry.values   = double(raw(:)');
        end
        ds(end+1) = entry; %#ok<AGROW>
    end
end

function strs = decodeAsciiRows(mat)
%DECODEASCIIROWS  Decode an HDF5-read padded-ASCII uint8 matrix to strings.
%   exportHDF5 writes a [M x L] matrix (M strings, L = max length); h5read
%   returns it [M x L] as well, so each row is one space-padded string.
%   Returns a deblank'd cellstr.
    M = size(mat, 1);
    strs = cell(1, M);
    for k = 1:M
        s = char(mat(k, :));
        strs{k} = deblank(s);
    end
end

function attrs = readAllAttributes(filepath)
%READALLATTRIBUTES  Return a struct array of every attribute (path/name/value).
    info = h5info(filepath);
    attrs = struct('path', {}, 'name', {}, 'value', {}, 'class', {});
    attrs = collectAttrs(info, attrs);
end

function attrs = collectAttrs(node, attrs)
%COLLECTATTRS  Recurse groups/datasets collecting attributes.
    if isfield(node, 'Attributes') && ~isempty(node.Attributes)
        for a = 1:numel(node.Attributes)
            at = node.Attributes(a);
            entry = struct();
            entry.path  = stripTrailingSlash(node.Name);
            entry.name  = at.Name;
            entry.class = class(at.Value);
            v = at.Value;
            if ischar(v) || isstring(v)
                entry.value = char(v);
            elseif iscell(v)
                entry.value = char(v{1});
            else
                entry.value = double(v(:)');
            end
            attrs(end+1) = entry; %#ok<AGROW>
        end
    end
    if isfield(node, 'Datasets') && ~isempty(node.Datasets)
        for di = 1:numel(node.Datasets)
            d = node.Datasets(di);
            if ~isempty(d.Attributes)
                dpath = [stripTrailingSlash(node.Name), '/', d.Name];
                dnode = struct('Name', dpath, 'Attributes', d.Attributes);
                attrs = collectAttrs(dnode, attrs);
            end
        end
    end
    if isfield(node, 'Groups') && ~isempty(node.Groups)
        for gi = 1:numel(node.Groups)
            attrs = collectAttrs(node.Groups(gi), attrs);
        end
    end
end

function paths = collectDatasetPaths(node, parent)
%COLLECTDATASETPATHS  Return a cell array of every dataset's full path.
    paths = {};
    base = stripTrailingSlash(node.Name);
    if isempty(base) && ~isempty(parent)
        base = parent;
    end
    if isfield(node, 'Datasets') && ~isempty(node.Datasets)
        for di = 1:numel(node.Datasets)
            paths{end+1} = [base, '/', node.Datasets(di).Name]; %#ok<AGROW>
        end
    end
    if isfield(node, 'Groups') && ~isempty(node.Groups)
        for gi = 1:numel(node.Groups)
            paths = [paths, collectDatasetPaths(node.Groups(gi), base)]; %#ok<AGROW>
        end
    end
end

function s = stripTrailingSlash(p)
    s = char(p);
    if numel(s) > 1 && s(end) == '/'
        s = s(1:end-1);
    end
end
