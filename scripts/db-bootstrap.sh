#!/bin/sh
set -eu

# Melhores práticas: Usar aspas em todas as atribuições
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
# pg_isready é a forma correta e segura de esperar
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
  sleep 2
done

# Gerando o hash (removendo espaços extras se houver)
SCHEMA_HASH="$(sha256sum "$SQL_FILE" | awk '{print $1}')"

# Criar tabela de histórico
psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_bootstrap_history (
  id BIGSERIAL PRIMARY KEY,
  schema_hash TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

# Otimização: Checar tudo em uma única chamada ao banco
checks="$(psql -tA -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT 
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants')) || ',' ||
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')) || ',' ||
    (SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'plan_type')) || ',' ||
    (SELECT EXISTS (SELECT 1 FROM public.schema_bootstrap_history WHERE schema_hash = '$SCHEMA_HASH' LIMIT 1));
")"

# Extraindo os valores da string "t,t,t,f"
has_tenants="$(echo "$checks" | cut -d',' -f1)"
has_users="$(echo "$checks" | cut -d',' -f2)"
has_plan_type="$(echo "$checks" | cut -d',' -f3)"
hash_exists="$(echo "$checks" | cut -d',' -f4)"

# Se as tabelas principais existem
if [ "$has_tenants" = "t" ] && [ "$has_users" = "t" ]; then
  if [ "$hash_exists" = "t" ]; then
    echo "Database schema matches hash. Skipping bootstrap."
    exit 0
  fi
  
  # Se as tabelas existem mas o hash não está lá, talvez seja a primeira vez 
  # rodando este script em um banco já populado.
  echo "Schema exists but hash is missing. Recording current hash..."
  psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -c "INSERT INTO public.schema_bootstrap_history (schema_hash) VALUES ('$SCHEMA_HASH') ON CONFLICT DO NOTHING;"
  exit 0
fi

echo "Applying schema from $SQL_FILE..."
psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE"

psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "INSERT INTO public.schema_bootstrap_history (schema_hash) VALUES ('$SCHEMA_HASH') ON CONFLICT DO NOTHING;"

echo "Schema bootstrap completed successfully."