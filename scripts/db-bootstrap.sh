#!/bin/sh
set -eu

DB_HOST="${POSTGRES_HOST:-postgres}"
DB_PORT="${POSTGRES_PORT_INTERNAL:-5432}"
DB_NAME="${POSTGRES_DB:-ngola_projects}"
DB_USER="${POSTGRES_USER:-ngola}"
DB_PASSWORD="${POSTGRES_PASSWORD:-ngola_dev_password}"
SQL_FILE="${SQL_FILE:-/bootstrap/ngola_schema.sql}"

if [ ! -f "$SQL_FILE" ]; then
  echo "Schema file not found: $SQL_FILE" >&2
  exit 1
fi

export PGPASSWORD="$DB_PASSWORD"

echo "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}/${DB_NAME}..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 2
done

SCHEMA_HASH="$(sha256sum "$SQL_FILE" | awk '{print $1}')"

psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_bootstrap_history (
  id BIGSERIAL PRIMARY KEY,
  schema_hash TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

has_tenants_table="$(
  psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants');"
)"

has_users_table="$(
  psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users');"
)"

has_plan_type="$(
  psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_type');"
)"

has_subscription_plans_table="$(
  psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscription_plans');"
)"

has_subscriptions_table="$(
  psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscriptions');"
)"

recorded_hash="$(
  psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "SELECT schema_hash FROM public.schema_bootstrap_history ORDER BY applied_at DESC LIMIT 1;"
)"

if [ "$has_tenants_table" = "t" ] \
  && [ "$has_users_table" = "t" ] \
  && [ "$has_plan_type" = "t" ] \
  && [ "$has_subscription_plans_table" = "t" ] \
  && [ "$has_subscriptions_table" = "t" ]; then
  if [ "$recorded_hash" = "$SCHEMA_HASH" ]; then
    echo "Database schema already matches docs/ngola_schema.sql. Skipping bootstrap."
    exit 0
  fi

  if [ -z "$recorded_hash" ]; then
    psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      -c "INSERT INTO public.schema_bootstrap_history (schema_hash) VALUES ('$SCHEMA_HASH') ON CONFLICT (schema_hash) DO NOTHING;"
    echo "Database schema already exists. Recorded current schema hash and skipped bootstrap."
    exit 0
  fi

  echo "Database schema drift detected: existing schema does not match docs/ngola_schema.sql." >&2
  echo "Bootstrap aborted to avoid applying a non-idempotent SQL file over an existing schema." >&2
  exit 1
fi

echo "Schema missing or incomplete. Applying docs/ngola_schema.sql..."
psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE"
psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "INSERT INTO public.schema_bootstrap_history (schema_hash) VALUES ('$SCHEMA_HASH') ON CONFLICT (schema_hash) DO NOTHING;"
echo "Schema bootstrap completed successfully."
