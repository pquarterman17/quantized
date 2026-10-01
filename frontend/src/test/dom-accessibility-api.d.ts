// dom-accessibility-api 0.5.x (the copy @testing-library/dom resolves, and
// the one `accessibleNames.render.test.tsx` imports) ships `dist/index.d.ts`
// but omits it from its package.json `exports`, so "bundler" resolution cannot
// see it. Declare the one function the tests use, with the library's own
// signature (0.6.x adds the `types` export condition).
declare module "dom-accessibility-api" {
  export function computeAccessibleName(
    root: Element,
    options?: { compute?: "description" | "name"; hidden?: boolean },
  ): string;
}
