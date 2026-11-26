// The names of the distribution functions in lib/formulaDist.ts, kept in a
// tiny module of their own so the EAGER headless check (lib/formulaHeadless.ts)
// can say "the Python twin has these" without pulling the numerics (the lazy
// formula chunk) into the first-paint bundle. formulaDist.test.ts pins that
// this list is exactly the keys of DIST_FUNCS.

export const DIST_NAMES: ReadonlySet<string> = new Set(
  (
    "normpdf normcdf norminv tpdf tcdf tinv chi2pdf chi2cdf chi2inv fpdf fcdf finv " +
    "gampdf gamcdf gaminv betapdf betacdf betainv lognpdf logncdf logninv " +
    "wblpdf wblcdf wblinv exppdf expcdf expinv poisspdf poisscdf binopdf binocdf"
  ).split(" "),
);
