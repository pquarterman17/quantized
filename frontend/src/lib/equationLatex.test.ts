// lib/equationLatex (audit P2.7 stretch): the Python-expression -> LaTeX
// converter behind the equation preview. It must draw the tree the backend
// grammar (calc/fit_equation_syntax.py) evaluates, and return null -- never
// throw -- on anything it cannot draw.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import katex from "katex";
import { describe, expect, it } from "vitest";

import { equationToLatex, nameToLatex, PREVIEW_FUNCTION_NAMES } from "./equationLatex";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const body = (text: string): string | null => {
  const tex = equationToLatex(text);
  return tex === null ? null : tex.replace(/^(y|f\(x\)) = /, "");
};

describe("equationToLatex: the documented example and common models", () => {
  it("renders A*exp(-x/tau) + c as A e^{-x/tau} + c", () => {
    expect(equationToLatex("A*exp(-x/tau) + c")).toBe("y = A\\,e^{-x/\\tau} + c");
  });

  it("renders a Gaussian with the exponent's division inline", () => {
    expect(body("A*exp(-(x-x0)**2/(2*sigma**2)) + c")).toBe(
      "A\\,e^{-\\left(x - x_{0}\\right)^{2}/\\left(2\\,\\sigma^{2}\\right)} + c",
    );
  });

  it("renders a logistic with a fraction outside the exponent", () => {
    expect(body("1/(1+exp(-(x-x0)/w))")).toBe("\\frac{1}{1 + e^{-\\left(x - x_{0}\\right)/w}}");
  });

  it("renders a quadratic", () => {
    expect(body("a*x^2 + b*x + c")).toBe("a\\,x^{2} + b\\,x + c");
  });
});

describe("equationToLatex: left-hand side", () => {
  it("keeps y = and f(x) = as typed and supplies y = when there is none", () => {
    expect(equationToLatex("y = a*x")).toBe("y = a\\,x");
    expect(equationToLatex("  y=a*x ")).toBe("y = a\\,x");
    expect(equationToLatex("f(x) = a*x")).toBe("f(x) = a\\,x");
    expect(equationToLatex("f(x)=a*x")).toBe("f(x) = a\\,x");
    expect(equationToLatex("a*x")).toBe("y = a\\,x");
  });

  it("gives nothing for an empty right-hand side or a second =", () => {
    for (const text of ["", "   ", "y =", "y = ", "f(x) =", "y == x", "y = a = b"]) {
      expect(equationToLatex(text), text).toBeNull();
    }
  });
});

describe("equationToLatex: operators and precedence (mirrors the backend)", () => {
  it("treats ** as a synonym of ^", () => {
    expect(body("x**2")).toBe(body("x^2"));
    expect(body("x**2")).toBe("x^{2}");
  });

  it("is right-associative for powers, as the backend pins (2^3^2 = 2^(3^2))", () => {
    expect(body("2^3^2")).toBe("2^{3^{2}}");
    expect(body("2**3**2")).toBe("2^{3^{2}}");
  });

  it("binds a sign after ^ to the rest of the power chain only", () => {
    expect(body("2^-3^2")).toBe("2^{-3^{2}}");
    expect(body("2^-3*4")).toBe("2^{-3} \\cdot 4");
  });

  it("draws the leading-minus encoding as a sign binding like -", () => {
    expect(body("-x**2")).toBe("-x^{2}");
    expect(body("-a*b + c")).toBe("-a\\,b + c");
    expect(body("-(a-b)")).toBe("-\\left(a - b\\right)");
    expect(body("(-a)^2")).toBe("\\left(-a\\right)^{2}");
    expect(body("a^(-b)")).toBe("a^{-b}");
  });

  it("parenthesizes a negation that follows an operator", () => {
    expect(body("a - -b")).toBe("a - \\left(-b\\right)");
    expect(body("3*-2*x")).toBe("3\\,\\left(-2\\right)\\,x");
    expect(body("a*-b^2")).toBe("a\\,\\left(-b^{2}\\right)");
    expect(body("--x")).toBe("-\\left(-x\\right)");
    expect(body("c*(-a+b)")).toBe("c\\,\\left(-a + b\\right)");
  });

  it("drops unary plus, as the backend does", () => {
    expect(body("+a")).toBe("a");
    expect(body("a*+b")).toBe("a\\,b");
    expect(body("(+a)")).toBe("a");
  });

  it("keeps grouping that changes the meaning and drops what does not", () => {
    expect(body("(a+b)*c")).toBe("\\left(a + b\\right)\\,c");
    expect(body("a-(b-c)")).toBe("a - \\left(b - c\\right)");
    expect(body("(a-b)-c")).toBe("a - b - c");
    expect(body("(a*b)*c")).toBe("a\\,b\\,c");
    expect(body("(a+b)^2")).toBe("\\left(a + b\\right)^{2}");
    expect(body("(a*b)^2")).toBe("\\left(a\\,b\\right)^{2}");
  });

  it("draws / as \\frac outside an exponent, nesting left to right", () => {
    expect(body("a/b")).toBe("\\frac{a}{b}");
    expect(body("a/b/c")).toBe("\\frac{\\frac{a}{b}}{c}");
    expect(body("x/(a*b)")).toBe("\\frac{x}{a\\,b}");
    expect(body("(a/b)^2")).toBe("\\left(\\frac{a}{b}\\right)^{2}");
    expect(body("-(a/b)")).toBe("-\\frac{a}{b}");
  });

  it("keeps / inline inside an exponent, with the parentheses it then needs", () => {
    expect(body("exp(x/(a*b))")).toBe("e^{x/\\left(a\\,b\\right)}");
    expect(body("exp(a/b*c)")).toBe("e^{\\left(a/b\\right)\\,c}");
    expect(body("2^(a/b)")).toBe("2^{a/b}");
  });

  it("uses \\cdot where juxtaposition would merge digits or read as a mixed number", () => {
    expect(body("2*x")).toBe("2\\,x");
    expect(body("x*2")).toBe("x \\cdot 2");
    expect(body("2*3")).toBe("2 \\cdot 3");
    expect(body("a*2^x")).toBe("a \\cdot 2^{x}");
    expect(body("2*(1/3)")).toBe("2 \\cdot \\frac{1}{3}");
    expect(body("a*(1/3)")).toBe("a\\,\\frac{1}{3}");
  });
});

describe("equationToLatex: functions and constants", () => {
  it("covers exactly the backend grammar's FUNCTION_NAMES", () => {
    const src = readFileSync(join(REPO_ROOT, "src/quantized/calc/fit_equation_syntax.py"), "utf-8");
    const tuple = /FUNCTION_NAMES: tuple\[str, \.\.\.\] = \(([^)]*)\)/.exec(src);
    expect(tuple, "FUNCTION_NAMES not found in fit_equation_syntax.py").not.toBeNull();
    const backend = [...(tuple?.[1] ?? "").matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]).sort();
    expect(backend.length).toBeGreaterThan(10);
    expect([...PREVIEW_FUNCTION_NAMES].sort()).toEqual(backend);
    for (const name of backend) expect(body(`${name}(x)`), name).not.toBeNull();
  });

  it("uses the conventional notation for each function", () => {
    expect(body("exp(x)")).toBe("e^{x}");
    expect(body("log(x)")).toBe("\\ln\\left(x\\right)"); // natural log (np.log)
    expect(body("log10(x)")).toBe("\\log_{10}\\left(x\\right)");
    expect(body("sqrt(x)")).toBe("\\sqrt{x}");
    expect(body("abs(x)")).toBe("\\left|x\\right|");
    expect(body("floor(x)")).toBe("\\left\\lfloor x\\right\\rfloor");
    expect(body("ceil(x)")).toBe("\\left\\lceil x\\right\\rceil");
    expect(body("asin(x)")).toBe("\\arcsin\\left(x\\right)");
    expect(body("coth(x)")).toBe("\\coth\\left(x\\right)");
    expect(body("erf(x)")).toBe("\\operatorname{erf}\\left(x\\right)");
    expect(body("sign(x)")).toBe("\\operatorname{sgn}\\left(x\\right)");
    expect(body("sin (x)")).toBe("\\sin\\left(x\\right)");
  });

  it("parenthesizes an exponential used as a power's base", () => {
    expect(body("exp(x)^2")).toBe("\\left(e^{x}\\right)^{2}");
    expect(body("sin(x)^2")).toBe("\\sin\\left(x\\right)^{2}");
    expect(body("exp(exp(x))")).toBe("e^{e^{x}}");
  });

  it("draws pi and e as constants", () => {
    expect(body("e*pi")).toBe("e\\,\\pi");
    expect(body("cos(2*pi*x/T)")).toBe("\\cos\\left(\\frac{2\\,\\pi\\,x}{T}\\right)");
  });
});

describe("equationToLatex: numbers", () => {
  it("keeps plain numbers as typed", () => {
    expect(body("1.5*x")).toBe("1.5\\,x");
    expect(body(".5*x")).toBe(".5\\,x");
    expect(body("2.*x")).toBe("2.\\,x");
  });

  it("draws scientific notation as a power of ten", () => {
    expect(body("2.5e-3*x")).toBe("2.5 \\times 10^{-3}\\,x");
    expect(body("1e3*x")).toBe("10^{3}\\,x");
    expect(body("1.5e+03")).toBe("1.5 \\times 10^{3}");
    expect(body("1E-05")).toBe("10^{-5}");
    expect(body("(1e3)^2")).toBe("\\left(10^{3}\\right)^{2}");
  });

  it("gives nothing for a malformed number", () => {
    for (const text of ["1.2.3", "2e", "2e+", "1..", "2ex"]) expect(equationToLatex(text), text).toBeNull();
  });
});

describe("nameToLatex: parameter names", () => {
  it("draws Greek-named parameters as the letter", () => {
    expect(nameToLatex("tau")).toBe("\\tau");
    expect(nameToLatex("sigma")).toBe("\\sigma");
    expect(nameToLatex("Delta")).toBe("\\Delta");
    expect(nameToLatex("lambda")).toBe("\\lambda");
    expect(nameToLatex("varphi")).toBe("\\varphi");
    // Only exact names: a Greek prefix is still an ordinary word.
    expect(nameToLatex("taus")).toBe("\\mathrm{taus}");
    expect(nameToLatex("DELTA")).toBe("\\mathrm{DELTA}");
  });

  it("turns _ and trailing digits into subscripts", () => {
    expect(nameToLatex("x_0")).toBe("x_{0}");
    expect(nameToLatex("tau_1")).toBe("\\tau_{1}");
    expect(nameToLatex("k_B")).toBe("k_{B}");
    expect(nameToLatex("A_max")).toBe("A_{\\mathrm{max}}");
    expect(nameToLatex("A0")).toBe("A_{0}");
    expect(nameToLatex("tau12")).toBe("\\tau_{12}");
    expect(nameToLatex("A0_max")).toBe("A_{0,\\mathrm{max}}");
    expect(nameToLatex("T_c_sigma")).toBe("T_{c,\\sigma}");
  });

  it("sets other multi-letter names upright so they do not read as products", () => {
    expect(nameToLatex("amp")).toBe("\\mathrm{amp}");
    expect(nameToLatex("a1b")).toBe("\\mathrm{a1b}");
    expect(nameToLatex("A")).toBe("A");
  });

  it("keeps odd underscores literal", () => {
    expect(nameToLatex("_a")).toBe("\\mathrm{\\_a}");
    expect(nameToLatex("lambda_")).toBe("\\mathrm{lambda\\_}");
    expect(nameToLatex("b__c")).toBe("\\mathrm{b\\_\\_c}");
  });

  it("draws Greek letters and subscript digits typed as Unicode", () => {
    expect(body("τ*x")).toBe("τ\\,x");
    expect(body("A₀*x")).toBe("{A₀}\\,x");
    expect(body("τ₁_max")).toBe("{τ₁}_{\\mathrm{max}}");
  });

  it("gives nothing for a name holding any other character", () => {
    expect(nameToLatex("x²")).toBeNull();
    expect(nameToLatex("Å")).toBeNull();
    expect(nameToLatex("a\\b")).toBeNull();
    expect(equationToLatex("x²")).toBeNull(); // one parameter named "x²" to the backend
    expect(equationToLatex("é*x")).toBeNull();
  });

  it("is not fooled by names on Object.prototype", () => {
    expect(body("constructor*x")).toBe("\\mathrm{constructor}\\,x");
    expect(body("toString")).toBe("\\mathrm{toString}");
    expect(body("__proto__")).toBe("\\mathrm{\\_\\_proto\\_\\_}");
    expect(body("hasOwnProperty(x)")).toBeNull(); // an unknown function, not a method
  });
});

describe("equationToLatex: malformed input gives null and never throws", () => {
  const MALFORMED = [
    "A*exp(", "A*exp(-x/tau", "a)", "(a", "()", "a*()", "exp", "exp x", "exp*x", "foo(x)", "x(2)", "pi(2)",
    "a b", "2x", "2(3)", "a*", "a+", "*a", "a*/b", "a^", "a,b", "exp(a,b)", "-", "(-)", "a*-", "a = b",
    "x\n+1", "a + b", "a − b", "a·b", "x²+1", "１*x", "a;b", "a%b", "$a", "\\frac{a}{b}", "{a}",
  ];
  it.each(MALFORMED)("%j", (text) => {
    expect(() => equationToLatex(text)).not.toThrow();
    expect(equationToLatex(text)).toBeNull();
  });

  it("survives pathological nesting depth", () => {
    const deep = `${"(".repeat(100_000)}x${")".repeat(100_000)}`;
    expect(() => equationToLatex(deep)).not.toThrow();
    const unbalanced = "(".repeat(100_000);
    expect(equationToLatex(unbalanced)).toBeNull();
  });

  it("never throws on random input, and whatever it returns KaTeX accepts", () => {
    // Deterministic LCG so a failure reproduces.
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const alphabet = ["a", "x", "tau", "x_0", "1", "2.5", "e-3", "e", "pi", "exp", "sqrt", "(", ")", "+", "-", "*", "/", "^", "**", " ", ",", "="];
    let rendered = 0;
    for (let i = 0; i < 3000; i += 1) {
      const text = Array.from({ length: 1 + rand(12) }, () => alphabet[rand(alphabet.length)]).join("");
      const tex = equationToLatex(text); // a throw here fails the test
      if (tex !== null) {
        rendered += 1;
        const draw = () => katex.renderToString(tex, { throwOnError: true, strict: "error" });
        expect(draw, `${text} -> ${tex}`).not.toThrow();
      }
    }
    expect(rendered).toBeGreaterThan(100); // the corpus is not all rejects
  });
});
