# anti-slop — procedencia

- Fuente: https://github.com/dmmulroy/anti-slop
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copiado desde: `skills/install-anti-slop/assets/anti-slop/` (sin modificaciones)
- Instalado con: `install-anti-slop/scripts/install.mjs` (skill en `~/.claude/skills/install-anti-slop`)
- Rutas: `tools/oxlint/anti-slop/index.ts` (plugin genérico). El plugin Effect
  (`effect/index.ts`) se copió pero no está registrado — el repo no depende de `effect`.
- Dependencias: `oxlint@1.85.0`, `@oxlint/plugins@1.85.0` (exactas).

## Desviaciones intencionales

- `anti-slop/no-module-mocking` en `off` en `oxlint.config.ts`: los tests del
  proyecto usan `jest.mock()` (TDD London School, mock-first).
- Oxlint corre aparte de ESLint (`npm run lint:slop`); `npm run lint` sigue siendo ESLint.
