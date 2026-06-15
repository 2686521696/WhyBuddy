# 06. 运行与维护手册

## 1. 目标

本手册用于回答以下问题：

- 本地怎么启动前端、后端和执行器
- 常用脚本有哪些
- 关键端口和环境变量是什么
- 构建、测试、冒烟如何执行
- 出现常见问题时该从哪里排查

## 2. 包管理与脚本约定

根仓库同时保留了 `npm` 和 `pnpm` 生态信息，但从脚本内容与锁文件看，项目主要围绕根 `package.json` 统一执行。

常用脚本如下。

## 2.1 开发类脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动前端 Vite 开发服务 |
| `npm run dev:frontend` | 同 `dev`，显式前端启动 |
| `npm run dev:server` | 启动 `server/index.ts` 的 watch 模式 |
| `npm run dev:all` | 同时启动前端、后端、执行器 |
| `npm run dev:advanced` | 别名，调用 `scripts/dev-all.mjs` |
| `npm run dev:stop` | 停止 `dev:all` 拉起的进程 |

## 2.2 构建与生产脚本

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 构建前端并打包服务端 |
| `npm run start` | 生产启动 |
| `npm run preview` | 预览前端构建结果 |
| `npm run build:pages` | 构建 Pages 相关产物 |

## 2.3 检查与测试脚本

| 命令 | 作用 |
| --- | --- |
| `npm run lint` | 运行 Prettier 检查 |
| `npm run check` | TypeScript 类型检查 |
| `npm run typecheck` | 调用 `check` |
| `npm run test` | 运行 client/server/executor 测试 |
| `npm run test:client` | 前端 Vitest |
| `npm run test:server` | 服务端测试脚本 |
| `npm run test:executor` | 执行器测试 |

## 2.4 冒烟与验证脚本

| 命令 | 作用 |
| --- | --- |
| `npm run smoke:prod` | 生产冒烟 |
| `npm run smoke:executor` | 执行器冒烟 |
| `npm run smoke:mission` | Mission 集成冒烟 |
| `npm run smoke:restart` | 任务重启冒烟 |
| `npm run smoke:sliderule` | SlideRule 浏览器冒烟 |
| `npm run smoke:sliderule-store` | SlideRule store/API 冒烟 |
| `npm run smoke:release` | 汇总多个冒烟脚本 |
| `npm run test:release` | lint + typecheck + test + build + smoke |

## 3. 本地开发推荐方式

## 3.1 最常用：全栈联调

```bash
npm run dev:all
```

这会通过 `scripts/dev-all.mjs` 启动整个开发栈，适合：

- 页面联调
- 任务流/执行器联调
- blueprint/SlideRule 端到端调试

## 3.2 仅前端开发

```bash
npm run dev:frontend
```

适合：

- UI 修改
- 纯前端交互调整
- 不依赖后端变更的页面开发

## 3.3 仅后端开发

```bash
npm run dev:server
```

适合：

- 路由与服务端逻辑调整
- 不需要完整执行器链路的接口开发

## 4. 关键端口

| 端口 | 服务 | 说明 |
| --- | --- | --- |
| `3000` | 前端 Vite | 默认前端开发端口 |
| `3001` | 主服务 | Vite 代理目标 |
| `3031` | 执行器 | 默认 `lobster-executor` 基址 |

说明：

- `vite.config.ts` 中将 `/api` 和 `/socket.io` 代理到 `http://localhost:3001`
- 主服务默认通过 `DEFAULT_EXECUTOR_BASE_URL = http://127.0.0.1:3031` 与执行器通信

## 5. `dev:all` 做了什么

`scripts/dev-all.mjs` 除了拉进程，还做了很多环境治理：

- 自动读取 `.env`
- 判断 Docker 是否可达
- 当 `real` 模式不可用时自动把执行器切到 `native`
- 默认翻转多个 blueprint v4 对齐开关为启用
- 处理代理环境变量
- 在 Windows 上处理子进程退出与端口存活的特殊情况

这意味着 `dev:all` 不只是“并行跑三个命令”，而是本地开发编排器。

## 6. 环境变量

环境变量模板见 `.env.example`。从结构上看，主要分几类。

## 6.1 服务基础配置

- `PORT`
- `NODE_ENV`
- `SESSION_SECRET`
- `SESSION_COOKIE_NAME`

## 6.2 数据库/存储配置

- `DATABASE_PROVIDER`
- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `REDIS_*`

## 6.3 LLM 与生成配置

- `LLM_*`
- `FALLBACK_LLM_*`
- `AUTOPILOT_REAL_RUNTIME`
- `BLUEPRINT_*`

## 6.4 执行器配置

- `LOBSTER_EXECUTION_MODE`
- `LOBSTER_DOCKER_HOST`
- `LOBSTER_EXECUTOR_*`
- `EXECUTOR_CALLBACK_*`

## 6.5 集成类配置

- `FEISHU_*`
- `WEB_SEARCH_API_KEY`
- 图片/预览相关配置

## 6.6 开发增强开关

- `BLUEPRINT_CHECKS_LEDGER_ENABLED`
- `BLUEPRINT_CONTENT_QUALITY_CHECK_ENABLED`
- `BLUEPRINT_COMPANION_ENABLED`
- `BLUEPRINT_TRACEABILITY_MATRIX_ENABLED`
- `BLUEPRINT_PREVIEW_AUDIT_ENABLED`

`dev:all` 会对这些开关给出“默认开启、显式值优先”的行为。

## 7. 构建与发布

## 7.1 本地构建

```bash
npm run build
```

会执行两步：

1. `vite build`
2. `esbuild server/index.ts --bundle --outdir=dist`

产物特征：

- 前端产物在 `dist/public`
- 服务端打包到 `dist`

## 7.2 生产启动

```bash
npm run start
```

由 `scripts/start-prod.mjs` 接管启动逻辑。

## 7.3 Docker

仓库根目录提供：

- `Dockerfile`
- `docker-compose.yml`

其中 `docker-compose.yml` 主要用于启动：

- 应用服务
- MySQL

适合：

- 标准化本地环境
- 部署验证
- 基础联调

## 8. 测试策略

项目测试面覆盖较广，至少包括：

- 前端 Vitest
- 服务端测试脚本
- 执行器 Vitest
- 决策/HITL 专项测试
- Socket 重连测试
- 多种 smoke 脚本
- SlideRule V5 专项验证链路

## 8.1 快速检查推荐顺序

如果只改了少量代码，建议至少执行：

```bash
npm run check
npm run test
```

如果改动涉及主链路，建议执行：

```bash
npm run build
npm run smoke:release
```

## 8.2 SlideRule 重点验证

存在专门的：

```bash
npm run verify:sliderule-v5
```

适用于：

- SlideRule V5 相关逻辑
- 交付链、结构链、视觉链、可读性与守卫逻辑调整

## 9. 常见排查入口

## 9.1 前端请求失败

优先检查：

- 前端是否运行在 `3000`
- 后端是否运行在 `3001`
- `vite.config.ts` 代理是否命中
- 浏览器开发者工具中的 `/api` 请求返回

## 9.2 Socket 不更新

优先检查：

- `3001` 是否正常启动
- `/socket.io` 是否被代理到主服务
- `server/core/socket.ts` 是否已初始化
- 前端对应 store 是否完成连接与订阅

## 9.3 执行器无法运行

优先检查：

- `3031` 是否监听
- `LOBSTER_EXECUTION_MODE` 当前值
- Docker 是否可达
- 是否已经自动回退到 `native`
- 主服务回调地址与回调签名配置是否正确

## 9.4 Blueprint/Autopilot 功能缺失

优先检查：

- `AUTOPILOT_REAL_RUNTIME`
- 各 `BLUEPRINT_*` 开关
- LLM 配置是否可用
- 执行器与 capability bridge 是否就绪

## 9.5 构建异常

优先检查：

- `npm run check`
- `npm run build`
- `vite.config.ts` 的 alias、root、outDir 配置
- 服务端是否引用了仅浏览器可用模块

## 10. 维护建议

## 10.1 新增脚本时

建议同步更新：

- 本文档
- `README.md`
- 如果是专项链路，补充 smoke/test 说明

## 10.2 新增端口或服务时

建议同步更新：

- `06-runbook.md`
- `01-overview.md`
- 相关 compose 或 Docker 文档

## 10.3 新增环境变量时

建议同步更新：

- `.env.example`
- 本文档对应章节
- 相关脚本中的默认值与注释

## 11. 推荐日常命令清单

### 启动开发栈

```bash
npm run dev:all
```

### 类型检查

```bash
npm run check
```

### 执行全量测试

```bash
npm run test
```

### 本地构建

```bash
npm run build
```

### 关键冒烟

```bash
npm run smoke:release
```

### 停止开发栈

```bash
npm run dev:stop
```
