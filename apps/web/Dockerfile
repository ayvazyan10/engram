FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.4

# Copy workspace files (web depends on @engram-ai-memory/core via workspace:*)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc turbo.json ./
COPY tooling/ ./tooling/
COPY packages/core/ ./packages/core/
COPY apps/web/ ./apps/web/

# Install deps
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm turbo run build --filter=@engram-ai-memory/web...

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/apps/web/dist/ /usr/share/nginx/html/
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
