# Ngola Projects - Relatório Completo do Sistema (Estado Atual)

## 1) Visão Geral

O backend está organizado como monorepo Nx com serviços independentes e banco PostgreSQL compartilhado.

Serviços principais:

- `api-gateway`: entrada unificada para auth e project.
- `auth-service`: autenticação, sessão, tokens e 2FA.
- `project-service`: tenants, projetos, fases, labels e tasks.
- `communication-service`: canais, mensagens, notificações e socket.
- `video-service`: reuniões, tokens LiveKit, encerramento e resumo pós-reunião.
- `livekit`: infraestrutura de mídia em tempo real (WebRTC).
- `postgres` e `redis`: persistência e mensageria/cache.

## 2) Função de Cada Serviço

### API Gateway

- Expor endpoints padronizados para o frontend.
- Encaminhar chamadas para `auth-service` e `project-service`.
- Centralizar contratos de entrada para as áreas já estabilizadas.

### Auth Service

- Registro/login/logout/refresh.
- Perfil do usuário autenticado (`/me`) e listagem de usuários do tenant.
- Suporte a 2FA com enable/verify.

### Project Service

- CRUD de tenant.
- Onboarding de tenant.
- CRUD de projeto.
- CRUD de fases e labels.
- CRUD de tasks com campos de negócio.

### Communication Service

- CRUD essencial de canais.
- Mensagens (create/list/edit/delete/pin/reaction).
- Notificações (listar/marcar lida/marcar todas).
- Socket.IO básico para eventos em tempo real.

### Video Service

- Criar reunião vinculada a tenant/projeto.
- Emitir token LiveKit por role (`host`, `presenter`, `viewer`).
- Encerrar reunião de forma idempotente.
- Processar webhooks do LiveKit.
- Gerar resumo pós-reunião (OpenAI quando disponível; fallback quando indisponível).
- Criar tasks automaticamente no `project-service` a partir de `actionItems`.

## 3) O Que Já Está Concluído

### Infra e Build

- Docker Compose funcional com serviços principais.
- Build multi-serviço estável para auth/project/communication/video.
- Pipeline CI mínimo obrigatório configurado e executando em push:
  - `build:libs`
  - `build:all`
  - `lint:all`
  - `test:all`

### Qualidade e Testes

- Lint e testes unitários passando nos serviços principais.
- Fluxos de API validados por chamadas reais.

### Video + LiveKit

- Criação de reunião e token funcionando.
- Encerramento corrigido para não quebrar quando a sala já foi finalizada.
- Persistência de `meeting.status=ended`, `ai_summary`, `recording_url`.
- Criação automática de task no project-service com vínculo por `meetingId`.
- `summary.createdTaskIds` resolvido por consulta real ao banco.

### Observabilidade

- Middleware HTTP estruturado aplicado em todos os serviços HTTP.
- Logs JSON de início/fim de request com:
  - `requestId`
  - `method`
  - `path`
  - `statusCode`
  - `durationMs`
  - `ip`
  - `userAgent`
- Header `x-request-id` retornado para rastreabilidade ponta a ponta.

## 4) Estado de Risco / Bloqueios Atuais

- OpenAI em alguns testes respondeu `429` (quota/rate limit), acionando fallback.
- Ainda não há dashboard/alerta central formal (ex.: Prometheus+Grafana/Loki).
- Communication e Video ainda não estão roteados via API Gateway (acesso direto por porta).
- Segurança operacional ainda precisa de checklist formalizado e aplicado (etapa seguinte).

## 5) Contratos e Integração Frontend

- O catálogo completo de APIs para frontend está em:
  - `docs/frontend-api-reference.md`

## 6) Recomendação de Próxima Etapa

### Segurança do Sistema (próxima fase)

1. Sanitizar segredos e estratégia de `.env`/vault.
2. Validar autenticação/autorização em endpoints críticos (inclusive communication/video).
3. Aplicar rate limit em rotas sensíveis (auth/login, token/meeting, webhooks).
4. Revisar CORS, headers de segurança e validação de payload.
5. Definir política de backup/restore testada para PostgreSQL.
6. Adicionar trilha de auditoria para ações críticas.

## 7) Maturidade Estimada (Atual)

- MVP interno (beta fechado): ~75%
- Produção final com risco controlado: ~55–60%

## 8) Resumo Executivo

O sistema já está funcional para fluxos críticos de autenticação, gestão de projetos e reuniões com resumo pós-evento.
Com CI ativo, observabilidade estruturada e integração de serviços estabilizada, a base está pronta para evoluir em segurança operacional e frontend completo sem reescrever arquitetura.
