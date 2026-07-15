# 环境与配置

面向自部署/开发者。普通使用不需要读这页。

## 启动

```bash
# 前端（vite :3000）
pnpm install && pnpm dev

# Python 推演引擎（:9700，唯一业务后端）
cd slide-rule-python
python -m venv .venv
.venv/bin/pip install -r requirements.txt   # Windows: .venv\Scripts\pip
.venv/bin/python -m uvicorn app:app --port 9700
```

`.env` 放仓库根目录，**永远不要提交**（已在 .gitignore）。

## 必填配置

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` | LLM 网关密钥 |
| `LLM_BASE_URL` | OpenAI 兼容网关地址 |
| `LLM_MODEL` | 模型名 |
| `SLIDERULE_LLM_GENERATE_ENABLED=1` | 开真 LLM 生成（关闭则确定性降级） |

## 可选开关（默认值可不写）

| 变量 | 默认 | 说明 |
|---|---|---|
| `SLIDERULE_WEB_SEARCH` | on | 真外网搜索证据源（Tavily → Serper → 维基百科免 key 兜底） |
| `TAVILY_API_KEY` / `SERPER_API_KEY` | 空 | 搜索供应商密钥，没有就走维基百科 |
| `SLIDERULE_CODE_RUN` | on | code.run 沙盒执行工具；**没有 `E2B_API_KEY` 时自动不可用（fail-closed），绝不在宿主机执行代码** |
| `E2B_API_KEY` | 空 | E2B 云沙盒密钥 |
| `SLIDERULE_AGENTIC_PICK` | off | 能力挑选改为 LLM 提案+门验收。盲评内容质量 4:0 胜出，代价是时长/成本约 2 倍 |
| `SLIDERULE_STRUCTURED_LLM` | on | 结构化生成通道：校验失败把错误喂回 LLM 重试，替代盲重试 |
| `RAG_VECTOR_ENABLED` | false | 向量检索（需要 qdrant） |

## 质量验证

```bash
# Python 全量测试（无网络也全绿；会话存储自动隔离进临时目录）
cd slide-rule-python && .venv/bin/python -m pytest -q

# 发布门：客户端测试 → 服务端契约 → tsc → 真浏览器冒烟
# 这是合并 main 的唯一凭据——AI 声称完成不算数，脚本跑过才算数
pnpm run verify:sliderule-v5
```

慢机器冒烟超时可调：`SLIDERULE_SMOKE_NAV_TIMEOUT`（默认 45s）、`SLIDERULE_SMOKE_TURN_TIMEOUT`（默认 240s）。
