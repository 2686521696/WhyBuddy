# WhyBuddy 与 grok-build 架构对照

> 性质：两边重测后的对照，不是记忆，也不是把旧表抄一遍。
> 测量日：2026-08-30。
> grok-build：`https://github.com/xai-org/grok-build` @ `bc7f02e`（2026-08-28 *Synced from monorepo*）。
> WhyBuddy：本仓当时的 `HEAD`。闸里的模块 / 边 / 环读的是生成图，不是手点。
> 前一次对照在 `docs/欠缺模块清单-对照Claude与Grok-build.md` §16 / §17 / §32。那几节里的 **347 条边、91 个 crate、「边上写着为什么」** 以本文为准。

---

## 0. 两个被订正的数

这次重测就是冲着这两条来的。上次量错的方式和这次的口径写在这里，避免再被当成论据。

### 0.1 「1.7M 行 Rust」不是生成码

把所有 `.rs` 的行数在进程里累加（**不**用分批 `wc -l` 的 total）：

| 口径 | 文件 | 行 |
|---|---:|---:|
| 非测试、手写（去掉 `third_party/` + 生成标记） | 2,126 | **1,256,748** |
| 非测试（含 vendored / 生成） | 2,193 | 1,284,157 |
| 测试路径（`tests/`、`*_test.rs`、`tests.rs`） | 753 | 443,035 |
| **全部 `.rs`** | 2,946 | **1,727,192** |
| 带 `@generated` / `DO NOT EDIT` 的非测试 | 1 | 1,359 |
| `third_party/` | 66 | 26,050 |

1.73M = 非测试 1.28M + 测试 0.44M。生成码几乎不占行数。`crates/codegen/` 是目录名，里面是手写 crate，不是代码生成器的输出。

另有 1,439 个非测试文件带 `#[cfg(test)]`。这批行还在「非测试」里——和 grok 自己说的「测试行不含内联 `#[cfg(test)]`」一致。

### 0.2 「边上写着为什么」第一次量是 0，因为只数了行内 `#`

Cargo 依赖的注释几乎全在**上一行**（或上一块），不在 `crate = { path = "…" } # …` 行尾。

只扫行内 `#`：内部边带注释 = **0**。连上行上的注释块之后：

| | 内部边（去重） | 带注释 | 比例 | 注释位置 |
|---|---:|---:|---:|---|
| 工作区全部成员（97） | 362 | 64 | 17.7% | 全部在上方，0 条行内 |
| **一等 crate（92，去掉 third_party + prod）** | **351** | **61** | **17.4%** | 同上 |
| 全部依赖声明（含 crates.io） | 1,554 | 202 | 13.0% | — |

「边上写着为什么」是少数情况，不是常态。当初拿这句话当「他们比我们强」的论据之一，站不住。模块头注释我们本来就更厚（见 §3）。

---

## 1. 体量：他们比我们大约大一倍，别拿「我们小所以简单」当理由

同一天、同一套「非测试手写源码」口径：

| | grok-build | WhyBuddy |
|---|---|---|
| 非测试手写源码 | **1,256,748 行 / 2,126 文件**（Rust） | **675,421 行 / 2,244 文件**（Python 108,825 / 303 + TS/JS 566,596 / 1,941） |
| 行数比 | 1.0 | 0.54（他们是我们的 **1.86 倍**） |
| 文件数 | 2,126 | 2,244（几乎一样） |
| 架构闸里的模块 | = crate 内的 `.rs`，编译器全包 | Python **276** + TS **1,910** = **2,186** |
| 测试（行 / 文件） | 443,035 / 753（另有 1,439 个文件内嵌 `#[cfg(test)]`） | Python 103,462 / 482 + TS 396,571 / 1,481 |
| 测试（用例，grep，不是收集器） | 未跑 `cargo test --list` | `def test_` **3,125**；`it(`/`test(` **15,170** |

文件数两边一个量级。他们不是靠「东西少」才做到零环。

⚠ 不要拿 grok 的**测试行数**跟我们的**用例数**比。§16 那次对照里「Python 5278 条 + TS 42 条」是用例口径，而且 42 只是单文件套件，不是全仓。这次把行和用例分开写。

---

## 2. 边界：现在两边的账

| | grok-build | WhyBuddy |
|---|---|---|
| 边界单元 | 工作区成员 **97**；一等 crate **92**（去掉 4 个 `third_party/` + 1 个 `prod/`） | Python **11** 个包 + **23** 个 component；TS **5** 个包 + **26** 个 component。都不是编译单元 |
| 内部依赖边 | 全部成员 362；**一等 351** | Python **800** + TS **5,910** |
| 平均扇出（一等） | 351 / 92 = **3.82** | 闸按组算，不按 crate |
| 叶子（不依赖任何内部单元） | **35 / 92 = 38%** | Python `util` **120**（不依赖 services 内任何模块） |
| 环 | **0**（编不出来） | Python 模块 / 组间 **0**；TS **包级 0**（硬闸）/ 模块级 **94** / 组间 **35**（棘轮） |
| 未声明的依赖 | 不可能存在 | 两侧 **0** |
| 架构图 | **0** 张（svg/png/puml/dot/mermaid 都是 0） | **2** 张，生成的；手改会红 |
| 根清单 | `Cargo.toml` 第一行：`Auto-generated workspace root` | `architecture.toml` / `architecture.ts.json` 手写契约，图是生成的 |

粒度：他们 2,126 个手写非测试文件 / 92 crate ≈ **每 crate 23 个文件**。我们闸内 2,186 个模块 / 49 个 component（23+26）≈ **每组 45 个**。而且他们的 crate 是物理边界，我们的组是「清单里的一行 + 一条判据」。

---

## 3. 模块文档：我们更厚，这条不用追

| | grok-build | WhyBuddy（Python 闸内 276 个模块） |
|---|---|---|
| 有模块头 | `//!` **77.8%**（1,655 / 2,126） | docstring **99.6%**（275 / 276） |
| 有头的平均行数 | **7.3** | **21.2** |

§16.1 旧表写 grok 68% / 7.4 行、我们 93% / 14.9 行——量的是另一批文件（他们含更多非手写，我们含更广的 `.py`）。方向没变：注释纪律是这仓自己的，不是从他们抄来的优势。

---

## 4. 我们现在追平了什么

2026-08-29 之前这些全是「零强制」。今天（闸读数）：

| 抄过来的东西 | grok | WhyBuddy 现在 |
|---|---|---|
| 依赖必须先声明 | Cargo | 两侧未声明 **0** |
| 环红 | 编不出来 = 0 | Python 0；TS 包级 0。模块级 / 组间走棘轮，只许变短 |
| 图是生成的，手改会红 | 他们不画图 | `arch_graph.py --emit` / `arch-graph-ts.mjs --emit` |
| 叶子层 | 叶子 crate | `services_layer.util` 120 |
| 成员关系 | 根 `Cargo.toml` 生成 | 孤儿 54 上棘轮，且每条有 `[orphan_reasons]` 归类 |

逃生口两边都堵了，但「堵住」和「不存在」不是一回事：

| | grok | WhyBuddy |
|---|---|---|
| 绕过成本 | 不可能——循环依赖编不出来 | 改代码就能绕，只是会被判据抓 |
| 逃生口 | 不存在 | Python 函数体 import **463 / 800 = 57%**；TS 动态 `import()` / `require()` **307** |
| 判据能不能关 | 关不掉编译器 | 可以注释掉测试 |

函数体 import / 动态 import 已经算进边里（变异过：藏进去照样红）。判据仍是测试，不是编译器。

---

## 5. 还没抄、而且现在就能抄的：带事故原因的禁用 API 清单

这是这次对照里唯一一条「结构上追得上、又还没装」的。

grok 的根 `clippy.toml` 有一份 `disallowed-methods`，**12 条，每条都是「禁什么 + 为什么禁 + 该用哪个」**。机器强制（`cargo clippy` / `just lint-rs`）。全文如下——不是摘要：

```toml
disallowed-methods = [
  { path = "reqwest::Client::new",
    reason = "bypasses the grok TLS policy (backend pin, OS roots, GROK_EXTRA_CA_BUNDLE); build through xai_grok_extra_ca; localhost-only clients allow with a reason" },
  { path = "reqwest::blocking::Client::new",
    reason = "bypasses the grok TLS policy …" },
  { path = "reqwest::ClientBuilder::build",
    reason = "use xai_grok_extra_ca::build_reqwest_client: it applies the grok TLS policy and survives a broken OS store; localhost/test clients allow with a reason" },
  { path = "reqwest::blocking::ClientBuilder::build",
    reason = "use xai_grok_extra_ca::build_blocking_reqwest_client …" },
  { path = "std::fs::canonicalize",
    reason = "returns \\\\?\\ verbatim paths on Windows; use dunce::canonicalize" },
  { path = "std::path::Path::canonicalize",
    reason = "returns \\\\?\\ verbatim paths on Windows; use dunce::canonicalize" },
  { path = "tokio::fs::canonicalize",
    reason = "returns \\\\?\\ verbatim paths on Windows; use xai_grok_tools::util::fs helpers or spawn_blocking + dunce::canonicalize" },
  { path = "std::env::home_dir",
    reason = "grok-home resolution goes through xai-dirs (uncached) or xai_grok_config::grok_home (cached); generic home via xai_dirs::home_dir" },
  { path = "dirs::home_dir",
    reason = "home-anchored paths resolve via xai_dirs::home_dir so all sites agree; Node-based tools use os.homedir, which matches it, not the known-folder API" },
  { path = "std::process::Command::spawn",
    reason = "an unenrolled child outlives its session; use xai_tty_utils::ProcessScope::enroll" },
  { path = "tokio::process::Command::spawn",
    reason = "an unenrolled child outlives its session; use xai_tty_utils::ProcessScope::enroll" },
  { path = "portable_pty::SlavePty::spawn_command",
    reason = "an unenrolled pty child outlives its session; enroll the shell with xai_tty_utils::ProcessScope::enroll_terminal_pid" },
]
```

文件头还写着事故本身：Windows `\\?\` 路径漏进提示词、没登记的子进程活过会话、`$HOME` 在 Windows GUI 进程上是空的、`dirs::home_dir` 和 Node `os.homedir()` 对不上。这正是本仓 `CLAUDE.md` 第八条——「注释要记录事故」——只不过他们让 linter 执行，我们只写在注释里。

他们自己也没做到「一份配置覆盖全树」：根文件的注释写明 clippy **只读最近的一份、不合并**；canonicalize / spawn 那几条靠 `cargo clippy` 和 `just lint-rs`，Bazel lint aspect 钉的是另一份、**不含**这几条。抄的时候连这个坑一起抄：一份名单，两处配置必须逐字相同，否则又是「只改一半」。

### 我们有没有等价物

**没有统一入口。** 今天最接近的都是一事一脚本：

| 现有闸 | 管什么 | 缺什么 |
|---|---|---|
| `scripts/check-no-node-backend-api.mjs` | 防新增 Node 后端接口 | 不是禁用 API 名单，没有事故原因字段 |
| `scripts/lint-autopilot-colors.mjs` | Autopilot 色板 | 单主题 |
| `scripts/arch-graph-ts.mjs` / `arch_graph.py` | 依赖边 / 环 | 不管调用了哪个函数 |
| `scripts/freeform-blockref-wiring-check.mjs` | 区块 ref 接线 | 单主题 |

`package.json` **没有 eslint**，也没有 `eslint.config.*`。TS 侧连挂 `no-restricted-syntax` / `no-restricted-imports` 的地方都还没有。Python 侧也没有一份 ruff/flake8 的 banned-api 表。

而我们恰恰有一堆同款的账，全靠人记：

- 两份 DOMPurify 白名单要钉在一起（漏了 `data-page-id`，静默剥掉）
- 环境开关手抄多份，默认值和词表对不上过
- 合法域多本账（设备 / 原型 / Literal）
- `slide_rule_session` 的缓存注入活不过一次 `importlib.reload`

这些就是该写进「禁什么 + 哪次踩的 + 该用哪个」的条目。还没抄。要抄再说一声。

---

## 6. 一句话

声明、环（Python / TS 包级）、生成图、叶子层、成员归类——这五条现在追平了。粒度还粗一倍。「编译器 vs 测试」追不平，只能把逃生口一条条堵死。唯一还没抄、又值得马上抄的，是那份带事故原因的禁用 API 清单。

---

## 附录 A. 怎么复测（避免再信分批 `wc`）

```bash
# grok-build（浅克隆即可）
git clone --depth 1 https://github.com/xai-org/grok-build.git /tmp/grok-build

# 行数：在一个进程里累加，不要 `find | xargs wc -l` 再去加 total
# 依赖注释：看依赖行上方的连续 `#` 块，不只看行内

# WhyBuddy 闸
slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --check
node scripts/arch-graph-ts.mjs --check
```

生成图里的 WhyBuddy 数字以 `--emit` 为准。grok 的 crate / 边数字以本文测量日为准；根 `Cargo.toml` 是生成的，成员数会变。
