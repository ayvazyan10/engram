# Development Guide

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 or newer (CI uses 22.x) | [nodejs.org](https://nodejs.org) |
| pnpm | 9.15.4 (workspace pin) | `npm install -g pnpm@9.15.4` |
| Git | any recent | system package manager |

---

## Initial setup

```bash
git clone https://github.com/ayvazyan10/engram
cd engram
pnpm install
```

This installs all workspace dependencies across all packages in one step.

---

## Monorepo overview

Engram uses **pnpm workspaces** with **Turborepo** for build orchestration.

```
pnpm-workspace.yaml   declares workspaces: apps/*, packages/*, adapters/*, tooling/*
turbo.json            tasks: build, dev, test, test:coverage, lint, typecheck, e2e, clean
```

### Build pipeline

Turborepo respects `dependsOn: ["^build"]` — packages are always built in dependency order:

```
packages/core → packages/mcp → apps/server (also depends directly on core)
              → packages/cli
apps/web, packages/vis and adapters/ollama build independently of core
```

### Useful commands

```bash
# Run workspace development scripts (watchers and dev servers)
pnpm dev

# Pack the Claude Desktop Extension (mcpb validates it; the Python fallback only packs it)
pnpm pack:mcpb

# Build everything
pnpm turbo run build

# Build a single package (+ its dependencies)
pnpm turbo run build --filter=@engram-ai-memory/server

# Force rebuild (ignore cache)
pnpm turbo run build --force

# Run all tests
pnpm turbo run test

# Lint all packages
pnpm turbo run lint

# Type-check without emitting
pnpm turbo run typecheck
```

---

## Running in development

### Start the API server

The dashboard uses the API server for data. The Ollama adapter uses it to recall and store memories.

```bash
# Option A — run compiled dist (after build)
mkdir -p ~/.engram
ENGRAM_DB_PATH=~/.engram/dev.db \
  node apps/server/dist/index.js

# Option B — watch the server source (build its workspace dependencies first)
mkdir -p ~/.engram
ENGRAM_DB_PATH=~/.engram/dev.db \
  pnpm --filter @engram-ai-memory/server dev
```

Server starts at `http://localhost:4901`.

### Start the dashboard

In production, the Atlas dashboard is served from the API server at `http://localhost:4901` (after building with `pnpm turbo run build`).

For development with hot-reload:

```bash
pnpm --filter @engram-ai-memory/web dev
# → http://localhost:4902 (dev only — proxies to API on 4901)
```

The Vite dev server proxies `/api` → `localhost:4901` and `/socket.io` → `localhost:4901`.

### Seed demo data

```bash
cd packages/core
npx tsx scripts/demo.ts
```

The script writes demo memories and graph connections to `packages/core/engram.db` and prints the resulting memory counts. To view them, start the server with `ENGRAM_DB_PATH="$PWD/packages/core/engram.db"` from the repository root.

### Reset the database

```bash
# Stop processes using the dev database first.
rm -f ~/.engram/dev.db{,-wal,-shm,.index}
# Restart the server with the same ENGRAM_DB_PATH to create a fresh database.
```

---

## Database workflow

**Never use `drizzle-kit push`** — it can drop data. Engram upgrades user databases in `runSqliteMigrations()` each time it opens SQLite. The generated SQLite migrations are for tooling and schema-parity checks.

```bash
# 1. Update both the Drizzle schema and the runtime upgrade in runSqliteMigrations()
vim packages/core/src/db/schema.ts packages/core/src/db/adapter.ts

# 2. Generate migration SQL
pnpm db:generate
# → creates packages/core/src/db/migrations/XXXX_*.sql

# 3. Review the generated SQL before applying
cat packages/core/src/db/migrations/*.sql

# 4. Apply the generated SQL to a fresh tooling database
ENGRAM_DB_PATH="$(mktemp)" pnpm db:migrate
```

Root-level scripts:

```json
"db:generate": "pnpm --filter @engram-ai-memory/core drizzle-kit generate",
"db:migrate":  "pnpm --filter @engram-ai-memory/core drizzle-kit migrate"
```

---

## TypeScript configuration

Shared configs live in `tooling/tsconfig/`:

| Config | Used by | Key settings |
|---|---|---|
| `base.json` | TypeScript workspaces, via `node.json` or `react.json` | `strict: true`, `exactOptionalPropertyTypes: false` |
| `node.json` | core, mcp, cli, vis, server, Ollama adapter | `module: NodeNext`, `types: ["node"]` |
| `react.json` | apps/web | `jsx: react-jsx`, `moduleResolution: Bundler` |

Each package extends the relevant shared config. Add package-specific overrides in the package's own `tsconfig.json`.

---

## Package structure

### Adding a new package

```bash
mkdir packages/my-package
cd packages/my-package
cat > package.json << 'EOF'
{
  "name": "@engram-ai-memory/my-package",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "devDependencies": {
    "@engram-ai-memory/tsconfig": "workspace:*",
    "typescript": "5.7.3",
    "vitest": "^3.1.1"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  }
}
EOF

cat > tsconfig.json << 'EOF'
{
  "extends": "@engram-ai-memory/tsconfig/node.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"]
}
EOF
```

### Adding a dependency

```bash
# Add to a specific package
pnpm --filter @engram-ai-memory/server add fastify

# Add a dev dependency to the workspace root
pnpm add -Dw typescript
```

---

## Testing

Tests use **Vitest** (runs natively with ESM, no transpilation needed).

```bash
# Run all tests once
pnpm turbo run test

# Watch mode for a package
pnpm --filter @engram-ai-memory/core exec vitest

# With coverage, and enforcing that package's thresholds
pnpm turbo run test:coverage
```

Every package with a `test` script has a matching `test:coverage` script, and CI runs `test:coverage` in place of `test` — it runs the same suites and additionally fails a package that drops below its own thresholds.

Test files generally live under `src/` as `*.test.ts` or `*.test.tsx`. The web package also tests its bundle checker under `scripts/`.

### Key test areas

| Test | File | What it checks |
|---|---|---|
| Embedding codec | `packages/core/src/embedding/__tests__/fp16.test.ts` | FP16 pack/unpack, including subnormal values |
| Vector search | `packages/core/src/retrieval/__tests__/vector-search-topk.test.ts` | topK bounds and result counts |
| Brain store | `packages/core/src/NeuralBrain.test.ts` | near-duplicate merging and contradiction handling |
| Graph edges | `packages/core/src/graph/__tests__/graph-edges.test.ts` | edge removal and bidirectional counts |

---

## Contributing

### Branch naming

```
feature/description    new functionality
fix/description        bug fix
docs/description       documentation only
refactor/description   no behavior change
```

### Commit messages

Follow conventional commits:

```
feat(core): add importance decay on recall
fix(server): correct socket.io namespace initialization
docs: add integration guide for Custom Agent
refactor(mcp): simplify tool registration pattern
```

### Pull request checklist

- [ ] `pnpm turbo run build` passes with no errors
- [ ] `pnpm turbo run lint` passes — it is a hard CI gate, not advisory
- [ ] `pnpm turbo run test:coverage` passes, including each package's coverage thresholds
- [ ] New functionality has tests
- [ ] SQLite changes update the runtime migration and the Drizzle schema, regenerate the tooling SQL and pass the schema-parity test
- [ ] Documentation updated if behavior changed

---

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | any branch push / PR targeting `master` | install → typecheck → lint → build → generate/apply SQLite migrations → cache or fetch embedding models → coverage with PostgreSQL 16 → validate the Desktop Extension manifest |
| `release.yml` | push tag `v*` or manual dispatch | require `NPM_TOKEN`, install, build and verify package names. Tag runs publish missing versions of core, mcp, cli and vis. Both triggers build and validate the Desktop bundle. Tag runs create or update the GitHub release with changelog notes and `engram-mcp.mcpb`. |

The v0.15.1 tag ships core, mcp, cli and the Desktop bundle at 0.15.1. The publish loop checks each package’s own version, including vis at 0.5.0.

### Local CI simulation

```bash
pnpm install --frozen-lockfile
pnpm turbo run typecheck
pnpm turbo run lint
pnpm turbo run build
pnpm db:generate
ENGRAM_DB_PATH="$(mktemp)" pnpm db:migrate
pnpm turbo run test:coverage
npx --yes @anthropic-ai/mcpb validate packages/mcpb/manifest.json
```

ESLint runs from the shared config in `tooling/`. `no-console` is off for the CLI, whose stdout *is* its user interface.

After building the Atlas dashboard, `pnpm --filter @engram-ai-memory/web check:bundle` checks the gzip JavaScript budgets: 200 KB for initial loading, 125 KB for lazy Insights (including charts) and 220 KB for lazy 3D views (Sky and Landscape). It also checks that Insights, charts, three.js and the 3D views stay out of the initial imports.

---

## Docker

`docker-compose.yml` defines three services. The API image builds `packages/core`, `packages/mcp` and `apps/server`; the standalone web image serves the dashboard.

```bash
# Start all services
docker-compose up -d

# Services:
#   api:4901        — Engram REST API (SQLite inside the container)
#   web:4902        — Dashboard (standalone web container)
#   postgres:5432   — for cloud-sync testing only, never a primary backend

# Logs
docker-compose logs -f api
```

**All three publish on `127.0.0.1` only.** Binding them to every interface published an unauthenticated API — and a database whose password is in the compose file — on whatever network the host happens to be on. Exposing the API deliberately means setting `ENGRAM_API_KEY`, adding the public hostname to `ENGRAM_ALLOWED_HOSTS`, and only then changing the published address.

The Postgres password comes from the environment: `POSTGRES_PASSWORD` in your shell or a `.env` file, defaulting to `dev_password`. Set a real one before moving that port off loopback.

`ENGRAM_API_KEY` is deliberately **not** templated as `${ENGRAM_API_KEY}` in the compose file — an unset variable would expand to an empty string, which the server now refuses to start with. Uncomment the line and set a real value instead.

The `api` service is reached by the name `api` from the web container, which is why `ENGRAM_ALLOWED_HOSTS` lists it alongside `localhost` and `127.0.0.1`.

Environment variables for Docker are configured in `docker-compose.yml`. For multi-device sync, set `ENGRAM_SYNC_URL` to a PostgreSQL connection string — see [Cloud Sync](CLOUD-SYNC.md).
