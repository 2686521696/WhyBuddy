"""页面 id 别名表要跨精修轮累积（2026-08-28）。

## 事故

第 4.5 步把「以页面 id 作键或存页面 id」的七样载体都改了名，**唯独改不到
已经烧进页面 HTML 正文的 data-page-id**——那是第 3.5 步 unify_shell 按当时
的草稿 id 打的孔，`rekey_page_map` 只换 dict 的键、不碰 value 那串 HTML。

真机 sr-20260827191954（药房）四个菜单项全点不动、sr-20260827201847（巡检）
五个全废，而 sr-20260822124211 页键本身还是 p1/p2、孔对得上、菜单是好的
——所以这是第 4.5 步引入的**回归**，不是一直就坏。宿主
`resolveActivePageId` 查不到就静默回落当前页，一声不吭。

修法照 friendly_id 的 History：改名的**那一刻**把映射记下来随页面落库，
宿主解析不到时按它回退（前端判据在
client/src/pages/sliderule/__tests__/menu-click-survives-page-rename.test.ts）。

## 这个文件专管「累积」这一半

`canonical_page_id_map` 的头注写着「一个都没改就返回空表」，而那**正是精修轮
的常态**。于是精修一次，本轮 pageIdAliases 是 {}，直接盖上去就把首轮记下的
p1→remote_rx_audit 抹掉——菜单第二天又点不动了，而且同样不报错。老页面是
被 reuse_pages 照搬回来的，孔里烧的还是首轮那批 id。

合并只能放在落库那一处：流水线拿不到 state（旧值只在 `state.specFirstPages
= got` 之前还活着），往里穿参数要改十几处签名。冲突时**本轮赢**，对应
friendly_id 的 `order(id: :desc)`——同一个旧 id 被指到两个新 id 时，最近那次
改名才是有效的。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import spec_first_pipeline as sfp  # noqa: E402
from services.v5_capability_executor import _cache_spec_first_pages  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_stash():
    sfp._last_pages_var.set(None)
    yield
    sfp._last_pages_var.set(None)


def _stash(pages, aliases):
    sfp._last_pages_var.set({
        "version": "spec-first-pipeline-v1",
        "pages": dict(pages),
        "navItems": [{"id": k, "name": k} for k in pages],
        "pageIdAliases": dict(aliases),
    })


class Test别名跨轮累积:
    def test_首轮把改名记下来(self):
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">x</a>"}, {"p1": "remote_rx_audit"})
        _cache_spec_first_pages(state)
        assert state.specFirstPages["pageIdAliases"] == {"p1": "remote_rx_audit"}

    def test_精修轮没改名也不许把上一轮的别名抹掉(self):
        """⚠ 这条是本文件的理由。

        精修轮 `canonical_page_id_map` 返回空表是常态；照搬回来的老页面里，
        孔烧的还是首轮那批草稿 id。空表直接盖上去 = 菜单再次点不动，
        而且没有一处会报错。
        """
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">x</a>"}, {"p1": "remote_rx_audit"})
        _cache_spec_first_pages(state)

        # 第二轮：页面重画了一遍，但一个都没改名 → 本轮别名表是空的
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">y</a>"}, {})
        _cache_spec_first_pages(state)

        assert state.specFirstPages["pageIdAliases"] == {"p1": "remote_rx_audit"}, (
            "精修轮的空表把首轮的别名抹掉了——菜单会再次静默失灵"
        )

    def test_二次改名时本轮赢(self):
        """同一个旧 id 被指到两个新 id：最近那次改名才是有效的。"""
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"draft2": "<a data-page-id=\"p1\">x</a>"}, {"p1": "draft2"})
        _cache_spec_first_pages(state)

        _stash({"final": "<a data-page-id=\"p1\">x</a>"}, {"p1": "final", "draft2": "final"})
        _cache_spec_first_pages(state)

        aliases = state.specFirstPages["pageIdAliases"]
        assert aliases["p1"] == "final"
        # 中间那个 id 也留着：它不是交付页，但前端展平链式时要用它
        assert aliases["draft2"] == "final"

    def test_页面为空的那一轮什么都不写(self):
        """回落老链路的那一轮不许留下页面——连带别名也不许动上一轮的。"""
        state = V5SessionState(sessionId="s1", goal={"text": "x"}, artifacts=[])
        _stash({"remote_rx_audit": "<a data-page-id=\"p1\">x</a>"}, {"p1": "remote_rx_audit"})
        _cache_spec_first_pages(state)
        before = dict(state.specFirstPages["pageIdAliases"])

        _stash({}, {"p9": "谁也不是"})
        _cache_spec_first_pages(state)

        assert state.specFirstPages["pageIdAliases"] == before


class Test流水线把别名交出来:
    def test_两条载体都带着别名键(self):
        """⚠ 反向判据：只挂 result 不算数。

        宿主刷新之后唯一的来源是 state.specFirstPages（走 _last_pages_var），
        不是 result——styleBrief 那次就是只挂在 model 上，精修回流被剥成六段，
        接线从出生起没通过电。所以两处都得写，源码里两处都得在。
        """
        src = sfp.__file__
        with open(src, encoding="utf-8") as fh:
            body = fh.read()
        # 剥掉注释再数：本仓踩过"判据 grep 到的词其实在文档字符串里"
        code = "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )
        assert code.count('"pageIdAliases": dict(_page_id_aliases)') == 2, (
            "result 与 _last_pages_var 两条载体必须都带 pageIdAliases，"
            "只写一条 = 刷新之后别名就没了"
        )


class Test别名是历史_不跟着版本回退:
    """⚠ 2026-08-28 审计出来的洞，补在原修复之后。

    页面 id 别名表有三个写入/读取点：落库、版本快照、版本回退。回退那处是
    `state.specFirstPages = restored.specFirstPages` ——**整份替换**，而旧
    快照里的别名表可能是空的（修复之前的存量版本；或某个没改过名的精修轮，
    canonical_page_id_map 一个都没改就返回空表，那正是精修轮的常态）。

    冲掉 = 菜单又点不动，而且照例一声不吭。别名是历史，模型版本可以回退，
    「p1 曾经是 remote_rx_audit」这件事永远为真——照 friendly_id：slug 历史
    只增，回退文章内容不会把老 slug 从历史表里删掉，否则老链接当场 404。
    """

    def test_合并规则_新的赢(self):
        from services.page_id_freeze import merge_page_id_aliases

        assert merge_page_id_aliases({"p1": "old"}, {"p1": "new"}) == {"p1": "new"}
        assert merge_page_id_aliases({"p1": "a"}, {"p2": "b"}) == {"p1": "a", "p2": "b"}

    def test_合并规则_空表不许抹掉已有的(self):
        """这条就是回退那个洞的形状：新的一边是空表。"""
        from services.page_id_freeze import merge_page_id_aliases

        assert merge_page_id_aliases({"p1": "remote_rx_audit"}, {}) == {
            "p1": "remote_rx_audit"
        }
        assert merge_page_id_aliases({"p1": "remote_rx_audit"}, None) == {
            "p1": "remote_rx_audit"
        }

    def test_合并规则_自指与脏数据剔掉(self):
        from services.page_id_freeze import merge_page_id_aliases

        assert merge_page_id_aliases({"p1": "p1"}, {}) == {}
        assert merge_page_id_aliases({"": "x", "y": ""}, {}) == {}
        assert merge_page_id_aliases("不是表", 42) == {}

    def test_回退那一处真的接上了合并(self):
        """⚠ 反向判据：函数写对了 ≠ 它被调用了。

        整份替换那一行还在的话，上面三条照样全绿——而线上回退一次别名就没了。
        """
        import services.rehearsal_control as rc

        with open(rc.__file__, encoding="utf-8") as fh:
            body = fh.read()
        code = "\n".join(
            line for line in body.splitlines() if not line.lstrip().startswith("#")
        )
        at = code.index("state.specFirstPages = restored.specFirstPages")
        window = code[at - 400 : at + 500]
        assert "merge_page_id_aliases" in window, (
            "版本回退整份替换了 specFirstPages 却没合并别名表——回退一次菜单就废"
        )
