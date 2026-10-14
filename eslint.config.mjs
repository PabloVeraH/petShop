import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Tooling de agentes y artefactos generados: no es código de la app
    // (mismo criterio que .graphifyignore).
    ".claude/**",
    ".claude-flow/**",
    ".opencode/**",
    "coverage/**",
    "graphify-out/**",
  ]),
  // Idiomas de Jest en tests: require() tras jest.resetModules()/doMock (un
  // import estático se resolvería antes del mock) y componentes inline dentro
  // de jest.mock(). En src/ ambas reglas siguen como error; `any` es error en
  // todo el repo.
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "react/display-name": "off",
    },
  },
]);

export default eslintConfig;
