"""Minimal Blueprint spec-docs proxy endpoint.

This is a contract slice, not the full Blueprint migration. Node still owns
batch orchestration, artifacts, progress events, review, and export.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import zipfile
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException

from config.settings import settings


router = APIRouter(tags=["Blueprint spec-docs proxy"])

SUPPORTED_TYPES = {"requirements", "design", "tasks"}
REVIEW_STATUSES = {"accepted", "rejected", "reviewing"}
PROMPT_ID = "blueprint.spec-documents.v1"
ARTIFACT_MEMORY_ACTIONS = {"list", "read", "write"}
ARTIFACT_MEMORY_RESOURCES = {"all", "ledger", "events", "replays", "feedback"}


def _auth(key: Optional[str]) -> None:
    if key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid key")


def _digest(payload: Any) -> str:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def _clean_text(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def _safe_slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:64] or "section"


def _safe_filename_segment(text: str) -> str:
    segment = re.sub(r"[^A-Za-z0-9._-]+", "-", str(text or "").strip()).strip("-._")
    return segment[:96] or "spec"


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def _events(job: dict[str, Any]) -> list[Any]:
    events = job.get("events")
    return events if isinstance(events, list) else []


def _artifacts(job: dict[str, Any]) -> list[Any]:
    artifacts = job.get("artifacts")
    return artifacts if isinstance(artifacts, list) else []


def _find_spec_document(job: dict[str, Any], document_id: str) -> Optional[dict[str, Any]]:
    for artifact in _artifacts(job):
        if not _is_record(artifact) or artifact.get("type") not in SUPPORTED_TYPES:
            continue
        payload = artifact.get("payload")
        if _is_record(payload) and payload.get("id") == document_id:
            return payload
    return None


def _replace_spec_document_artifact(job: dict[str, Any], document: dict[str, Any]) -> list[Any]:
    replaced = []
    for artifact in _artifacts(job):
        payload = artifact.get("payload") if _is_record(artifact) else None
        if (
            _is_record(artifact)
            and _is_record(payload)
            and artifact.get("type") == document.get("type")
            and (
                payload.get("id") == document.get("id")
                or (
                    payload.get("nodeId") == document.get("nodeId")
                    and payload.get("sourceDocumentId") == document.get("sourceDocumentId")
                )
            )
        ):
            replaced.append({**artifact, "payload": document})
        else:
            replaced.append(artifact)
    return replaced


def _generation_event(job_id: str, document: dict[str, Any], status: str, occurred_at: str) -> dict[str, Any]:
    event_payload = {
        "documentId": document.get("id"),
        "sourceDocumentId": document.get("sourceDocumentId") or document.get("id"),
        "version": document.get("version") or 1,
        "status": status,
    }
    event_id = "blueprint-event-" + _digest(
        {"jobId": job_id, "documentId": document.get("id"), "status": status, "at": occurred_at}
    ).split(":", 1)[1][:12]
    return {
        "id": event_id,
        "jobId": job_id,
        "type": "job.stage",
        "family": "job",
        "stage": "spec_docs",
        "status": "reviewing",
        "message": f"Marked SPEC document {document.get('title') or document.get('id')} as {status}.",
        "occurredAt": occurred_at,
        "payload": event_payload,
    }


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _find_item(items: list[Any], item_id: Any) -> Any:
    if not isinstance(item_id, str) or not item_id:
        return None
    for item in items:
        if isinstance(item, dict) and item.get("id") == item_id:
            return item
    return None


def _build_markdown(doc_type: str, node_title: str, node_summary: str, target_text: str) -> tuple[str, str, str]:
    label = {
        "requirements": "Requirements",
        "design": "Design",
        "tasks": "Tasks",
    }[doc_type]
    title = f"{label}: {node_title}"
    summary = f"{label} document for {node_title}."
    body_sections = [
        (
            "Context",
            f"- Target: {target_text}\n- Node: {node_title}\n- Summary: {node_summary}",
        ),
        (
            "Acceptance",
            f"- The {doc_type} document stays grounded in the requested Blueprint node.\n"
            "- Node remains owned by the Node Blueprint pipeline for artifacts and events.",
        ),
    ]
    content = f"# {title}\n\n{summary}\n\n"
    for section_title, body in body_sections:
        content += f"## {section_title}\n\n{body}\n\n"
    return title, summary, content.rstrip() + "\n"


def _export_single(
    documents: list[dict[str, Any]],
    job_id: str,
    node_id: str,
    doc_type: str,
) -> dict[str, Any]:
    matching = next(
        (doc for doc in documents if doc.get("nodeId") == node_id and doc.get("type") == doc_type),
        None,
    )
    if matching is None:
        return {
            "kind": "not_found",
            "message": "spec document not found",
            "details": {"jobId": job_id, "nodeId": node_id, "type": doc_type},
        }

    provenance = matching.get("provenance") if _is_record(matching.get("provenance")) else {}
    base_name = _safe_filename_segment(provenance.get("nodeTitle") or matching.get("title") or node_id)
    return {
        "kind": "ok",
        "archive": {
            "contentType": "text/markdown; charset=utf-8",
            "filename": f"{base_name}-{doc_type}.md",
            "body": str(matching.get("content") or ""),
            "encoding": "utf8",
        },
    }


def _zip_response(filename: str, files: dict[str, str], manifest: dict[str, Any]) -> dict[str, Any]:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_name, content in files.items():
            archive.writestr(file_name, content)
        archive.writestr("MANIFEST.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return {
        "kind": "ok",
        "archive": {
            "contentType": "application/zip",
            "filename": filename,
            "body": base64.b64encode(buffer.getvalue()).decode("ascii"),
            "encoding": "base64",
        },
    }


def _export_node(
    documents: list[dict[str, Any]],
    job_id: str,
    node_id: str,
    exported_at: str,
) -> dict[str, Any]:
    node_docs = [doc for doc in documents if doc.get("nodeId") == node_id]
    if not node_docs:
        return {
            "kind": "not_found",
            "message": "no spec documents to export",
            "details": {"jobId": job_id, "nodeId": node_id},
        }

    provenance = node_docs[0].get("provenance") if _is_record(node_docs[0].get("provenance")) else {}
    node_title = str(provenance.get("nodeTitle") or node_id)
    segment = _safe_filename_segment(node_title)
    files = {f"{segment}/{doc.get('type')}.md": str(doc.get("content") or "") for doc in node_docs}
    manifest = {
        "jobId": job_id,
        "exportedAt": exported_at,
        "granularity": "node",
        "nodeIds": [node_id],
        "documents": [
            {
                "nodeId": node_id,
                "nodeTitle": node_title,
                "type": doc.get("type"),
                "filename": f"{segment}/{doc.get('type')}.md",
                "generationSource": (
                    doc.get("provenance", {}).get("generationSource")
                    if _is_record(doc.get("provenance"))
                    else "template"
                )
                or "template",
            }
            for doc in node_docs
        ],
    }
    return _zip_response(f"{segment}-spec.zip", files, manifest)


def _export_tree(
    documents: list[dict[str, Any]],
    job: dict[str, Any],
    job_id: str,
    exported_at: str,
) -> dict[str, Any]:
    if not documents:
        return {
            "kind": "not_found",
            "message": "no spec documents to export",
            "details": {"jobId": job_id},
        }

    files: dict[str, str] = {}
    manifest_documents = []
    node_ids: list[str] = []
    for doc in documents:
        provenance = doc.get("provenance") if _is_record(doc.get("provenance")) else {}
        node_id = str(doc.get("nodeId") or "node")
        node_title = str(provenance.get("nodeTitle") or node_id)
        segment = _safe_filename_segment(node_title)
        filename = f"{segment}/{doc.get('type')}.md"
        files[filename] = str(doc.get("content") or "")
        if node_id not in node_ids:
            node_ids.append(node_id)
        manifest_documents.append(
            {
                "nodeId": node_id,
                "nodeTitle": node_title,
                "type": doc.get("type"),
                "filename": filename,
                "generationSource": provenance.get("generationSource") or "template",
            }
        )

    root_title = "blueprint-spec"
    for artifact in _artifacts(job):
        payload = artifact.get("payload") if _is_record(artifact) else None
        if artifact.get("type") != "spec_tree" or not _is_record(payload):
            continue
        root_id = payload.get("rootNodeId")
        nodes = payload.get("nodes")
        if isinstance(nodes, list):
            root = next((node for node in nodes if _is_record(node) and node.get("id") == root_id), None)
            if root:
                root_title = str(root.get("title") or root_title)
        break

    manifest = {
        "jobId": job_id,
        "exportedAt": exported_at,
        "granularity": "tree",
        "nodeIds": node_ids,
        "documents": manifest_documents,
    }
    return _zip_response(f"{_safe_filename_segment(root_title)}-spec.zip", files, manifest)


def _export_documents(payload: dict[str, Any]) -> dict[str, Any]:
    request = payload.get("request") if _is_record(payload.get("request")) else {}
    job_id = _clean_text(request.get("jobId"), _clean_text(payload.get("jobId"), ""))
    granularity = request.get("granularity")
    if granularity not in {"single", "node", "tree"}:
        return {"kind": "invalid_request", "message": "granularity must be one of single, node, tree"}

    node_id = request.get("nodeId")
    doc_type = request.get("type")
    if granularity == "single" and (not _clean_text(node_id, "") or doc_type not in SUPPORTED_TYPES):
        return {"kind": "invalid_request", "message": "single export requires nodeId and type"}
    if granularity == "node" and not _clean_text(node_id, ""):
        return {"kind": "invalid_request", "message": "node export requires nodeId"}

    job = payload.get("job") if _is_record(payload.get("job")) else None
    if job is None:
        return {"kind": "not_found", "message": "blueprint job not found", "details": {"jobId": job_id}}

    raw_documents = payload.get("documents")
    documents = [doc for doc in raw_documents if _is_record(doc)] if isinstance(raw_documents, list) else []
    exported_at = _clean_text(payload.get("now"), "1970-01-01T00:00:00.000Z")

    if granularity == "single":
        return _export_single(documents, job_id, str(node_id), str(doc_type))
    if granularity == "node":
        return _export_node(documents, job_id, str(node_id), exported_at)
    return _export_tree(documents, job, job_id, exported_at)


def _generate_one_document(payload: dict[str, Any]) -> dict[str, Any]:
    doc_type = _clean_text(payload.get("targetDocumentType"), "")
    if doc_type not in SUPPORTED_TYPES:
        raise HTTPException(400, "targetDocumentType must be requirements, design, or tasks")

    node = payload.get("specTreeNode")
    if not isinstance(node, dict):
        raise HTTPException(400, "specTreeNode is required")
    request = payload.get("request") if isinstance(payload.get("request"), dict) else {}

    node_title = _clean_text(node.get("title"), "Untitled node")
    node_summary = _clean_text(node.get("summary"), "No summary provided")
    target_text = _clean_text(request.get("targetText"), "No target text provided")

    title, summary, content = _build_markdown(doc_type, node_title, node_summary, target_text)
    fingerprint_payload = {
        "promptId": PROMPT_ID,
        "targetDocumentType": doc_type,
        "nodeId": node.get("id"),
        "nodeTitle": node_title,
        "targetText": target_text,
        "sectionSeed": _safe_slug(node_title),
    }

    return {
        "generationSource": "llm",
        "title": title,
        "summary": summary,
        "content": content,
        "status": "draft",
        "promptId": PROMPT_ID,
        "model": "python-blueprint-spec-docs-contract",
        "promptFingerprint": _digest(fingerprint_payload),
        "responseDigest": _digest({"title": title, "summary": summary, "content": content}),
    }


@router.post("/generate-one")
async def generate_one(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return _generate_one_document(payload)


@router.post("/generate-batch")
async def generate_batch(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)

    items = payload.get("items")
    if not isinstance(items, list) or len(items) == 0:
        raise HTTPException(400, "items must be a non-empty array")

    results: list[dict[str, Any]] = []
    success_count = 0
    for item in items:
        if not isinstance(item, dict):
            results.append(
                {
                    "ok": False,
                    "nodeId": None,
                    "targetDocumentType": None,
                    "error": "item must be an object",
                }
            )
            continue

        node = item.get("specTreeNode") if isinstance(item.get("specTreeNode"), dict) else {}
        node_id = node.get("id")
        doc_type = item.get("targetDocumentType")
        try:
            document = _generate_one_document(item)
        except HTTPException as exc:
            results.append(
                {
                    "ok": False,
                    "nodeId": node_id if isinstance(node_id, str) else None,
                    "targetDocumentType": doc_type if isinstance(doc_type, str) else None,
                    "error": str(exc.detail),
                }
            )
            continue

        success_count += 1
        results.append(
            {
                "ok": True,
                "nodeId": node_id if isinstance(node_id, str) else None,
                "targetDocumentType": document.get("targetDocumentType", doc_type)
                if isinstance(doc_type, str)
                else None,
                "document": document,
            }
        )

    if success_count == len(results):
        overall_source = "llm"
    elif success_count == 0:
        overall_source = "template"
    else:
        overall_source = "partial"

    return {
        "jobId": payload.get("jobId"),
        "overallSource": overall_source,
        "results": results,
    }


@router.post("/artifact-memory/contract")
async def artifact_memory_contract(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)

    job_id = _clean_text(payload.get("jobId"), "")
    if not job_id:
        raise HTTPException(400, {"error": "jobId_required"})

    action = _clean_text(payload.get("action"), "list")
    if action not in ARTIFACT_MEMORY_ACTIONS:
        raise HTTPException(
            400,
            {
                "error": "invalid_action",
                "allowedActions": sorted(ARTIFACT_MEMORY_ACTIONS),
            },
        )

    resource = _clean_text(payload.get("resource"), "all")
    if resource not in ARTIFACT_MEMORY_RESOURCES:
        raise HTTPException(
            400,
            {
                "error": "invalid_resource",
                "allowedResources": sorted(ARTIFACT_MEMORY_RESOURCES),
            },
        )

    ledger = _as_list(payload.get("ledger"))
    events = _as_list(payload.get("events"))
    replays = _as_list(payload.get("replays"))
    feedback = _as_list(payload.get("feedback"))
    response: dict[str, Any] = {
        "jobId": job_id,
        "action": action,
        "resource": resource,
        "source": "node-artifact-store",
        "persistenceOwner": "node",
        "ledger": ledger,
        "events": events,
        "replays": replays,
        "feedback": feedback,
        "counts": {
            "ledger": len(ledger),
            "events": len(events),
            "replays": len(replays),
            "feedback": len(feedback),
        },
    }

    if action == "read":
        resource_items = {
            "ledger": ledger,
            "events": events,
            "replays": replays,
            "feedback": feedback,
            "all": ledger + events + replays + feedback,
        }[resource]
        item = _find_item(resource_items, payload.get("itemId"))
        response["item"] = item
        response["found"] = item is not None

    if action == "write":
        request = payload.get("request")
        response["request"] = request if isinstance(request, dict) else {}
        response["writeAccepted"] = True

    return response


@router.post("/review")
async def review_document(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)

    job = payload.get("job")
    spec_tree = payload.get("specTree")
    request = payload.get("request")
    document_id = _clean_text(payload.get("documentId"), "")
    if not _is_record(job):
        raise HTTPException(400, "job is required")
    if not _is_record(spec_tree):
        raise HTTPException(400, "specTree is required")
    if not _is_record(request):
        raise HTTPException(400, "request is required")
    if not document_id:
        raise HTTPException(400, "documentId is required")

    status = request.get("status")
    if status not in REVIEW_STATUSES:
        raise HTTPException(400, "status must be accepted, rejected, or reviewing")

    document = _find_spec_document(job, document_id)
    job_id = _clean_text(job.get("id"), _clean_text(payload.get("jobId"), ""))
    if document is None:
        return {
            "ok": False,
            "status": 404,
            "error": "Blueprint SPEC document not found.",
            "message": f"No SPEC document {document_id} exists in job {job_id}.",
        }

    reviewed_at = _clean_text(payload.get("now"), "1970-01-01T00:00:00.000Z")
    updated_document = {
        **document,
        "sourceDocumentId": document.get("sourceDocumentId") or document.get("id"),
        "status": status,
        "updatedAt": reviewed_at,
        "reviewedAt": reviewed_at,
    }
    if status == "accepted":
        updated_document["acceptedAt"] = reviewed_at
        updated_document.pop("rejectedAt", None)
    elif status == "rejected":
        updated_document["rejectedAt"] = reviewed_at
        updated_document.pop("acceptedAt", None)
    else:
        updated_document.pop("acceptedAt", None)
        updated_document.pop("rejectedAt", None)

    reviewed_by = _clean_text(request.get("reviewedBy"), "")
    review_note = _clean_text(request.get("reviewNote"), "")
    if reviewed_by:
        updated_document["reviewedBy"] = reviewed_by
    else:
        updated_document.pop("reviewedBy", None)
    if review_note:
        updated_document["reviewNote"] = review_note
    else:
        updated_document.pop("reviewNote", None)

    updated_job = {
        **job,
        "status": "reviewing",
        "stage": "spec_docs",
        "updatedAt": reviewed_at,
        "artifacts": _replace_spec_document_artifact(job, updated_document),
        "events": _events(job) + [_generation_event(job_id, updated_document, str(status), reviewed_at)],
    }
    return {"job": updated_job, "specTree": spec_tree, "document": updated_document}


@router.post("/export")
async def export_documents(payload: dict[str, Any], x_internal_key: Optional[str] = Header(None)):
    _auth(x_internal_key)
    return _export_documents(payload)
