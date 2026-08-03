# Electrical transport

Covers `calc/electrical.py`. Units follow the semiconductor-lab convention
used throughout the toolbox: resistance in Ω, sheet resistance in Ω/sq,
resistivity in Ω·cm, carrier density in cm⁻³, mobility in cm²/(V·s).

## Van der Pauw sheet resistance

For an arbitrarily-shaped, simply-connected, homogeneous thin sample with
four small contacts on its perimeter, the sheet resistance $R_s$ is
determined — with no geometric correction factor — from two characteristic
resistances $R_a$, $R_b$ (each the average of the two current-reversed
readings for that contact configuration) via the implicit relation:

$$e^{-\pi R_a/R_s} + e^{-\pi R_b/R_s} = 1$$

Note $R_s$ sits in the *denominator* of each exponent — the measured
resistances are fixed inputs; the unknown $R_s$ sets the exponents' scale.
The symmetric case $R_a=R_b=R$ is closed-form, $R_s = \pi R/\ln 2$; the code
uses it directly when the two match exactly (the general solve's Jacobian is
degenerate there) and otherwise root-finds numerically — the left-hand side
is strictly increasing in $R_s$, so exactly one positive root exists.
**When to use:** any four-point measurement on an irregular or awkwardly-
contacted thin film/flake where a linear four-point-probe correction factor
doesn't apply.

Worked example: $R_a=R_b=1\,\Omega \Rightarrow R_s = 4.5324\,\Omega/\text{sq}$
(the textbook symmetric-cell value).

**Reference:** van der Pauw, L.J., "A method of measuring specific
resistivity and Hall effect of discs of arbitrary shape," *Philips Res.
Rep.* **13**, 1–9 (1958).

## Hall-effect carrier analysis

A transverse voltage $V_H$ develops when a current $I_x$ flows through a
conductor in a perpendicular field $B_z$. For a single-point measurement,

$$R_H = \frac{V_H\,t}{I\,B}, \qquad n = \frac{1}{|R_H|\,q}$$

with sign convention $R_H>0$ = holes (p-type), $R_H<0$ = electrons (n-type).
For a field sweep, `hall_analysis` linear-fits the transverse
resistance/resistivity against field,

$$R_{xy}(H) = R_H\,H + R_{xy,0}$$

so the slope — not a single reading — is the Hall coefficient, averaging out
point-to-point noise and reporting a fit-quality $R^2$. When the
longitudinal conductivity $\sigma$ is also supplied (e.g. from a companion
van der Pauw measurement, $\sigma = 1/\rho$), the Hall mobility follows as
$\mu_H = |R_H|\cdot\sigma$. **When to use:** extracting majority-carrier type,
density, and mobility from a magnetic-field-swept Hall bar or van der Pauw
measurement — the field sweep is strongly preferred over a single point
whenever more than one field value is available, since it is immune to a
single bad reading and gives a quantitative fit-quality check.

Worked example — clean electron-like sweep ($R_{xy}=-1.2\times10^{-3}H$,
$t=10^{-3}$ cm, $\sigma=500$ S/cm): $R_H = -1.2\times10^{-2}$ cm³/C,
$n=5.20\times10^{20}$ cm⁻³, carrier type electron, $\mu_H = 6.0$ cm²/(V·s).

**Reference:** Ashcroft, N.W. & Mermin, N.D., *Solid State Physics*
(Saunders, 1976), Ch. 1 (Drude-model Hall effect).
