FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.4

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc turbo.json ./
COPY tooling/ ./tooling/
COPY packages/core/ ./packages/core/
COPY apps/server/ ./apps/server/

# Install deps
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm turbo run build --filter=@neural-core/server...

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN npm install -g pnpm@9.15.4

COPY --from=builder /app/pnpm-workspace.yaml /app/package.json /app/.npmrc ./
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist/ ./packages/core/dist/
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/dist/ ./apps/server/dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/core/node_modules/ ./packages/core/node_modules/
COPY --from=builder /app/apps/server/node_modules/ ./apps/server/node_modules/

# Database migrations
COPY --from=builder /app/packages/core/src/db/migrations/ ./packages/core/src/db/migrations/
COPY --from=builder /app/packages/core/drizzle.config.ts ./packages/core/

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "apps/server/dist/index.js"]
