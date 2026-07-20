import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Supabase Edge Functions are Deno code and are linted separately in the
  // edge-functions CI job with `deno lint`. ESLint's TypeScript rules do not
  // apply to that runtime (URL imports, Deno globals, intentional `any`s
  // guarded by `// deno-lint-ignore-file`), so exclude the whole tree here.
  { ignores: ["dist", "supabase/functions/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // The codebase intentionally uses `any` at typed boundaries with
      // third-party APIs (Supabase generated types, DOM Google Maps, legacy
      // fixtures). Keep as a warning, not a hard failure.
      "@typescript-eslint/no-explicit-any": "warn",
      // Shadcn UI ships several passthrough component types that extend a
      // library prop type with no additions. Warn instead of error.
      "@typescript-eslint/no-empty-object-type": "warn",
      // tailwind.config.ts intentionally uses `require("tailwindcss-animate")`
      // to stay compatible with the Tailwind plugin loader.
      "@typescript-eslint/no-require-imports": "warn",
      "no-case-declarations": "warn",
      "no-constant-binary-expression": "warn",
      "prefer-const": "warn",
    },
  },
);
