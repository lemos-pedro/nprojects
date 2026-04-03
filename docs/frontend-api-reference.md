# Ngola Projects - API Reference (Frontend)

Este documento lista os endpoints atualmente disponíveis para integração do frontend.

## 1) Base URLs (Ambiente Local)

- API Gateway (recomendado para frontend): `http://localhost:3000/api/v1`
- Auth Service (direto): `http://localhost:3001`
- Project Service (direto): `http://localhost:3003`
- Communication Service (direto): `http://localhost:3004`
- Video Service (direto): `http://localhost:3005`
- LiveKit (infra): `http://localhost:7880` / `ws://localhost:7880`

## 2) Convenções Gerais

- Header de autenticação: `Authorization: Bearer <accessToken>`
- Header de rastreio: `x-request-id` (aceito/retornado por todos os serviços HTTP)
- Content-Type: `application/json`

## 3) API Gateway (Principal para Frontend)

Base: `http://localhost:3000/api/v1`

### Health

- `GET /health`
- `GET /auth/health`

### Auth

- `POST /auth/register`
  - Body: `{ email, password, fullName, tenantName? }`
- `POST /auth/login`
  - Body: `{ email, password, twoFactorCode? }`
- `POST /auth/refresh`
  - Body: `{ refreshToken }`
- `POST /auth/logout`
  - Body: `{ refreshToken }`
- `POST /auth/2fa/enable` (auth)
- `POST /auth/2fa/verify` (auth)
  - Body: `{ code }`
- `GET /me` (auth)
- `GET /users` (auth)

### Tenants

- `POST /tenants` (auth)
- `POST /tenants/onboarding` (auth)
- `GET /tenants` (auth)
- `GET /tenants/:id` (auth)
- `PATCH /tenants/:id` (auth)
- `DELETE /tenants/:id` (auth)

### Project Templates / Projects / Phases / Labels / Tasks

- `POST /projects/templates` (auth)
- `GET /projects/templates?industry=<value>` (auth)
- `POST /projects` (auth)
- `GET /projects?tenantId=<uuid>` (auth)
- `GET /projects/:id` (auth)
- `PATCH /projects/:id` (auth)
- `DELETE /projects/:id` (auth)

- `POST /phases` (auth)
- `GET /phases?projectId=<uuid>` (auth)
- `PATCH /phases/:id` (auth)
- `DELETE /phases/:id` (auth)

- `POST /labels` (auth)
- `GET /labels?tenantId=<uuid>` (auth)

- `POST /tasks` (auth)
- `GET /tasks?projectId=<uuid>` (auth)
- `GET /tasks/:id` (auth)
- `PATCH /tasks/:id` (auth)
- `DELETE /tasks/:id` (auth)

## 4) Auth Service (Direto)

Base: `http://localhost:3001`

- `GET /api/v1/auth/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/2fa/enable` (auth)
- `POST /api/v1/auth/2fa/verify` (auth)
- `GET /api/v1/me` (auth)
- `GET /api/v1/users` (auth)

## 5) Project Service (Direto)

Base: `http://localhost:3003`

- `GET /api/v1/project-service/health`
- `POST /api/v1/tenants`
- `POST /api/v1/tenants/onboarding`
- `GET /api/v1/tenants`
- `GET /api/v1/tenants/:id`
- `PATCH /api/v1/tenants/:id`
- `DELETE /api/v1/tenants/:id`

- `POST /api/v1/projects/templates`
- `GET /api/v1/projects/templates`
- `POST /api/v1/projects`
- `GET /api/v1/projects`
- `GET /api/v1/projects/:id`
- `PATCH /api/v1/projects/:id`
- `DELETE /api/v1/projects/:id`

- `POST /api/v1/phases`
- `GET /api/v1/phases`
- `PATCH /api/v1/phases/:id`
- `DELETE /api/v1/phases/:id`

- `POST /api/v1/labels`
- `GET /api/v1/labels`

- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:id`
- `PATCH /api/v1/tasks/:id`
- `DELETE /api/v1/tasks/:id`

## 6) Communication Service (Direto)

Base: `http://localhost:3004`

### Health

- `GET /api/v1/health`

### Channels

- `POST /channels`
  - Body: `{ tenantId, createdBy, type?, name?, description?, topic?, projectId?, teamId?, isPrivate?, members? }`
- `GET /channels?userId=<id>`
- `GET /channels/:channelId`

### Messages

- `POST /messages`
  - Body: `{ channelId, senderId, content, type?, parentId?, attachments? }`
- `GET /messages/:channelId`
- `POST /messages/:messageId/edit`
  - Body: `{ content? }`
- `POST /messages/:messageId/delete`
- `POST /messages/:messageId/pin`
- `POST /messages/:messageId/unpin`
- `POST /messages/:messageId/reactions`
  - Body: `{ emoji, userId }`

### Notifications

- `GET /notifications?userId=<id>`
- `POST /notifications/:notificationId/read`
- `POST /notifications/read-all`
  - Body: `{ userId }`

### Socket.IO

- Endpoint Socket: `ws://localhost:3004`
- Eventos aceitos hoje:
  - `message`
  - `channel:join`
  - `channel:leave`
  - `user:typing`
  - `participant:hand_raised`
  - `meeting:reaction`
  - `meeting:spotlight`
  - `meeting:recording_status`
  - `meeting:mute_all`
- Eventos emitidos:
  - `message`
  - `user:typing`
  - `participant:hand_raised`
  - `meeting:reaction`
  - `meeting:spotlight`
  - `meeting:recording_status`
  - `meeting:mute_all`

## 7) Video Service (Direto)

Base: `http://localhost:3005/api/v1`

### Meetings

- `POST /meetings`
  - Body: `{ tenantId, createdBy, projectId?, channelId?, teamId?, title, description?, scheduledFor?, maxParticipants?, isRecorded?, participants? }`
- `GET /meetings/:id`
- `POST /meetings/:id/token`
  - Body: `{ userId, role: "host"|"presenter"|"viewer", name? }`
- `GET /meetings/:id/waiting-room`
  - Retorna participantes ainda não admitidos para publicar na sala
- `POST /meetings/:id/admit`
  - Body: `{ hostUserId, participantUserId }`
- `PATCH /meetings/:id/end`
- `GET /meetings/:id/summary`
- `GET /meetings/:id/recording`
- `GET /meetings/:id/demo?userId=<id>&tenantId=<id>&role=<host|viewer|presenter>&name=<nome>`

### Webhook (interno)

- `POST /webhooks/livekit`

## 8) Fluxos Recomendados para Frontend

### Fluxo Auth + Sessão

1. `POST /auth/register` ou `POST /auth/login`
2. Guardar `accessToken` e `refreshToken`
3. Carregar contexto com `GET /me`
4. Renovar token com `POST /auth/refresh`

### Fluxo Projeto

1. Criar/listar tenant (`/tenants`)
2. Criar/listar project (`/projects`)
3. Criar/listar phase (`/phases`)
4. Criar/listar task (`/tasks`)

### Fluxo Reunião

1. Criar reunião (`POST /meetings`)
2. Gerar token (`POST /meetings/:id/token`)
3. Para sala de espera: listar (`GET /meetings/:id/waiting-room`) e admitir (`POST /meetings/:id/admit`)
4. Conectar no LiveKit (`ws://localhost:7880`)
5. Finalizar (`PATCH /meetings/:id/end`)
6. Ler resultado (`GET /meetings/:id/summary`, `/recording`)

## 9) Notas Importantes para Integração

- O frontend deve preferir o API Gateway para Auth e Project.
- Communication e Video ainda estão com integração direta (não roteados no gateway).
- Alguns endpoints de communication não usam prefixo `/api/v1`; isso é intencional no estado atual.
- `createdTaskIds` no summary do vídeo já reflete tasks reais associadas ao `meetingId`.
