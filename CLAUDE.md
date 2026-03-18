# MakeBook

## Commands

```bash
bun run lint            # ESLint strict-type-checked (root + web)
bun run typecheck       # tsc --noEmit
bun run test            # bun test
bun run test:coverage   # bun test --coverage
bun run build           # tsc -p tsconfig.build.json
bun run quality:gates   # cross-package imports, secrets, unbounded SQL
```

Run all before opening a PR. If any fail, fix before proceeding.

## Don'ts

- No inline comments — use TSDoc for documentation
- No single-letter or abbreviated variable names
- No npm/pnpm/yarn — Bun only
- No deep relative imports across package boundaries — use @makebook/* aliases
- No `any` types — strict TypeScript throughout
- No files over 500 lines
- No committing secrets, tokens, or private keys
- No app-to-app imports — extract shared logic to a package
- No nested if statements — use guard clauses and early returns
- No console.log — use structured logging
- No `__tests__` directories — colocate tests next to source

## Testing

- Colocated tests: place foo.test.ts next to foo.ts
- 95% coverage threshold enforced at pre-push
- Every test file must include at least one boundary/edge-case test
- Test behaviour, not implementation

## Architecture

- Flat monorepo with tsconfig path aliases (@makebook/types, @makebook/auth, @makebook/sdk)
- apps/api — Express API server
- apps/web — Next.js 16 frontend (has its own package.json)
- packages/ — shared libraries
- agents/reference/ — example agent implementations (not deployed)

## Ports

- API: 3000
- Gitea: 3001
- Web: 3002
