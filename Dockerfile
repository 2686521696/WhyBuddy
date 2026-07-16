# SlideRule — production image
# Two-stage build: install + build, then a slim runtime stage that
# only carries dist/ and the production node_modules.

# ─── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# 可选企业根证书（内网 MITM 代理环境）：把 PEM 证书放进 docker/certs/
# 再构建即可；目录为空时下面两步是空操作，不影响正常环境。
COPY docker/certs/ /usr/local/share/ca-certificates/sliderule/
RUN sh -c 'cat /usr/local/share/ca-certificates/sliderule/*.crt >> /etc/ssl/certs/ca-certificates.crt 2>/dev/null || true'
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# pnpm via corepack (pinned by package.json `packageManager`).
RUN corepack enable

WORKDIR /app

# Copy lock + manifest first so the install layer caches when only source
# files change.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Full install including devDependencies (vite / esbuild / tsc are needed for
# the build step). We deliberately do not run prepare scripts here; the
# project's prepare hook does not need to run during a Docker build.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy the rest of the repo. .dockerignore should keep node_modules / data /
# .codex-logs / .manus-logs / .tmp / out of the image.
COPY . .

# Vite build emits dist/public/, esbuild bundles dist/index.js.
RUN pnpm run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3001

# 运行期同样信任可选企业根证书（LLM 网关走企业代理时需要）
COPY docker/certs/ /usr/local/share/ca-certificates/sliderule/
RUN sh -c 'cat /usr/local/share/ca-certificates/sliderule/*.crt >> /etc/ssl/certs/ca-certificates.crt 2>/dev/null || true'
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app

# Copy package manifest + lockfile + the built artifacts.
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/patches ./patches
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/dist ./dist

# Production install — no devDependencies, no scripts.
RUN corepack enable && \
    pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm store prune

EXPOSE 3001

# scripts/start-prod.mjs sets NODE_ENV and imports dist/index.js.
CMD ["node", "scripts/start-prod.mjs"]
