-- ============================================================
-- NGOLA PROJECTS — PostgreSQL Schema Completo
-- Versão: 1.0 | Multi-tenant | Production-Ready
-- ============================================================
-- Executar como superuser ou owner da base de dados
-- Compatível com PostgreSQL 15+
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- pesquisa full-text
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- pesquisa sem acentos

-- ============================================================
-- ENUMS GLOBAIS
-- ============================================================

CREATE TYPE plan_type AS ENUM ('starter', 'growth', 'enterprise');
CREATE TYPE billing_interval AS ENUM ('monthly', 'annual');
CREATE TYPE billing_status AS ENUM ('active', 'past_due', 'cancelled', 'trialing', 'paused');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended', 'pending_verification');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'manager', 'member', 'viewer', 'guest');
CREATE TYPE project_status AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived');
CREATE TYPE task_status AS ENUM ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled');
CREATE TYPE task_priority AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE channel_type AS ENUM ('project', 'team', 'direct', 'announcement', 'general');
CREATE TYPE message_type AS ENUM ('text', 'file', 'image', 'system', 'task_update', 'meeting_summary');
CREATE TYPE meeting_status AS ENUM ('scheduled', 'live', 'ended', 'cancelled');
CREATE TYPE notification_type AS ENUM ('task_assigned', 'task_updated', 'message', 'mention', 'meeting_starting', 'ai_alert', 'billing', 'system');
CREATE TYPE industry_vertical AS ENUM ('telecom', 'oil_energy', 'construction', 'financial', 'tech_startup', 'other');
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'expired');
CREATE TYPE oauth_provider AS ENUM ('microsoft', 'google');
CREATE TYPE ai_alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE ai_prediction_type AS ENUM ('delay_risk', 'budget_overrun', 'resource_bottleneck', 'compliance_risk', 'delivery_risk');
CREATE TYPE attachment_type AS ENUM ('document', 'image', 'video', 'audio', 'spreadsheet', 'presentation', 'other');
CREATE TYPE webhook_event AS ENUM ('project.created', 'project.updated', 'task.created', 'task.updated', 'task.completed', 'message.created', 'meeting.ended', 'member.invited');

-- ============================================================
-- MÓDULO 1 — TENANTS & WORKSPACES
-- ============================================================

CREATE TABLE tenants (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(255) NOT NULL,
    slug                VARCHAR(100) NOT NULL UNIQUE,          -- ex: "sonangol", "unitel"
    logo_url            TEXT,
    industry_vertical   industry_vertical NOT NULL DEFAULT 'other',
    plan                plan_type NOT NULL DEFAULT 'starter',
    billing_status      billing_status NOT NULL DEFAULT 'trialing',
    trial_ends_at       TIMESTAMPTZ,
    max_members         INTEGER NOT NULL DEFAULT 10,
    max_projects        INTEGER NOT NULL DEFAULT 5,
    max_storage_gb      INTEGER NOT NULL DEFAULT 5,
    storage_used_bytes  BIGINT NOT NULL DEFAULT 0,
    custom_domain       VARCHAR(255),
    timezone            VARCHAR(100) NOT NULL DEFAULT 'Africa/Luanda',
    locale              VARCHAR(10) NOT NULL DEFAULT 'pt-AO',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    metadata            JSONB NOT NULL DEFAULT '{}',           -- configurações custom por tenant
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ                            -- soft delete (GDPR)
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_plan ON tenants(plan);
CREATE INDEX idx_tenants_active ON tenants(is_active) WHERE is_active = TRUE;

-- ============================================================
-- MÓDULO 2 — UTILIZADORES & AUTENTICAÇÃO
-- ============================================================

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email               VARCHAR(255) NOT NULL,
    email_verified_at   TIMESTAMPTZ,
    password_hash       TEXT,                                  -- NULL se usar OAuth
    full_name           VARCHAR(255) NOT NULL,
    display_name        VARCHAR(100),
    avatar_url          TEXT,
    phone               VARCHAR(30),
    job_title           VARCHAR(150),
    department          VARCHAR(150),
    timezone            VARCHAR(100) NOT NULL DEFAULT 'Africa/Luanda',
    locale              VARCHAR(10) NOT NULL DEFAULT 'pt-AO',
    status              user_status NOT NULL DEFAULT 'pending_verification',
    last_seen_at        TIMESTAMPTZ,
    notification_prefs  JSONB NOT NULL DEFAULT '{
        "email": true,
        "push": true,
        "mentions": true,
        "task_updates": true,
        "meeting_reminders": true
    }',
    two_factor_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    two_factor_secret   TEXT,                                  -- encriptado
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_last_seen ON users(last_seen_at DESC);

-- OAuth / SSO (Microsoft 365, Google)
CREATE TABLE user_oauth_accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        oauth_provider NOT NULL,
    provider_id     VARCHAR(255) NOT NULL,                     -- ID do utilizador no provider
    access_token    TEXT,                                      -- encriptado em produção
    refresh_token   TEXT,                                      -- encriptado em produção
    token_expires_at TIMESTAMPTZ,
    scope           TEXT,                                      -- permissões concedidas
    raw_profile     JSONB NOT NULL DEFAULT '{}',               -- dados brutos do provider
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_id)
);

CREATE INDEX idx_oauth_user ON user_oauth_accounts(user_id);
CREATE INDEX idx_oauth_provider ON user_oauth_accounts(provider, provider_id);

-- Sessões activas (JWT refresh tokens)
CREATE TABLE user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token   TEXT NOT NULL UNIQUE,
    ip_address      INET,
    user_agent      TEXT,
    device_type     VARCHAR(50),                               -- desktop, mobile, tablet
    expires_at      TIMESTAMPTZ NOT NULL,
    last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(refresh_token);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- Invitações de membros
CREATE TABLE invitations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invited_by      UUID NOT NULL REFERENCES users(id),
    email           VARCHAR(255) NOT NULL,
    role            member_role NOT NULL DEFAULT 'member',
    team_id         UUID,                                      -- FK adicionada depois
    token           TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    status          invitation_status NOT NULL DEFAULT 'pending',
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    accepted_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_tenant ON invitations(tenant_id);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_token ON invitations(token);

-- ============================================================
-- MÓDULO 3 — PERMISSÕES & RBAC
-- ============================================================

-- Teams (grupos de utilizadores dentro de um tenant)
CREATE TABLE teams (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    avatar_url      TEXT,
    color           VARCHAR(7),                                -- hex color, ex: #0A2463
    is_private      BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at     TIMESTAMPTZ
);

CREATE INDEX idx_teams_tenant ON teams(tenant_id);

-- Membros de teams
CREATE TABLE team_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        member_role NOT NULL DEFAULT 'member',
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);

-- FK de invitations para teams
ALTER TABLE invitations ADD CONSTRAINT fk_invitations_team
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

-- Permissões granulares por recurso
CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
    resource_type   VARCHAR(50) NOT NULL,                      -- 'project', 'channel', 'report'
    resource_id     UUID NOT NULL,
    role            member_role NOT NULL,
    granted_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR team_id IS NOT NULL)         -- pelo menos um dos dois
);

CREATE INDEX idx_permissions_resource ON permissions(resource_type, resource_id);
CREATE INDEX idx_permissions_user ON permissions(user_id);
CREATE INDEX idx_permissions_team ON permissions(team_id);

-- Audit log de acções (imutável)
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    user_id         UUID REFERENCES users(id),
    action          VARCHAR(100) NOT NULL,                     -- ex: 'project.deleted'
    resource_type   VARCHAR(50),
    resource_id     UUID,
    ip_address      INET,
    user_agent      TEXT,
    old_values      JSONB,
    new_values      JSONB,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- ============================================================
-- MÓDULO 4 — PROJECTOS & TAREFAS
-- ============================================================

-- Templates de projecto por vertical de indústria
CREATE TABLE project_templates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = template global
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    industry        industry_vertical,
    icon            VARCHAR(50),
    color           VARCHAR(7),
    phases          JSONB NOT NULL DEFAULT '[]',               -- fases padrão do projecto
    task_templates  JSONB NOT NULL DEFAULT '[]',               -- tarefas padrão
    is_public       BOOLEAN NOT NULL DEFAULT FALSE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_industry ON project_templates(industry);
CREATE INDEX idx_templates_tenant ON project_templates(tenant_id);

-- Projectos
CREATE TABLE projects (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    team_id             UUID REFERENCES teams(id) ON DELETE SET NULL,
    template_id         UUID REFERENCES project_templates(id) ON DELETE SET NULL,
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    status              project_status NOT NULL DEFAULT 'planning',
    industry_vertical   industry_vertical,
    cover_image_url     TEXT,
    color               VARCHAR(7),
    start_date          DATE,
    due_date            DATE,
    completed_at        TIMESTAMPTZ,
    budget_amount       NUMERIC(15, 2),
    budget_currency     VARCHAR(3) NOT NULL DEFAULT 'USD',
    budget_spent        NUMERIC(15, 2) NOT NULL DEFAULT 0,
    progress_percent    SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    priority            task_priority NOT NULL DEFAULT 'medium',
    is_private          BOOLEAN NOT NULL DEFAULT FALSE,
    geolocation         JSONB,                                 -- {lat, lng, address} para projectos físicos
    custom_fields       JSONB NOT NULL DEFAULT '{}',           -- campos custom por vertical
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at         TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_projects_tenant ON projects(tenant_id);
CREATE INDEX idx_projects_team ON projects(team_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_due ON projects(due_date);
CREATE INDEX idx_projects_created_by ON projects(created_by);

-- Membros de projecto
CREATE TABLE project_members (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        member_role NOT NULL DEFAULT 'member',
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);

-- Fases/Milestones do projecto
CREATE TABLE project_phases (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    order_index     SMALLINT NOT NULL DEFAULT 0,
    start_date      DATE,
    due_date        DATE,
    completed_at    TIMESTAMPTZ,
    color           VARCHAR(7),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_phases_project ON project_phases(project_id);

-- Labels/Tags de tarefas
CREATE TABLE labels (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(7) NOT NULL DEFAULT '#0A2463',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_labels_tenant ON labels(tenant_id);

-- Tarefas
CREATE TABLE tasks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_id            UUID REFERENCES project_phases(id) ON DELETE SET NULL,
    parent_task_id      UUID REFERENCES tasks(id) ON DELETE CASCADE, -- subtarefas
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    status              task_status NOT NULL DEFAULT 'todo',
    priority            task_priority NOT NULL DEFAULT 'medium',
    order_index         INTEGER NOT NULL DEFAULT 0,
    start_date          DATE,
    due_date            DATE,
    completed_at        TIMESTAMPTZ,
    estimated_hours     NUMERIC(6, 2),
    actual_hours        NUMERIC(6, 2),
    budget_amount       NUMERIC(12, 2),
    budget_spent        NUMERIC(12, 2) NOT NULL DEFAULT 0,
    progress_percent    SMALLINT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    custom_fields       JSONB NOT NULL DEFAULT '{}',
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_phase ON tasks(phase_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX idx_tasks_tenant ON tasks(tenant_id);

-- Atribuições de tarefas (uma tarefa pode ter múltiplos responsáveis)
CREATE TABLE task_assignees (
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(task_id, user_id)
);

CREATE INDEX idx_assignees_user ON task_assignees(user_id);

-- Labels de tarefas
CREATE TABLE task_labels (
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id    UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY(task_id, label_id)
);

-- Dependências entre tarefas
CREATE TABLE task_dependencies (
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(task_id, depends_on_id),
    CHECK(task_id != depends_on_id)
);

-- Comentários de tarefas
CREATE TABLE task_comments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    parent_id       UUID REFERENCES task_comments(id) ON DELETE CASCADE, -- replies
    content         TEXT NOT NULL,
    content_html    TEXT,
    edited_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_comments_task ON task_comments(task_id);
CREATE INDEX idx_comments_user ON task_comments(user_id);

-- Registo de tempo por tarefa
CREATE TABLE time_entries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    description     TEXT,
    started_at      TIMESTAMPTZ NOT NULL,
    ended_at        TIMESTAMPTZ,
    duration_minutes INTEGER,                                  -- calculado ou manual
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_time_task ON time_entries(task_id);
CREATE INDEX idx_time_user ON time_entries(user_id);

-- ============================================================
-- MÓDULO 5 — CHAT & MENSAGENS
-- ============================================================

-- Canais de comunicação
CREATE TABLE channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
    type            channel_type NOT NULL DEFAULT 'project',
    name            VARCHAR(100),                              -- NULL para DMs
    description     TEXT,
    topic           TEXT,
    avatar_url      TEXT,
    is_private      BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    last_message_at TIMESTAMPTZ,
    message_count   INTEGER NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_channels_tenant ON channels(tenant_id);
CREATE INDEX idx_channels_project ON channels(project_id);
CREATE INDEX idx_channels_team ON channels(team_id);
CREATE INDEX idx_channels_type ON channels(type);
CREATE INDEX idx_channels_last_msg ON channels(last_message_at DESC);

-- Membros de canais
CREATE TABLE channel_members (
    channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                VARCHAR(20) NOT NULL DEFAULT 'member',  -- member, admin
    last_read_at        TIMESTAMPTZ,
    last_read_msg_id    UUID,
    notifications_muted BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(channel_id, user_id)
);

CREATE INDEX idx_channel_members_user ON channel_members(user_id);

-- Mensagens (tabela principal — armazenamento híbrido PostgreSQL + futuro MongoDB)
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    parent_id       UUID REFERENCES messages(id) ON DELETE CASCADE, -- thread reply
    type            message_type NOT NULL DEFAULT 'text',
    content         TEXT,                                      -- texto da mensagem
    content_html    TEXT,                                      -- versão formatada
    task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,  -- mensagem ancorada a tarefa
    meeting_id      UUID,                                      -- FK adicionada depois
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    is_edited       BOOLEAN NOT NULL DEFAULT FALSE,
    edited_at       TIMESTAMPTZ,
    mentions        UUID[] NOT NULL DEFAULT '{}',              -- IDs de utilizadores mencionados
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_messages_channel ON messages(channel_id);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_parent ON messages(parent_id);
CREATE INDEX idx_messages_task ON messages(task_id);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_messages_pinned ON messages(channel_id, is_pinned) WHERE is_pinned = TRUE;
-- Índice para pesquisa full-text
CREATE INDEX idx_messages_search ON messages USING gin(to_tsvector('portuguese', coalesce(content, '')));

-- Reacções a mensagens
CREATE TABLE message_reactions (
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       VARCHAR(20) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);

-- Anexos de mensagens e tarefas
CREATE TABLE attachments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    message_id      UUID REFERENCES messages(id) ON DELETE CASCADE,
    task_id         UUID REFERENCES tasks(id) ON DELETE CASCADE,
    meeting_id      UUID,                                      -- FK adicionada depois
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    type            attachment_type NOT NULL DEFAULT 'other',
    file_name       VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type       VARCHAR(100),
    s3_bucket       VARCHAR(100) NOT NULL,
    s3_key          TEXT NOT NULL,
    public_url      TEXT,
    thumbnail_url   TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',               -- dimensões, duração, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_attachments_message ON attachments(message_id);
CREATE INDEX idx_attachments_task ON attachments(task_id);
CREATE INDEX idx_attachments_tenant ON attachments(tenant_id);

-- Notificações
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            notification_type NOT NULL,
    title           VARCHAR(255) NOT NULL,
    body            TEXT,
    resource_type   VARCHAR(50),                               -- 'task', 'message', 'meeting'
    resource_id     UUID,
    actor_id        UUID REFERENCES users(id),                 -- quem gerou a notificação
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    sent_email      BOOLEAN NOT NULL DEFAULT FALSE,
    sent_push       BOOLEAN NOT NULL DEFAULT FALSE,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;

-- ============================================================
-- MÓDULO 6 — REUNIÕES & GRAVAÇÕES
-- ============================================================

CREATE TABLE meetings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
    channel_id          UUID REFERENCES channels(id) ON DELETE SET NULL,
    team_id             UUID REFERENCES teams(id) ON DELETE SET NULL,
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    status              meeting_status NOT NULL DEFAULT 'scheduled',
    scheduled_at        TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,
    duration_minutes    INTEGER,
    livekit_room_id     VARCHAR(255),                          -- ID da sala no LiveKit
    livekit_room_token  TEXT,                                  -- token de acesso
    max_participants    INTEGER NOT NULL DEFAULT 50,
    is_recorded         BOOLEAN NOT NULL DEFAULT FALSE,
    recording_s3_key    TEXT,                                  -- caminho no S3
    recording_url       TEXT,                                  -- URL público (temp signed)
    recording_size_bytes BIGINT,
    -- IA pós-reunião
    transcript_text     TEXT,                                  -- transcrição completa (Whisper)
    ai_summary          TEXT,                                  -- resumo gerado por GPT-4o
    ai_decisions        JSONB NOT NULL DEFAULT '[]',           -- decisões extraídas
    ai_action_items     JSONB NOT NULL DEFAULT '[]',           -- tarefas geradas pela IA
    ai_risks_mentioned  JSONB NOT NULL DEFAULT '[]',           -- riscos identificados na reunião
    ai_processed_at     TIMESTAMPTZ,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meetings_tenant ON meetings(tenant_id);
CREATE INDEX idx_meetings_project ON meetings(project_id);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_scheduled ON meetings(scheduled_at);

-- Participantes de reuniões
CREATE TABLE meeting_participants (
    meeting_id      UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ,
    left_at         TIMESTAMPTZ,
    duration_seconds INTEGER,
    is_host         BOOLEAN NOT NULL DEFAULT FALSE,
    camera_on       BOOLEAN,
    mic_on          BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(meeting_id, user_id)
);

CREATE INDEX idx_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX idx_participants_user ON meeting_participants(user_id);

-- FKs de meetings adicionadas agora que a tabela existe
ALTER TABLE messages ADD CONSTRAINT fk_messages_meeting
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL;

ALTER TABLE attachments ADD CONSTRAINT fk_attachments_meeting
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE;

-- ============================================================
-- MÓDULO 7 — BILLING & PLANOS
-- ============================================================

-- Planos disponíveis (configuração de produto)
CREATE TABLE subscription_plans (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                plan_type NOT NULL UNIQUE,
    display_name        VARCHAR(100) NOT NULL,
    description         TEXT,
    price_monthly_usd   NUMERIC(8, 2) NOT NULL,
    price_annual_usd    NUMERIC(8, 2) NOT NULL,
    max_members         INTEGER NOT NULL,
    max_projects        INTEGER NOT NULL,
    max_storage_gb      INTEGER NOT NULL,
    max_meetings_month  INTEGER,                               -- NULL = ilimitado
    has_ai_predictive   BOOLEAN NOT NULL DEFAULT FALSE,
    has_power_bi        BOOLEAN NOT NULL DEFAULT FALSE,
    has_api_access      BOOLEAN NOT NULL DEFAULT FALSE,
    has_sso             BOOLEAN NOT NULL DEFAULT FALSE,
    has_audit_logs      BOOLEAN NOT NULL DEFAULT FALSE,
    has_custom_domain   BOOLEAN NOT NULL DEFAULT FALSE,
    features            JSONB NOT NULL DEFAULT '[]',           -- lista de features do plano
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dados seed dos planos
INSERT INTO subscription_plans (name, display_name, description, price_monthly_usd, price_annual_usd, max_members, max_projects, max_storage_gb, max_meetings_month, has_ai_predictive, has_power_bi, has_api_access, has_sso, has_audit_logs, has_custom_domain, features) VALUES
('starter',    'Starter',    'Para pequenas empresas e startups',           49,  470,  10,   5,   5,   20,  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE,
 '["Chat por projecto", "Videochamadas (até 10 participantes)", "Resumo IA básico", "Microsoft 365 integrado", "Dashboard básico"]'),
('growth',     'Growth',     'Para equipas médias em crescimento',         149, 1430,  50,  25,  50,   NULL, TRUE,  FALSE, TRUE,  FALSE, TRUE,  FALSE,
 '["Tudo do Starter", "IA preditiva (atrasos e riscos)", "Canais ilimitados", "API pública", "Audit logs 90 dias", "Videochamadas ilimitadas", "Gravação de reuniões 10GB"]'),
('enterprise', 'Enterprise', 'Para grandes empresas e indústrias críticas', 399, 3830, NULL, NULL, NULL,  NULL, TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,
 '["Tudo do Growth", "Power BI integrado", "SSO/SAML enterprise", "IA preditiva avançada por vertical", "Domínio custom", "SLA 99.9%", "Suporte dedicado", "Audit logs ilimitados", "Backup dedicado"]');

-- Subscriptions activas por tenant
CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id             UUID NOT NULL REFERENCES subscription_plans(id),
    status              billing_status NOT NULL DEFAULT 'trialing',
    billing_interval    billing_interval NOT NULL DEFAULT 'monthly',
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end  TIMESTAMPTZ NOT NULL,
    trial_start         TIMESTAMPTZ,
    trial_end           TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    -- Stripe
    stripe_customer_id      VARCHAR(255),
    stripe_subscription_id  VARCHAR(255) UNIQUE,
    stripe_price_id         VARCHAR(255),
    -- Seats
    seats_purchased     INTEGER NOT NULL DEFAULT 1,
    seats_used          INTEGER NOT NULL DEFAULT 0,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- Histórico de facturas
CREATE TABLE invoices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    subscription_id     UUID NOT NULL REFERENCES subscriptions(id),
    stripe_invoice_id   VARCHAR(255) UNIQUE,
    invoice_number      VARCHAR(50),
    status              VARCHAR(30) NOT NULL,                  -- draft, open, paid, void, uncollectible
    amount_due          NUMERIC(10, 2) NOT NULL,
    amount_paid         NUMERIC(10, 2) NOT NULL DEFAULT 0,
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    invoice_pdf_url     TEXT,
    period_start        TIMESTAMPTZ NOT NULL,
    period_end          TIMESTAMPTZ NOT NULL,
    paid_at             TIMESTAMPTZ,
    due_date            TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX idx_invoices_stripe ON invoices(stripe_invoice_id);

-- Uso por tenant (para metering e limites)
CREATE TABLE usage_records (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    metric          VARCHAR(50) NOT NULL,                      -- 'api_calls', 'ai_requests', 'storage_gb', 'meeting_minutes'
    quantity        NUMERIC(12, 2) NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_usage_tenant ON usage_records(tenant_id);
CREATE INDEX idx_usage_metric ON usage_records(tenant_id, metric, period_start);

-- ============================================================
-- MÓDULO 8 — INTEGRAÇÃO MICROSOFT 365
-- ============================================================

-- Configuração da integração M365 por tenant
CREATE TABLE microsoft365_integrations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    ms_tenant_id        VARCHAR(255) NOT NULL,                 -- Azure AD Tenant ID
    client_id           VARCHAR(255),
    access_token        TEXT,                                  -- encriptado
    refresh_token       TEXT,                                  -- encriptado
    token_expires_at    TIMESTAMPTZ,
    scope               TEXT,
    -- Features activas
    sync_calendar       BOOLEAN NOT NULL DEFAULT TRUE,
    sync_onedrive       BOOLEAN NOT NULL DEFAULT TRUE,
    sync_outlook        BOOLEAN NOT NULL DEFAULT FALSE,
    sync_teams_calendar BOOLEAN NOT NULL DEFAULT FALSE,
    -- Estado
    last_sync_at        TIMESTAMPTZ,
    sync_error          TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Calendário Microsoft sincronizado com reuniões
CREATE TABLE microsoft_calendar_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meeting_id          UUID REFERENCES meetings(id) ON DELETE CASCADE,
    ms_event_id         VARCHAR(255) NOT NULL,                 -- ID no Microsoft Graph
    ms_calendar_id      VARCHAR(255),
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL,
    is_online_meeting   BOOLEAN NOT NULL DEFAULT FALSE,
    teams_join_url      TEXT,
    raw_event           JSONB NOT NULL DEFAULT '{}',
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, ms_event_id)
);

CREATE INDEX idx_ms_calendar_user ON microsoft_calendar_events(user_id);
CREATE INDEX idx_ms_calendar_meeting ON microsoft_calendar_events(meeting_id);
CREATE INDEX idx_ms_calendar_start ON microsoft_calendar_events(start_time);

-- Ficheiros OneDrive linkados a projectos/tarefas
CREATE TABLE onedrive_files (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    task_id         UUID REFERENCES tasks(id) ON DELETE CASCADE,
    ms_item_id      VARCHAR(255) NOT NULL,                     -- ID no OneDrive
    ms_drive_id     VARCHAR(255),
    name            VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT,
    mime_type       VARCHAR(100),
    web_url         TEXT,                                      -- URL de abertura no browser
    download_url    TEXT,
    thumbnail_url   TEXT,
    last_modified_at TIMESTAMPTZ,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_onedrive_project ON onedrive_files(project_id);
CREATE INDEX idx_onedrive_task ON onedrive_files(task_id);

-- ============================================================
-- MÓDULO 9 — IA PREDITIVA & ALERTAS
-- ============================================================

-- Previsões geradas pela IA por projecto/tarefa
CREATE TABLE ai_predictions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects(id) ON DELETE CASCADE,
    task_id             UUID REFERENCES tasks(id) ON DELETE CASCADE,
    type                ai_prediction_type NOT NULL,
    severity            ai_alert_severity NOT NULL DEFAULT 'info',
    score               NUMERIC(5, 4) NOT NULL CHECK (score BETWEEN 0 AND 1), -- 0=sem risco, 1=risco máximo
    confidence          NUMERIC(5, 4) CHECK (confidence BETWEEN 0 AND 1),
    title               VARCHAR(255) NOT NULL,
    explanation         TEXT NOT NULL,
    recommendations     JSONB NOT NULL DEFAULT '[]',
    input_features      JSONB NOT NULL DEFAULT '{}',           -- dados usados na previsão (auditável)
    model_version       VARCHAR(50),
    is_acknowledged     BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by     UUID REFERENCES users(id),
    acknowledged_at     TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_predictions_project ON ai_predictions(project_id);
CREATE INDEX idx_predictions_type ON ai_predictions(type);
CREATE INDEX idx_predictions_severity ON ai_predictions(severity);
CREATE INDEX idx_predictions_unack ON ai_predictions(tenant_id, is_acknowledged) WHERE is_acknowledged = FALSE;

-- Histórico de scores por projecto (time-series para trending)
CREATE TABLE ai_project_scores (
    id              BIGSERIAL PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    score_overall   NUMERIC(5, 4) NOT NULL,
    score_delay     NUMERIC(5, 4),
    score_budget    NUMERIC(5, 4),
    score_resource  NUMERIC(5, 4),
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scores_project ON ai_project_scores(project_id, recorded_at DESC);

-- Webhooks configurados por tenant (plataforma aberta)
CREATE TABLE webhooks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    url             TEXT NOT NULL,
    secret          TEXT NOT NULL,                             -- HMAC signing secret
    events          webhook_event[] NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_tenant ON webhooks(tenant_id);

-- Log de entregas de webhooks
CREATE TABLE webhook_deliveries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id      UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event           webhook_event NOT NULL,
    payload         JSONB NOT NULL,
    response_status INTEGER,
    response_body   TEXT,
    duration_ms     INTEGER,
    success         BOOLEAN NOT NULL DEFAULT FALSE,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at DESC);

-- ============================================================
-- FUNÇÕES & TRIGGERS UTILITÁRIOS
-- ============================================================

-- Trigger: actualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a todas as tabelas com updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'updated_at'
        AND table_schema = 'public'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
            t, t
        );
    END LOOP;
END;
$$;

-- Trigger: actualiza last_message_at no canal quando nova mensagem
CREATE OR REPLACE FUNCTION update_channel_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE channels
    SET last_message_at = NEW.created_at,
        message_count = message_count + 1
    WHERE id = NEW.channel_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_update_channel
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION update_channel_last_message();

-- Trigger: actualiza progresso do projecto quando tarefa muda de status
CREATE OR REPLACE FUNCTION update_project_progress()
RETURNS TRIGGER AS $$
DECLARE
    total_tasks INTEGER;
    done_tasks  INTEGER;
BEGIN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'done')
    INTO total_tasks, done_tasks
    FROM tasks
    WHERE project_id = NEW.project_id
    AND deleted_at IS NULL
    AND parent_task_id IS NULL;

    IF total_tasks > 0 THEN
        UPDATE projects
        SET progress_percent = ROUND((done_tasks::NUMERIC / total_tasks) * 100)
        WHERE id = NEW.project_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_update_progress
    AFTER INSERT OR UPDATE OF status ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_project_progress();

-- Trigger: actualiza storage_used_bytes do tenant quando anexo é adicionado/removido
CREATE OR REPLACE FUNCTION update_tenant_storage()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE tenants SET storage_used_bytes = storage_used_bytes + NEW.file_size_bytes
        WHERE id = NEW.tenant_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE tenants SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes)
        WHERE id = OLD.tenant_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attachments_storage
    AFTER INSERT OR DELETE ON attachments
    FOR EACH ROW EXECUTE FUNCTION update_tenant_storage();

-- ============================================================
-- VIEWS ÚTEIS PARA O BACKEND
-- ============================================================

-- View: projectos com métricas calculadas
CREATE VIEW v_project_summary AS
SELECT
    p.id,
    p.tenant_id,
    p.name,
    p.status,
    p.priority,
    p.due_date,
    p.progress_percent,
    p.budget_amount,
    p.budget_spent,
    ROUND((p.budget_spent / NULLIF(p.budget_amount, 0)) * 100, 2) AS budget_used_percent,
    p.start_date,
    CASE WHEN p.due_date < NOW() AND p.status NOT IN ('completed', 'cancelled')
         THEN TRUE ELSE FALSE END AS is_overdue,
    COUNT(DISTINCT pm.user_id) AS member_count,
    COUNT(DISTINCT t.id) AS total_tasks,
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'done') AS done_tasks,
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'in_progress') AS active_tasks,
    MAX(ap.score_overall) AS ai_risk_score,
    p.created_at,
    p.updated_at
FROM projects p
LEFT JOIN project_members pm ON pm.project_id = p.id
LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
LEFT JOIN LATERAL (
    SELECT score_overall FROM ai_project_scores
    WHERE project_id = p.id ORDER BY recorded_at DESC LIMIT 1
) ap ON TRUE
WHERE p.deleted_at IS NULL
GROUP BY p.id, ap.score_overall;

-- View: dashboard executivo por tenant
CREATE VIEW v_tenant_dashboard AS
SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.plan,
    COUNT(DISTINCT u.id) AS total_users,
    COUNT(DISTINCT p.id) AS total_projects,
    COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'active') AS active_projects,
    COUNT(DISTINCT p.id) FILTER (WHERE p.due_date < NOW() AND p.status NOT IN ('completed','cancelled')) AS overdue_projects,
    COUNT(DISTINCT tk.id) FILTER (WHERE tk.status = 'in_progress') AS tasks_in_progress,
    COUNT(DISTINCT m.id) FILTER (WHERE m.status = 'live') AS live_meetings,
    t.storage_used_bytes,
    t.max_storage_gb * 1073741824 AS storage_limit_bytes,
    ROUND((t.storage_used_bytes::NUMERIC / NULLIF(t.max_storage_gb * 1073741824, 0)) * 100, 2) AS storage_used_percent
FROM tenants t
LEFT JOIN users u ON u.tenant_id = t.id AND u.deleted_at IS NULL
LEFT JOIN projects p ON p.tenant_id = t.id AND p.deleted_at IS NULL
LEFT JOIN tasks tk ON tk.tenant_id = t.id AND tk.deleted_at IS NULL
LEFT JOIN meetings m ON m.tenant_id = t.id
WHERE t.deleted_at IS NULL AND t.is_active = TRUE
GROUP BY t.id;

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Isolamento multi-tenant
-- ============================================================

-- Activar RLS nas tabelas críticas
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

-- Política de exemplo (aplicar tenant_id do JWT via app.current_tenant_id)
-- O backend define: SET app.current_tenant_id = 'uuid-do-tenant';

CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_projects ON projects
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_tasks ON tasks
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_channels ON channels
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE POLICY tenant_isolation_messages ON messages
    USING (
        channel_id IN (
            SELECT id FROM channels
            WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
        )
    );

CREATE POLICY tenant_isolation_meetings ON meetings
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

-- ============================================================
-- FIM DO SCHEMA
-- ============================================================
-- Tabelas criadas: 35
-- Índices criados: 60+
-- Triggers: 4
-- Views: 2
-- RLS Policies: 6
-- ============================================================