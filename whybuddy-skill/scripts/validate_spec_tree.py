#!/usr/bin/env python3
"""Validate deterministic invariants for a WhyBuddy SPEC tree."""

from __future__ import annotations

import json
import sys
from typing import Any

VALID_TYPES = {"requirement", "design", "task", "evidence"}
VALID_SOURCES = {"llm", "llm_fallback", "template"}
MIN_NODES = 3
MAX_NODES = 50
MAX_DEPTH = 4


def load_payload(argv: list[str]) -> dict[str, Any]:
    if len(argv) > 1:
        with open(argv[1], "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    else:
        payload = json.load(sys.stdin)

    if not isinstance(payload, dict):
        raise ValueError("input must be a JSON object")
    return payload


def is_root(node: dict[str, Any]) -> bool:
    return node.get("parentId") in (None, "")


def validate(payload: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return ["missing nodes list"]

    if not (MIN_NODES <= len(nodes) <= MAX_NODES):
        failures.append(
            f"node count {len(nodes)} is outside [{MIN_NODES}, {MAX_NODES}]"
        )

    ids = [node.get("id") for node in nodes if isinstance(node, dict)]
    if len(ids) != len(nodes):
        failures.append("all nodes must be JSON objects")
    if any(node_id in (None, "") for node_id in ids):
        failures.append("empty node id found")
    if len(ids) != len(set(ids)):
        duplicates = sorted({node_id for node_id in ids if ids.count(node_id) > 1})
        failures.append(f"duplicate node ids: {duplicates}")

    by_id = {node.get("id"): node for node in nodes if isinstance(node, dict)}
    roots = [node for node in nodes if isinstance(node, dict) and is_root(node)]
    if len(roots) != 1:
        failures.append(f"expected exactly one root node, found {len(roots)}")
    elif roots[0].get("type") != "requirement":
        failures.append("root node type must be requirement")

    for node in nodes:
        if not isinstance(node, dict):
            continue

        node_type = node.get("type")
        if node_type not in VALID_TYPES:
            failures.append(f"node {node.get('id')!r} has invalid type: {node_type!r}")

        if not is_root(node) and node.get("parentId") not in by_id:
            failures.append(
                f"node {node.get('id')!r} references missing parent {node.get('parentId')!r}"
            )

    for node in nodes:
        if not isinstance(node, dict):
            continue

        seen: set[str] = set()
        current = node
        depth = 1
        while True:
            current_id = current.get("id")
            if not isinstance(current_id, str):
                break
            if current_id in seen:
                failures.append(f"cycle detected at node {node.get('id')!r}")
                break
            seen.add(current_id)
            if is_root(current):
                break
            parent_id = current.get("parentId")
            if parent_id not in by_id:
                break
            current = by_id[parent_id]
            depth += 1

        if depth > MAX_DEPTH:
            failures.append(
                f"node {node.get('id')!r} depth {depth} exceeds maximum {MAX_DEPTH}"
            )

    root_node_id = payload.get("rootNodeId")
    if root_node_id and roots and roots[0].get("id") != root_node_id:
        failures.append("rootNodeId does not match the actual root node")

    provenance = payload.get("provenance")
    if not isinstance(provenance, dict):
        failures.append("missing provenance object")
    else:
        generation_source = provenance.get("generationSource")
        if generation_source not in VALID_SOURCES:
            failures.append(
                f"invalid provenance.generationSource: {generation_source!r}"
            )

    deduped: list[str] = []
    seen_messages: set[str] = set()
    for failure in failures:
        if failure not in seen_messages:
            deduped.append(failure)
            seen_messages.add(failure)
    return deduped


def main(argv: list[str]) -> int:
    try:
        payload = load_payload(argv)
    except Exception as exc:
        print(f"input error: {exc}", file=sys.stderr)
        return 2

    failures = validate(payload)
    if failures:
        print("failed - SPEC tree invariants were violated:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print(f"passed - valid SPEC tree with {len(payload['nodes'])} nodes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
