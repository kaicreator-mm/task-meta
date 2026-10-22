# task-meta — agent rules

- Read `docs/v0.1/DEFINITION.md` first; it is the frozen v0.1 Product/L2. Do not widen scope.
- Node 24 (`.node-version`), TypeScript run directly by Node type stripping: only erasable
  syntax (no enums, namespaces, parameter properties); relative imports end in `.ts`.
- Gate: `npm run lint && npm run typecheck && npm test` (the workspace `tools/task-check.sh`
  runs exactly these). Format with `npx biome check --write .` before committing.
- Tests: `node:test` + `node:assert/strict`, files `test/**/*.test.ts`, fixtures under
  `test/fixtures/`. Fixtures are synthetic or sanitized — never copy real prompts, model
  text, tool arguments, headers, tokens or absolute user paths into the repo.
- `vendor/ads/**` is byte-identical upstream source: never edit (see `vendor/ads/PINS.md`).
- `src/model.ts` and `src/canonical.ts` are shared contracts; change them only if the task
  says so.
- Dependencies are pinned in `package-lock.json`; do not add packages unless the task says so.
- Never call the live GitHub API from tests.
