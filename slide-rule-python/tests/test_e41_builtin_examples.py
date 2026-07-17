"""E41 官方示例库——摘要投影必须全真（来自过门冻结模型，不发明数字）。"""

import json
from pathlib import Path

from services.builtin_examples import list_builtin_examples
from services.schema_legal import legal_snapshot

_FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def test_four_examples_with_real_metrics():
    examples = list_builtin_examples()
    assert len(examples) == 4
    models = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    by_domain = {e["domain"]: e for e in examples}
    for domain, ex in by_domain.items():
        model = models[domain]
        assert ex["pages"] == len(model["page"]["pages"])
        assert ex["roles"] == len(model["rbac"]["roles"])
        assert ex["aiCapabilities"] == len(model["aigc"]["capabilities"])
        # 标签 = 真实页面名前三，不是营销词
        real_names = [p.get("name") for p in model["page"]["pages"][:3]]
        assert ex["tags"] == real_names


def test_identity_fields_within_legal_domain():
    legal = legal_snapshot()
    for ex in list_builtin_examples():
        assert ex["theme"] in legal["identityThemes"]
        assert ex["icon"] in legal["identityIcons"]
        assert ex["nav"] in legal["identityNavs"]
        assert ex["productName"]  # E40.2 夹具已入身份段，产品名非空
        assert ex["intent"]  # 起手意图 = 点卡预填的话题原文
        assert ex["category"] in {"供应链", "人力资源", "客户服务"}
