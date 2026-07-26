// ESLint 10 flat config (PRIMARY SOFTWARE P4.1 — the `npm run lint` restore).
//
// Scope: NON-type-aware linting. The repo's TypeScript is 7.0.2 (the native
// port) while typescript-eslint 8.65 declares `typescript >=4.8.4 <6.1.0`,
// so the deps are installed with --legacy-peer-deps and only syntax-level
// rules run; type-aware presets (recommendedTypeChecked) stay off until
// typescript-eslint supports TS 7. tsc (via `npm run build`) remains the
// type-error gate — lint adds the correctness rules tsc does not check
// (hooks discipline, unused vars, import hygiene).
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "e2e/", "node_modules/"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The two classic hooks rules are the enforced correctness gate.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // hooks v7's React-Compiler-prep rules (set-state-in-effect, refs,
      // immutability, purity, static-components, preserve-manual-memoization)
      // flagged 73 sites across this established codebase on first run —
      // churny compiler-readiness guidance, not bug reports. Deliberately OFF
      // for the lint-restore; adopting them is its own reviewed campaign.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/static-components": "off",
      "react-hooks/preserve-manual-memoization": "off",
      // `_`-prefixed is the codebase's own "deliberately unused" convention.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
