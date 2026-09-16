"""Current account authority shared by control, execution and preview access.

2026-09-13: disabling an owner stopped new authenticated control requests, but
existing preview credentials only checked session ownership and plan approval.
They therefore remained usable after the same account lost project access.
Account state must be read independently of the project revision: source sync
temporarily spans two versions while the runtime owner still holds its lease.
"""

from services.identity_store import get_identity_store
from services.project_access import project_access_enabled


def authorize_project_actor(owner_id: str) -> None:
    try:
        user = get_identity_store().get_by_id_for_auth(owner_id)
    except Exception:
        # Provider/SQL diagnostics can contain connection credentials. A lookup
        # outage cannot keep an old grant valid or expose those diagnostics.
        raise PermissionError("project_actor_unavailable") from None
    if user is None or user.id != owner_id or not user.is_active or not project_access_enabled(user):
        raise PermissionError("project_actor_access_revoked")
