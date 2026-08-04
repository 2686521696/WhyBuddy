"""体验层三段必须在流上可见（2026-08-04）。

## 这条防的是一个 165.8 秒的黑屏

真机量到（社区消防巡检那轮，10.2 分钟）：五系统建模的最后一个 llm_delta 之后，
到 skill_start/datamodel 之前，**165.8 秒一个事件都没有**——比选材那六段加起来
还长，而且落在最难受的位置：用户已经等了七八分钟、眼看要出结果，突然黑三分钟。

那段时间后端在干这三件事，埋点里数是现成的，只是从来没往前端送：

    monitor.sheet    104.9s   生成首页参照图
    monitor.palette   19.1s   从参照图读配色
    monitor.design    59.5s   照着图设计版式

## 为什么带"大概多久"

生参照图那 ~105 秒**在物理上没法流式**——图片没有"逐字"这回事，画完一次性
返回。这类操作能给的只有"在做什么 + 正常要多久"：用户能自己判断"还在正常
范围"还是"真卡了"。只给转圈图标的话，等 30 秒和等 3 分钟看起来一模一样。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import enrich_timing  # noqa: E402
from services.v5_full_driver import _ENRICH_STAGE_LABELS, _enrich_stage_event  # noqa: E402


def test_the_three_slow_stages_are_all_covered():
    """三段一个都不能漏——漏掉哪一段，那一段就还是黑的。"""
    assert set(_ENRICH_STAGE_LABELS) == {"monitor.sheet", "monitor.palette", "monitor.design"}


def test_every_label_carries_a_duration_hint():
    """每一段都要带时长提示，理由见文件头（没法流式时它是唯一的判断依据）。"""
    for name, (label, hint) in _ENRICH_STAGE_LABELS.items():
        assert label and not label.startswith("monitor."), f"{name} 要给人话，不是内部阶段名"
        assert "秒" in hint, f"{name} 缺时长提示"


def test_start_and_end_are_paired():
    start = _enrich_stage_event("start", "monitor.sheet", {})
    end = _enrich_stage_event("end", "monitor.sheet", {"ms": 104895, "ok": True})
    assert start["type"] == "reasoning_step"
    assert end["type"] == "reasoning_step_result"
    # 成对的关键是 label 一致——前端靠它把这一条收掉，对不上就会一直转
    assert start["label"] == end["label"]
    assert end["ms"] == 104895 and end["error"] is False


def test_skipped_stage_is_not_reported_as_a_failure():
    """got=0 是"跳过了/没产出"（比如没配生图 key），不是失败。

    混同的话，没配生图的环境会满屏红叉——而那恰恰是设计上允许的降级路径。
    """
    ev = _enrich_stage_event("end", "monitor.sheet", {"ms": 0, "ok": True, "got": 0})
    assert ev["error"] is False


def test_internal_substeps_stay_off_the_stream():
    """内部子步骤不报——报出来会把一条清晰的进度线拆成一堆看不懂的碎片。"""
    for internal in ("block.refimage", "freeform.total", "monitor.total", "block.screenshot"):
        assert _enrich_stage_event("start", internal, {}) is None


def test_sink_receives_start_before_end_and_never_breaks_the_pipeline():
    """sink 要在阶段**开始**时就叫一声（否则等于没改），且自身出错不能传染。"""
    seen = []
    enrich_timing.set_stage_sink(lambda phase, name, fields: seen.append((phase, name)))
    try:
        with enrich_timing.stage("monitor.sheet", page="p1"):
            assert seen == [("start", "monitor.sheet")], "开始时就要叫，不能等跑完"
    finally:
        enrich_timing.set_stage_sink(None)
    assert [p for p, _ in seen] == ["start", "end"]

    # sink 自己炸了，被测链路必须照常跑完
    enrich_timing.set_stage_sink(lambda *_a: 1 / 0)
    try:
        with enrich_timing.stage("monitor.design", page="p1"):
            pass
    finally:
        enrich_timing.set_stage_sink(None)


def test_stage_still_reraises_so_fail_open_semantics_survive():
    """异常照常向上抛——ENRICH 全程 fail-open，吞掉就变成"成功但内容为空"。"""
    enrich_timing.set_stage_sink(lambda *_a: None)
    try:
        raised = False
        try:
            with enrich_timing.stage("monitor.design"):
                raise RuntimeError("boom")
        except RuntimeError:
            raised = True
        assert raised
    finally:
        enrich_timing.set_stage_sink(None)
