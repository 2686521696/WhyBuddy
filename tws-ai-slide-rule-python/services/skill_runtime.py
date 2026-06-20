"""Injectable runtime boundary for skill.invoke.

This module defines the adapter interface used by the Python SlideRule
executor. It does not discover skills, launch local commands, or call external
services; callers inject an adapter that implements the runtime-specific work.
"""

from dataclasses import dataclass
from typing import Any, Dict, Optional, Protocol

DEFAULT_FAKE_SKILL_RUNTIME_PROVENANCE = "python-fake-skill"
DEFAULT_SKILL_RUNTIME = "fake-skill"


class SkillRuntimeUnavailable(Exception):
    """Raised when the injected skill runtime is unavailable."""


class SkillNotFoundError(Exception):
    """Raised when the runtime does not expose the requested skill."""


class SkillInvalidArgumentsError(Exception):
    """Raised when the runtime rejects the supplied skill arguments."""


class SkillInvokeDeniedError(Exception):
    """Raised when policy denies the requested skill invocation."""


class SkillRuntimeError(Exception):
    """Raised when the runtime fails while invoking a skill."""


@dataclass(frozen=True)
class SkillInvokeRequest:
    skill_id: str
    arguments: Dict[str, Any]
    input: str
    runtime: str = DEFAULT_SKILL_RUNTIME


@dataclass(frozen=True)
class SkillInvokeResult:
    output: str
    response: Any = None
    runtime: Optional[str] = None
    provenance: Optional[str] = None


class SkillRuntimeAdapter(Protocol):
    def invoke(self, request: SkillInvokeRequest) -> SkillInvokeResult:
        ...


SkillRegistry = SkillRuntimeAdapter


@dataclass(frozen=True)
class SkillRuntime:
    adapter: SkillRuntimeAdapter
    runtime: str = DEFAULT_SKILL_RUNTIME
    provenance: Optional[str] = None

    @property
    def registry(self) -> SkillRuntimeAdapter:
        return self.adapter

    def provenance_for(self, runtime: Optional[str] = None) -> str:
        if self.provenance:
            return self.provenance
        runtime_name = runtime or self.runtime
        return f"skill-runtime:{runtime_name}"


_skill_runtime: Optional[SkillRuntime] = None


def set_skill_runtime(runtime: Optional[SkillRuntime]) -> None:
    global _skill_runtime
    _skill_runtime = runtime


def get_skill_runtime() -> Optional[SkillRuntime]:
    return _skill_runtime


def create_skill_runtime(
    *,
    adapter: Optional[SkillRuntimeAdapter] = None,
    registry: Optional[SkillRegistry] = None,
    runtime: str = DEFAULT_SKILL_RUNTIME,
    provenance: Optional[str] = None,
) -> SkillRuntime:
    selected_adapter = adapter or registry
    if selected_adapter is None:
        raise ValueError("skill runtime requires an adapter")

    selected_provenance = provenance
    if selected_provenance is None and adapter is None and registry is not None:
        selected_provenance = DEFAULT_FAKE_SKILL_RUNTIME_PROVENANCE

    return SkillRuntime(
        adapter=selected_adapter,
        runtime=runtime,
        provenance=selected_provenance,
    )
