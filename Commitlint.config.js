module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // nova funcionalidade
        'fix',      // correcção de bug
        'docs',     // documentação
        'style',    // formatação, sem mudança de lógica
        'refactor', // refactoring sem feat nem fix
        'test',     // testes
        'chore',    // manutenção (deps, configs)
        'ci',       // CI/CD
        'perf',     // performance
        'revert',   // reverter commit
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'api-gateway',
        'auth-service',
        'project-service',
        'communication-service',
        'video-service',
        'ai-service',
        'notification-service',
        'billing-service',
        'shared',
        'database',
        'docker',
        'ci',
        'deps',
      ],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-max-length': [2, 'always', 72],
  },
};

// Exemplos de commits válidos:
// feat(auth-service): add jwt refresh token rotation
// fix(api-gateway): correct tenant isolation middleware
// chore(deps): update nestjs to v10.3
// ci(docker): add health check to postgres container