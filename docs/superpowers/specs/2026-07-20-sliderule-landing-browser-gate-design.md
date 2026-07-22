# SlideRule 落地页严格门与生成应用浏览器验收设计

日期：2026-07-20  
状态：推荐方案已获用户确认，等待书面设计复核  
范围：`landingPageRef` 新生成契约、生成应用 Playwright Chromium 验收、V5 发布门清单、形态差距文档订正

## 背景

SlideRule 已经支持 `appbundle.landingPageRef`：有效引用会让真实业务页成为应用首屏，并从菜单中移除兼容工作台 `home`。当前实现仍有两个机械保障缺口：

1. Prompt 声明 `landingPageRef` 必填，但通用结构 Gate 只检查“非空但悬挂”的引用。LLM 完全漏填时仍能过门，运行时随后回退旧工作台。
2. 发布门已有 schema/RBAC 单测，但没有用真实 Chromium 打开生成应用，无法机械确认首屏、Shell、菜单和角色降级在浏览器中确实成立。

同时，发布门的若干显式测试清单已经漂移，形态差距文档仍把已经落地的动态首屏写成未来工作，并错误记录了 `json-render` 的许可证。

## 目标

- 首次 LLM 生成和 LLM 精修得到的五系统模型缺少 `landingPageRef` 时必须 fail-closed。
- 历史模型直接加载和历史版本回退继续允许缺少该字段，仍可使用兼容工作台。
- 使用项目现有 Playwright + Chromium，离线、确定性地验收生成应用真实页面。
- 浏览器验收覆盖 side/top/phone Shell、真实业务首屏、无旧 `home` 菜单和角色无权降级。
- 把 landing 后端、AppBundle 和浏览器验收纳入本地 V5 主发布门，并同步串行/轻量门的相应清单。
- 把形态差距文档更新为当前事实，明确 Experience Block Catalog 仍是过渡骨架。
- 把固定提交 `9d3dfc...` 下的 `json-render` 许可证订正为 Apache-2.0。

## 非目标

- 不给所有历史五系统模型补写或迁移 `landingPageRef`。
- 不把通用 `FiveSystemModel` TypeScript 接口改成全局必填，因为旧快照仍需解析。
- 不引入新的五系统 schema 版本字段；等以后同时出现多项新模型必填字段再统一版本治理。
- 不把生成应用验收建立在真实 LLM、外部供应商、Python 推演时长或现有会话库内容上。
- 不在这一轮实现真实 Experience Block renderer、Binding、layout 或 action executor。
- 不修改 GitHub Actions 全量测试工作流；现有 CI 已运行全部 client 和 Python 测试。

## 方案选择

### 方案 A：Gate keyword-only strict 参数（采用）

给 `validate_five_system_model()` 增加默认关闭的 keyword-only 参数：

```python
validate_five_system_model(
    model,
    *,
    require_landing_page_ref: bool = False,
)
```

兼容调用不传参数，行为逐字保持；首次 LLM 生成和 LLM 精修显式传 `True`。strict 模式发现字段缺失、`None` 或纯空白时，返回路径为 `appbundle.landingPageRef` 的 `PUBLISH_MISSING_REQUIRED_FIELD` finding。

优点是只有一套 Gate 规则和 findings 汇总逻辑，改动集中且默认兼容。缺点是生成调用点必须显式传 strict，因此测试会锁定生产、评测和 LLM smoke 三处调用。

### 方案 B：独立 `validate_generated_five_system_model()` 包装函数（不采用）

调用语义更直观，但若包装函数自行追加 findings，容易逐步形成两套 Gate。只有让包装函数内部继续调用方案 A 的 strict 参数才安全，因此没有独立收益。

### 方案 C：模型协议版本字段（本轮不采用）

给 `appbundle` 增加版本标记后按版本决定必填字段，长期最自描述。但当前没有完整版本治理基础，会扩大生成、持久化、回退和前端类型范围。单为一个字段引入版本协议不符合本轮最小改动原则。

## 严格 Gate 设计

### 通用 Gate

`slide-rule-python/services/v5_model_gate.py` 保持现有默认行为：

- 六个系统段和所有既有引用继续按原规则校验。
- `require_landing_page_ref=False` 时，缺少首屏字段是合法旧模型；非空坏引用仍被 `PUBLISH_DANGLING_CROSSREF` 拦截。
- `require_landing_page_ref=True` 时，缺失、`None`、空串或纯空白统一产生 `PUBLISH_MISSING_REQUIRED_FIELD`。
- 非空且存在于 `page.pages[].id` 的引用通过。

### 生成与精修路径

`slide-rule-python/services/v5_capability_executor.py` 当前路径是：

```text
generate -> deterministic repair -> gate
         -> gate findings feedback -> regenerate -> repair -> gate
```

两次 Gate 必须使用同一个 strict 值。普通首次生成和 `_refine_context` 精修均传 `True`。如果 Repair 因无法修复坏引用而删除 `landingPageRef`，随后的 strict Gate 会拦住并进入现有错误回喂重试，不再静默放行旧工作台。

### 历史版本回退

`_model_override` 是用户选择历史版本后直供的旧快照，不是本轮 LLM 新产物。该路径传 `False`：

- 老快照没有 `landingPageRef` 仍可恢复。
- 运行时继续诚实回退兼容工作台。
- 回退不会因为新协议要求而把用户已有版本判死。

`_build_per_skill_evidence()` 会把当前合并的 `_refine_active` 判定拆成“是否存在 refine/override 上下文”和“是否为 override”两个事实，向 `_try_llm_generate_evidence()` 传递 strict 选择。首次生成默认 strict，因此普通新颖意图无需额外标记。

### 工具与评测

真实 LLM 生成评测和 LLM smoke 也必须显式使用 strict Gate，避免“生产拦住、评测仍把漏字段模型算成功”的双口径。内置确定性模型已经全部声明真实首屏，相关夹具测试改用 strict Gate 锁住这一事实。

## Playwright Chromium 浏览器验收

### 为什么独立脚本

新增 `scripts/generated-app-browser-smoke.mjs`，不把逻辑塞进现有 `sliderule-browser-smoke.mjs`：

- 现有脚本负责真实推演、Python provenance、报告和挑战链，允许长时间运行并依赖后端。
- 新脚本只负责“一个已经闭环的五系统模型能否在真实浏览器正确长成应用”，必须快速、离线和确定性。
- 分开后失败信息明确：生成应用渲染失败不会被误读成 LLM/网络故障，真实推演失败也不会掩盖 renderer 结果。

两个脚本都使用仓库现有 `@playwright/test` 导出的 Chromium。新脚本沿用现有 Vite 自启动、端口探测、Windows 隐藏进程和退出清理模式。

### 固定会话夹具

脚本不复制一整套手写业务模型，而是组合仓库已有冻结数据：

- 从 `client/src/pages/sliderule/demo-gallery/instruments.json` 读取一个已经闭环、能被 HTTP session store 正常水合的状态骨架。
- 从 `slide-rule-python/services/data/builtin_domain_models.json` 读取 `leave_approval` 和 `service_ticket` 两个经过结构门的模型。
- 把骨架中的 `sessionId`、goal 和 `publishClosure.perSkillEvidence[*].modelSection` 替换为对应模型段。
- 每个浏览器 context 使用独立 session id，清除对应 runtime 状态，并按场景预设当前角色。

Playwright 只拦截测试 context 中的 `/api/sliderule/*`：

- `GET /api/sliderule/sessions/:sessionId` 返回 `{ state: fixtureState }`。
- `GET /api/sliderule/health` 返回固定健康结果，避免无关后端横幅干扰。
- 任何其他 SlideRule API 请求返回 501 并被记录；若出现生成、编排、执行或 AIGC 请求，测试直接失败。

这样仍然真实经过：HTTP session hydration -> `publishClosure.perSkillEvidence` 模型重建 -> `SlideRuleStudio` -> `deriveAppRuntimeSchema()` -> `AppRuntimeScreen`。

### 场景一：side Shell、角色降级和 phone Shell

使用 `leave_approval`：

1. 以 `employee` 打开，断言应用舞台和运行时出现。
2. 断言 `landingPageId` 与 `activePageId` 都是 `my_leave_workbench`。
3. 断言 side Shell 出现、真实落地菜单出现、`menu-home` 不存在。
4. 切换为 `manager`，断言当前页诚实降级到该角色第一个可见业务页 `manager_leave_kanban`，仍不生成 `home` 菜单。
5. 切到 phone，断言 phone Shell、唯一 TabBar 和同一个业务页仍在。
6. 切回 desktop，断言恢复 side Shell且当前业务页不丢失。

### 场景二：top Shell 和真实业务首屏

使用 `service_ticket`：

1. 以 `customer` 打开。
2. 断言 top Shell 出现。
3. 断言 `landingPageId` 与 `activePageId` 都是 `customer_ticket_submit`。
4. 断言真实菜单存在、旧 `home` 菜单不存在。

两个场景都截取固定 viewport 的截图到 `tmp/generated-app-browser-smoke/`，并在页面异常、意外 API、首屏不符、重复 test id 或断言超时时以非零退出。

### 稳定测试钩子

`AppRuntimeScreen.tsx` 增加语义化、与 Ant Design 类名无关的 DOM 钩子：

- side 根：`app-shell-side`
- top 根：沿用 `app-shell-top`
- phone 根：`app-shell-phone`
- runtime 根属性：`data-landing-page-id`、`data-active-page-id`
- 菜单标签：`app-runtime-menu-${pageId}`

phone 外层与真实 `PhoneTabBar` 当前重复使用 `app-runtime-tabbar`。保留真实 TabBar 上的 id，移除外层重复 id，保证 Playwright strict locator 只命中一个元素。

这些属性只暴露已存在的运行时状态，不改变用户行为，也不引入测试专用业务分支。

## 发布门设计

### 主门 `scripts/verify-sliderule-v5.sh`

静态线增加：

- `client/src/pages/sliderule/__tests__/system-screens.test.tsx`
- `slide-rule-python/tests/test_builtin_domain_models.py`
- landing 引用 Gate 测试
- Prompt 必填契约测试
- landing Repair 测试
- 本轮新增 strict Gate/生成重试/版本回退测试

浏览器线先运行 `pnpm run smoke:generated-app`，再运行既有 `pnpm run smoke:sliderule`，分别记录退出码；任一失败即主门失败。生成应用 smoke 不替代真实推演 smoke。

### 串行门

`verify:sliderule-v5:serial` 同步主门新增的 client/Python/浏览器项目，保持“主门的顺序执行等价物”语义。

### 轻量门

`verify:sliderule-v5:light` 仍只服务纯 Markdown/docs 合入，不增加 Python、TypeScript 编译或浏览器：

- 补齐 `app-runtime-schema`、`rbac-preview`、`experience-block-catalog` 和 `system-screens` 四个前端文件。
- 保持“两批 Vitest”的轻量合同，避免把 docs-only 路径变成全门。

### CI

`.github/workflows/ci.yml` 已运行 `client/src` 全量测试和 Python 全量测试，不新增重复节点。浏览器发布门继续由本地/合并脚本的 full gate 负责。

## 文档订正

更新 `docs/sliderule-archetype-gap-2026-07-19.md`：

- 把“所有应用强制同一工作台”改成“新模型可选择真实业务首屏；旧模型、坏引用或无可见业务页才回退兼容工作台”。
- 把当前主要差距转向 `page.blocks` 尚未进入生成与真实渲染主链。
- 把第 0 步更新为静态门和生成应用 Chromium 验收均已补入。
- 把第 1 步写清楚：首次 LLM 生成/精修必须声明真实落地页，历史加载/版本回退继续兼容。
- 把第 2 步明确称为 transition scaffold：当前只守 `id/type`、目录和注册边界；Prompt 仍不生成 `page.blocks`，五个 renderer 仍是 `ExistingContentAdapter`。
- 把“每个区块已有前端实现”改成“每个目录项已有前端注册边界/适配器”。
- 把关键代码位置中的“需增加 landingPageRef/blocks/目录”更新为已存在和剩余待做字段。
- 把 `json-render` 在固定提交 `9d3dfc...` 下的许可证从 MIT 全部订正为 Apache-2.0，并链接固定提交 LICENSE。

根项目自身仍是 MIT；本轮只修正文档中的外部参考许可证，不修改根 `LICENSE` 或 README 的项目许可证标识。

## TDD 与验证顺序

1. 先新增 strict Gate 单测，确认当前代码对缺失字段错误地通过。
2. 再新增生成链路测试：第一次漏字段、第二次补齐可恢复；两次漏字段必须 `MODEL_GATE_BLOCKED`。
3. 新增版本回退测试，确认无字段旧快照仍可恢复为 6/6 证据。
4. 实现最小 strict 参数和调用点传递，依次跑上述 Python 测试转绿。
5. 先写生成应用浏览器 smoke 和断言；在缺少稳定 test hooks 时确认它失败。
6. 只增加必要 DOM 属性并消除重复 TabBar id，再运行 Chromium smoke 转绿。
7. 更新主/串行/轻量门清单并运行目标静态测试。
8. 最后更新文档，因为此时“已完成”已有代码和浏览器证据支持。

## 文件边界

预计修改：

- `slide-rule-python/services/v5_model_gate.py`
- `slide-rule-python/services/v5_capability_executor.py`
- `slide-rule-python/services/v5_llm_generate.py`（仅精修提示的旧模型升级例外说明，如测试证明需要）
- `slide-rule-python/scripts/eval_five_system_generation.py`
- `slide-rule-python/scripts/llm_smoke.py`
- `slide-rule-python/tests/test_v5_llm_generate_gate.py`
- `slide-rule-python/tests/test_model_versions.py`
- `slide-rule-python/tests/test_builtin_domain_models.py`
- `client/src/pages/sliderule/live-runtime/AppRuntimeScreen.tsx`
- `scripts/verify-sliderule-v5.sh`
- `package.json`
- `docs/sliderule-archetype-gap-2026-07-19.md`

预计新增：

- `scripts/generated-app-browser-smoke.mjs`

不修改当前已暂存的 AgentLoop、SkillsLibrary 文件；若实现开始前这些文件继续留在索引中，所有 diff 和验证均按显式路径检查，不使用 `git add -A`。

## 验收标准

- 兼容 Gate 对缺少 `landingPageRef` 的旧模型仍通过。
- strict Gate 对缺失、`None`、空白和 Repair 清除后的生成模型均失败，并返回精确 path/code。
- 首次生成和精修都启用 strict；版本回退关闭 strict。
- Gate feedback retry 可以把第一次漏字段的模型修正为合法模型；连续漏字段不产出闭环证据。
- `leave_approval` 和 `service_ticket` 内置模型继续通过 strict Gate。
- Playwright Chromium 在没有 LLM 和 Python 推演调用的情况下通过两个生成应用场景。
- side/top/phone、真实 landing、无 `menu-home`、角色降级均有浏览器断言和截图。
- 主门包含 landing 后端、AppBundle、strict Gate 和生成应用 smoke；串行门等价；轻量门保持 Vitest-only。
- 形态差距文档与代码现状一致，并明确 Catalog 只是骨架。
- `json-render` 外部参考许可证统一为 Apache-2.0，根项目 MIT 标识不变。
- 目标 Vitest、pytest、TypeScript 检查、生成应用 smoke 及现有真实推演 smoke 均通过，或如实报告受外部 LLM/环境阻塞的部分。

## 风险与控制

- **strict 误伤历史版本**：只在 LLM 新生成/精修路径开启，override 有专门回归测试。
- **strict 调用点遗漏**：生产、评测、smoke 的显式调用由搜索和测试锁定；通用 Gate 默认不变。
- **浏览器测试依赖已有本地会话**：所有状态由 route interception 提供，session id 固定且隔离。
- **浏览器测试意外触发生成**：记录并拒绝所有非 session/health 的 SlideRule API。
- **依赖 Ant Design 内部 DOM**：只依赖项目自有 `data-testid`/状态属性。
- **测试夹具漂移**：复用 CI 已全量校验的内置模型和画廊闭环状态，不维护另一份手写业务协议。
- **发布门时长增加**：生成应用 smoke 不调用 LLM，预期只增加一次 Vite/Chromium 启动和两次页面水合；真实 LLM smoke 仍是墙钟主项。
- **污染用户暂存内容**：实现与验证使用显式路径，最终单独列出本轮文件，不改不提交现有六个暂存文件。
