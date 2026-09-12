# WhyBuddy 私有工程预览运行说明

更新：2026-09-13。适用本次内部工程模式；生产开关仍关闭。完整阶段状态见 [整体重构方案](<WhyBuddy 工程运行与浏览器验证整体重构方案.md#22-2026-09-13-私有反向预览与工作台接入>)。

工程由现有 Python 控制循环和持久 runtime worker 管理，在私有 E2B 沙盒中启动。沙盒主动通过 WSS 连接独立预览网关；浏览器使用自己的短时授权访问网关，网关通过已登记的隧道转发 HTTP、SSE 和 WebSocket。生成应用自己的前端、路由和状态在 iframe 内运行。

## 实际接入点

| 代码 | 职责 |
|---|---|
| `slide-rule-python/services/project_preview_access.py` | SQL 中保存凭据 hash；一次性票据兑换、角色分离、归属、批准、版本、租约和撤销 |
| `slide-rule-python/routes/project_preview.py` | 所有者读取预览快照、申请票据和撤销；网关独立认证与复查接口 |
| `slide-rule-python/services/project_preview_runtime.py` | 真实 runtime worker 持有租约时安装、登记、探测、轮换和停止 tunnel agent |
| `slide-rule-python/services/e2b_workspace_provider.py` | 将 agent 放在生成工程服务目录之外，通过 stdin 写配置并启动受管 PID |
| `server/project-preview/service.ts` | 独立网关进程；票据兑换后 303 清除 URL，以 HttpOnly Cookie 访问，管理状态端点独立验权 |
| `server/project-preview/relay.ts` | 经过授权的 HTTP/WS 转发、旧连接替换、实时复查、撤销、头和 Cookie 过滤 |
| `server/project-preview/tunnel-stream.ts` | 字节背压、双向 FIN、关闭与错误处理 |
| `client/src/pages/sliderule/project-runtime/` | 共同 React 预览；Studio 与 AppsWorkbench 按工程类型挂载；只读刷新不启动或续租 |

## 配置与启动

先运行 `pnpm run build:project-preview`，生成 `dist/project-preview/gateway.cjs`、`agent.cjs` 和 `ws-LICENSE.txt`。Python 默认读取这个 agent 产物；构建缺失时状态接口仍可读，预览不可用。

Python 环境继续使用已有持久数据库、E2B 和内部工程开关，另加：

```dotenv
SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED=1
WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE=https://{runtimeId}.preview.example.com
WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY=<单独生成的随机值，至少32个可打印非空白字符>
```

每个 runtime 必须占一个完整的主机名前缀。将该预览域名的 DNS/TLS 指向独立网关，保留原始 Host，支持 HTTP Upgrade、长响应和 WSS。主站认证 Cookie 必须限定主站；应用所在来源与主站分离。这里的 example.com 是部署占位，本轮没有配置生产域名。

复制根目录 `.env.preview.example` 为已忽略的 `.env.preview`，填写相同的独立网关 key，以及 Python 的 `/api/sliderule/internal/project-preview` 地址。远端 authority 必须用 HTTPS；同机可使用 `http://127.0.0.1:9700`。然后运行：

```powershell
pnpm run build:project-preview
pnpm run dev:project-preview
```

网关默认监听 3002，TLS 由独立入口终结。它只需要 authority 地址和自己的 key。应用沙盒只收到绑定 runtime、generation、角色及期限的 tunnel token；E2B 管理/流量凭据、LLM key、主库凭据不进入 agent 配置。

`http://{runtimeId}.localhost:3002` 只适合本机传输测试。E2B 无法通过这个本机地址访问开发机网关；真实云预览必须有沙盒可达的 HTTPS/WSS 地址。仅填写本地 `.env` 不会建立这些 DNS、TLS 和路由。

## 正常使用与失效行为

1. 在已批准的工程会话中启动真实 runtime，worker 完成安装、版本健康检查后安装 tunnel agent。
2. Studio 或应用中心读取同一项目状态；点击「打开预览」才申请一次性票据。
3. 票据兑换期限与浏览器访问期限分开：前者默认 60 秒，后者默认从出票起最多 300 秒，并受 runtime 期限约束。兑换不会重置授权时钟；刷新状态不会自动换票。
4. 票据被网关兑换后跳转到干净的 `/`；Cookie 使用 HttpOnly，HTTPS 下附带 Secure、SameSite=None、Partitioned。页面 JavaScript 不能读取授权 Cookie。
5. 项目、运行或版本变化时前端卸载旧 iframe；过期后通过明确点击重新申请。网关每次请求重新鉴权，并周期复查已有长连接，拒绝撤销、旧代次或 authority 不可用的访问。

预览读取和点击页面不自动延长 runtime 空闲或总预算。现有显式活动接口及 worker 策略负责续租；运行到期后页面可能仍保留已加载 DOM，后续请求被拒，工作台轮询显示实际状态。停止控制回合、停止应用与撤销浏览器访问仍是不同操作。

Vite 仅额外允许服务端推导的该 runtime 预览主机名。源文件修改仍须产生不可变 revision；当前模型写入与活跃预览同步尚待持租约 worker 的后续实现，不能通过开放任意主机或绕过项目锁完成 HMR。

## 复用来源与许可

固定源码版本均见 [来源索引](<WhyBuddy 工程重构参考源码索引.md>) 和 [快照锁文件](reference-sources.lock.json)。

| 来源 | 本次采用 | 实际复用方式 |
|---|---|---|
| frp `d20a23299600`，`server/control.go` | ControlID、旧控制连接退出后不得清除新记录、工作连接消费边界 | 按行为改写为 TS，再绑定 WhyBuddy SQL generation；未嵌入 Go 服务 |
| chisel `3c00f04ca154`，`client/client_connect.go`、`share/cio/pipe.go` | 主动连出、有限退避、双向独立 FIN | 按行为改写为 `ws` 与 Node stream；未引入 SSH 层 |
| OpenSandbox `60bca638497d`，`components/ingress/pkg/proxy/proxy.go` | 先授权再路由、转发前剥离内部凭据头 | HTTP 与 WS 两侧分别落实；保留 WhyBuddy 权威归属与端口范围 |
| `ws` | WebSocket 协议实现、真实升级和流量传输 | 直接复用仓库已有 npm 依赖；bundle 同目录保留原 MIT LICENSE |
| grok-build | 执行与展示分离、资源所有者、操作恢复及人工授权合同 | 延续已有 Python 主循环与 runtime worker，不增加第二套 Agent 循环 |

前三项是源码合同的改写，没有复制完整项目或声称逐字移植。WhyBuddy 的 SQL 一次性票据、批准校验、跨进程租约、E2B 生命周期及 React 接入由本仓实现。参考源码的测试与许可证说明不能替代本仓实际验收。

## 可复跑验证与尚未覆盖范围

```powershell
pnpm run build:project-preview
pnpm run test:project-preview
pnpm run project:contracts:check
pnpm run test:scripts
pnpm run arch:check
pnpm run smoke:project-preview-tunnel
```

最后一条需要 E2B 配置、本机 Chrome、网络与云运行额度，按轮次将脱敏报告和截图写入 `artifacts/project-preview-tunnel-smoke/`，结束后销毁两个测试沙盒并查询确认。`SLIDERULE_CHROMIUM_PATH` 可指定浏览器路径。其网关/agent/Vite 是实际代码，云 authority 使用测试身份注册表；持久 Python 授权另由真实 SQL 与 HTTP 入口测试覆盖。

本次不等于生产预览已部署，也不等于 P4 浏览器验收服务完成。仍需固定 revision 的独立验证 worker、交付证据闸、真实业务数据库，以及模型补丁到持租约运行实例的活跃版本同步。应用中心历史版本恢复、复刻、导出和生产发布也各自保留阶段验收。
