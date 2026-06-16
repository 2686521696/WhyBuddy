'''
Author: wangchunji
Date: 2026-06-16 04:13:12
LastEditors: wangchunji
LastEditTime: 2026-06-16 15:05:59
Description:
'''
"""
Auth middleware, ported from Node auth and Python's authenticate.

For internal SlideRule calls, use key. For full, integrate with existing Python auth.
"""

from fastapi import Header, HTTPException
from config.settings import settings

async def verify_internal_key(x_internal_key: str = Header(None)):
    if x_internal_key != settings.SLIDE_RULE_INTERNAL_KEY:
        raise HTTPException(403, "Invalid internal key")
    return True
