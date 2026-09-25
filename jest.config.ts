import type { Config } from "jest";

const transform = { "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }] };
const moduleNameMapper = { "^@/(.*)$": "<rootDir>/src/$1" };
const testPathIgnorePatterns = ["/node_modules/", "/.next/"];

const config: Config = {
  rootDir: ".",
  clearMocks: true,
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/*.stories.{ts,tsx}",
  ],
  coverageThreshold: {
    global: { lines: 70, functions: 70, branches: 60, statements: 70 },
  },
  coverageReporters: ["text-summary", "lcov", "html"],
  coverageDirectory: "coverage",
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
      moduleNameMapper,
      transform,
      testPathIgnorePatterns,
      testTimeout: 15000,
    },
    {
      displayName: "integration",
      preset: "ts-jest",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      moduleNameMapper,
      transform,
      testPathIgnorePatterns,
      testTimeout: 15000,
    },
    {
      displayName: "components",
      preset: "ts-jest",
      testEnvironment: "jsdom",
      // Todo *.test.tsx bajo tests/ (no solo tests/components/): un test de
      // componente puesto en otra carpeta (ej. tests/unit/components/) quedaba
      // fuera de todos los proyectos y nunca se ejecutaba — así ocultó una
      // regresión de accesibilidad en StoreLocationPicker (UI-13).
      testMatch: ["<rootDir>/tests/**/*.test.tsx"],
      moduleNameMapper,
      transform,
      testPathIgnorePatterns,
      testTimeout: 15000,
    },
  ],
};

export default config;
