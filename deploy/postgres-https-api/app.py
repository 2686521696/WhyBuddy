import hmac
import os
import time
from datetime import date, datetime, time as dt_time
from decimal import Decimal
from ipaddress import IPv4Address, IPv6Address
from typing import Any
from uuid import UUID

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from pydantic import BaseModel, Field


API_KEY = os.environ["DB_API_KEY"]
MAX_ROWS_LIMIT = int(os.environ.get("DB_API_MAX_ROWS", "5000"))
DEFAULT_TIMEOUT_MS = int(os.environ.get("DB_API_STATEMENT_TIMEOUT_MS", "30000"))
MAX_TIMEOUT_MS = int(os.environ.get("DB_API_MAX_STATEMENT_TIMEOUT_MS", "120000"))
MAX_BODY_BYTES = int(os.environ.get("DB_API_MAX_BODY_BYTES", str(1024 * 1024)))


def db_connect() -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ.get("DB_HOST", "local-postgres"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["DB_API_DB_USER"],
        password=os.environ["DB_API_DB_PASSWORD"],
        sslmode=os.environ.get("DB_SSLMODE", "require"),
        connect_timeout=int(os.environ.get("DB_CONNECT_TIMEOUT_SECONDS", "10")),
    )


def require_api_key(
    authorization: str | None = Header(default=None),
    x_db_api_key: str | None = Header(default=None),
) -> None:
    token = x_db_api_key
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token or not hmac.compare_digest(token, API_KEY):
        raise HTTPException(status_code=401, detail="invalid API key")


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, dt_time, UUID, IPv4Address, IPv6Address)):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, memoryview):
        return bytes(value).hex()
    if isinstance(value, list | tuple):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    return str(value)


class QueryRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=500_000)
    params: list[Any] | dict[str, Any] | None = None
    max_rows: int = Field(default=1000, ge=0)
    timeout_ms: int | None = Field(default=None, ge=100, le=MAX_TIMEOUT_MS)
    readonly: bool = False
    rollback: bool = False


app = FastAPI(
    title="miantuan PostgreSQL HTTPS API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def enforce_body_limit(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY_BYTES:
        return JSONResponse({"detail": "request body too large"}, status_code=413)
    return await call_next(request)


@app.get("/livez")
def livez() -> dict[str, bool]:
    return {"ok": True}


@app.get("/v1/health", dependencies=[Depends(require_api_key)])
def health() -> dict[str, Any]:
    started = time.monotonic()
    with db_connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                select
                  current_database() as database,
                  current_user as user,
                  version() as version,
                  now() as server_time
                """
            )
            row = cur.fetchone()
    return {
        "ok": True,
        "database": row["database"],
        "user": row["user"],
        "version": row["version"].split(",")[0],
        "server_time": jsonable(row["server_time"]),
        "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    }


@app.get("/v1/schema", dependencies=[Depends(require_api_key)])
def schema() -> dict[str, Any]:
    with db_connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                select
                  table_schema,
                  table_name,
                  column_name,
                  ordinal_position,
                  data_type,
                  is_nullable,
                  column_default
                from information_schema.columns
                where table_schema not in ('pg_catalog', 'information_schema')
                order by table_schema, table_name, ordinal_position
                """
            )
            columns = [jsonable(row) for row in cur.fetchall()]
    return {"columns": columns}


@app.post("/v1/query", dependencies=[Depends(require_api_key)])
def query(body: QueryRequest) -> dict[str, Any]:
    timeout_ms = min(body.timeout_ms or DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    max_rows = min(body.max_rows, MAX_ROWS_LIMIT)
    started = time.monotonic()

    with db_connect() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            if body.readonly:
                cur.execute("set transaction read only")
            cur.execute(
                "select set_config('statement_timeout', %s, true)",
                (f"{timeout_ms}ms",),
            )
            cur.execute(
                "select set_config('idle_in_transaction_session_timeout', %s, true)",
                (f"{timeout_ms}ms",),
            )

            cur.execute(body.sql, body.params)

            columns: list[str] = []
            rows: list[Any] = []
            truncated = False
            if cur.description is not None:
                columns = [column.name for column in cur.description]
                fetched = cur.fetchmany(max_rows + 1)
                truncated = len(fetched) > max_rows
                rows = [jsonable(row) for row in fetched[:max_rows]]

            rowcount = cur.rowcount

        if body.readonly or body.rollback:
            conn.rollback()
        else:
            conn.commit()

    return {
        "ok": True,
        "columns": columns,
        "rows": rows,
        "rowcount": rowcount,
        "truncated": truncated,
        "max_rows": max_rows,
        "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    }
