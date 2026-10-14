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
  // import estático se resolvería antes del mock), componentes inline dentro
  // de jest.mock() y `any` en dobles de prueba. `any` queda como warning para
  // seguir viéndolo; en src/ las tres reglas siguen como error.
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "react/display-name": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
