"""Origin's own fit of each built-in function #1096 ported (one case each).

Every case fits a seeded noisy curve with ``nlbegin`` / ``nlfit`` / ``nlend``
using Origin's built-in function of the same name, from Origin's own initial
guess. The start values Origin chose are copied into LabTalk variables
``qz_s<i>`` right after ``nlbegin`` (read back as ``values``). Functions in
``PLANTED_START`` could not be fitted from Origin's guess (see their notes in
``truth.json`` ``conventions``); they restart from the planted parameters.

The fit report sheets (``FitNL*``) land in ``books``: the first
``len(params)`` rows of "Value" / "Standard Error" are the parameters; the
statistics column lists points, degrees of freedom, reduced chi-square,
residual sum of squares, R-square, adjusted R-square and the fit status.
"""

from __future__ import annotations

from oracle_fit_planted import PLANTED
from oracle_inputs_fit import FIT_SEED_BASE, case_id, fit_generator, origin_name
from oracle_model import Case, Read

from quantized.calc.fit_models import FIT_MODELS

POOR_GUESS = (
    "Origin's own guess ended far above the noise floor (RSS / (dof * sigma^2) > 3) "
    "or reported no fit (RSS 0, status Failed(-103))"
)

# registry name -> why the fit restarts from the planted parameters. Origin's own
# guess was run first and ended far above the noise floor; ``nlbegin`` still runs
# Origin's initialization, then the planted values overwrite it (``values`` holds
# the start the fit actually used).
PLANTED_START: dict[str, str] = {
    **dict.fromkeys(
        (
            "Allometric2", "Beta", "BETMod", "BiDoseResp", "Biphasic", "BlNeldSmp", "BoxLucas2",
            "BWF", "Chapman", "Dhyperbl", "DoniachSunjic", "DoubleBoltzmann", "ECS", "ExpAssoc2",
            "ExpAssocDelay1", "ExpAssocDelay2", "ExpGrow3Dec2", "ExponentialCDF", "Holliday1",
            "InvsPoly", "Logistpk", "Pow2P3", "Power0", "Rational1", "Rational3", "Rational4",
            "ReciprocalMod", "SchulzFlory", "Weibull3", "DoubleExpOffset", "FreundlichEXT",
            "LangmuirEXT1",
        ),
        POOR_GUESS,
    ),
}
_NO_INIT = (
    "nlbegin iy:=<xy> func:=<name> nltree:=tt returns False (no Parameters Initialization "
    "section in the function definition); the same with init:=disable, init:=enable, "
    "option:=init_all, mode:=auto, without nltree, a one-column iy, and a lower-case file "
    "stem all return False, while functions of the same shape that have an initialization "
    "section start fine. Origin cannot start a headless fit of this function.",
)
NOT_EXERCISED: dict[str, tuple[str, ...]] = dict.fromkeys(
    (
        "Asymptotic2", "Asymptotic3", "Asymptotic4", "Asymptotic5", "Asymptotic6",
        "Asymptotic7", "BentHyperblSmp", "ExpGrow", "ExpGrowth", "Freundlich", "Freundlich3P",
        "Freundlich3PMod", "FreundlichMod1", "MWChang", "PolyCtr5", "Pulse1", "Reich",
        "Richards", "SLogistic4", "TimePow",
    ),
    _NO_INIT,
) | {
    name: (
        "nlbegin returns False although the function has an initialization script; "
        "also False with init:=disable" + extra,
    )
    for name, extra in (
        ("AsymmetricGaussian", ""),
        ("Composite", " (its script calls peak_pos on the curve)"),
        ("Lanczos3", " and with the LabTalk variable setpar = 0 its script reads"),
    )
}

FIT_NAMES: tuple[str, ...] = tuple(PLANTED)


def fit_case(index: int, name: str) -> Case:
    pnames = FIT_MODELS[name]["paramNames"]
    planted = name in PLANTED_START
    # Declared before nlbegin: variables created after it do not survive nlend.
    steps = [f"double qz_s{i} = 0;" for i in range(1, len(pnames) + 1)]
    steps += [f"nlbegin iy:=[{{book}}]1!(1,2) func:={origin_name(name)} nltree:=tt;"]
    if planted:
        steps += [f"tt.{p} = {v!r};" for p, v in zip(pnames, PLANTED[name][2], strict=True)]
    steps += [f"qz_s{i} = tt.{p};" for i, p in enumerate(pnames, start=1)]
    steps += ["nlfit;", "nlend output:=1;"]
    skipped = NOT_EXERCISED.get(name, ())
    return Case(
        id=case_id(name),
        description=f"Origin's own nlfit of {origin_name(name)} to a noisy planted curve",
        seed=FIT_SEED_BASE + index,
        generate=fit_generator(name),
        steps=() if skipped else tuple(steps),
        reads=tuple(Read(f"qz_s{i}") for i in range(1, len(pnames) + 1)),
        not_exercised=skipped,
        conventions={
            "fit": "Origin nlbegin/nlfit/nlend, Levenberg-Marquardt, no weighting",
            "start": "planted" if planted else "origin_guess",
            **({"start_reason": PLANTED_START[name]} if planted else {}),
        },
    )


FIT_CASES: tuple[Case, ...] = tuple(fit_case(i, n) for i, n in enumerate(FIT_NAMES))
