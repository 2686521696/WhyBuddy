"""Explicit identity fixture for tests focused on execution/session contracts.

Account revocation tests use actual SQL identities and signed HTTP requests in
test_project_composition_authority. This fixture replaces only identity lookup;
the production capability check and every worker/preview call site still run.
"""
from types import SimpleNamespace

import pytest

from services import project_actor_access, project_access
from services.identity_store import User


@pytest.fixture
def project_actor(monkeypatch):
    users = {}
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setattr(project_access.settings, "NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr(project_actor_access, "get_identity_store",
        lambda: SimpleNamespace(get_by_id_for_auth=lambda owner: users.get(owner)))
    def register(owner):
        user = User(id=owner, is_active=True, is_superuser=True, is_verified=True)
        users[owner] = user
        return user
    return register
