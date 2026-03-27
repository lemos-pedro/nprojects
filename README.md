# Ngola Projects

Implementação inicial da Fase 1 do roadmap backend com:

- `api-gateway`
- `auth-service`
- `Docker` com PostgreSQL e Redis
- `CI/CD` inicial em GitHub Actions

## Estrutura

- `apps/api-gateway`: gateway HTTP que expõe `/api/v1/*` e encaminha autenticação para o `auth-service`
- `apps/auth-service`: serviço NestJS com `health`, `register`, `login`, `refresh` e `logout`
- `apps/project-service`: CRUD inicial da Fase 2 para tenants, templates, projects, phases, labels e tasks
- `libs/shared`: utilitários partilhados
- `libs/database`: configuração de PostgreSQL e Redis
- `docs/`: documentação funcional, roadmap e schema SQL de referência do projeto
- `scripts/db-bootstrap.sh`: verificação e bootstrap idempotente do schema PostgreSQL

## Comandos

```bash
npm install
npm run build:all
npm run test:all
npm run lint:all
npm run docker:up
```

Para subir também `api-gateway` e `auth-service` em containers:

```bash
npm run docker:full:up
```

## Serviços locais

- API Gateway: `http://localhost:3000/api/v1/health`
- Auth Service: `http://localhost:3001/api/v1/auth/health`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Estado atual

Esta base segue a Fase 1 do roadmap e já organiza o backend na raiz do repositório, sem a pasta técnica antiga `error`.
O `auth-service` ainda usa persistência em memória para acelerar o arranque inicial; o próximo passo é ligar autenticação, sessões e tenants ao PostgreSQL com migrations reais.
O fluxo recomendado de desenvolvimento local usa Docker apenas para infraestrutura (`PostgreSQL` e `Redis`) e executa as apps com `npm run auth-service` e `npm run api-gateway`, evitando falhas de rede do npm durante build de imagens.
No fluxo full-docker, o serviço `db-bootstrap` valida `docs/ngola_schema.sql` contra o estado do banco e só aplica o SQL quando o schema ainda não existe; se detectar drift em schema já existente, ele falha para evitar aplicar um SQL não idempotente por cima de dados existentes.

## Persistência de dados

O PostgreSQL usa o volume Docker `postgres_data`, por isso os teus dados de teste continuam no banco entre `docker:down` e `docker:up`.
Não uses `docker compose down -v` se quiseres preservar os dados.
O bootstrap do schema só aplica `docs/ngola_schema.sql` quando detecta banco vazio ou estrutura incompleta; ele não apaga o conteúdo existente.
