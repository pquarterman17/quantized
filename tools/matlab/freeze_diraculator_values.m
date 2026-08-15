function freeze_diraculator_values()
%FREEZE_DIRACULATOR_VALUES  Freeze DiraCulator W4 calculator-domain outputs.
%
%   DIRACULATOR_AUDIT_PLAN P1 (parity evidence): the twelve W4 calculator
%   domains shipped on reference/textbook tests only; this script freezes
%   the authoritative MATLAB outputs so `pytest -m golden` can compare the
%   Python port exactly. Companion to freeze_calc_values.m (same case
%   style); run with the sibling ../quantized_matlab present:
%     addpath('<quantized>/tools/matlab'); freeze_diraculator_values()
%
%   Case classes (see the classification tables in DIRACULATOR_AUDIT_PLAN):
%     (a) +calc package call — calc.<domain>.<fn>(...) frozen directly.
%     (b) GUI-embedded formula — replicated INLINE below, with the
%         DiraCulator.m line numbers cited; keep the replica in sync.
%     (d) intentional divergence — the INTENDED (corrected) behaviour is
%         computed inline and documented; the MATLAB bug is NOT frozen.
%   Python-only extensions (class c) are deliberately absent.
%
%   jsonencode rules (CLAUDE.md): finite inputs only, no complex outputs,
%   2-D stays 2-D, 1-element struct arrays normalize to objects.

    here     = fileparts(mfilename('fullpath'));
    repoRoot = fullfile(here, '..', '..');
    qm       = fullfile(repoRoot, '..', 'quantized_matlab');
    assert(isfolder(qm), 'quantized_matlab not found at %s', qm);
    addpath(qm);
    goldenDir = fullfile(repoRoot, 'tests', 'golden');
    if ~isfolder(goldenDir), mkdir(goldenDir); end

    %% ── sections assembled from the per-domain campaign snippets ──────────

    fprintf('Done.\n');
end

function writeJson(s, outPath)
    fid = fopen(outPath, 'w');
    assert(fid > 0, 'cannot open %s', outPath);
    fwrite(fid, jsonencode(s));
    fclose(fid);
    fprintf('froze %s\n', outPath);
end
