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
    if ~isfolder(qm)
        % Worktree checkouts live an extra directory deep (<repo>/.claude/
        % worktrees/<name>/), so the direct sibling path resolves to a
        % nonexistent location. Fall back to an explicit override rather
        % than assuming a fixed checkout layout.
        override = getenv('QZ_MATLAB_REF');
        if ~isempty(override) && isfolder(override)
            qm = override;
        end
    end
    assert(isfolder(qm), 'quantized_matlab not found at %s (set QZ_MATLAB_REF to override)', qm);
    addpath(qm);
    goldenDir = fullfile(repoRoot, 'tests', 'golden');
    if ~isfolder(goldenDir), mkdir(goldenDir); end

    %% ══════════════════════════════════════════════════════════════════════
    %% ── Electrical ──
    %% ══════════════════════════════════════════════════════════════════════

    % resistivity(Rs [Ohm/sq], t [cm]) -> rho [Ohm*cm]  (calc.electrical.resistivity)
    rEl1 = calc.electrical.resistivity(500, 2e-5);
    writeJson(struct('input', struct('Rs', 500, 't', 2e-5), 'output', rEl1), ...
        fullfile(goldenDir, 'calc_dira_electrical_resistivity.json'));

    % sheetResistance(rho [Ohm*cm], t [cm]) -> Rs [Ohm/sq]  (calc.electrical.sheetResistance)
    rEl2 = calc.electrical.sheetResistance(1e-3, 2e-5);
    writeJson(struct('input', struct('rho', 1e-3, 't', 2e-5), 'output', rEl2), ...
        fullfile(goldenDir, 'calc_dira_electrical_sheet_resistance.json'));

    % conductivity(rho [Ohm*cm]) -> sigma [S/cm]  (calc.electrical.conductivity)
    rEl3 = calc.electrical.conductivity(1e-3);
    writeJson(struct('input', struct('rho', 1e-3), 'output', rEl3), ...
        fullfile(goldenDir, 'calc_dira_electrical_conductivity.json'));

    % mobility(rho [Ohm*cm], n [cm^-3]) -> mu [cm^2/V/s]  (calc.electrical.mobility)
    rEl4 = calc.electrical.mobility(1e-2, 1e18);
    writeJson(struct('input', struct('rho', 1e-2, 'n', 1e18), 'output', rEl4), ...
        fullfile(goldenDir, 'calc_dira_electrical_mobility.json'));

    % currentDensity(I [A], area [cm^2]) -> J [A/cm^2]  (calc.electrical.currentDensity)
    rEl5 = calc.electrical.currentDensity(0.01, 0.04);
    writeJson(struct('input', struct('I', 0.01, 'area', 0.04), 'output', rEl5), ...
        fullfile(goldenDir, 'calc_dira_electrical_current_density.json'));

    % hallAnalysis(field [T], hallResistance [Ohm or Ohm*cm], Thickness, Sigma)
    % -> R_H, carrierDensity, carrierType, mobility, fitR2  (calc.electrical.hallAnalysis)
    % Clean synthetic electron-like sweep (matches the Python module docstring
    % worked example so freeze and port share one canonical case).
    hEl6 = (-5:5)' * 0.5;   % -2.5:0.5:2.5, 11 pts (matches the Python docstring case)
    rxyEl6 = -1.2e-3 * hEl6;
    rEl6 = calc.electrical.hallAnalysis(hEl6, rxyEl6, 'Thickness', 1e-3, 'Sigma', 500);
    writeJson(struct('input', struct('field', hEl6.', 'hallResistance', rxyEl6.', ...
        'thickness', 1e-3, 'sigma', 500), 'output', rEl6), ...
        fullfile(goldenDir, 'calc_dira_electrical_hall_analysis.json'));

    % wiedemannFranz(T [K], rho [Ohm*cm]) -> kappa [W/(cm*K)]  (calc.electrical.wiedemannFranz)
    % NOTE: this function returns a bare double (not a struct) in MATLAB.
    kappaEl7 = calc.electrical.wiedemannFranz(300, 1.72e-6);
    writeJson(struct('input', struct('T', 300, 'rho', 1.72e-6), ...
        'output', struct('kappa', kappaEl7)), ...
        fullfile(goldenDir, 'calc_dira_electrical_wiedemann_franz.json'));

    % hall_single_point: GUI-embedded only — no +calc/+electrical file exists for
    % this (Python's hall_single_point ports DiraCulator.m's doHallEffect nested
    % function directly). Replicated inline from DiraCulator.m lines 1681-1707:
    %   RH = VH * t / (I * B);                              % cm^3/C
    %   nAbs = abs(1 / (RH * calc.constants().e));           % cm^-3
    %   if RH > 0, hc = calc.semiconductor.hallCoefficient(0, nAbs, 1, 1);
    %   else,      hc = calc.semiconductor.hallCoefficient(nAbs, 0, 1, 1); end
    % Inputs are the GUI's own default field values (VH=1e-3 V, I=1e-3 A, B=1 T,
    % t=100 nm -> 1e-5 cm), which also happen to match the Python docstring case.
    VH_hs = 1e-3; I_hs = 1e-3; B_hs = 1.0; t_hs = 100e-7;   % t: 100 nm -> cm
    RH_hs = VH_hs * t_hs / (I_hs * B_hs);
    nAbs_hs = abs(1 / (RH_hs * calc.constants().e));
    if RH_hs > 0
        hc_hs = calc.semiconductor.hallCoefficient(0, nAbs_hs, 1, 1);
    else
        hc_hs = calc.semiconductor.hallCoefficient(nAbs_hs, 0, 1, 1);
    end
    writeJson(struct('input', struct('VH', VH_hs, 'I', I_hs, 'B', B_hs, 't_cm', t_hs), ...
        'output', struct('RH', RH_hs, 'n', nAbs_hs, 'apparentType', hc_hs.apparentType)), ...
        fullfile(goldenDir, 'calc_dira_electrical_hall_single_point.json'));

    % van_der_pauw: Python-only extension — NO MATLAB counterpart anywhere in
    % quantized_matlab (grepped +calc/+electrical, DiraCulator.m, and the docs
    % tree for "van.*pauw"/"vanDerPauw"; only comments and tutorial prose
    % mention Van der Pauw measurements, never an implementing function). NOT
    % frozen; labeled a class-(c) extension in the audit report.

    %% ══════════════════════════════════════════════════════════════════════
    %% ── Semiconductor ──
    %% ══════════════════════════════════════════════════════════════════════

    % intrinsicCarrierConc(Material='Si', T=300 default) -> ni, Nc, Nv, Eg, T
    rSc1 = calc.semiconductor.intrinsicCarrierConc('Material', 'Si');
    writeJson(struct('input', struct('material', 'Si'), 'output', rSc1), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_intrinsic_carrier_conc.json'));

    % carrierConcentration(Nd, Na, ni) -> n, p, type
    rSc2 = calc.semiconductor.carrierConcentration(1e16, 0, 1.5e10);
    writeJson(struct('input', struct('Nd', 1e16, 'Na', 0, 'ni', 1.5e10), 'output', rSc2), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_carrier_concentration.json'));

    % fermiLevel(Material='Si', Nd=1e16, T=300 default) -> EF, type
    rSc3 = calc.semiconductor.fermiLevel('Material', 'Si', 'Nd', 1e16);
    writeJson(struct('input', struct('material', 'Si', 'Nd', 1e16), 'output', rSc3), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_fermi_level.json'));

    % builtInPotential(Na, Nd, ni, T=300 default) -> Vbi
    rSc4 = calc.semiconductor.builtInPotential(1e17, 1e17, 9.65e9);
    writeJson(struct('input', struct('Na', 1e17, 'Nd', 1e17, 'ni', 9.65e9), 'output', rSc4), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_built_in_potential.json'));

    % depletionWidth(Material='Si', Vbi=0.7, Na=1e16, Nd=1e17, T=300 default)
    % -> W, Wcm, xn, xp
    rSc5 = calc.semiconductor.depletionWidth('Material', 'Si', 'Vbi', 0.7, ...
        'Na', 1e16, 'Nd', 1e17);
    writeJson(struct('input', struct('material', 'Si', 'Vbi', 0.7, 'Na', 1e16, 'Nd', 1e17), ...
        'output', rSc5), fullfile(goldenDir, 'calc_dira_semiconductor_depletion_width.json'));

    % debyeLength(Material='Si', n=1e16, T=300 default) -> LD, LDcm
    rSc6 = calc.semiconductor.debyeLength('Material', 'Si', 'n', 1e16);
    writeJson(struct('input', struct('material', 'Si', 'n', 1e16), 'output', rSc6), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_debye_length.json'));

    % hallCoefficient(n, p, mu_e, mu_h) -> RH, apparentType
    rSc7 = calc.semiconductor.hallCoefficient(1e16, 1e4, 1400, 450);
    writeJson(struct('input', struct('n', 1e16, 'p', 1e4, 'mu_e', 1400, 'mu_h', 450), ...
        'output', rSc7), fullfile(goldenDir, 'calc_dira_semiconductor_hall_coefficient.json'));

    % mobilityModel(Material='Si', N=1e16, T=300 default) -> muE, muH, material
    rSc8 = calc.semiconductor.mobilityModel('Material', 'Si', 'N', 1e16);
    writeJson(struct('input', struct('material', 'Si', 'N', 1e16), 'output', rSc8), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_mobility_model.json'));

    % thermalVelocity(mStar=0.26, T=300 default) -> vth
    rSc9 = calc.semiconductor.thermalVelocity(0.26);
    writeJson(struct('input', struct('mStar', 0.26), 'output', rSc9), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_thermal_velocity.json'));

    % sheetCarrierDensity(n, t) -> ns
    rSc10 = calc.semiconductor.sheetCarrierDensity(1e17, 1e-6);
    writeJson(struct('input', struct('n', 1e17, 't', 1e-6), 'output', rSc10), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_sheet_carrier_density.json'));

    % diffusionCoeff(mu, T=300 default) -> D
    rSc11 = calc.semiconductor.diffusionCoeff(1400);
    writeJson(struct('input', struct('mu', 1400), 'output', rSc11), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_diffusion_coeff.json'));

    % diffusionLength(D, tau) -> L, Lum
    rSc12 = calc.semiconductor.diffusionLength(25, 1e-6);
    writeJson(struct('input', struct('D', 25, 'tau', 1e-6), 'output', rSc12), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_diffusion_length.json'));

    % dosEffectiveMass(Material='GaAs', Carrier='e') -> mStar, material, carrier
    rSc13 = calc.semiconductor.dosEffectiveMass('Material', 'GaAs', 'Carrier', 'e');
    writeJson(struct('input', struct('material', 'GaAs', 'carrier', 'e'), 'output', rSc13), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_dos_effective_mass.json'));

    % materialPresets() -> struct of all preset materials
    rSc14 = calc.semiconductor.materialPresets();
    writeJson(struct('output', rSc14), ...
        fullfile(goldenDir, 'calc_dira_semiconductor_material_presets.json'));

    %% ══════════════════════════════════════════════════════════════════════
    %% ── Thermal ──
    %% ══════════════════════════════════════════════════════════════════════
    %% No +calc/+thermal package exists — buildThermalTab (DiraCulator.m
    %% ~4568-4692) embeds all three formulas directly in its nested callbacks.
    %% Each case below replicates that inline formula verbatim, citing the
    %% specific callback + line range.

    % Card 1 — Wiedemann-Franz: DiraCulator.m doWiedemannFranz, lines 4598-4608.
    %   sigma [S/cm] -> S/m; kappa = L0 * sigma_SI * T  [W/(m*K)]
    sigma_wf = 6e5;   % S/cm (Cu-like, the card's own default)
    T_wf = 300;       % K
    sigma_si_wf = sigma_wf * 100;   % S/cm -> S/m (line 4599)
    L0_wf = 2.44e-8;                 % Lorenz number, W*Ohm/K^2 (line 4601)
    kappa_wf = L0_wf * sigma_si_wf * T_wf;   % line 4602
    writeJson(struct('input', struct('sigma', sigma_wf, 'T', T_wf), ...
        'output', struct('kappa', kappa_wf)), ...
        fullfile(goldenDir, 'calc_dira_thermal_wiedemann_franz.json'));

    % Card 2 — Debye temperature: DiraCulator.m doDebye, lines 4634-4648.
    %   Theta_D = (hbar/kB) * v_s * (6*pi^2*n)^(1/3)  [K]
    vs_deb = 5000;    % m/s (card default)
    n_deb = 5e28;     % atoms/m^3 (card default)
    hbar_deb = 1.054571817e-34;   % local literal, line 4641 (not calc.constants())
    kB_deb = 1.380649e-23;        % local literal, line 4642
    thetaD_deb = (hbar_deb / kB_deb) * vs_deb * (6 * pi^2 * n_deb)^(1/3);  % line 4643
    writeJson(struct('input', struct('v_s', vs_deb, 'n', n_deb), ...
        'output', struct('theta_D', thetaD_deb)), ...
        fullfile(goldenDir, 'calc_dira_thermal_debye_temperature.json'));

    % Card 3 — Thermal diffusivity: DiraCulator.m doThermalDiffusivity, lines 4678-4689.
    %   alpha = kappa / (rho * cp)  [m^2/s]; alpha_mm2 = alpha * 1e6  [mm^2/s]
    kappa_td = 150;   % W/(m*K)  (Si-like, card default)
    rho_td = 2329;    % kg/m^3   (Si)
    cp_td = 700;      % J/(kg*K) (Si)
    alpha_td = kappa_td / (rho_td * cp_td);   % line 4682
    alpha_mm2_td = alpha_td * 1e6;            % line 4683
    writeJson(struct('input', struct('kappa', kappa_td, 'rho', rho_td, 'cp', cp_td), ...
        'output', struct('alpha', alpha_td, 'alpha_mm2', alpha_mm2_td)), ...
        fullfile(goldenDir, 'calc_dira_thermal_thermal_diffusivity.json'));

    %% ── DIRACULATOR_AUDIT P1: Thin Film, Superconductor, Vacuum ──
    %  Sections below are meant to be spliced into freeze_calc_values.m (before
    %  its trailing writeJson local function). Each case freezes
    %  {input, params, output} for one calc.<domain>.<fn> call in the house
    %  style. Result structs carry a `.latex` field (not JSON-comparable against
    %  the Python port, which has no such key) -> always rmfield it before
    %  writeJson.

    %% ── Thin Film ──

    % deposition_rate(thickness=1000 Ang, time=60 s) — depositionRate.m, DiraCulator
    % buildThinFilmTab Card 1 defaults (efDRThick=1000, efDRTime=60).
    r = calc.thinFilm.depositionRate(1000, 60);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('thickness', 1000, 'time', 60), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_thinfilm_deposition_rate.json'));

    % diffusion_length_thermal(D=1e-13 cm^2/s, t=3600 s) — diffusionLength_thermal.m.
    % Not wired into buildThinFilmTab (no GUI card); +calc counterpart still
    % exists, so this freezes the direct function call per the docstring example.
    r = calc.thinFilm.diffusionLength_thermal(1e-13, 3600);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('D', 1e-13, 't', 3600), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_thinfilm_diffusion_length.json'));

    % dose_from_current(current=1e-6 A, time=60 s, area=1 cm^2) — doseFromCurrent.m,
    % Card 5 (Ion Dose) defaults.
    r = calc.thinFilm.doseFromCurrent(1e-6, 60, 1.0);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('current', 1e-6, 'time', 60, 'area', 1.0), ...
        'output', r), fullfile(goldenDir, 'calc_dira_thinfilm_dose_from_current.json'));

    % dose_to_concentration(dose=1e15, Rp=50 nm, deltaRp=15 nm) — doseToConcentration.m,
    % Card 9 defaults.
    r = calc.thinFilm.doseToConcentration(1e15, 50, 15);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('dose', 1e15, 'Rp', 50, 'deltaRp', 15), ...
        'output', r), fullfile(goldenDir, 'calc_dira_thinfilm_dose_to_concentration.json'));

    % Scherrer grain size — GUI-embedded formula from DiraCulator.m Card 6
    % (lines 2495-2510), using the card defaults. There is no standalone
    % +calc/+thinFilm function, so freeze the cited GUI formula inline.
    fwhm_sch = 0.5; lambda_sch = 1.5406; twoTheta_sch = 33; K_sch = 0.9;
    beta_sch = fwhm_sch * pi / 180;
    theta_sch = twoTheta_sch / 2 * pi / 180;
    D_sch = K_sch * lambda_sch / (beta_sch * cos(theta_sch));
    out_sch = struct('D', D_sch, 'D_nm', D_sch / 10, ...
        'fwhm_deg', fwhm_sch, 'wavelength', lambda_sch, ...
        'two_theta_deg', twoTheta_sch, 'K', K_sch);
    writeJson(struct('input', struct('fwhm_deg', fwhm_sch, ...
        'wavelength', lambda_sch, 'two_theta_deg', twoTheta_sch), ...
        'output', out_sch), ...
        fullfile(goldenDir, 'calc_dira_thinfilm_scherrer.json'));

    % kiessig_thickness(deltaQ=0.0628 Ang^-1) — kiessigThickness.m, Card 2, kinematic
    % (uncorrected) branch — deltaQ far above any plausible Qc so Qc stays NaN.
    r = calc.thinFilm.kiessigThickness(0.0628);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('deltaQ', 0.0628), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_thinfilm_kiessig_basic.json'));

    % kiessig_thickness(deltaQ=0.050 Ang^-1, SLD=6.3e-6 Ang^-2) — same fn,
    % refraction-corrected branch (Pt film, per the MATLAB docstring example).
    r = calc.thinFilm.kiessigThickness(0.050, SLD=6.3e-6);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('deltaQ', 0.050, 'SLD', 6.3e-6), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_thinfilm_kiessig_sld.json'));

    % multilayer_thermal_conductivity([10 20 10] nm, [150 10 150] W/m/K) —
    % multilayerThermalConductivity.m, Card 10 defaults (efMTt='10 20 10',
    % efMTk='150 10 150').
    thk = [10 20 10].';
    kap = [150 10 150].';
    r = calc.thinFilm.multilayerThermalConductivity(thk, kap);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('thicknesses', thk.', 'kappas', kap.'), ...
        'output', r), fullfile(goldenDir, 'calc_dira_thinfilm_multilayer_k.json'));

    % projected_range('Ar', 'Si', 100 keV) — projectedRange.m, Card 8 defaults.
    % (result.warning text is identical to the Python ion_range.projected_range
    % string, so it is kept and compared too.)
    r = calc.thinFilm.projectedRange('Ar', 'Si', 100);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('ion', 'Ar', 'target', 'Si', 'energy', 100), ...
        'output', r), fullfile(goldenDir, 'calc_dira_thinfilm_projected_range.json'));

    % sputter_rate(Y=2.0, J=1.0 mA/cm^2, rho=10.5 g/cm^3, M=107.87 g/mol) —
    % sputterRate.m, Card 7 defaults (silver-like target).
    r = calc.thinFilm.sputterRate(2.0, 1.0, 10.5, 107.87);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('Y', 2.0, 'J', 1.0, 'rho', 10.5, 'M', 107.87), ...
        'output', r), fullfile(goldenDir, 'calc_dira_thinfilm_sputter_rate.json'));

    % stoney_stress(Es=130 GPa, nus=0.28, ts=500 um, tf=100 nm, R=10 m) —
    % stoneyStress.m, Card 3 defaults, called in SI units (as the +calc fn
    % expects; the GUI converts GPa/um/nm before calling).
    r = calc.thinFilm.stoneyStress(130e9, 0.28, 500e-6, 100e-9, 10);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('Es', 130e9, 'nus', 0.28, 'ts', 500e-6, ...
        'tf', 100e-9, 'R', 10), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_thinfilm_stoney_stress.json'));

    % thermal_mismatch_strain(alphaFilm=17e-6, alphaSub=3e-6, deltaT=-500 K,
    % E=200 GPa, nu=0.28) — thermalMismatchStrain.m, Card 4 defaults.
    r = calc.thinFilm.thermalMismatchStrain(17e-6, 3e-6, -500, E=200e9, nu=0.28);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('alphaFilm', 17e-6, 'alphaSub', 3e-6, ...
        'deltaT', -500, 'E', 200e9, 'nu', 0.28), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_thinfilm_thermal_mismatch.json'));

    % NOTE: calc.thin_film.sauerbrey (Python) has NO MATLAB counterpart — no
    % +calc/+thinFilm/sauerbrey.m and no DiraCulator buildThinFilmTab card.
    % Python-only extension (class c) — no freeze case.
    %
    % NOTE: DiraCulator buildThinFilmTab Card 6 "Scherrer Grain Size"
    % (D = K*lambda/(B*cos(theta)), K=0.9, inline GUI formula) has NO Python
    % counterpart anywhere in calc/thin_film.py or the thin-film routes —
    % this is a MATLAB feature that was never ported. Flagged in the audit
    % report; not a freeze/test case since there is no Python fn to test.

    %% ── Superconductor ──

    % london_depth(lambda0=39 nm, T=4.2 K, Tc=9.25 K) — londonDepth.m, Card 1
    % defaults (Nb).
    r = calc.superconductor.londonDepth(lambda0=39, T=4.2, Tc=9.25);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('lambda0', 39, 'T', 4.2, 'Tc', 9.25), ...
        'output', r), fullfile(goldenDir, 'calc_dira_superconductor_london_depth.json'));

    % coherence_length(xi0=38 nm, T=4.2 K, Tc=9.25 K) — coherenceLength.m, Card 2
    % defaults (Nb).
    r = calc.superconductor.coherenceLength(xi0=38, T=4.2, Tc=9.25);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('xi0', 38, 'T', 4.2, 'Tc', 9.25), ...
        'output', r), fullfile(goldenDir, 'calc_dira_superconductor_coherence_length.json'));

    % gl_parameter(lambda=39 nm, xi=38 nm) — glParameter.m, Card 3 defaults (Nb).
    r = calc.superconductor.glParameter(lambda=39, xi=38);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('lambda', 39, 'xi', 38), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_superconductor_gl_parameter.json'));

    % critical_fields(Hc0=1980 Oe, Tc=9.25 K, T=4.2 K) — criticalFields.m, Card 4
    % defaults, called WITHOUT Material/lambda/xi exactly as the GUI's
    % doCriticalFields() does. Note: this path resolves to Type I with
    % Hc1=Hc2=NaN even though 1980/9.25 are Nb's numbers, because the type-II
    % branch requires either a preset Material or explicit lambda/xi/kappa —
    % intended MATLAB behavior of this exact call site, freeze it as-is.
    r = calc.superconductor.criticalFields(Hc0=1980, Tc=9.25, T=4.2);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('Hc0', 1980, 'Tc', 9.25, 'T', 4.2), ...
        'output', r), fullfile(goldenDir, 'calc_dira_superconductor_critical_fields_manual.json'));

    % critical_fields(Material='Nb', T=4.2 K) — same fn, Material-driven path
    % that DOES exercise the Type-II Hc1/Hc2 branch (per the MATLAB worked
    % example in criticalFields.m's header).
    %
    % *** MATLAB SOURCE BUG (surfaced here, NOT silently fixed) ***
    % calc.superconductor.criticalFields(Material=..., T=...) is UNCALLABLE
    % as documented in the current quantized_matlab checkout. When Material
    % is given and lambda/xi are not, it internally calls
    %   calc.superconductor.londonDepth(Material=opts.Material, T=T)
    %   calc.superconductor.coherenceLength(Material=opts.Material, T=T)
    % and BOTH declare their primary argument with a validator that rejects
    % their own "unset" sentinel default:
    %   opts.lambda0 (1,1) double {mustBePositive} = NaN   (londonDepth.m:42)
    %   opts.xi0     (1,1) double {mustBePositive} = NaN   (coherenceLength.m:46)
    % MATLAB's `arguments` block validates DEFAULT values too, so any call
    % that omits lambda0/xi0 -- which is the entire point of the Material=
    % convenience path -- throws "Invalid default value for argument
    % 'lambda0'/'xi0'. Value must be positive." before the function body
    % ever runs. Verified directly: a bare
    % `calc.superconductor.londonDepth(Material='Nb', T=4.2)` (the exact
    % call from that function's own docstring example) throws the identical
    % error. This makes criticalFields.m's own documented worked example
    % (its header, ~line 68) non-functional as shipped. Not fixed here --
    % quantized_matlab is only ever fixed deliberately, never silently, per
    % CLAUDE.md; report filed separately. Freezing the INTENDED output
    % instead: lambda(T)/xi(T) computed via the exact formulas londonDepth.m
    % (line 54) and coherenceLength.m (line 60) implement -- applied to the
    % Nb preset directly -- then fed to criticalFields as explicit
    % lambda/xi, which exercises its (unaffected) Hc1/Hc2 formulas exactly
    % as the Material path would have. The Python port's critical_fields
    % has no equivalent bug (its _resolve() has no premature validator), so
    % this is what quantized.calc.superconductor.critical_fields(material=
    % "Nb", t=4.2) actually computes -- confirmed a legitimate golden target.
    nbPresetCf = calc.superconductor.materialPresets(Material='Nb');
    Tcf = 4.2;
    tCf = Tcf / nbPresetCf.Tc;
    lambdaIntendedCf = nbPresetCf.lambda0 / sqrt(1 - tCf^4);   % londonDepth.m:54
    xiIntendedCf     = nbPresetCf.xi0     / sqrt(1 - tCf^2);   % coherenceLength.m:60
    r = calc.superconductor.criticalFields(Material='Nb', T=Tcf, ...
        lambda=lambdaIntendedCf, xi=xiIntendedCf);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('Material', 'Nb', 'T', Tcf), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_superconductor_critical_fields_material.json'));

    % depairing_current(Hc0=1980 Oe, lambda0=39 nm, Tc=9.25 K, T=4.2 K) —
    % depairingCurrent.m, Card 5 defaults, explicit-params path (as the GUI
    % calls it — no Material kwarg passed even though defaults match Nb).
    r = calc.superconductor.depairingCurrent(Hc0=1980, lambda0=39, Tc=9.25, T=4.2);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('Hc0', 1980, 'lambda0', 39, 'Tc', 9.25, ...
        'T', 4.2), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_superconductor_depairing_current.json'));

    % material_presets(Material='Nb') — materialPresets.m, single-material form
    % (matches Python material_presets("Nb") shape directly; the no-argument
    % form nests under a MATLAB-only .Nb/.NbN/... field layout that the Python
    % port wraps differently in {"materials": {...}} — freezing the
    % single-material call avoids that structural mismatch entirely).
    r = calc.superconductor.materialPresets(Material='Nb');
    writeJson(struct('input', struct('Material', 'Nb'), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_superconductor_material_presets_nb.json'));

    % NOTE: calc.superconductor.bcs_gap (Python) is a Python-only extension
    % (weak-coupling Delta0 = 1.764*kB*Tc, plus the Muhlschlegel Delta(T) form).
    % +calc/+superconductor/bcsGap.m is a DIFFERENT, array-based curve-FITTING
    % routine (fits Delta0/Tc from measured T,Delta(T) data) — a measurement-
    % analysis function, not a calculator-tab feature, and DiraCulator's
    % buildSuperconductorTab has no "BCS Gap" card at all. No freeze case.

    %% ── Vacuum ──

    % mean_free_path(P=1e-4 Pa, T=300 K, d=3.64e-10 m [N2]) — meanFreePath.m.
    % DiraCulator buildVacuumTab Card 1 (Mean Free Path) reimplements this
    % formula INLINE in doMFP() rather than calling calc.vacuum.meanFreePath,
    % but the inline formula (kB*T/(sqrt(2)*pi*d^2*P)) is identical — freezing
    % the +calc function directly at the Card-1 defaults.
    r = calc.vacuum.meanFreePath(1e-4, T=300, d=3.64e-10);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('P', 1e-4, 'T', 300, 'd', 3.64e-10), ...
        'output', r), fullfile(goldenDir, 'calc_dira_vacuum_mean_free_path.json'));

    % monolayer_time(P=1.33e-4 Pa) — monolayerTime.m, Card 2 default.
    r = calc.vacuum.monolayerTime(1.33e-4);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('P', 1.33e-4), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_vacuum_monolayer_time.json'));

    % knudsen_number(mfp=0.05 m, L=0.1 m) — knudsenNumber.m docstring example
    % (transition regime, Kn=0.5).
    r = calc.vacuum.knudsenNumber(0.05, 0.1);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('mfp', 0.05, 'L', 0.1), 'output', r), ...
        fullfile(goldenDir, 'calc_dira_vacuum_knudsen_number.json'));

    % pump_down_time(V=50 L, S=100 L/s, P0=1e5 Pa, Pf=1e-4 Pa) —
    % pumpDownTime.m, Card 4 defaults.
    r = calc.vacuum.pumpDownTime(50, 100, 1e5, 1e-4);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('V', 50, 'S', 100, 'P0', 1e5, 'Pf', 1e-4), ...
        'output', r), fullfile(goldenDir, 'calc_dira_vacuum_pump_down_time.json'));

    % sputter_yield('Cu', 500 eV, ion='Ar') — sputterYield.m. Freezes the
    % CORRECT +calc.vacuum.sputterYield(material, energy, ion=...) call order.
    % DiraCulator's Card 3 doSputterYield() button callback calls
    % calc.vacuum.sputterYield(efSYMat.Value, efSYIon.Value, efSYE.Value) —
    % i.e. (material, ion, energy) positionally, swapping ion and energy into
    % the function's (material, energy, opts.ion=...) signature, which errors
    % at the MATLAB "arguments" validation (a char passed where energy expects
    % a positive double) every time the GUI button is pressed. This is the
    % "Fixed sputterYield GUI arg-order bug" noted in PORT_CHECKLIST.md: the
    % +calc function itself was never wrong, only the GUI's call site was; the
    % Python port (routes/vacuum.py -> calc.vacuum.sputter_yield(material,
    % energy, ion=...)) already matches the function's own (correct, intended)
    % signature, so this freezes that intended behavior directly.
    r = calc.vacuum.sputterYield('Cu', 500, ion='Ar');
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('material', 'Cu', 'energy', 500, 'ion', 'Ar'), ...
        'output', r), fullfile(goldenDir, 'calc_dira_vacuum_sputter_yield.json'));

    % gas_flow(P1=1e-3 Pa, P2=1e-5 Pa, d=0.025 m, L=0.5 m) — gasFlow.m, Card 6
    % defaults.
    r = calc.vacuum.gasFlow(1e-3, 1e-5, 0.025, 0.5);
    r = rmfield(r, 'latex');
    writeJson(struct('input', struct('P1', 1e-3, 'P2', 1e-5, 'd', 0.025, ...
        'L', 0.5), 'output', r), fullfile(goldenDir, 'calc_dira_vacuum_gas_flow.json'));

    %% ── X-ray & Neutron ─────────────────────────────────────────────────────
    % Python module: src/quantized/calc/xray.py (registry domain "xray")
    %
    % class (a) — MATLAB counterpart exists, frozen via direct calc.* calls:
    %   bragg_d_spacing  <-> calc.crystal.dFromTwoTheta
    %   bragg_two_theta  <-> calc.crystal.twoThetaFromD
    %   bragg_theta      <-> calc.xrayNeutron.braggLaw(...).theta   (same formula,
    %                        theta = asind(lambda/(2d)), even though braggLaw is
    %                        not a 1:1 name match)
    %   q_from_two_theta <-> calc.xrayNeutron.twoThetaToQ
    %   two_theta_from_q <-> calc.xrayNeutron.qToTwoTheta
    %   q_from_d_spacing <-> calc.xrayNeutron.braggLaw(...).Q        (Q cancels
    %                        lambda algebraically -> 2*pi/d; braggLaw's Q field
    %                        is a valid golden source for any admissible lambda)
    %
    % class (c) — Python-only extension, NOT frozen here (no MATLAB source at
    % all, confirmed absent from +calc/+xrayNeutron and +calc/+crystal):
    %   bragg_d_from_theta, d_spacing_from_q, energy_from_wavelength_a,
    %   wavelength_from_energy_kev, neutron_calc (uses m_n, which
    %   calc.constants.m has no field for -- see xray.py module docstring).
    %   xray_calc is a dispatcher over the modes above, not a distinct formula.
    %
    % class (c)/documented divergence — NOT frozen here:
    %   sld_formula.sld_from_formula wraps `periodictable` (Sears + Henke/CXRO
    %   tables, the NIST NCNR engine), not MATLAB's own calc.elementData
    %   bCoherent/dispersionFactors tables. Different underlying atomic-data
    %   tables mean MATLAB-golden parity is not meaningful; parity is already
    %   asserted against published NIST NCNR reference values in
    %   tests/test_sld_formula.py (rtol=2e-3, documented as "not MATLAB golden
    %   tests -- there is no MATLAB source for this feature" in that file's own
    %   docstring). Staging a MATLAB-golden case here would freeze a number the
    %   Python port is not trying to reproduce.

    lam = 1.5406;       % Cu Kalpha1 (Angstrom)
    twoTheta = 28.44;   % deg
    d = 3.1356;         % Angstrom (Si(111))

    % -- bragg_d_spacing: d from 2theta -- calc.crystal.dFromTwoTheta --
    r = calc.crystal.dFromTwoTheta(twoTheta, lambda=lam);
    writeJson(struct('input', struct('wavelength', lam, 'twoTheta', twoTheta, 'n', 1), ...
        'output', struct('d', r.d)), fullfile(goldenDir, 'calc_dira_xray_d_from_2theta.json'));

    % -- bragg_two_theta: 2theta from d -- calc.crystal.twoThetaFromD --
    r = calc.crystal.twoThetaFromD(d, lambda=lam);
    writeJson(struct('input', struct('wavelength', lam, 'd', d, 'n', 1), ...
        'output', struct('twoTheta', r.twoTheta)), fullfile(goldenDir, 'calc_dira_xray_2theta_from_d.json'));

    % -- bragg_theta: theta from d -- calc.xrayNeutron.braggLaw(...).theta --
    rBL = calc.xrayNeutron.braggLaw(d, Lambda=lam);
    writeJson(struct('input', struct('wavelength', lam, 'd', d, 'n', 1), ...
        'output', struct('theta', rBL.theta)), fullfile(goldenDir, 'calc_dira_xray_theta_from_d.json'));

    % -- q_from_two_theta: Q from 2theta -- calc.xrayNeutron.twoThetaToQ --
    rQ = calc.xrayNeutron.twoThetaToQ(twoTheta, Lambda=lam);
    writeJson(struct('input', struct('wavelength', lam, 'twoTheta', twoTheta), ...
        'output', struct('Q', rQ.Q)), fullfile(goldenDir, 'calc_dira_xray_q_from_2theta.json'));

    % -- two_theta_from_q: 2theta from Q -- calc.xrayNeutron.qToTwoTheta --
    Qval = 2.0038223329441213;
    rT = calc.xrayNeutron.qToTwoTheta(Qval, Lambda=lam);
    writeJson(struct('input', struct('wavelength', lam, 'Q', Qval), ...
        'output', struct('twoTheta', rT.twoTheta)), fullfile(goldenDir, 'calc_dira_xray_2theta_from_q.json'));

    % -- q_from_d_spacing: Q from d (wavelength-independent) -- calc.xrayNeutron.braggLaw(...).Q --
    writeJson(struct('input', struct('d', d, 'n', 1), ...
        'output', struct('Q', rBL.Q)), fullfile(goldenDir, 'calc_dira_xray_q_from_d.json'));


    %% ── Magnetic ────────────────────────────────────────────────────────────
    % Python module: src/quantized/calc/magnetic.py (registry domain "magnetic")
    %
    % class (a) — direct +calc/+magnetic/*.m port:
    %   bohr_magneton_convert <-> bohrMagnetonConvert.m
    %   magnetization         <-> magnetization.m
    %   moment_per_atom       <-> momentPerAtom.m
    %   demag_factor          <-> demagFactor.m
    %
    % class (b) — GUI-embedded formula (DiraCulator.m buildMagneticTab), no
    % dedicated +calc file, but the GUI's inline arithmetic is bug-free and
    % matches the Python port exactly:
    %   demag_named        <-> doDemagFactor        (~3830-3859) — demagFactor +
    %                          axis swap for the "in-plane"/"transverse" labels
    %   curie_weiss_moment <-> doCurieWeiss          (~3885-3907) — computes
    %                          mu_eff directly, NOT via the buggy curieWeiss.m
    %   langevin           <-> doLangevin            (~3937-3958)
    %   moment_convert     <-> doMomentConvert       (~3783-3805)
    %
    % class (d) — intentional divergence from a MATLAB bug; frozen INTENDED
    % (corrected) behavior, per magnetic.py module docstring:
    %   curie_weiss_fit <-> +calc/+magnetic/curieWeiss.m — the fit machinery
    %                       (fitLine/C/theta_CW/R2/invChi) is correct and IS
    %                       frozen from the real MATLAB call below; only
    %                       curieWeiss.m's mu_eff is bugged (C_SI = C*1e-3
    %                       combined with SI kB/muB -> exactly 100x too small;
    %                       see the unit-algebra note at the freeze call). The
    %                       Python golden test multiplies the frozen (buggy)
    %                       mu_eff by the exact factor 100 rather than
    %                       hand-deriving a separate value.
    %   domain_wall     <-> doDomainWall (~3984-3996) — the GUI multiplies by
    %                       1e-3*1e4=10 converting erg/cm^2 -> mJ/m^2, but
    %                       1 erg/cm^2 = 1 mJ/m^2 exactly. Frozen inline below
    %                       with the correct x1 factor (no MATLAB call, since
    %                       calling the buggy GUI code isn't scriptable/exists
    %                       only inline in DiraCulator.m).

    kB_cgs = 1.381e-16;   % erg/K (CGS) -- matches the GUI's local literal, not
    muB_cgs = 9.274e-21;  % emu         -- calc.constants() (SI); see doCurieWeiss
    NA = 6.022e23;        % 1/mol         and doLangevin in DiraCulator.m verbatim.

    % -- bohr_magneton_convert -- calc.magnetic.bohrMagnetonConvert --
    r = calc.magnetic.bohrMagnetonConvert(2.5e-3, 'emu');
    writeJson(struct('input', struct('moment', 2.5e-3, 'unit', 'emu'), ...
        'output', struct('muB', r.muB)), fullfile(goldenDir, 'calc_dira_magnetic_bohr_magneton.json'));

    % -- magnetization -- calc.magnetic.magnetization --
    r = calc.magnetic.magnetization(2.5e-3, 5e-5);
    writeJson(struct('input', struct('moment', 2.5e-3, 'volume', 5e-5), ...
        'output', struct('Mcgs', r.Mcgs, 'Msi', r.Msi, 'MkAm', r.MkAm)), ...
        fullfile(goldenDir, 'calc_dira_magnetic_magnetization.json'));

    % -- moment_per_atom -- calc.magnetic.momentPerAtom --
    r = calc.magnetic.momentPerAtom(1.5e-3, 1e-4, 8.49e22);
    writeJson(struct('input', struct('totalMoment', 1.5e-3, 'volume', 1e-4, 'atomDensity', 8.49e22), ...
        'output', struct('muB', r.muB, 'muEmu', r.muEmu, 'M', r.M)), ...
        fullfile(goldenDir, 'calc_dira_magnetic_moment_per_atom.json'));

    % -- demag_factor: sphere / thin_film / cylinder / prolate / oblate -- calc.magnetic.demagFactor --
    r = calc.magnetic.demagFactor('sphere');
    writeJson(struct('input', struct('shape', 'sphere'), ...
        'output', struct('Nz', r.Nz, 'Nxy', r.Nxy)), fullfile(goldenDir, 'calc_dira_magnetic_demag_sphere.json'));

    r = calc.magnetic.demagFactor('thin_film');
    writeJson(struct('input', struct('shape', 'thin_film'), ...
        'output', struct('Nz', r.Nz, 'Nxy', r.Nxy)), fullfile(goldenDir, 'calc_dira_magnetic_demag_thinfilm.json'));

    r = calc.magnetic.demagFactor('cylinder', L=0.3, d=0.1);
    writeJson(struct('input', struct('shape', 'cylinder', 'length', 0.3, 'diameter', 0.1), ...
        'output', struct('Nz', r.Nz, 'Nxy', r.Nxy)), fullfile(goldenDir, 'calc_dira_magnetic_demag_cylinder.json'));

    r = calc.magnetic.demagFactor('prolate', ratio=5);
    writeJson(struct('input', struct('shape', 'prolate', 'ratio', 5), ...
        'output', struct('Nz', r.Nz, 'Nxy', r.Nxy)), fullfile(goldenDir, 'calc_dira_magnetic_demag_prolate.json'));

    r = calc.magnetic.demagFactor('oblate', ratio=10);
    writeJson(struct('input', struct('shape', 'oblate', 'ratio', 10), ...
        'output', struct('Nz', r.Nz, 'Nxy', r.Nxy)), fullfile(goldenDir, 'calc_dira_magnetic_demag_oblate.json'));

    % -- demag_named: GUI dropdown label -> demagFactor + axis swap (DiraCulator.m doDemagFactor) --
    r = calc.magnetic.demagFactor('thin_film');
    tmp = r.Nz; r.Nz = r.Nxy; r.Nxy = tmp;   % "Thin film (in-plane)" swap
    writeJson(struct('input', struct('label', 'Thin film (in-plane)'), ...
        'output', struct('Nz', r.Nz, 'Nxy', r.Nxy)), fullfile(goldenDir, 'calc_dira_magnetic_demag_named_inplane.json'));

    r = calc.magnetic.demagFactor('prolate', ratio=20);
    tmp = r.Nxy; r.Nxy = r.Nz; r.Nz = tmp;   % "Long cylinder (transverse)" swap
    writeJson(struct('input', struct('label', 'Long cylinder (transverse)'), ...
        'output', struct('Nz', r.Nz, 'Nxy', r.Nxy)), fullfile(goldenDir, 'calc_dira_magnetic_demag_named_transverse.json'));

    % -- curie_weiss_moment: GUI card formula (DiraCulator.m doCurieWeiss, ~3885-3907) --
    % Inline replication: the GUI recomputes mu_eff directly rather than calling
    % +calc/+magnetic/curieWeiss.m (whose mu_eff has the ~100x unit bug fixed in
    % the curie_weiss_fit case below); this inline formula is already correct.
    Ccw = 4.375; thetaCw = -50;
    mu_eff_cgs = sqrt(3 * kB_cgs * Ccw / NA);
    mu_eff_muB = mu_eff_cgs / muB_cgs;
    writeJson(struct('input', struct('C', Ccw, 'theta', thetaCw), ...
        'output', struct('mu_eff', mu_eff_muB)), fullfile(goldenDir, 'calc_dira_magnetic_curie_weiss_moment.json'));

    % -- curie_weiss_fit: 1/chi vs T fit -- +calc/+magnetic/curieWeiss.m --
    % Real MATLAB call: fitLine/C/theta_CW/R2/invChi are class (a) (unaffected
    % by the mu_eff bug). Synthetic paramagnet C=4, theta=50 (per curieWeiss.m's
    % own doc example), sampled every 20 K from 100-400 K, fit restricted to the
    % documented [150, 400] paramagnetic window.
    Tcw = (100:20:400).';
    chiCw = 4 ./ (Tcw - 50);
    rCW = calc.magnetic.curieWeiss(Tcw, chiCw, 'FitRange', [150 400]);
    writeJson(struct('input', struct('temperature', Tcw.', 'susceptibility', chiCw.'), ...
        'params', struct('fitRangeLo', 150, 'fitRangeHi', 400), ...
        'output', struct('theta_CW', rCW.theta_CW, 'C', rCW.C, 'mu_eff', rCW.mu_eff, ...
            'fitLine', rCW.fitLine, 'R2', rCW.R2, 'invChi', rCW.invChi.')), ...
        fullfile(goldenDir, 'calc_dira_magnetic_curie_weiss_fit.json'));

    % -- langevin: GUI card (DiraCulator.m doLangevin, ~3937-3958) --
    muLang = 1e-16; Hlang = 10000; Tlang = 300;
    xLang = muLang * Hlang / (kB_cgs * Tlang);
    Llang = coth(xLang) - 1/xLang;
    writeJson(struct('input', struct('mu', muLang, 'H', Hlang, 'T', Tlang), ...
        'output', struct('L', Llang, 'x', xLang)), fullfile(goldenDir, 'calc_dira_magnetic_langevin.json'));

    % -- domain_wall: GUI card (DiraCulator.m doDomainWall, ~3984-3996), INTENDED
    % (bug-corrected) behavior -- see class (d) note above.
    Adw = 2e-6; Kdw = 4.8e6;
    delta_cm = pi * sqrt(Adw / Kdw);
    delta_nm = delta_cm * 1e7;
    Ewall_erg = 4 * sqrt(Adw * Kdw);
    Ewall_mJ_m2 = Ewall_erg;   % correct x1 factor (NOT the GUI's buggy x10)
    writeJson(struct('input', struct('A', Adw, 'K', Kdw), ...
        'output', struct('delta_nm', delta_nm, 'e_wall_mj_m2', Ewall_mJ_m2)), ...
        fullfile(goldenDir, 'calc_dira_magnetic_domain_wall.json'));

    % -- moment_convert: GUI card (DiraCulator.m doMomentConvert, ~3783-3805) --
    valMc = 1.0e-3; scaleMc = 1;   % 'emu' dropdown ItemsData = 1
    emuMc = valMc * scaleMc; Am2Mc = emuMc * 1e-3;
    rBM = calc.magnetic.bohrMagnetonConvert(emuMc, 'emu');
    volMc = 0.01; nAtomsMc = 1e15;
    emuccMc = emuMc / volMc; AmMc = emuccMc * 1e3;
    muB_per_atom = rBM.muB / nAtomsMc;
    writeJson(struct('input', struct('value', valMc, 'unit', 'emu', 'volume', volMc, 'atoms', nAtomsMc), ...
        'output', struct('emu', emuMc, 'am2', Am2Mc, 'mu_b', rBM.muB, 'm_cgs', emuccMc, 'm_si', AmMc, ...
            'mu_b_per_atom', muB_per_atom)), fullfile(goldenDir, 'calc_dira_magnetic_moment_convert.json'));


    %% ── Optics ──────────────────────────────────────────────────────────────
    % Python module: src/quantized/calc/optics.py (registry domain "optics")
    %
    % class (a) — all seven Python ops are direct verbatim ports of the seven
    % +calc/+optics/*.m files (confirmed by source comparison: formulas match
    % term-for-term, including the k=0 -> Inf branch in penetrationDepth.m and
    % the n2>=n1 -> NaN branch in criticalAngle.m).

    % -- fresnel_coefficients: air/glass, oblique incidence -- calc.optics.fresnelCoefficients --
    r = calc.optics.fresnelCoefficients(1.0, 1.5, 30);
    writeJson(struct('input', struct('n1', 1.0, 'n2', 1.5, 'theta', 30), ...
        'output', struct('Rs', r.Rs, 'Rp', r.Rp, 'Ts', r.Ts, 'Tp', r.Tp)), ...
        fullfile(goldenDir, 'calc_dira_optics_fresnel_normal.json'));

    % -- fresnel_coefficients: glass/air, beyond critical angle (evanescent/TIR) --
    r = calc.optics.fresnelCoefficients(1.5, 1.0, 50);
    writeJson(struct('input', struct('n1', 1.5, 'n2', 1.0, 'theta', 50), ...
        'output', struct('Rs', r.Rs, 'Rp', r.Rp, 'Ts', r.Ts, 'Tp', r.Tp)), ...
        fullfile(goldenDir, 'calc_dira_optics_fresnel_tir.json'));

    % -- critical_angle: glass/air (TIR exists) -- calc.optics.criticalAngle --
    r = calc.optics.criticalAngle(1.5, 1.0);
    writeJson(struct('input', struct('n1', 1.5, 'n2', 1.0), ...
        'output', struct('thetaC', r.thetaC)), fullfile(goldenDir, 'calc_dira_optics_critical_angle.json'));

    % -- critical_angle: air/glass (n2 >= n1 -> NaN branch) --
    r = calc.optics.criticalAngle(1.0, 1.5);
    writeJson(struct('input', struct('n1', 1.0, 'n2', 1.5), ...
        'output', struct('thetaC', r.thetaC)), fullfile(goldenDir, 'calc_dira_optics_critical_angle_nan.json'));

    % -- brewster_angle: air/glass -- calc.optics.brewsterAngle --
    r = calc.optics.brewsterAngle(1.0, 1.5);
    writeJson(struct('input', struct('n1', 1.0, 'n2', 1.5), ...
        'output', struct('thetaB', r.thetaB)), fullfile(goldenDir, 'calc_dira_optics_brewster.json'));

    % -- penetration_depth: Si @ 400 nm (finite, k>0 branch) -- calc.optics.penetrationDepth --
    r = calc.optics.penetrationDepth(5.6, 0.39, 400);
    writeJson(struct('input', struct('n', 5.6, 'k', 0.39, 'lambda', 400), ...
        'output', struct('depth', r.depth, 'absCoeff', r.absCoeff, 'absLength', r.absLength)), ...
        fullfile(goldenDir, 'calc_dira_optics_penetration_depth.json'));

    % -- skin_depth: Cu @ 1 GHz -- calc.optics.skinDepth --
    r = calc.optics.skinDepth(1.68e-8, 1e9);
    writeJson(struct('input', struct('rho', 1.68e-8, 'f', 1e9), ...
        'output', struct('delta', r.delta, 'deltaUm', r.deltaUm, 'deltaNm', r.deltaNm)), ...
        fullfile(goldenDir, 'calc_dira_optics_skin_depth.json'));

    % -- dielectric_to_refractive: Si, lossless (k=0 branch) -- calc.optics.dielectricToRefractive --
    r = calc.optics.dielectricToRefractive(12.25, 0);
    writeJson(struct('input', struct('eps1', 12.25, 'eps2', 0), ...
        'output', struct('n', r.n, 'k', r.k)), fullfile(goldenDir, 'calc_dira_optics_dielectric_to_refractive.json'));

    % -- dielectric_to_refractive: metallic regime (eps1<0 branch) --
    r = calc.optics.dielectricToRefractive(-10, 2);
    writeJson(struct('input', struct('eps1', -10, 'eps2', 2), ...
        'output', struct('n', r.n, 'k', r.k)), fullfile(goldenDir, 'calc_dira_optics_dielectric_to_refractive_metal.json'));

    % -- refractive_to_dielectric: Si (IR), k=0 -- calc.optics.refractiveToDielectric --
    r = calc.optics.refractiveToDielectric(3.5, 0);
    writeJson(struct('input', struct('n', 3.5, 'k', 0), ...
        'output', struct('eps1', r.eps1, 'eps2', r.eps2)), ...
        fullfile(goldenDir, 'calc_dira_optics_refractive_to_dielectric.json'));

    % -- refractive_to_dielectric: gold @ ~600 nm (k>0 branch) --
    r = calc.optics.refractiveToDielectric(0.15, 3.6);
    writeJson(struct('input', struct('n', 0.15, 'k', 3.6), ...
        'output', struct('eps1', r.eps1, 'eps2', r.eps2)), ...
        fullfile(goldenDir, 'calc_dira_optics_refractive_to_dielectric_gold.json'));

    %% ══════════════════════════════════════════════════════════════════════
    %% ── Electrochemistry ──
    %% ══════════════════════════════════════════════════════════════════════
    %% All five ops have a direct +calc/+electrochemistry/*.m counterpart, called
    %% with each card's own GUI default values (DiraCulator.m
    %% buildElectrochemistryTab, ~4407-4562) so the freeze doubles as a check of
    %% the widget defaults too. Every MATLAB result struct also carries a
    %% `.latex` display field that the Python port intentionally omits (see
    %% src/quantized/calc/electrochemistry.py's module docstring) — the Python
    %% test strips it before comparing.

    % nernstPotential(E0, n, Q, T=298.15) -> E, E0, n, Q, T, latex
    rEc1 = calc.electrochemistry.nernstPotential(0.77, 1, 0.01);
    writeJson(struct('input', struct('E0', 0.77, 'n', 1, 'Q', 0.01), 'output', rEc1), ...
        fullfile(goldenDir, 'calc_dira_electrochemistry_nernst_potential.json'));

    % butlerVolmer(j0, eta, alpha=0.5, T=298.15) -> j, jAnodic, jCathodic, jTafel, latex
    rEc2 = calc.electrochemistry.butlerVolmer(1e-3, 0.1, alpha=0.5);
    writeJson(struct('input', struct('j0', 1e-3, 'eta', 0.1, 'alpha', 0.5), 'output', rEc2), ...
        fullfile(goldenDir, 'calc_dira_electrochemistry_butler_volmer.json'));

    % tafelSlope(alpha, T=298.15) -> b, bMv, latex
    rEc3 = calc.electrochemistry.tafelSlope(0.5);
    writeJson(struct('input', struct('alpha', 0.5), 'output', rEc3), ...
        fullfile(goldenDir, 'calc_dira_electrochemistry_tafel_slope.json'));

    % ohmicDrop(I, R) -> V, VmV, latex
    rEc4 = calc.electrochemistry.ohmicDrop(1e-3, 50);
    writeJson(struct('input', struct('I', 1e-3, 'R', 50), 'output', rEc4), ...
        fullfile(goldenDir, 'calc_dira_electrochemistry_ohmic_drop.json'));

    % doubleLayerCapacitance(epsilon, d, A) -> C, CuF, CpF, Cspec, latex
    rEc5 = calc.electrochemistry.doubleLayerCapacitance(78, 0.5, 1.0);
    writeJson(struct('input', struct('epsilon', 78, 'd', 0.5, 'A', 1.0), 'output', rEc5), ...
        fullfile(goldenDir, 'calc_dira_electrochemistry_double_layer_capacitance.json'));

    %% ══════════════════════════════════════════════════════════════════════
    %% ── Diffusion ──
    %% ══════════════════════════════════════════════════════════════════════
    %% No +calc/+diffusion package exists — buildDiffusionTab (DiraCulator.m
    %% ~4698-4829) embeds all three formulas directly in its nested callbacks.
    %% Each case below replicates the callback formula inline verbatim, citing
    %% the specific callback + line range, using each card's own GUI default
    %% values.
    %%
    %% NOTE (overlap, deliberately NOT re-frozen here): diffusion_length's
    %% L = sqrt(D*t) formula is IDENTICAL to the separate
    %% +calc/+semiconductor/diffusionLength.m package function (arg renamed
    %% tau->t). That package op belongs to the Semiconductor domain's own audit
    %% and is frozen there as calc_dira_semiconductor_diffusion_length.json
    %% (see freeze_dira_electrical_semi_thermal.m) — freezing it again here
    %% under a different name would be a redundant duplicate. This section
    %% freezes the GUI-embedded formula instead, since that is what
    %% quantized.calc.diffusion's own module docstring documents itself against
    %% ("Ports the three inline MATLAB diffusion formulas verbatim" from
    %% buildDiffusionTab, not the semiconductor package).

    % Card 1 — Arrhenius: DiraCulator.m doArrhenius, lines 4732-4742.
    %   D = D0 * exp(-Ea / (kB_eV * T))  [cm^2/s]; kB_eV hardcoded at line 4736.
    D0_arr = 0.1;    % cm^2/s (card default)
    Ea_arr = 1.0;    % eV (card default)
    T_arr = 1000;    % K (card default)
    kB_eV_arr = 8.617333262e-5;                            % line 4736
    D_arr = D0_arr * exp(-Ea_arr / (kB_eV_arr * T_arr));   % line 4737
    writeJson(struct('input', struct('D0', D0_arr, 'Ea', Ea_arr, 'T', T_arr), ...
        'output', struct('D', D_arr)), ...
        fullfile(goldenDir, 'calc_dira_diffusion_arrhenius.json'));

    % Card 2 — Diffusion length: DiraCulator.m doDiffLength, lines 4768-4783.
    %   Ld = sqrt(D*t) [cm]; Ld_um = Ld*1e4; Ld_nm = Ld*1e7
    D_dl = 1e-12;    % cm^2/s (card default)
    t_dl = 3600;     % s (card default)
    Ld_dl = sqrt(D_dl * t_dl);     % line 4771
    Ld_um_dl = Ld_dl * 1e4;        % line 4772
    Ld_nm_dl = Ld_dl * 1e7;        % line 4773
    writeJson(struct('input', struct('D', D_dl, 't', t_dl), ...
        'output', struct('L', Ld_dl, 'L_um', Ld_um_dl, 'L_nm', Ld_nm_dl)), ...
        fullfile(goldenDir, 'calc_dira_diffusion_diffusion_length.json'));

    % Card 3 — Fick's first law: DiraCulator.m doFick, lines 4813-4826.
    %   J = -D * dC/dx  [atoms/(cm^2*s)]
    D_fk = 1e-12;     % cm^2/s (card default)
    dC_fk = 1e18;     % cm^-3 (card default)
    dx_fk = 1e-5;     % cm (card default)
    J_fk = -D_fk * dC_fk / dx_fk;   % line 4821
    writeJson(struct('input', struct('D', D_fk, 'dC', dC_fk, 'dx', dx_fk), ...
        'output', struct('J', J_fk)), ...
        fullfile(goldenDir, 'calc_dira_diffusion_fick_flux.json'));

    % c_profile: Python-only extension (constant-source erfc profile,
    % c(x,t) = c0*erfc(x/(2*sqrt(D*t)))) — grepped +calc (recursively, incl.
    % +calc/+semiconductor) and DiraCulator.m's buildDiffusionTab for "erfc";
    % the only repo-wide hits are +fitting/parseEquation.m and
    % +fitting/residualDiagnostics.m (equation-string parsing and a
    % normal-probability-plot diagnostic — unrelated to a diffusion profile).
    % NOT frozen; labeled a class-(c) extension in the audit report.

    %% ══════════════════════════════════════════════════════════════════════
    %% ── Substrates ──
    %% ══════════════════════════════════════════════════════════════════════

    % listSubstrates + getSubstrate: full 14-row table dump (data parity, mirrors
    % the calc.elementData verbatim-table precedent above). buildSubstratesTab
    % (DiraCulator.m ~4835-4943) just displays this table per-row; it embeds no
    % formula of its own, so a full-table dump IS the parity evidence.
    subNames = calc.substrates.listSubstrates();
    subTbl = cell(numel(subNames), 1);
    for si = 1:numel(subNames)
        subTbl{si} = calc.substrates.getSubstrate(subNames{si});
    end
    writeJson(struct('output', {subTbl}), ...
        fullfile(goldenDir, 'calc_dira_substrates_table.json'));

    % latticeMismatch(aFilm, aSub) -> mismatch, mismatchPct, description, latex
    % (+calc/+crystal/latticeMismatch.m) — the function's own docstring example
    % (La0.7Sr0.3MnO3 on SrTiO3). Python's substrates.lattice_mismatch is a
    % verbatim port (no latex field); exact formula match, no discrepancy.
    rSub2 = calc.crystal.latticeMismatch(3.876, 3.905);
    writeJson(struct('input', struct('aFilm', 3.876, 'aSub', 3.905), 'output', rSub2), ...
        fullfile(goldenDir, 'calc_dira_substrates_lattice_mismatch.json'));

    % criticalThickness(aFilm, aSub, nu=0.3) -> hc, hcNm, mismatch, burgersVector,
    % latex (+calc/+crystal/criticalThickness.m).
    % These two cases originally exposed a four-part Python formula divergence.
    % They now gate method-level parity: b=aFilm/sqrt(2), both 60-degree
    % factors, hc=A*(log(hc/b)+1), and 50 iterations from hc=1000 Angstrom.
    rSub3a = calc.crystal.criticalThickness(5.869, 5.653);
    writeJson(struct('input', struct('aFilm', 5.869, 'aSub', 5.653, 'nu', 0.3), ...
        'output', rSub3a), ...
        fullfile(goldenDir, 'calc_dira_substrates_critical_thickness_a.json'));
    rSub3b = calc.crystal.criticalThickness(3.876, 3.905);
    writeJson(struct('input', struct('aFilm', 3.876, 'aSub', 3.905, 'nu', 0.3), ...
        'output', rSub3b), ...
        fullfile(goldenDir, 'calc_dira_substrates_critical_thickness_b.json'));

    fprintf('Done.\n');
end

function writeJson(s, outPath)
    fid = fopen(outPath, 'w');
    assert(fid > 0, 'cannot open %s', outPath);
    fwrite(fid, jsonencode(s));
    fclose(fid);
    fprintf('froze %s\n', outPath);
end
