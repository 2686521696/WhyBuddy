"""Versioned delivery archives from independent evidence, separate from hosting.

The current source/plan and managed acceptance profile are checked on preparation
and on status reads. Historical downloads retain their original evidence and
explicitly report current staleness. A client-supplied closure, a ready preview, or a historical
passed record cannot unlock a current release. Preparing a ZIP does not deploy it.
"""

import io
import json
import zipfile
from datetime import datetime, timezone

from services.project_acceptance import TASK_SUITE_VERSION, acceptance_profile, bound_delivery_profile
from services.project_authority import approved_reference
from services.project_export import source_archive
from services.project_manifest import canonical_json, content_hash
from services.project_source_operations import ProjectSourceOperations
from services.project_store import ProjectConflict, ProjectNotFound
from services.project_verification_gate import (ENVIRONMENT_BLOCK_CODES, validate_build_evidence,
    validate_verification_result)
from services.project_verification_store import ProjectVerificationStore
from services.deliverable_kind import OFFICE_FILE, plan_deliverable_kind
from services.scope_authority import latest_control_plan, plan_execution_authorized


class ProjectDeliveryService:
    def __init__(self, store, owner_id):
        self.store, self.owner_id = store, owner_id
        self.source = ProjectSourceOperations(store, None, owner_id)
        self.records = ProjectVerificationStore(store)
        store._q("create table if not exists wb_project_release (id varchar(80) primary key,project_id varchar(80) not null,idempotency_key varchar(64) not null,created_at varchar(64) not null,payload text not null,unique(project_id,idempotency_key))")

    def _evidence(self, project_id, verification_id=None):
        project, authority = self.source.authority(project_id)
        revision = self.store.get_revision(project_id, owner_id=self.owner_id)
        reasons = []
        if not plan_execution_authorized(authority):
            reasons.append("project_plan_approval_required")
        # ⚠ 2026-09-25 74E9KCWHAB：原来只认任务模板，普通网页这条永远成立。
        bound = bound_delivery_profile(revision.templateVersion, revision.specRevision)
        if bound is None:
            reasons.append("project_acceptance_profile_not_bound")
        snapshot = (self.records.get(verification_id, owner_id=self.owner_id, current_plan_ref=approved_reference(authority))
            if verification_id else self.records.latest(project_id, owner_id=self.owner_id,
                current_plan_ref=approved_reference(authority)))
        if snapshot is None:
            reasons.append("project_verification_required")
        elif snapshot.verification.projectId != project_id:
            raise ProjectNotFound("project_verification_not_found")
        elif (snapshot.verification.revision != revision.revision
                and snapshot.verification.status == "blocked"
                and snapshot.verification.errorCode in ENVIRONMENT_BLOCK_CODES):
            # ⚠ 2026-09-27 隔离真机第 58 轮（喝水记录 + 紫色 + 撤销）：最近一次验收是旧版本、
            #   而且是环境挡住的（验收浏览器拿不到访问票）。下面那支说「当前版本没验过」
            #   会触发续跑叫模型去验收；可那次验收的 errorHint 明说「重复验收都解决不了」，
            #   模型照做不验，只把收尾原话又说一遍——用户看见两段一样的话。宿主给的两句
            #   话打架。环境问题不随版本变：照实报环境挡住，不续跑。
            reasons.append("project_verification_environment_blocked")
        elif snapshot.verification.revision != revision.revision:
            # ⚠ 2026-09-27 隔离真机第 36 轮（习惯打卡网页 + 追问加「导出 CSV」）：
            #   改完代码没重新验收，最近那条验收是旧版本的。原来落进下面「没通过」
            #   那一支，续跑提示写「当前版本的独立浏览器验收没有通过」——模型记得上
            #   一次是环境问题，读成「又是环境」，一个工具没调，把收尾原话又说了一遍，
            #   用户看见两段几乎一样的总结。当前版本根本没验过，就说没验过。
            reasons.append("project_verification_required")
        elif (snapshot.effectiveStatus == "blocked"
                and snapshot.verification.errorCode in ENVIRONMENT_BLOCK_CODES):
            # 验收没跑起来，不是没通过（见 ENVIRONMENT_BLOCK_CODES）。
            reasons.append("project_verification_environment_blocked")
        elif (snapshot.effectiveStatus != "passed" or bound is None
                or snapshot.verification.suiteVersion != bound[1]):
            reasons.append("project_current_business_verification_required")
        else:
            record = snapshot.verification
            files = self.store.read_files(project_id, revision.revision, owner_id=self.owner_id)
            try:
                build = validate_build_evidence(record.build, revision=revision.revision, tree_hash=revision.treeHash,
                    lockfile_hash=content_hash(files.get("package-lock.json", "")), suite_version=record.suiteVersion)
                validate_verification_result(record.status, record.assertions, artifact_count=len(record.artifactRefs),
                    suite_version=record.suiteVersion, error_code=record.errorCode, build=build)
            except ValueError:
                reasons.append("project_verification_evidence_incomplete")
        return project, authority, revision, snapshot, reasons

    def _profile(self, revision):
        bound = bound_delivery_profile(revision.templateVersion, revision.specRevision)
        return bound or (None, TASK_SUITE_VERSION)

    def status(self, project_id):
        project, _authority, revision, snapshot, reasons = self._evidence(project_id)
        extras = snapshot.verification.acceptanceRequirements if snapshot else []
        rows = self.store._q("select payload from wb_project_release where project_id=$1 order by created_at desc,id desc limit 20", [project_id])
        releases = []
        for row in rows:
            saved = json.loads(row["payload"])
            saved["effectiveStatus"] = "ready" if not reasons and saved["revision"] == revision.revision and snapshot and saved["verificationId"] == snapshot.verification.verificationId else "stale"
            releases.append(saved)
        return {"projectId": project.projectId, "revision": revision.revision, "eligible": not reasons,
            "profile": acceptance_profile(extras, self._profile(revision)[1]), "blockedReasons": reasons,
            "verificationId": snapshot.verification.verificationId if snapshot else None,
            "releases": releases, "deployment": {"status": "not_configured", "publicUrl": None}}

    def publication(self, project_id):
        """发布到应用市场要的东西：钉住的那一版、标题、验收截图。没通过当前版本的交付验收就不许发（fail-closed）。

        ⚠ 2026-10-01 用户审查应用市场：新流程做出来的网页工程从来上不了架——结果卡上的「发布」一直是
          disabled「发布通道尚未接通」，市场里只有老 HTML 推演的 24 个。发布的是**这一版**：别人在市场里看到的
          截图、复刻拿到的源码都钉在通过验收的这个 revision 上，作者之后再改不会悄悄换掉已发布的东西。
          办公文件不是应用（用户定的口径：应用 / 文件分标签），不走这里。
        截图是增强：取不到照发，卡片没封面而已（§七）；验收没过是缺证据，不许发（§七 fail-closed）。
        """
        project, authority, revision, snapshot, reasons = self._evidence(project_id)
        if plan_deliverable_kind(latest_control_plan(authority)) == OFFICE_FILE:
            raise ValueError("project_publish_office_file_is_not_an_app")
        if reasons:
            raise ProjectConflict("project_publish_requires_delivery:" + ",".join(reasons))
        screenshot = None
        for ref in snapshot.verification.artifactRefs[:1]:
            try:
                screenshot = self.records.read_artifact(snapshot.verification.verificationId, ref.artifactId,
                                                        owner_id=self.owner_id)
            except Exception:  # noqa: BLE001 — 封面是增强项
                screenshot = None
        title = str((authority.goal or {}).get("text") or "").strip() or "网页应用"
        return {"projectId": project.projectId, "sessionId": project.sessionId, "revision": revision.revision,
                "templateVersion": revision.templateVersion, "title": title[:2000], "screenshot": screenshot}

    def prepare(self, project_id, *, expected_revision, verification_id, idempotency_key):
        project, authority, revision, snapshot, reasons = self._evidence(project_id, verification_id)
        if revision.revision != expected_revision:
            raise ProjectConflict("project_revision_conflict")
        if reasons or snapshot is None:
            raise ProjectConflict(reasons[0] if reasons else "project_verification_required")
        key = content_hash(idempotency_key)
        release_id = "prel-" + content_hash(canonical_json([project_id, key]))[:40]
        evidence = snapshot.verification
        value = {"releaseId": release_id, "projectId": project_id, "revision": revision.revision,
            "treeHash": revision.treeHash, "verificationId": verification_id,
            "profileId": self._profile(revision)[0], "planRef": approved_reference(authority),
            "lockfileHash": evidence.build.lockfileHash, "buildHash": evidence.build.outputHash,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "downloadPath": f"/api/sliderule/projects/{project_id}/releases/{release_id}/download",
            "deployed": False}
        # Publishing this small immutable index does not own a remote execution.
        # Source CAS is checked in the INSERT; historical receipts stay historical.
        self.store._q("insert into wb_project_release(id,project_id,idempotency_key,created_at,payload) "
            "select $1,$2,$3,$4,$5 where exists(select 1 from wb_project where id=$2 and owner_id=$6 and current_revision=$7) "
            "on conflict(project_id,idempotency_key) do nothing",
            [release_id, project_id, key, value["createdAt"], canonical_json(value), self.owner_id, revision.revision])
        rows = self.store._q("select payload from wb_project_release where id=$1 and project_id=$2", [release_id, project_id])
        if not rows:
            raise ProjectConflict("project_revision_conflict")
        actual = json.loads(rows[0]["payload"])
        if any(actual[name] != value[name] for name in ("revision", "verificationId", "profileId", "planRef")):
            raise ProjectConflict("project_idempotency_conflict")
        # A concurrent authority change can leave a historical record, but it
        # cannot be returned as a currently eligible delivery.
        _p, _a, after, _s, reasons = self._evidence(project_id, verification_id)
        if reasons or after.revision != expected_revision:
            raise ProjectConflict("project_delivery_authority_changed")
        return actual

    def download(self, project_id, release_id):
        self.source.authority(project_id)
        rows = self.store._q("select payload from wb_project_release where id=$1 and project_id=$2", [release_id, project_id])
        if not rows:
            raise ProjectNotFound("project_release_not_found")
        release = json.loads(rows[0]["payload"])
        saved = self.store.get_revision(project_id, release["revision"], owner_id=self.owner_id)
        files = self.store.read_files(project_id, saved.revision, owner_id=self.owner_id)
        record = self.records.get(release["verificationId"], owner_id=self.owner_id).verification
        project, _authority, _revision, current, reasons = self._evidence(project_id, release["verificationId"])
        effective_status = "ready" if (not reasons and project.currentRevision == release["revision"]
            and current and current.effectiveStatus == "passed") else "stale"
        data = io.BytesIO(source_archive(files, saved))
        with zipfile.ZipFile(data, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("delivery.json", canonical_json({**release, "profile": acceptance_profile(),
                "verification": record.model_dump(mode="json"), "hostingConfigured": False,
                "currentRevision": project.currentRevision, "effectiveStatus": effective_status,
                "blockedReasons": reasons}))
            archive.writestr("deployment/Dockerfile", "FROM node:22-bookworm-slim\nWORKDIR /app\nCOPY . .\nRUN npm ci --ignore-scripts && npm run build\nENV NODE_ENV=production\nENV WHYBUDDY_APP_DATA_DIR=/data\nEXPOSE 5173\nCMD [\"npm\",\"start\",\"--\",\"--host\",\"0.0.0.0\",\"--port\",\"5173\",\"--static-dir\",\"dist\"]\n")
            archive.writestr("DEPLOYING.md", "# Deploying the task application\n\nBuild deployment/Dockerfile and mount a persistent volume at /data. Configure TLS and an independent domain before public use. Create the application administrator privately before opening public access. Keep database backups outside the container. This archive has not been deployed.\n\nExample: docker build -f deployment/Dockerfile -t whybuddy-task source\n\nRun: docker run --rm -p 127.0.0.1:5173:5173 -v whybuddy-task-data:/data whybuddy-task\n")
        return data.getvalue()
