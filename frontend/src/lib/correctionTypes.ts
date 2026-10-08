/** Correction-pipeline params (camelCase wire keys; all optional).
 * Mirrors `routes/corrections.CorrectionParams` / MATLAB `correctionParams`. */
export interface CorrectionParams {
  xOff?: number;
  yOff?: number;
  bgSlope?: number;
  bgInt?: number;
  bgPoly?: number[];
  xTrimMin?: number;
  xTrimMax?: number;
  isNeutron?: boolean;
  isMag?: boolean;
  fieldUnit?: string;
  momentUnit?: string;
  sampleMass?: number;
  sampleVolume?: number;
  smoothEnabled?: boolean;
  smoothWindow?: number;
  smoothMethod?: string;
  smoothPolyOrder?: number;
  normMethod?: string;
  normReferenceValue?: number;
  normReferenceMin?: number;
  normReferenceMax?: number;
  detrendOrder?: number;
  derivativeMode?: string;
  /** Signal-stage subset; absent preserves all channels. */
  signalChannels?: number[];
  /** GOTO #2 anchor-point baseline subtraction: user-picked (x, y) anchor
   * pairs + the interpolation method (linear/pchip/spline). Present with
   * >=2 anchors = subtracted in pipeline step 3 (beats bgPoly/slope). */
  bgAnchors?: [number, number][];
  bgAnchorMethod?: string;
  /** GOTO #7b XRR/NR beam-footprint correction: beam width + sample length
   * (any one shared length unit — only w/L enters the geometry) and whether
   * x is the detector angle 2θ (then θ = x/2). Both > 0 = enabled
   * (pipeline step 2b; `dq` channels are skipped). */
  footprintW?: number;
  footprintL?: number;
  footprintTwoTheta?: boolean;
  /** MAIN_PLAN #37 arbitrary rescaling — the literal MULTIPLIER for x / y.
   * The Corrections card offers ×/÷ but stores 1/v for a division, so this is
   * the single stored representation (see `lib/rescale.ts`). Applied FIRST in
   * the backend pipeline (step 0), so every other correction on this object —
   * trims, offsets, bg slope/intercept, anchors — is expressed in the SCALED
   * units the user sees on the plot. Absent or 1 = no-op; the backend rejects
   * zero/non-finite with a 422. */
  xScale?: number;
  yScale?: number;
}
