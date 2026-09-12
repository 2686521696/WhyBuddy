"""Fixed-suite browser evidence is narrower than product delivery acceptance.

Only the trusted verifier produces these assertions. A document saying passed,
an exit code or a screenshot alone cannot satisfy the suite. Preserve historic
outcomes; project-head and specification changes make their current view stale.
"""
from models.project_runtime import VerificationAssertion, VerificationRecord, VerificationSnapshot

SUITE_VERSION = "react-vite-counter@1"
RUNNER_VERSION = "whybuddy-browser-v1:pw1.61.1"
REQUIRED_ASSERTIONS = frozenset({"heading_visible", "counter_initial", "counter_increment",
    "counter_second_increment", "reload_reset", "no_page_errors", "no_failed_requests"})


def validate_verification_result(status: str, assertions: list, *, artifact_count: int,
                                 suite_version: str, error_code: str | None = None) -> list[VerificationAssertion]:
    if suite_version != SUITE_VERSION:
        raise ValueError("verification_suite_unsupported")
    if status not in {"passed", "failed", "blocked", "cancelled"}:
        raise ValueError("verification_status_invalid")
    if not isinstance(assertions, list) or len(assertions) > 64:
        raise ValueError("verification_assertions_invalid")
    checked = [item if isinstance(item, VerificationAssertion) else VerificationAssertion.model_validate(item) for item in assertions]
    names = [item.id for item in checked]
    if len(names) != len(set(names)) or any(name not in REQUIRED_ASSERTIONS for name in names):
        raise ValueError("verification_assertions_invalid")
    if error_code is not None and (not isinstance(error_code, str) or not 1 <= len(error_code) <= 240):
        raise ValueError("verification_error_invalid")
    if status == "passed" and (set(names) != REQUIRED_ASSERTIONS or not all(item.status == "passed" for item in checked)
                               or artifact_count < 1 or error_code is not None):
        raise ValueError("verification_evidence_incomplete")
    if status == "failed" and not any(item.status == "failed" for item in checked):
        raise ValueError("verification_failure_evidence_required")
    if status in {"blocked", "cancelled"} and not error_code:
        raise ValueError("verification_error_required")
    return checked


def verification_snapshot(record: VerificationRecord, *, revision: str, tree_hash: str,
                          spec_revision: str | None, plan_ref: str | None) -> VerificationSnapshot:
    stale = (record.revision != revision or record.treeHash != tree_hash
             or record.specRevision != spec_revision or record.planRef != plan_ref
             or record.suiteVersion != SUITE_VERSION or record.runnerVersion != RUNNER_VERSION)
    return VerificationSnapshot(verification=record, effectiveStatus="stale" if stale else record.status)
