import { getEnv } from '@ngola/shared';

export function getDatabaseConfig() {
  return {
    postgres: {
      host: getEnv('POSTGRES_HOST', 'localhost'),
      port: Number(getEnv('POSTGRES_PORT', '5432')),
      database: getEnv('POSTGRES_DB', 'ngola_projects'),
      user: getEnv('POSTGRES_USER', 'ngola'),
      password: getEnv('POSTGRES_PASSWORD', 'ngola_dev_password'),
    },
    redis: {
      host: getEnv('REDIS_HOST', 'localhost'),
      port: Number(getEnv('REDIS_PORT', '6379')),
    },
  };
}
