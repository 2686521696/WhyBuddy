# Work 模式 3D 素材（精选 CC0 套装）

> 2026-07-10 采购（任务 #87，路线见 [docs/WORK_MODE_PLAN.md](../../../docs/WORK_MODE_PLAN.md)）。
> 全部素材 **CC0 1.0 Universal（公有领域）**，作者 Quaternius（quaternius.com），
> 原始 License.txt 见本目录 `LICENSE-Quaternius-CC0.txt`。
> 请考虑支持原作者：https://www.patreon.com/quaternius

## 内容清单（共 5.3MB，已压缩）

### characters/ — 10 个人形角色

| 来源包                                                       | 文件                  | 用途建议                  |
| ------------------------------------------------------------ | --------------------- | ------------------------- |
| Ultimate Animated Character Pack（自带 16 动画/角色，23 骨） | Suit_Male/Female      | 管理员、财务（正装）      |
| 同上                                                         | Casual_Male/Female    | 创作者、内容运营（便装）  |
| 同上                                                         | Worker_Male/Female    | AI 制作、执行岗（工装）   |
| 同上                                                         | OldClassy_Male/Female | 审核、顾问（老绅士/淑女） |
| Universal Base Characters（无动画，65 骨，配 UAL）           | Superhero_Male/Female | 备用/彩蛋                 |

UACP 角色内嵌动画：Death, Defeat, Idle, Jump, PickUp, RecieveHit, Roll,
Run, Run_Carry, Shoot_OneHanded, SitDown, StandUp, Victory, Walk, Wave…
——巡演编排（走位/落座/干活/庆祝）够用，**开箱即播，无需重定向**。

### animations/ — 通用动画库

`UAL1_Standard.glb`（43 剪辑，无根运动版）：Idle_Loop, Idle_Talking_Loop,
Walk_Loop, Walk_Formal_Loop, Jog_Fwd_Loop, Sitting_Enter/Idle_Loop/Talking_Loop/Exit,
Interact, PickUp_Table, Fixing_Kneeling, Dance_Loop, Push_Loop…
**仅配 65 骨 universal 骨架**（Superhero 两件；骨名 root/pelvis/spine_01…
已逐骨验证一致）。不要套在 23 骨的 UACP 角色上。

## 工程注意

- 所有 GLB 经 `@gltf-transform/cli optimize` 处理：**EXT_meshopt_compression**
  （加载需 three.js `MeshoptDecoder`）+ **EXT_texture_webp** + 贴图上限 1024，
  KHR_mesh_quantization。原包 120MB+ → 精选 5.3MB。
- 上游 UBC 包有贴图命名笔误（gltf 引用 `*_png.png`，实际文件无此后缀），
  打包时已补别名修复，GLB 内已自含贴图，无外部引用。
- 本目录随 `client/public` 进 GitHub Pages 部署产物；新增文件保持
  "个位数 MB 总量"纪律，大包完整版不进 git（重下流程见下）。

## 复采购流程（完整包/更多角色）

1. Quaternius 各包经 itch.io 匿名可下（UBC/UAL）或 Google Drive（UACP 等），
   来源页：quaternius.com/packs/\*.html；
2. RG Poly「Cartoon City Massive Pack」（308 角色共享骨架）现为 itch 付费包
   （内容仍 CC0），需要时人工购买后按上述压缩流程精选；
3. KayKit（kaylousberg.itch.io）免费包以奇幻题材为主，办公道具用仓库已有的
   Kenney furniture-kit（`client/public/kenney_furniture-kit`）即可。
