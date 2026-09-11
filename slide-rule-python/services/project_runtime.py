"""Application runtime orchestration over ProjectStore and a workspace provider."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from models.project_runtime import PreviewDescriptor, RuntimeInstance
from services.project_store import ProjectStore
from services.workspace_provider import WorkspaceProvider, WorkspaceProviderError


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProjectRuntimeService:
    """Provision one fixed-template project revision in a leased workspace.

    Authorization and revision checks remain in ProjectStore. This service only
    coordinates provider side effects and records the resulting lease metadata.
    """

    def __init__(self, store: ProjectStore, provider: WorkspaceProvider):
        self.store = store
        self.provider = provider

    def start(self, project_id: str, *, owner_id: str, lease_owner: str,
              port: int = 5173, install_command: str = "npm install --ignore-scripts",
              start_command: str = "npm run dev -- --host 0.0.0.0") -> tuple[RuntimeInstance, PreviewDescriptor]:
        project = self.store.get_project(project_id, owner_id=owner_id)
        revision = self.store.get_revision(project_id, owner_id=owner_id)
        lease = self.store.acquire_lease(project_id, owner_id=owner_id, lease_owner=lease_owner)
        handle = None
        try:
            handle = self.provider.create(workspace_id=lease.workspaceId)
            self.provider.write_files(handle, self.store.read_files(project_id, revision.revision, owner_id=owner_id))
            installed = self.provider.run(handle, install_command, timeout_seconds=600)
            if installed.exit_code not in (None, 0):
                raise WorkspaceProviderError("project_dependency_install_failed")
            # Keep the server process alive remotely; the provider still returns
            # a concrete process identifier for cancellation and fencing.
            started = self.provider.run(handle, "nohup " + start_command + " >/tmp/whybuddy-runtime.log 2>&1 & echo $!", timeout_seconds=30)
            preview_url = self.provider.preview_url(handle, port)
            runtime_id = "rt-" + uuid.uuid4().hex
            runtime = RuntimeInstance(runtimeId=runtime_id, workspaceId=lease.workspaceId,
                projectId=project.projectId, revision=revision.revision, status="ready", port=port,
                previewUrl=preview_url, processId=started.process_id, health="unknown", lastHeartbeat=_timestamp())
            self.store.renew_lease(project_id, owner_id=owner_id, lease_owner=lease_owner,
                generation=lease.generation, sandbox_id=handle.sandbox_id,
                mounted_revision=revision.revision, process_refs={runtime_id: started.process_id})
            descriptor = PreviewDescriptor(projectId=project.projectId, runtimeId=runtime_id,
                revision=revision.revision, status="ready", entryUrl=preview_url,
                capabilities=["http", "websocket", "refresh"])
            return runtime, descriptor
        except Exception:
            if handle is not None:
                try:
                    self.provider.destroy(handle)
                except Exception:
                    pass
            try:
                self.store.release_lease(project_id, owner_id=owner_id, lease_owner=lease_owner, generation=lease.generation)
            except Exception:
                pass
            raise

