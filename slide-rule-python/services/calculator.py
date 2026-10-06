"""算数：给 Agent 一件通用的计算原语，别让它心算。

⚠ 2026-10-06 真机 r33 sr-20261006045715-M51333CGA5（@data-storytelling @pptx-deck-context 奶茶店投资人汇报）：
  规划阶段模型心算 `12×(1-32%)-2-2.4`，写成 4.16（实为 3.76），据此对用户说「你给的数字自相矛盾：应第 11 个月回本、
  三年 188.4 万」，问了一道建立在错算上的问卷；随后为了把用户本来自洽的 136.6 万「圆回来」，编出了「开业爬坡、平台/支付、
  税费及维护准备金等经营性调整」写进投资人 PPT 的计划——用户一个字都没提过。同一天 r32（Excel 三年预测）计划里的
  三年合计也少算 2,000，靠执行期宿主扫描才抓到。

  根子不在某个技能：规划期只读、没有工程、没有沙盒，**任何数字都只能心算**。Claude Code 的 plan mode 照样能跑只读命令；
  这里补的是同一类通用原语，不是给财务技能加工具。

只认算术：数字、+ - * / // % **、括号、一元正负、几个纯函数（round / min / max / abs / sum）。一行一个算式，
`名字 = 算式` 记下结果，后面的行可以用这个名字。不是 Python：没有属性、下标、调用任意函数、导入——AST 白名单，
不认识的节点直接报错，不 eval。
"""

from __future__ import annotations

import ast
import math
import operator
import re
from typing import Any, Dict, List

MAX_LINES = 40
MAX_LINE_CHARS = 300
MAX_ABS = 1e18
MAX_POWER = 64

_BIN = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_FUNCS = {"round": round, "min": min, "max": max, "abs": abs, "sum": lambda *xs: sum(xs)}
_ASSIGN = re.compile(r"^\s*([^\W\d][\w]*)\s*=(?!=)\s*(.+)$", re.UNICODE)
# 模型常写的全角 / 中文符号：× ÷ － （ ） ％ 。百分号按「÷100」认（32% → 0.32）。
_NORMALIZE = str.maketrans({"×": "*", "÷": "/", "－": "-", "（": "(", "）": ")", "，": ",", "＋": "+", "％": "%"})
_PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%(?!\s*[\d(])")


class CalcError(ValueError):
    pass


def _eval(node: ast.AST, names: Dict[str, float]) -> float:
    if isinstance(node, ast.Expression):
        return _eval(node.body, names)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in names:
            return names[node.id]
        raise CalcError(f"不认识「{node.id}」：先用一行 `{node.id} = …` 算出来")
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        left, right = _eval(node.left, names), _eval(node.right, names)
        if isinstance(node.op, ast.Pow) and abs(right) > MAX_POWER:
            raise CalcError("指数太大")
        try:
            value = _BIN[type(node.op)](left, right)
        except ZeroDivisionError as exc:
            raise CalcError("除以 0") from exc
        if isinstance(value, complex) or (isinstance(value, float) and not math.isfinite(value)) or abs(value) > MAX_ABS:
            raise CalcError("结果超出范围")
        return value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_eval(node.operand, names))
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS
            and not node.keywords):
        return _FUNCS[node.func.id](*[_eval(arg, names) for arg in node.args])
    raise CalcError("只认算术：数字、+ - * / // % **、括号、round/min/max/abs/sum")


def _tidy(value: float) -> float:
    """浮点尾巴收掉（0.1+0.2 → 0.3），整数显示成整数。"""
    rounded = round(float(value), 10)
    return int(rounded) if rounded == int(rounded) and abs(rounded) < 1e15 else rounded


def calculate(lines: Any) -> Dict[str, Any]:
    """逐行算。某一行错了照实报那一行，后面不再算（后面的行可能依赖它）。"""
    if isinstance(lines, str):
        lines = lines.splitlines()
    rows = [str(line).strip() for line in (lines or []) if str(line or "").strip()][:MAX_LINES]
    if not rows:
        return {"ok": False, "error": "没有算式。一行一个，例如 `月利润 = 12*(1-0.32)-2-2.4`。"}
    names: Dict[str, float] = {}
    results: List[Dict[str, Any]] = []
    for raw in rows:
        line = raw[:MAX_LINE_CHARS].translate(_NORMALIZE)
        match = _ASSIGN.match(line)
        name, expr = (match.group(1), match.group(2)) if match else (None, line)
        expr = _PERCENT.sub(r"(\1/100)", expr)
        try:
            value = _tidy(_eval(ast.parse(expr, mode="eval"), names))
        except SyntaxError:
            return {"ok": False, "results": results, "error": f"「{raw}」不是算式"}
        except CalcError as exc:
            return {"ok": False, "results": results, "error": f"「{raw}」：{exc}"}
        if name:
            names[name] = value
        results.append({"expr": raw, **({"name": name} if name else {}), "value": value})
    return {"ok": True, "results": results}
