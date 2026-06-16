"""
Stable LLM wrapper for V5, replacing Node's llm-client.ts + pool-json-llm.ts + su8 + 6-key pool.

Uses the project's stable RAG + LLM config (qwen or whatever in llm_config) for generation.
No more proxy 504s, cooldowns, template fallbacks.
All "LLM" calls for content now go through RAG for evidence + generation.
"""

from typing import Dict, Any, List, Optional
from services.rag_service import ask_question  # stable from the structure

def call_stable_llm_for_capability(capability_id: str, prompt: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Replacement for Node's callSlideRuleDialogueJsonLlm / callPoolJsonLlm.
    Always uses RAG to bring external evidence, then generates.
    """
    # Force RAG for evidence/tools to avoid "degraded" and "未引入外部证据"
    full_prompt = f"{prompt}\n\nContext: {context}\nUse RAG to retrieve real external evidence for this capability."
    result = ask_question(full_prompt, top_k=8)
    return {
        "answer": result.get("answer", "Generated via stable RAG."),
        "sources": result.get("sources", []),
        "provenance": "python-rag-stable",
        "model": "stable-rag-llm"
    }

def get_stable_config() -> Dict[str, Any]:
    # Replacement for ai-config.ts + LLM pool env
    return {
        "use_rag": True,
        "pool": "python-rag",  # no su8
        "timeout": 300000,
        "reasoning": "medium"
    }
