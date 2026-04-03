export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export type SecurityEnvCheck = {
  name: string;
  minLength?: number;
  disallowedValues?: string[];
};

export function assertSecureEnv(service: string, checks: SecurityEnvCheck[]): void {
  const nodeEnv = (process.env.NODE_ENV ?? 'development').toLowerCase();
  if (nodeEnv !== 'production') {
    return;
  }

  for (const check of checks) {
    const value = process.env[check.name];
    if (!value || value.trim().length === 0) {
      throw new Error(`[${service}] Missing required security env var: ${check.name}`);
    }

    if (check.minLength && value.length < check.minLength) {
      throw new Error(
        `[${service}] Env var ${check.name} is too short (min ${check.minLength} chars required)`,
      );
    }

    if (check.disallowedValues?.includes(value)) {
      throw new Error(`[${service}] Env var ${check.name} is using an insecure default value`);
    }
  }
}
