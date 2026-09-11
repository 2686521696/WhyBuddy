from services.project_runtime import ProjectRuntimeService
from services.project_store import ProjectStore
from services.workspace_provider import ProcessResult, WorkspaceHandle


class Provider:
    def __init__(self):
        self.destroyed = False

    def create(self, **kwargs):
        return WorkspaceHandle("ws-prj", "sb-1")

    def write_files(self, handle, files):
        self.files = files

    def run(self, handle, command, **kwargs):
        return ProcessResult("42", exit_code=0)

    def preview_url(self, handle, port):
        return "https://preview.example"

    def stop(self, handle, process_id):
        pass

    def destroy(self, handle):
        self.destroyed = True


def test_start_provisions_revision_and_records_lease(tmp_path):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'runtime.db'}")
    project = store.create_project("session-1", owner_id="alice", files={"package.json": "{}"}, template_version="vite-1", plan_ref="plan-1")
    runtime, preview = ProjectRuntimeService(store, Provider()).start(project.projectId, owner_id="alice", lease_owner="worker")
    assert runtime.status == "ready"
    assert runtime.revision == project.currentRevision
    assert preview.entryUrl == "https://preview.example"
    lease = store.get_lease(project.projectId, owner_id="alice")
    assert lease and lease.sandboxId == "sb-1" and lease.mountedRevision == project.currentRevision
    store.close()
