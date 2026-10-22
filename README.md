# task-meta

Passive, source-qualified Agent Task execution evidence collector. It captures
metadata-only observations from a real Agent run (v0.1: ZCode), keeps them as private
immutable content-addressed evidence, and writes a strict ADS `ads/github/v4`
`EXECUTION_SUMMARY` report for the owning GitHub Issue. Consumers such as Tally read
GitHub only.

- v0.1 definition, scope and Task DAG: [docs/v0.1/DEFINITION.md](docs/v0.1/DEFINITION.md)
- Vendored ADS contracts: [vendor/ads/PINS.md](vendor/ads/PINS.md)

```bash
npm ci
npm run lint && npm run typecheck && npm test
```
