"""
Durable session store, ported from Node's memory/session-store.ts and durable pilot.

Uses file + optional DB (like Python's MySQL + knowledge).
"""

import json
import os
from typing import Optional, Dict
from models.v5_state import V5SessionState

STORE_FILE = "data/v5_sessions.json"
os.makedirs("data", exist_ok=True)

def load_all() -> Dict[str, V5SessionState]:
    if os.path.exists(STORE_FILE):
        with open(STORE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return {k: V5SessionState(**v) for k, v in data.items()}
    return {}

def save_all(sessions: Dict[str, V5SessionState]):
    with open(STORE_FILE, "w", encoding="utf-8") as f:
        json.dump({k: v.model_dump() for k, v in sessions.items()}, f, ensure_ascii=False, indent=2)

def persist_state(state: V5SessionState):
    sessions = load_all()
    sessions[state.sessionId] = state
    save_all(sessions)
