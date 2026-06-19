"""Runtime config boundary tests for the Python SlideRule service."""

import os

from config.settings import Settings


def test_runtime_config_defaults_are_local_and_safe():
    settings = Settings(_env_file=None)

    assert settings.PORT == 9700
    assert settings.SLIDE_RULE_INTERNAL_KEY == "dev-slide-rule-internal"
    assert settings.QDRANT_URL == "http://localhost:6333"
    assert settings.DB_PASSWORD == ""


def test_runtime_config_reads_explicit_env(monkeypatch):
    monkeypatch.setenv("PORT", "9711")
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("SLIDE_RULE_INTERNAL_KEY", "runtime-test-key")
    monkeypatch.setenv("QDRANT_URL", "http://qdrant.test:6333")
    monkeypatch.setenv("QDRANT_API_KEY", "qdrant-test-key")

    settings = Settings(_env_file=None)

    assert settings.PORT == 9711
    assert settings.NODE_ENV == "production"
    assert settings.is_development is False
    assert settings.SLIDE_RULE_INTERNAL_KEY == "runtime-test-key"
    assert settings.QDRANT_URL == "http://qdrant.test:6333"
    assert settings.QDRANT_API_KEY == "qdrant-test-key"


def test_database_url_is_derived_from_runtime_env(monkeypatch):
    monkeypatch.setenv("DB_HOST", "db.test")
    monkeypatch.setenv("DB_PORT", "3307")
    monkeypatch.setenv("DB_NAME", "sliderule_test")
    monkeypatch.setenv("DB_USER", "sliderule")
    monkeypatch.setenv("DB_PASSWORD", "runtime-password")

    settings = Settings(_env_file=None)

    assert settings.DATABASE_URL == (
        "mysql+pymysql://sliderule:runtime-password@db.test:3307/"
        "sliderule_test?charset=utf8mb4"
    )


def test_runtime_settings_ignore_unrelated_node_proxy_env(monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:7890")
    monkeypatch.setenv("NODE_USE_ENV_PROXY", "1")

    settings = Settings(_env_file=None)

    assert settings.PORT == 9700
    assert settings.SLIDE_RULE_INTERNAL_KEY == "dev-slide-rule-internal"
    assert os.environ["NODE_USE_ENV_PROXY"] == "1"
