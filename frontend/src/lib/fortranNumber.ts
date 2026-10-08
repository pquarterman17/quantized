/** `Number()` that also reads a Fortran D exponent ("1.0D+00", "3.D4"). Same
 *  grammar as the backend's io/_fortran_float.py: an integer mantissa needs a
 *  signed exponent, so IDs and hex strings ("1D2", "3D") stay text. */
const FORTRAN = /^[+-]?(?:(?:\d+\.\d*|\.\d+)[dD][+-]?|\d+[dD][+-])\d+$/;

export const toNumber = (text: string): number =>
  Number(FORTRAN.test(text) ? text.replace(/d/i, "e") : text);
