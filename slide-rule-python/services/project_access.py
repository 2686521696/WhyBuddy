"""Deployment capability gate shared by HTTP and model-tool composition."""

import os

from config.settings import settings


def project_access_enabled(viewer) -> bool:
    admin = viewer.get("is_superuser", False) if isinstance(viewer, dict) else getattr(viewer, "is_superuser", False)
    return bool(viewer and admin
        and settings.NODE_ENV != "production" and os.getenv("NODE_ENV") != "production"
        and os.getenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED") == "1")
