# 依赖安全清债报告（2026-07-10）

背景：Dependabot 报 250 告警（4 critical / 100 high / 129 moderate / 17 low）。
本轮目标：主工作区双锁归零 + legacy 目录诚实定性。

## 处置结果

| 范围                                      | 处置前                    | 处置后          |
| ----------------------------------------- | ------------------------- | --------------- |
| 根工作区 `pnpm-lock.yaml`（pnpm audit）   | 140（2C/56H/74M/8L）      | **0**           |
| 根工作区 `package-lock.json`（npm audit） | 同源告警                  | **0**           |
| `agent-loop/`（legacy，已封存）           | 约 110（Dependabot 余量） | 豁免，见下      |
| `slide-rule-python/`                      | 未在本地审计              | 见「Python 侧」 |

## 做了什么

1. **砍无引用直接依赖**：`axios`（活代码零引用，连带 form-data /
   follow-redirects 链清除）。
2. **定向升级**（只动被标记的子树，不做全量刷新——全量刷新实测会把
   构建炸掉，见「教训」）：undici、ws（^8.21）、express、nodemailer
   （8→9，仅 `server/auth/email-mailer.ts` 使用，createTransport API 不变）、
   dockerode、mermaid（^11.15）、vitest（2→3.2.6，critical：UI server
   任意文件读取）、vite（^7.3.4）、postcss、streamdown、@ant-design/graphs、
   mammoth、@tailwindcss/vite、@babel/core。
3. **传递依赖 override**（pnpm.overrides 与 npm overrides 双侧镜像——
   Dependabot 同时扫两把锁）：protobufjs≥7.6.3（critical）、
   @grpc/grpc-js≥1.14.4、@protobufjs/utf8≥1.1.1、lodash/lodash-es≥4.18、
   uuid≥11.1.1、dompurify≥3.4.11、rollup ~4.59、mdast-util-to-hast≥13.2.1、
   picomatch@4 线≥4.0.4（范围键，不动 v2 消费者）、
   mammoth>@xmldom/xmldom ~0.8.13、express>path-to-regexp 0.1.13。
4. **xlsx 换源**：npm 源无修复版（SheetJS 停止发布 npm），切官方
   `cdn.sheetjs.com/xlsx-0.20.3` tarball（两个 high 均在 0.20.2 修复）；
   使用面（server excel 适配器）测试全绿。
5. **升级破损修复**：
   - pdfjs-dist 5.x 移除 `isEvalSupported` 选项（eval 路径已默认禁用），
     `workflow-attachments.ts` 同步删参；
   - 三个 property 测试在 5s 默认超时线附近裸奔，vitest 3 调度下必然
     越线——spec-docs-progress（O(n²)×100 轮）与 knowledge-extractor
     （每轮真实写盘）加显式超时；a2a-protocol 三个性质测试在迭代内
     重复构造 A2AServer（每次构造同步起 Python 注册进程），改为构造
     一次/跳过与性质无关的 Python 种子/降轮数——被测语义不变，
     此问题与本次升级无关（本容器 Python 在场时一直如此，CI 擦线）。

## 豁免与遗留（诚实清单）

- **`agent-loop/vscode-extension`（12 个依赖声明）**：目录已封存
  （见 agent-loop/README），无 lockfile、不构建、不部署。Dependabot
  仍会按 manifest 报告。两条路二选一，等裁决：
  a) 删除 legacy 目录的 package.json（保留源码考古价值不变）；
  b) 在 Dependabot UI 批量 dismiss（理由：archived, not deployed）。
- **xlsx 在 package-lock 的呈现**：npm 把 CDN tarball 记为 URL 依赖，
  Dependabot 对 URL 依赖的版本识别可能滞后——若 xlsx 告警不自动关闭，
  手工 dismiss（理由：patched via vendor CDN 0.20.3）。
- **packageManager 钉 pnpm@10.4.1**：devDep pnpm 已升 ^10.15，但
  corepack 版本钉值不动（CI frozen-lockfile 对 lockfile 格式敏感，
  单独升级需专门验证一轮，不混入本次）。
- **Python 侧（slide-rule-python/requirements.txt）**：范围式声明
  （`>=`），无锁文件，本地未装 pip-audit。Dependabot 的 python 告警
  （若有）需在 UI 确认；后续可加 `pip-audit` 进 smoke。

## 教训（为什么不做全量 `pnpm update`）

全量范围内刷新可把审计一次清零，但同时把 ~800 个传递解析全部换新，
实测产物 chunk 中 React `@license` 注释块被破坏导致 `vite build`
`Parse error @:1:1`，且二分不出单一元凶（react/rollup/vite 逐个回退
均不复现）。定向升级 + 精确 override 的组合达到同样的归零效果，
diff 可解释、可回滚。

## 验证

typecheck ✅ · client 453 文件/4618 测试 ✅ · server 489 文件 0 失败 ✅ ·
executor 231 测试 ✅ · guardrails（decision + socket-reconnect，覆盖
ws 8.21）✅ · `vite build` + esbuild 产物 ✅ · 双锁 audit 0 告警 ✅
