# Work 模式路线（角色自动巡演 · 可视化角色测试）

> 2026-07-10 裁决沉淀。缘起：TRAE 的 Work/Code 多模式启发 +
> [Agentshire](https://github.com/Agentshire/Agentshire)（MIT，把 AI 子代理变成
> 3D 小镇 NPC）。本文档记录 Work 模式的定位、已裁决的路线、Agentshire
> 借用方案与 3D 素材采购清单——**分析已做完，动手前先读这份，不重推演。**
>
> 北极星检验（见 [NORTH_STAR.md](./NORTH_STAR.md)）：Work 模式让"一句话 → 应用方案"
> 的**可信**再进一步——推演出的应用不只能看、能用，还能让角色自动跑一遍全流程，
> 把权限漏配、流程断链**测出来**。它是五系统真相的第四种观察形态：
> 推演看过程、应用看结果、代码看结构、**Work 看角色怎么用**。

## 一、价值分层（为什么 3D 不是必要条件）

Work 模式 = 三层，实用价值全部在前两层：

| 层         | 内容                         | 说明                                                                                                                                                                                                  |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **剧本层** | 五系统 model → 分幕演出脚本  | 纯函数确定性推导：RBAC 角色→演员，workflow chains（含泳道/角色绑定）→幕次走位，Page→工位，DataModel→道具，AIGC→特效动作                                                                               |
| **执行层** | 角色动作**真调浏览器运行时** | `startInstance` / `advanceInstance` / `addRow` / `accessForRole` 拦截 / AIGC tryrun——每步真落数据，巡演完切应用模式能看到留痕；产出**角色巡演报告**（走了哪些页、被拦几次、产出几行数据）进交付物附录 |
| **呈现层** | 把过程演给你看               | **呈现无关的事件流架构**：同一串巡演事件，既能驱动 2D 泳道令牌，也能驱动 3D NPC 走位                                                                                                                  |

**已裁决：2D 先行，3D 后置为可换皮肤。**
2D 版复用现有栈（React Flow 泳道图 + anime.js）：角色头像令牌沿泳道走位、
当前节点点亮、权限拦截红标、右侧事件流滚动。工作量约为 3D 方案两成，
测试价值一分不少。3D 买到的是演示冲击力与情绪可读性（营销层价值），
待 2D 巡演跑起来后再裁决是否加装。

其余边界裁决：

- **Design 模式不做**（低代码设计器已于任务 #61 复盘砍除，不借壳回魂）；
- **Dev 不升格为模式**（工程面不面向产品用户，保持隐藏入口）；
- **诚实原则贯穿**：演出事件必须绑定 runtime 真事件（烟花 = instance 真到达终态；
  红气泡 = accessForRole 真拦截），禁止无事实来源的演出；
- **「减少动态效果」偏好**（`sliderule:reduce-motion`）对巡演动画/未来 3D 同样生效。

## 二、分期路线

> **2026-07-10 用户改裁：一期直接上 3D**（"2D 版本的后续还要再修改"）。
> 已落地（`client/src/pages/sliderule/work-mode/`）：呈现层走"自研最小
> three.js 舞台 + 已采购角色"而非先整包移植 Agentshire——剧本/执行层
> 无论如何要自建，事件词汇表 GameEvent 兼容，Agentshire 氛围器官
> 二期可直接换皮加料。实测：三角色沿 workflow 三节点跑完（落库 1 行、
> 3 步审批到终态、4 处 RBAC 拦截），浏览器零报错。

- **一期 · 3D 巡演最小闭环（已落地）**：
  - `tour-script.ts` 剧本层：model → 演员（角色→CC0 GLB）/工位（页面）/
    幕次（集结→建单→审批链→权限审计→收幕），纯函数；
  - `tour-driver.ts` 执行层：每步真调 live-runtime（addRow /
    startInstance / advanceInstance byRole / RBAC 同源判定），
    emit GameEvent 兼容事件（npc_spawn/move_to/anim/emoji/work_done/fx），
    产出巡演报告；取消不回滚已落数据（诚实）；
  - `TourStage3D.tsx` 演出层：three.js 懒加载分包（gzip ~24KB +
    GLB 按需）、GLTFLoader+MeshoptDecoder、AnimationMixer 剪辑状态机
    （Idle/Walk/PickUp/Interact/Victory/Defeat）、工位桌台 + CanvasTexture
    名牌、reduce-motion 瞬移降级；模型加载失败给诚实立方体替身；
  - CSP 增补 `blob:`（connect-src/img-src）——GLTFLoader 解 GLB 内嵌
    贴图必需；blob 仅本页脚本可创建，zero-trust 姿态不变。
- **二期 · 办公室化（已落地，2026-07-10 用户裁决五件）**：
  - `vendor/SpotAllocator.ts`：Agentshire 直搬（MIT 署名，环形探位防
    NPC 站位重叠）；
  - `office-builder.ts`：部门分区办公室——**部门 = RBAC menus（schema
    真相）**，页面按权限交集归属；Kenney 家具工位三件套（桌/椅/显示器，
    显示器 CanvasTexture 实时绘页面名与动作，ScreenRenderer 手法）+
    分色地毯 + 墙面部门牌 + 绿植 + 墙体灯光；
  - NPC 头顶实时状态气泡（npc_status 事件：移动中/录入中/审批中/
    被拦截/完成），动作同步上工位显示器；
  - 点击 NPC → 角色档案卡（权限/可见页/无权页/流程职责，全部 model
    确定性推导，与运行应用同源判定）；
  - 巡演报告留档（localStorage）→ 交付物 MD 附录段（没跑过不出段）。
  - 遗留候选：不变式验收单逐条点亮、多链路顺演（chains）、
    Agentshire 氛围器官换皮（昼夜/天气/闲逛社交 DailyBehavior）。
- **三期 · 沉浸化（已落地，2026-07-10）**：舞台铺满内容区 + 悬浮 HUD
  （进度胶囊/事件横幅/可折叠事件流）、台词气泡（narration 绑 npcId）、
  名牌药丸化、环境密度。
- **四期 · 器官移植（已落地，2026-07-10 用户裁决"达不到 shire 效果"后
  换路）**：自建场景层退役，直接移植 Agentshire 视觉器官——
  - `vendor/agentshire/`：AssetLoader（清单制 + SkeletonUtils 骨骼安全
    克隆）、OfficeBuilder（30×25 房间/家具坐标/灯光配方逐字保留，工位
    按 stations/zones 参数化 + 部门牌）、ScreenRenderer（打字机代码/
    等待/完成/报错动态屏幕，绑 npc_status 真事件）；白板改画巡演进度
    （绑 progress/narration）；
  - 资产 `client/public/agentshire-assets/`（~4MB）：Kenney 卡通人类
    12 角色（自带 32 剪辑，ANIM_MAP 映射 driver 词汇）+ 低多边形家具，
    全 CC0，THIRD_PARTY_NOTICES 随目录；
  - 相机换透视（南侧高位俯视白板墙，Agentshire 办公室观感）；
  - 双层事件就绪队列（Surface 层等懒加载分包、舞台层等资产预载），
    冷启动点开演不再丢演出事件；
  - 退役：`office-builder.ts`（自建场景）与 UACP 写实角色池——
    `client/public/work-mode-3d/` 已删（2026-07-10 用户裁决；git
    历史可找回，复采购流程存于该目录 README 的历史版本）。
- **五期 · LLM 入魂档（默认关）**：角色用 LLM 生成拟真业务数据与台词，
  走既有真通道 / BYOK，fail-closed。氛围器官候选：TimeOfDayLighting
  昼夜光照、Effects/VFX 粒子、闲逛社交 DailyBehavior、BGM。

## 三、Agentshire 借用方案（0 期解剖已完成：B 终裁成立，见本节末）

### 探查到的硬事实（2026-07-10）

- **协议干净**：MIT；资产全 CC0（KayKit、Kenney、RG Poly 308 人形角色）+
  免费商用字体，见其 `THIRD_PARTY_NOTICES.md`。搬运只需保留 LICENSE 与声明。
- **几乎同栈**：React 19 + Tailwind v4 + Vite + lucide + TS；分歧仅在
  three 用法（它是 vanilla three 自建引擎，我们现有 legacy 场景是 R3F）。
- **前端可剥离**：`town-frontend/` 是独立 Vite 应用（engine / game / npc /
  narrative / audio / ui 分模块，多 HTML 入口）；`src/` 插件层深耦合
  OpenClaw 宿主，对我们是死重。
- **年轻项目**：58 commits / 1.2k star，fork 即自养；可选资产包 164MB
  （Releases 下载），不可能整包进仓。

### 三种搬法的裁决

| 方案                   | 内容                                                                                                                                                                | 裁决                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A 整包 iframe          | `town.html` 独立入口嵌进来喂假事件                                                                                                                                  | 只作 0 期验证脚手架，长期死路（样式/偏好/事件桥都隔着 iframe） |
| **B 器官移植（推荐）** | vendored `engine/ npc/ audio/ game/` 四器官进懒加载分包；丢插件层/UGC 编辑器/小游戏/Soul；自写 **SlideRuleDirectorBridge**（五系统运行时事件 → 它的游戏事件词汇表） | 拿到最贵的：动画编排引擎 + 昼夜/天气/程序音频 + 人形角色管线   |
| C 只借设计             | 协议与编排思想抄过来，场景用自家 R3F                                                                                                                                | 自家戏台缺人形角色与动画系统，等于重踩它踩过的坑               |

### 四个必须直面的代价

1. **双 three 栈不融合**：走 B 意味着自家 legacy 场景（`Scene3D`/`OfficeRoom`/
   `PetWorkers`/蓝图墙）荣退；渲染无关的纯函数（`capability-role-binding`
   五级归属、相机补偿）平移带走。vanilla engine 挂 React 反而简单（canvas
   挂载点 + 生命周期）。
2. **事件桥不因搬而省**：它的 NPC=编码子代理（召唤→集合→分配→编码→庆祝），
   我们的 NPC=业务角色（业务流程节点）。状态机骨架可复用，剧本层 +
   事件翻译必须自写——与一期 2D 的剧本层是**同一块工作**，2D 先做不浪费。
3. **诚实手术**：它是动画优先、演出与事实可脱钩；搬进来要在 narrative 层
   阉掉无事实来源的演出。
4. **包体红线**：GH Pages 静态部署 + 仓库大扫除纪律。资产精选（办公室 +
   六~八角色 + 必要动画，Draco 压缩后目标个位数 MB），其余走 Releases/CDN
   不进 git。依赖变更遵守 pnpm 三锁同步（package.json + package-lock.json +
   pnpm-lock.yaml），否则 CI frozen-lockfile 全红。

### 0 期解剖报告（2026-07-10 已完成，源码实测于 fork `xiaojilele-glitch/agentshire` @ f54a798）

**终裁：方案 B（器官移植）成立，且比预估更容易。** 三问实测结论：

1. **内存事件源：出厂即支持，无需手术。** 它自带 `IWorldDataSource`
   接口（`town-frontend/src/data/IWorldDataSource.ts`，仅 7 个成员：
   connect/disconnect/connected/onGameEvent/sendAction/getSnapshot）+
   `MockDataSource` 离线实现——后者用 `NarrativeEngine` 播 8 幕内存剧本
   （ACT_1_ENTER…ACT_8_PUBLISH）驱动整个小镇，WS 断开时 main.ts 本来就
   fallback 到它。**SlideRuleDirectorBridge = 第三个 IWorldDataSource 实现**：
   "剧本"从五系统 model 确定性推导，每个 GameEvent 绑定 runtime 真事实。
2. **耦合深度：薄到极致。** 游戏层唯一入口是
   `MainScene.handleGameEvent(event: GameEvent)` → `EventDispatcher`
   （自述"零业务逻辑"，~47 类 handler）；GameEvent 是纯 TS 联合类型
   （`data/GameProtocol.ts`，npc_spawn/npc_move_to/npc_anim/workstation_assign/
   fx/set_time/set_weather…）。**四器官（engine/game/npc/narrative）对
   platform/ 与 hooks/ 的 import 依赖为零**——WS 只活在 main.ts/ChatView；
   `platform/Bridge.ts` 仅 54 行 postMessage。前端出现的 "OpenClaw" 字样
   全是文案默认值，无协议依赖。OpenClaw 真耦合都在仓库根 `src/` 插件层
   （不搬）。
3. **资产子集：极小。** `town-frontend/public` 共 24MB，其中音乐 9.5MB
   （可不采）、角色 5.7MB（我们已有自采 Quaternius 套装）、办公场景
   实际需要的家具 1MB + 道具 2.5MB 级别——办公戏台增量 ≈ **3~4MB**。
4. **附加验证：独立构建一次通过。** `town-frontend` 用自己的
   package.json（deps 仅 react/react-dom/three/lucide/react-markdown/
   remark-gfm，与主仓同族）`npm install && npm run build` 23 秒成功；
   town 入口 gzip 217KB + GLTFLoader 155KB + main 131KB——懒加载分包
   后可控。

一期（2D 泳道）应把巡演事件流直接设计成 **GameEvent 兼容的词汇表子集**
（spawn/move_to/anim/work_done/fx…语义对齐），3D 阶段挂
SlideRuleDirectorBridge 时零翻译成本。

## 四、3D 知识备忘：五件套与选型纪律

文件里三要素（GLB 一包打尽）：

1. **模型 Mesh**：几何 + 材质贴图。纯 mesh 的场景/道具零技术风险。
2. **骨架 Skeleton/Rig**：关节树 + 蒙皮权重。三块里手艺最贵。
3. **动画 Animation Clips**：关键帧驱动骨头（不直接动顶点）。与骨架强耦合，
   跨骨架要重定向（retargeting）——坑最多的地方。

引擎里两件（经常被漏算）：

4. **动画状态机 + 混合**：three.js `AnimationMixer` crossfade + 上层状态机
   （巡演事件 → 播什么剪辑）。**与 2D 泳道版的"事件 → 演出动作"映射是同一层逻辑**，
   换 3D 皮时只是把"点亮泳道节点"换成"播 walk 剪辑"。
5. **Web 工程约束**：Draco/Meshopt 压缩（体积 -70%+）、多实例共享骨架、LOD。

**选型纪律（一票否决项）**：角色资产必须"三件齐 + 全系列共享骨架"的单一来源包；
绝不跨包拼人（模型一家、动画另一家 = 重定向天坑）。场景/道具可自由混搭同风格纯 mesh。

## 五、素材采购清单

> **2026-07-10 已采购**（任务 #87）：Quaternius 三包（UBC 角色、UAL 通用动画库、
> UACP 办公角色）曾验货压缩进仓（10 角色 + 43 剪辑共 5.3MB）；四期器官
> 移植后画风统一改用 Agentshire 同源 Kenney 角色，该目录已删（git 历史
> `client/public/work-mode-3d/` 可找回，README 历史版本含骨架验证结论与
> 复采购流程）。RG Poly 包已转 itch 付费（内容仍 CC0），未购；KayKit
> 免费包以奇幻题材为主，办公道具用仓库已有 Kenney 件，未采。
> 现役资产：`client/public/agentshire-assets/`（见其 README 与 NOTICES）。

### 第一梯队：免费 CC0（可直接进开源仓库）

| 来源                       | 地址                                          | 内容                                                                                | 备注                                                                                                |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Quaternius**             | quaternius.com                                | 低多边形角色包（共享骨架）+ **Universal Animation Library**（通用动画库配全系角色） | CC0。**最接近"整套"的主选**：角色+动画一站配齐                                                      |
| **Kenney**                 | kenney.nl                                     | 上百 CC0 包：家具、城市、UI、音效                                                   | 仓库已在用（`client/public/kenney_cube-pets_1.0`、`kenney_furniture-kit`）；All-in-1 合集属赞助性质 |
| **KayKit**（Kay Lousberg） | kaylousberg.itch.io                           | 角色包（骨架+动画齐）、城市/办公场景件                                              | 大部分 CC0，付费包几美元且允许再分发；与上两家风格同族                                              |
| **RG Poly 308 角色包**     | 从 Agentshire `THIRD_PARTY_NOTICES.md` 原链走 | 308 人形角色共享一套骨架 + 全套动画                                                 | CC0，Agentshire 实测可用，备选/扩充                                                                 |
| **Poly Pizza**             | poly.pizza                                    | CC0 低多边形模型聚合搜索                                                            | 缺零件时的搜索引擎                                                                                  |

**推荐主套装**：Quaternius 角色 + 他家通用动画库 + Kenney 场景件
（全 CC0、风格同族、骨架同源、动画互通）。

### 不适用（协议红线，非质量问题）

- **Synty Studios**（POLYGON 系列）、**Fab**/itch.io 付费区/CGTrader/TurboSquid：
  普遍"可用于成品、禁止再分发源资产"——我们是公开仓库 + GH Pages 直接伺服
  GLB，天然构成再分发，**用不了**。
- **Mixamo**：动画免费但非 CC0，不可作为素材再分发进开源仓库；且异源骨架
  要重定向，违反选型纪律。

### 落库纪律

- 精选子集进仓（目标个位数 MB，Draco 压缩），完整包走 Releases/CDN；
- vendored 代码目录保留上游 LICENSE + THIRD_PARTY_NOTICES + 来源 commit 基线；
- 新增运行时依赖走 pnpm 三锁同步。
