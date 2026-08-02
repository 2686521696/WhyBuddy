"""应用的访问模型（2026-08-02）。

## 为什么不是通用 RBAC

上一版审查过的那套后台是「角色 → 权限码 → 接口」的通用 RBAC。那个模型适合
**后台管理系统**（固定的一批人、固定的一批菜单），不适合这里：这边是**每个用户
产出自己的应用、别人可以浏览和 Fork**，权限依附在**资源**上而不是菜单上。

同样形状的成熟产品是代码托管：仓库有所有者、有公开/私有、能被 Fork、Fork 有血缘。
所以模型参照 **Gitea**（MIT，拉到本地读了 `models/perm` 与 `services/repository`）：

  · **有序的访问级别阶梯**（`models/perm/access_mode.go:17`）
        None(0) < Read(1) < Write(2) < Owner(3)
    判定全部是 `>= ` 比较，没有权限矩阵。加一个新动作只要问"它至少需要哪一级"，
    而不是去矩阵里补一行——后者正是那套 RBAC 后来长到 92 个路由文件还漏一半的原因。

  · **单调的合成顺序**（`models/perm/access/access.go:36`）
        起点 None → 公开的给 Read → 匿名到此为止 → 所有者直接 Owner → 否则查显式授权
    每一步**只能抬高、不能压低**。这个性质让"漏了某个分支"的后果是**权限不足**
    （用户会来报），而不是**权限过大**（没人会来报）。

  · **Fork 继承私有**（`services/repository/fork.go:97`）
        IsPrivate: opts.BaseRepo.IsPrivate || owner private
    私有应用被 Fork 之后**仍然私有**。这条很容易做反——Fork 出的是新记录、新
    所有者，很自然就写成默认公开，于是 Fork 成了绕过私有的后门。

## 三档可见性

    public    列在应用中心，任何人可看（含匿名）
    unlisted  不列出，但有链接就能看（对标 YouTube 不公开列表 / GitHub Gist）
    private   只有所有者与被显式授权的人可看

`unlisted` 值得单独一档：产品里"我想把这个分享给同事看，但不想挂在广场上"是很常见
的诉求。只有 public/private 两档时，用户为了分享就只能设成 public。

## 存量数据

`owner_id` 为空的历史应用：**可读（沿用现状），不可写**（超管除外）。
判成可写等于权限一上线就把所有历史应用敞开；判成不可读则会让应用中心突然空掉。
读写分开处理，两边都不激进。
"""

from __future__ import annotations

from enum import IntEnum
from typing import Any, Optional, Protocol

# ────────────────────────── 访问级别 ──────────────────────────


class Access(IntEnum):
    """有序阶梯，判定用 `>=`（对齐 Gitea models/perm/access_mode.go:17）。

    刻意**不设 Admin 档**：超管是正交的全局身份，不是资源上的一级。混进阶梯里会
    让"这个资源的管理员"和"系统超管"两个概念纠缠。
    """

    NONE = 0
    READ = 1
    WRITE = 2
    OWNER = 3

    def label(self) -> str:
        return {0: "none", 1: "read", 2: "write", 3: "owner"}[int(self)]


class Visibility:
    PUBLIC = "public"
    UNLISTED = "unlisted"
    PRIVATE = "private"

    ALL = (PUBLIC, UNLISTED, PRIVATE)
    DEFAULT = PUBLIC


def normalize_visibility(value: Optional[str]) -> str:
    """认不出的一律按**最保守**的档处理。

    与本项目其他地方"认不出就用默认值"的取向相反，是刻意的：可见性字段脏了
    （手工改库、迁移写错）时，把未知值当 public 等于把可能私密的东西публично 放出去。
    宁可让用户来问"我的应用怎么看不见了"，也不要静默泄露。
    """
    v = (value or "").strip().lower()
    if not v:
        return Visibility.DEFAULT  # 真的没设置 → 用默认（存量应用就是这种）
    return v if v in Visibility.ALL else Visibility.PRIVATE


# ────────────────────────── 用户视角 ──────────────────────────


class Viewer(Protocol):
    """访问者。只用到三样，避免把 identity_store.User 绑死进来——测试里可以传桩。"""

    @property
    def id(self) -> str: ...

    @property
    def is_superuser(self) -> bool: ...

    @property
    def is_active(self) -> bool: ...


def _viewer_id(viewer: Any) -> Optional[str]:
    if viewer is None:
        return None
    vid = getattr(viewer, "id", None)
    return str(vid) if vid else None


def _is_super(viewer: Any) -> bool:
    return bool(viewer is not None and getattr(viewer, "is_superuser", False))


# ────────────────────────── 合成 ──────────────────────────

# 显式授权表：app_id + user_id → 级别。现在只有 Fork/协作两个来源，
# 表结构留在 app_store 里，这里只消费。
GrantLookup = Any  # Callable[[str, str], Access] | None


def access_for(
    record: dict[str, Any],
    viewer: Any = None,
    *,
    grant_lookup: GrantLookup = None,
) -> Access:
    """算出 viewer 对这条应用记录的访问级别。

    合成顺序严格照 Gitea `accessLevel`（access.go:36）——**每一步只抬不压**：

        ① 起点 NONE
        ② 公开/不公开列表 → READ（匿名也算）
        ③ 匿名到此为止
        ④ 超管 → OWNER
        ⑤ 所有者 → OWNER
        ⑥ 显式授权 → 取其级别
        ⑦ 取以上最大值

    这个单调性是安全性的来源：任何一处漏判的后果都是**级别偏低**（用户会报"我
    打不开"），而不是**级别偏高**（没人会报，直到出事）。
    """
    mode = Access.NONE
    visibility = normalize_visibility(record.get("visibility"))
    owner_id = (record.get("owner_id") or "") or None

    # ② 公开与不公开列表都给读。两者的差别在**列表查询**里体现（见 visible_filter），
    #    不在这里——能拿到 record 说明已经知道 id 了。
    if visibility in (Visibility.PUBLIC, Visibility.UNLISTED):
        mode = Access.READ
    # 存量应用（没有 owner_id、没有 visibility）保持可读，避免应用中心突然空掉
    elif owner_id is None and not record.get("visibility"):
        mode = Access.READ

    viewer_id = _viewer_id(viewer)
    # ③ 匿名：到此为止。停用的账号同理（optional_user 已经把它们变成 None）
    if viewer_id is None:
        return mode

    # ④ 超管：包括处理无主的存量数据
    if _is_super(viewer):
        return Access.OWNER

    # ⑤ 所有者
    if owner_id is not None and owner_id == viewer_id:
        return Access.OWNER

    # ⑥ 显式授权
    if grant_lookup is not None:
        try:
            granted = grant_lookup(str(record.get("id") or ""), viewer_id)
        except Exception:  # noqa: BLE001 — 授权表查不到时按"没有额外授权"处理
            granted = Access.NONE
        if granted and int(granted) > int(mode):
            mode = Access(int(granted))

    return mode


# ────────────────────────── 动作 → 所需级别 ──────────────────────────
#
# 加新动作时只在这里补一行，不需要动判定逻辑。这正是阶梯模型相对权限矩阵的好处。

REQUIRED: dict[str, Access] = {
    "view": Access.READ,        # 打开应用、看缩略图
    "fork": Access.READ,        # 能看就能 Fork（Gitea 同款：可读即可 Fork）
    "drive": Access.WRITE,      # 继续推演（会改这个应用的状态）
    "rename": Access.WRITE,
    "revise": Access.WRITE,     # 出新版本
    "set_visibility": Access.OWNER,
    "grant": Access.OWNER,      # 把权限分给别人
    "delete": Access.OWNER,
}


def can(action: str, record: dict[str, Any], viewer: Any = None, **kw: Any) -> bool:
    """能不能对这条记录做这个动作。

    未知动作**一律拒绝**——拼错动作名的后果必须是"做不了"，不能是"畅通无阻"。
    """
    need = REQUIRED.get(action)
    if need is None:
        return False
    return access_for(record, viewer, **kw) >= need


def require(action: str, record: dict[str, Any], viewer: Any = None, **kw: Any) -> None:
    """不满足就抛 HTTPException。

    404 vs 403 的取舍：**看不见的资源报 404**，而不是 403。报 403 等于确认
    "这个 id 确实存在"，可以被用来枚举别人的私有应用。能看见但权限不够才报 403。
    """
    from fastapi import HTTPException

    level = access_for(record, viewer, **kw)
    need = REQUIRED.get(action)
    if need is None:
        raise HTTPException(status_code=403, detail="不支持的操作")
    if level >= need:
        return
    if level < Access.READ:
        raise HTTPException(status_code=404, detail="应用不存在")
    if _viewer_id(viewer) is None:
        raise HTTPException(status_code=401, detail="请先登录", headers={"WWW-Authenticate": "Bearer"})
    raise HTTPException(status_code=403, detail="没有权限执行该操作")


# ────────────────────────── Fork ──────────────────────────


def fork_visibility(source_record: dict[str, Any]) -> str:
    """Fork 出来的应用用什么可见性。

    **私有只能继承、不能因为 Fork 就降级**（Gitea services/repository/fork.go:97
    同款）。这条很容易做反：Fork 产出的是一条新记录、新所有者，写成默认公开非常
    自然，而那样 Fork 就成了绕过私有的后门——任何能读到私有应用的人（比如被授权
    的协作者）Fork 一下就把它公开了。

    unlisted 同理不升级为 public。public 的 Fork 保持 public。
    """
    source = normalize_visibility(source_record.get("visibility"))
    if source == Visibility.PRIVATE:
        return Visibility.PRIVATE
    if source == Visibility.UNLISTED:
        return Visibility.UNLISTED
    return Visibility.PUBLIC


# ────────────────────────── 列表过滤 ──────────────────────────


def visible_filter(viewer: Any = None) -> dict[str, Any]:
    """应用中心列表应该看到哪些。返回一个描述，由存储层翻译成各自的 SQL/谓词。

    三条规则：
      · 匿名：只有 public（**unlisted 不进列表**——这正是它与 public 的唯一区别）
      · 登录用户：public + 自己的（任何可见性）+ 被显式授权的
      · 超管：全部

    ⚠️ 列表过滤和单条判定是**两套代码**，很容易漂移（列表漏过滤 = 私有应用出现在
    广场上）。所以 `filter_records` 用 `access_for` 逐条复核，两套必须给出一致结论，
    有测试盯着这件事。
    """
    if _is_super(viewer):
        return {"scope": "all"}
    viewer_id = _viewer_id(viewer)
    if viewer_id is None:
        return {"scope": "public_only"}
    return {"scope": "public_plus_own", "viewer_id": viewer_id}


def filter_records(
    records: list[dict[str, Any]], viewer: Any = None, *, grant_lookup: GrantLookup = None
) -> list[dict[str, Any]]:
    """在内存里过滤（JSON/小数据量后端用）。

    实现上直接复用 `access_for`，而不是另写一套条件——列表与单条判定漂移是这类
    系统最常见的泄露方式（列表少过滤一个条件，私有应用就出现在广场上）。
    """
    out = []
    for rec in records:
        if access_for(rec, viewer, grant_lookup=grant_lookup) < Access.READ:
            continue
        # unlisted 能直接打开但**不进列表**——这是它与 public 的唯一区别
        if normalize_visibility(rec.get("visibility")) == Visibility.UNLISTED:
            vid = _viewer_id(viewer)
            owned = vid is not None and (rec.get("owner_id") or None) == vid
            if not (_is_super(viewer) or owned):
                continue
        out.append(rec)
    return out
