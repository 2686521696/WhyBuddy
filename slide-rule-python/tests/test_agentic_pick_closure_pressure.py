"""收口压力必须**随轮次递进**，而且不能自相矛盾（2026-08-04）。

## 这条防的是一次真实的"跑了九分钟什么都没有"

同一个题连跑三轮，第三轮：loop-4 / loop-5 连着两轮写「当前证据不足，不进入
运行时装配」，六轮跑满一次都没选收口，最后 awaitReason=max_loops 强停——
evidence 0/6、blocked、应用库一条记录都没有。前两轮同样的输入是出了应用的，
**两成一败**。

查出来两个原因，都在提示词里：

### ① 两句话直接打架，而劝退的那句挂在能力本身上

能力清单里写的是「…证据不齐会被门拦下——**收口前先确保证据充分**」，
而状态摘要里写的是「提案收口没有惩罚，拖到轮次耗尽才有」。模型正是在决定
**要不要选这个能力**的时候读到前一句。

### ② 进度提醒从第 1 轮到第 6 轮一模一样

最后一轮的紧迫程度显然不同于第 1 轮——那时候"再补一轮证据"这个选项**已经
不存在了**，可原措辞完全没体现。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.v5_agentic_pick import CAPABILITY_VOCAB, _progress_line  # noqa: E402


def test_closure_capability_no_longer_reads_as_a_warning_off():
    """收口能力的描述不能再劝退。

    它是模型决定要不要收口时读到的那一句，写成"先确保证据充分"等于告诉它
    "还不到时候"——而系统真正的取舍是：blocked 的收口也是交付，什么都没有才最差。
    """
    desc = CAPABILITY_VOCAB["appbundle.runtimeclosure"]
    assert "收口前先确保证据充分" not in desc
    assert "blocked" in desc
    # 要说清楚 blocked 也是一种交付，否则模型仍会把它当失败来规避
    assert "交付" in desc


def test_progress_pressure_escalates_with_remaining_loops():
    early = _progress_line(0, 6)
    late = _progress_line(4, 6)
    final = _progress_line(5, 6)
    assert early != late != final, "三档必须真的不同，否则等于没分档"
    assert "只剩 1 轮" in late
    assert "最后一轮" in final


def test_final_loop_states_the_consequence_in_concrete_terms():
    """最后一轮要把后果说具体。

    "应认真考虑收口"这种措辞留了余地，而那一轮已经没有余地了：不收就是
    max_loops 强停、evidence 0/6、用户什么都拿不到。
    """
    final = _progress_line(5, 6)
    assert "没有下一轮" in final
    assert "max_loops" in final


def test_early_loops_are_not_pressured_into_closing_too_soon():
    """早轮不能反过来被逼着收口——那会把"想清楚再动手"也一起毁掉。"""
    early = _progress_line(0, 6)
    assert "最后一轮" not in early and "只剩" not in early


def test_the_two_messages_no_longer_contradict_each_other():
    """能力描述与进度提醒必须朝同一个方向。

    这是这次事故的根因：一句说"先确保证据充分"，另一句说"收口没有惩罚"。
    模型只能挑一个信，它挑了劝退那句。
    """
    desc = CAPABILITY_VOCAB["appbundle.runtimeclosure"]
    for loop in range(6):
        line = _progress_line(loop, 6)
        # 两处都不该出现"先补够证据再收"这类把收口往后推的说法
        assert "收口前先确保" not in desc + line
