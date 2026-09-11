from types import SimpleNamespace

from services.project_store import ProjectStore
from services.workspace_provider import ProcessResult, WorkspaceHandle
from routes import project_runtime as route


class Provider:
    def __init__(self): self.commands = []
    def create(self, **kwargs): return WorkspaceHandle("ws", "sb")
    def write_files(self, handle, files): pass
    def run(self, handle, command, **kwargs): self.commands.append(command); return ProcessResult("p", exit_code=0)
    def preview_url(self, handle, port): return "https://preview.test"
    def stop(self, handle, process_id): pass
    def destroy(self, handle): pass


def test_start_route_uses_authenticated_owner_and_fixed_commands(tmp_path, monkeypatch):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'route.db'}")
    project = store.create_project("s1", owner_id="u1", files={"package.json": "{}"}, template_version="vite-1", plan_ref="plan")
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    provider = Provider()
    monkeypatch.setattr(route, "E2BWorkspaceProvider", lambda: provider)
    result = route.start_project_runtime(project.projectId, route.StartRuntimeRequest(), SimpleNamespace(id="u1"))
    assert result["preview"]["entryUrl"] == "https://preview.test"
    assert provider.commands == ["npm install --ignore-scripts", "nohup npm run dev -- --host 0.0.0.0 >/tmp/whybuddy-runtime.log 2>&1 & echo $!"]
    store.close()
