"""工作器分组：同一个库上的多套部署，各领各的单。

## 为什么有这个模块

⚠ 2026-10-04 本地开发连的是线上库（.env 里 APP_STORE_HTTP_API_URL 指着生产网关）。控制面任务
  （wb_control_run）和工程操作（wb_project_operation）都是「写进库里排队，谁的工作器有空谁领」。
  于是两套部署在抢同一个队列：

      本地跑的 4 轮 @技能 测试，批准后的执行阶段全被同一个工作器 control-93440d… 领走——
      跨了本地 4 次重启 ID 都没变，是线上那台。33 个任务，全是测试账号的。

  后果两头都有：本地改的控制面代码在执行阶段根本没跑到（测了线上代码）；反过来，本地工作器
  也能领到线上真实用户的单，用的是还在开发、甚至正在做变异测试的代码。

## 做法

单子写上「哪一组下的」（worker_pool 列），工作器只领自己组的。

- 没设 SLIDERULE_WORKER_POOL = 默认组（库里是 NULL）。线上不设，行为跟改之前一样；
  老行（这一列之前写的）也是 NULL，归默认组，照常被线上领。
- `pnpm dev:all` 起 Python 时默认设成 `dev-<机器名>`（scripts/dev-all.mjs），多台开发机连同一个库
  也各领各的。显式设了这个变量就用设的。

⚠ 这道闸只在**两边都是新代码**时成立：线上还没部署这一版之前，线上工作器不认这一列，照旧什么都领。
"""

from __future__ import annotations

import os
import re
from typing import Optional

ENV_NAME = "SLIDERULE_WORKER_POOL"
MAX_LEN = 80
_ALLOWED = re.compile(r"[^A-Za-z0-9._-]+")


def normalize_pool(raw: object) -> Optional[str]:
    """组名只留字母数字和 ._-，别的换成 -；空 = 默认组（None）。

    不合法的字符不报错也不丢弃整个值：把「dev host」悄悄变成默认组，等于让开发机去领线上的单——
    那正是这个模块要挡的。
    """
    text = _ALLOWED.sub("-", str(raw or "").strip()).strip("-")[:MAX_LEN]
    return text or None


def current_pool() -> Optional[str]:
    """这个进程属于哪一组。None = 默认组。"""
    return normalize_pool(os.environ.get(ENV_NAME))


def pool_filter(column: str, pool: Optional[str], param_index: int) -> tuple[str, list]:
    """SQL 片段 + 参数：只要这一组的行。默认组认 NULL（含这一列出现之前写的老行）。

    分两种写法而不是 `col = $n or $n is null`：Postgres 对没类型的 NULL 参数会报
    「could not determine data type」，两个后端（SQLite / Postgres，含 HTTPS 网关）都得过。
    """
    if pool is None:
        return f"{column} is null", []
    return f"{column} = ${param_index}", [pool]
