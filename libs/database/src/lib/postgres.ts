import { Pool, PoolClient, QueryResult } from 'pg';

import { getDatabaseConfig } from './database.config';

let pool: Pool | null = null;

export function isPostgresEnabled(): boolean {
  return Boolean(process.env.POSTGRES_HOST);
}

export function getPostgresPool(): Pool {
  if (!pool) {
    const { postgres } = getDatabaseConfig();
    pool = new Pool({
      host: postgres.host,
      port: postgres.port,
      database: postgres.database,
      user: postgres.user,
      password: postgres.password,
      max: 10,
    });
  }

  return pool;
}

export function query<T = unknown>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return getPostgresPool().query<T>(text, params);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
