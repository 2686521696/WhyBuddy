# material-color-utilities（vendored 子集）

来源：https://github.com/material-foundation/material-color-utilities
许可：Apache-2.0（原文见同目录 LICENSE）
取自 `typescript/` 目录，**逐字复制未改一行**，只补了 `.js` → 相对路径的
import 后缀处理（见下）。

## 为什么 vendor 而不是装 npm 包

官方在 npm 上的发布很乱：搜出来的 `@materialx/…`、`@importantimport/…`、
`@artprompt/…` 都是来源不明的社区重打包。这份代码是**色彩科学**——一个矩阵
系数抄错，出来的是查不出来的色偏，不会报错。所以宁可从官方仓库取源码、
把许可一起放进来，也不引一个来源不明的包。

同理**不手抄**：CAM16 正反变换 + HctSolver 共两千行，手打必错。

## 只取了哪几个文件、为什么

    utils/color_utils.ts        sRGB ↔ XYZ ↔ Lab，argb 位操作
    utils/math_utils.ts         角度/区间的数学工具
    hct/viewing_conditions.ts   CAM16 的观察环境（D65 白点等）
    hct/cam16.ts                CAM16 外观模型
    hct/hct.ts                  HCT 色空间（hue / chroma / tone）
    hct/hct_solver.ts           给定 H/C/T 反解出可显示的 sRGB
    palettes/tonal_palette.ts   同色相同彩度、只变 tone 的色阶

没取的：`scheme/*`、`dynamiccolor/*`、`quantize/*`、`blend`、`score`、
`temperature`、`dislike`。那些是 Material Design 3 自己的**角色命名体系**
（primaryContainer / onSurfaceVariant 之类），跟 antd 的 token 命名对不上，
硬套只会多一层翻译。我们要的只是「一个种子色 → 一条可控色阶」这块地基，
角色映射在 `../identity-palette.ts` 里按**我们自己的 12 个字段**做。

## 升级须知

这几个文件请**整体替换**，不要局部改。改动了就不再是"逐字复制"，下次对不上
上游。真需要改行为，改 `../identity-palette.ts`，别动这里。
