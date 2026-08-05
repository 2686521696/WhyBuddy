# PostgreSQL HTTPS API

This optional deployment stack exposes PostgreSQL through an authenticated HTTPS
API for environments that can only make HTTPS requests and cannot speak the
native PostgreSQL wire protocol.

The service itself listens on HTTP port `8000` inside Docker. Public HTTPS is
terminated by Caddy, which routes `/db-api/*` to this container.

## Endpoints

- `GET /v1/health`
- `GET /v1/schema`
- `POST /v1/query`

Authenticate with either header:

```http
Authorization: Bearer <DB_API_KEY>
X-DB-API-Key: <DB_API_KEY>
```

## Deploy

Create a dedicated PostgreSQL role first. Example:

```sql
create role db_api_user login password '<strong-password>';
grant connect on database appdb to db_api_user;
grant usage, create on schema public to db_api_user;
grant select, insert, update, delete, truncate, references, trigger on all tables in schema public to db_api_user;
grant usage, select, update on all sequences in schema public to db_api_user;
grant execute on all functions in schema public to db_api_user;
```

Then create `.env` from `.env.example` and start the service:

```bash
cp .env.example .env
docker compose up -d --build
```

Route it through Caddy:

```caddy
handle_path /db-api* {
	reverse_proxy local-db-api:8000
}
```

## Query Example

```bash
curl -sS https://miantuan.ai/db-api/v1/query \
  -H "Authorization: Bearer $DB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sql":"select current_database() as db, current_user as user","readonly":true}'
```

`readonly: true` opens a read-only transaction and rolls back at the end of the
request. For writes, omit it or set it to `false`.
