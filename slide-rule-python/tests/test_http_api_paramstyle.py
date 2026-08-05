"""HTTPS SQL API 后端的占位符方言转换（2026-08-05）。

## 这条防的是一次静默的数据损坏，和一次难查的 500

`HttpApiAppStore` 继承 `NeonHttpAppStore`，**连 SQL 一起继承**——那些 SQL 用
`$1`、`$2`（Neon 的 HTTP 接口按 Postgres 原生扩展协议吃这套）。而本仓的
/db-api 底层是 psycopg，走 DB-API 的 `format` paramstyle，只认 `%s`。

真机症状有迷惑性：**不带参数的语句全过、带参数的全 500**。后端因此看起来
"初始化成功、列表也读得出来"，一存就炸，像权限或建表问题。

第一版修法是一条带后顾断言的正则 `(?<!\\$)\\$(\\d+)`，想绕开美元引号块。
**它不成立**：`$$hello $1 world$$` 里的 `$1` 前面是空格不是 `$`，照样被替换，
把字符串**内容**改掉——这类"差不多对"是静默数据损坏，比直接报错糟得多。
所以这里逐条钉住扫描器该跳过的区段。
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.app_store import _numeric_to_format_params as conv  # noqa: E402


@pytest.mark.parametrize(
    "sql,want",
    [
        ("select $1::text", "select %s::text"),
        ("insert into t (a,b) values ($1,$2::jsonb)", "insert into t (a,b) values (%s,%s::jsonb)"),
        # 两位数序号：按 $10 整体替换，不能当成 $1 后面跟一个 0
        ("select * from t where id = $10", "select * from t where id = %s"),
        ("select 1", "select 1"),
    ],
)
def test_numbered_placeholders_become_format_style(sql, want):
    assert conv(sql) == want


@pytest.mark.parametrize(
    "sql",
    [
        # 美元引号块：里面的 $1 是**字符串内容**，动了就是改数据
        "select $$hello $1 world$$",
        "select $tag$ $1 $tag$",
        # 单引号字符串同理
        "select 'a $1 b'",
        # '' 是转义的单引号，不是字符串结束——数错了会把后面的 SQL 当字符串
        "select 'it''s $1 here'",
    ],
)
def test_quoted_regions_are_left_alone(sql):
    assert conv(sql) == sql


def test_placeholders_outside_quoted_regions_still_convert():
    """跳过区段不能连累区段外的占位符——只跳该跳的那一段。"""
    assert conv("select 'a $1 b', $1") == "select 'a $1 b', %s"
    assert conv("select $tag$ $1 $tag$, $3") == "select $tag$ $1 $tag$, %s"
    assert conv("select 'it''s $1', $2") == "select 'it''s $1', %s"


def test_the_real_upsert_converts_completely():
    """真实语句：转完不该剩任何 `$n`，否则又是那个 500。"""
    from services.app_store import _NEON_COLUMNS

    placeholders = ", ".join(
        f"${i + 1}::jsonb" if c == "model_json" else f"${i + 1}"
        for i, c in enumerate(_NEON_COLUMNS)
    )
    sql = f"insert into generated_app ({', '.join(_NEON_COLUMNS)}) values ({placeholders})"
    out = conv(sql)
    assert "$" not in out
    assert out.count("%s") == len(_NEON_COLUMNS)


def test_conversion_sits_in_the_backend_not_in_the_shared_sql():
    """SQL 本身必须仍然是 `$n` 写法。

    那些语句是 NeonHttpAppStore 和 HttpApiAppStore **共用的一份**：改成 `%s`
    会让 Neon 那条路挂掉，各写一份则必然分叉（两份 upsert 迟早只改一份）。
    所以转换只能待在唯一出口 `_q` 上。
    """
    import inspect

    from services.app_store import HttpApiAppStore, NeonHttpAppStore

    assert "$1" in inspect.getsource(NeonHttpAppStore.get), "共用 SQL 不该被改成 %s"
    assert "_numeric_to_format_params" in inspect.getsource(HttpApiAppStore._q)
