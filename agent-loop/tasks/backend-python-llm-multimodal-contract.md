# 后端 NodeJS 到 Python 迁移：LLM multimodal contract

## 执行状态
- 状态：待执行
- 目标：为 Python LLM client 增加 multimodal content parts（多模态内容片段）contract，不接真实 vision 请求。
- 角色分工：worker 负责 contract 和测试；reviewer 确认不发真实图片/vision 网络请求。

### 状态清单
- [x] Python client 能接收 text/image content parts。
- [x] 不支持的 provider 有明确错误或降级。
- [x] JSON hardening 不退化。
- [x] gate 全绿。
- [x] Codex review 确认没有真实外部请求。

## 目标

多模态是 LLM infra 大分母之一。先锁输入输出 contract，为后续真实 provider 支持铺路。

## 允许修改的文件
- `tws-ai-slide-rule-python/sliderule_llm/client.py`
- `tws-ai-slide-rule-python/sliderule_llm/config.py`
- `tws-ai-slide-rule-python/tests/test_multimodal_contract.py`
- `tws-ai-slide-rule-python/tests/test_client_parity.py`
- `tws-ai-slide-rule-python/tests/test_json_hardening.py`
- `agent-loop/tasks/backend-python-llm-multimodal-contract.md`

## 禁止扩大范围
- 不发真实 vision 请求。
- 不提交图片或大二进制。
- 不改 Node multimodal 行为。
- 不更新总迁移百分比。

## 必跑 gate

使用 `agent-loop/scripts/migration-queue.json` 里的 `llmMultimodalContractGates`。

## 成功标准

- Python 测试覆盖 text-only、text+image、unsupported provider。
- 不支持路径不能伪装成功。
- client parity 和 JSON hardening 不退化。
- 所有 gate 通过。
