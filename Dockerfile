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
# ⚠ 2026-10-08：4096 时 vite build 在 CI 里 heap out of memory（exit 134），从接入 Sentry 那次（faac0b2）起
#   deploy-images 的 app 镜像连续七次没出来，线上一直停在前一天的前端——python 镜像照常出，没人发现。
#   本机量过峰值常驻：接入前 5786MB、接入后 5928MB——一直贴着 4G 堆跑，@sentry/react 只是最后一根稻草。
#   公开仓库的 ubuntu-latest 有 16G，给 6G 堆。下次再贴线，先看 vite 的分包，别只往上加。
ENV NODE_OPTIONS=--max-old-space-size=6144

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

# 工作台 CSP 的 `frame-src` 是**编译期**定下来的：`vite.config.ts` 用
# `loadEnv(mode, ROOT, "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")` 取这个值，
# 算出允许 iframe 的预览来源，再 `transformIndexHtml` 塞进 <head> 的 meta。
#
# ⚠ 2026-09-16 线上抓到的：CI 构建的镜像里 CSP 是 `frame-src 'self'`，
#   因为这个变量从来没进过构建环境。后果**不是 502**——网关接通了、预览地址
#   也对，但浏览器按 CSP 把 iframe 拦掉，表现成「预览就是打不开」，
#   比 502 难查得多。
#
# ⚠ 这是构建期的值，**改了它必须重新打镜像**，重启容器不生效。
#   它只是一个公开域名，不是凭据；网关 key 绝不进前端构建。
#   留空时 CSP 退回 `frame-src 'self'`，即只允许本站 iframe（旧行为）。
ARG WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE=""
ENV WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE=$WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE

# 错误上报（client/src/lib/error-reporting.ts）：浏览器那份 DSN 也是构建期定死的。DSN 设计上就是公开的
# （只能往这个项目里写事件，读不了），放 repo variable，不是 secret。留空 = 浏览器不上报、包里不加载 Sentry。
ARG VITE_SENTRY_DSN=""
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
# 报错对得上是哪一版代码：CI 传「这个镜像的内容最后一次变化的那个提交」（deploy-images.yml 的 release 那步），
# 不是 github.sha——它每次提交都变，会让下面的 build 每次都重跑，只改了 Python 也要重编一遍前端。
ARG GIT_SHA=""
ENV VITE_SENTRY_RELEASE=$GIT_SHA

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

# ⚠ 2026-10-09 CI 日志（run 660）：原来先拷 dist 再装生产依赖，dist 每次都变，这一层（18 秒）连同整包 node_modules
#   每次重装、重推。依赖只看清单：先装依赖，再放每次会变的东西；版本号同理放到最后（它每次提交都变）。
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/patches ./patches

# Production install — no devDependencies, no scripts.
RUN corepack enable && \
    pnpm install --frozen-lockfile --prod --ignore-scripts && \
    pnpm store prune

COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/dist ./dist

# Node 服务报错带上版本（server/observability/error-reporting.ts）。ARG 不跨阶段，这里再声明一次。
ARG GIT_SHA=""
ENV SENTRY_RELEASE=$GIT_SHA

EXPOSE 3001

# scripts/start-prod.mjs sets NODE_ENV and imports dist/index.js.
CMD ["node", "scripts/start-prod.mjs"]
