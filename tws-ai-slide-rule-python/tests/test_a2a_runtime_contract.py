"""Contract tests for the Python-side A2A runtime boundary.

This slice only locks invoke, stream chunk, cancel, and agent-list envelopes.
It must not start CrewAI, LangGraph, Claude, external HTTP agents, or real
streaming infrastructure.
"""

import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.a2a_runtime import (  # noqa: E402
    A2A_RUNTIME_CONTRACT_VERSION,
    A2ARuntimeCancelResult,
    A2ARuntimeFailureResult,
    project_a2a_runtime_contract,
)


def _params() -> dict:
    return {
        "targetAgent": "contract-agent",
        "task": "Summarize the contract boundary",
        "context": "Contract-only A2A runtime test.",
        "capabilities": ["summarize", "report"],
        "streamMode": False,
    }


def _envelope(method: str = "a2a.invoke") -> dict:
    return {
        "jsonrpc": "2.0",
        "method": method,
        "id": "a2a-contract-1",
        "params": _params(),
        "auth": "contract-token",
    }


def _agent() -> dict:
    return {
        "id": "contract-agent",
        "name": "Contract Agent",
        "capabilities": ["summarize", "report"],
        "description": "Deterministic contract fixture, not a real agent.",
    }


def test_invoke_contract_projects_completed_envelope_without_external_agent():
    result = project_a2a_runtime_contract(
        {
            "operation": "invoke",
            "envelope": _envelope("a2a.invoke"),
            "frameworkType": "custom",
            "output": "Projected invoke response.",
            "artifacts": [
                {
                    "name": "contract.txt",
                    "type": "text/plain",
                    "content": "contract fixture",
                }
            ],
            "metadata": {"source": "contract-test"},
            "startedAt": 1710000000000,
            "completedAt": 1710000000001,
        }
    ).model_dump(exclude_none=True)

    assert result["contractVersion"] == A2A_RUNTIME_CONTRACT_VERSION
    assert result["runtime"] == "python-contract"
    assert result["operation"] == "invoke"
    assert result["ok"] is True
    assert result["status"] == "completed"
    assert result["envelope"] == _envelope("a2a.invoke")
    assert result["response"] == {
        "jsonrpc": "2.0",
        "id": "a2a-contract-1",
        "result": {
            "output": "Projected invoke response.",
            "artifacts": [
                {
                    "name": "contract.txt",
                    "type": "text/plain",
                    "content": "contract fixture",
                }
            ],
            "metadata": {"source": "contract-test"},
        },
    }
    assert result["session"]["sessionId"] == "a2a-contract-1"
    assert result["session"]["requestEnvelope"] == result["envelope"]
    assert result["session"]["status"] == "completed"
    assert result["session"]["frameworkType"] == "custom"
    assert result["session"]["response"] == result["response"]
    assert result["session"]["streamChunks"] == []


def test_stream_chunk_contract_preserves_chunk_and_session_status_without_real_stream():
    running = project_a2a_runtime_contract(
        {
            "operation": "stream_chunk",
            "envelope": _envelope("a2a.stream"),
            "frameworkType": "langgraph",
            "chunk": "partial contract chunk",
            "done": False,
            "startedAt": 1710000000000,
        }
    ).model_dump(exclude_none=True)
    completed = project_a2a_runtime_contract(
        {
            "operation": "stream_chunk",
            "envelope": _envelope("a2a.stream"),
            "frameworkType": "langgraph",
            "chunk": "",
            "done": True,
            "startedAt": 1710000000000,
            "completedAt": 1710000000002,
        }
    ).model_dump(exclude_none=True)

    assert running["ok"] is True
    assert running["status"] == "streaming"
    assert running["streamChunk"] == {
        "jsonrpc": "2.0",
        "id": "a2a-contract-1",
        "chunk": "partial contract chunk",
        "done": False,
    }
    assert running["session"]["status"] == "running"
    assert running["session"]["streamChunks"] == [running["streamChunk"]]

    assert completed["ok"] is True
    assert completed["status"] == "completed"
    assert completed["streamChunk"]["done"] is True
    assert completed["session"]["status"] == "completed"


def test_cancel_contract_is_cancelled_not_completed():
    result = project_a2a_runtime_contract(
        {
            "operation": "cancel",
            "sessionId": "a2a-contract-1",
            "envelope": _envelope("a2a.cancel"),
            "frameworkType": "crewai",
            "startedAt": 1710000000000,
            "completedAt": 1710000000003,
        }
    ).model_dump(exclude_none=True)

    assert result["ok"] is False
    assert result["status"] == "cancelled"
    assert result["status"] != "completed"
    assert result["error"] == {
        "code": -32005,
        "message": "A2A session cancelled.",
    }
    assert result["response"] == {
        "jsonrpc": "2.0",
        "id": "a2a-contract-1",
        "error": {
            "code": -32005,
            "message": "A2A session cancelled.",
        },
    }
    assert result["session"]["status"] == "cancelled"
    assert result["session"]["response"] == result["response"]


def test_list_agents_contract_preserves_agent_fields():
    result = project_a2a_runtime_contract(
        {"operation": "list_agents", "agents": [_agent()]}
    ).model_dump(exclude_none=True)

    assert result == {
        "contractVersion": A2A_RUNTIME_CONTRACT_VERSION,
        "runtime": "python-contract",
        "operation": "list_agents",
        "ok": True,
        "status": "completed",
        "agents": [_agent()],
    }


def test_error_contract_cannot_masquerade_as_completed_invoke():
    failure = project_a2a_runtime_contract(
        {
            "operation": "invoke",
            "envelope": _envelope("a2a.invoke"),
            "frameworkType": "custom",
            "status": "failed",
            "error": {
                "code": -32006,
                "message": "Framework contract failure.",
                "data": {"retryable": False},
            },
        }
    ).model_dump(exclude_none=True)

    assert failure["ok"] is False
    assert failure["status"] == "failed"
    assert failure["error"]["code"] == -32006

    with pytest.raises(ValidationError):
        A2ARuntimeFailureResult(
            **{
                **failure,
                "ok": True,
                "status": "completed",
                "response": {
                    "jsonrpc": "2.0",
                    "id": "a2a-contract-1",
                    "result": {"output": "not allowed", "artifacts": [], "metadata": {}},
                },
            }
        )


def test_cancelled_result_model_rejects_completed_status():
    cancelled = project_a2a_runtime_contract(
        {
            "operation": "cancel",
            "sessionId": "a2a-contract-1",
            "envelope": _envelope("a2a.cancel"),
        }
    ).model_dump(exclude_none=True)

    with pytest.raises(ValidationError):
        A2ARuntimeCancelResult(**{**cancelled, "ok": True, "status": "completed"})


def test_contract_rejects_unknown_operation_before_runtime_work():
    with pytest.raises(ValueError, match="operation must be"):
        project_a2a_runtime_contract({"operation": "register_agent"})
