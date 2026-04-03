import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';

import { isPostgresEnabled, query, withTransaction } from '@ngola/database';

import {
  Label,
  Project,
  ProjectMember,
  ProjectPhase,
  ProjectTemplate,
  Task,
  Tenant,
} from './project.types';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  industry_vertical: Tenant['industryVertical'];
  plan: Tenant['plan'];
  timezone: string;
  locale: string;
  created_at: string;
  updated_at: string;
}

interface TemplateRow {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  industry: ProjectTemplate['industry'] | null;
  icon: string | null;
  color: string | null;
  phases: ProjectTemplate['phases'];
  task_templates: ProjectTemplate['taskTemplates'];
  is_public: boolean;
  created_by: string | null;
  created_at: string;
}

interface ProjectRow {
  id: string;
  tenant_id: string;
  team_id: string | null;
  template_id: string | null;
  name: string;
  description: string | null;
  status: Project['status'];
  industry_vertical: Project['industryVertical'] | null;
  color: string | null;
  start_date: string | null;
  due_date: string | null;
  priority: Project['priority'];
  custom_fields: Record<string, unknown>;
  progress_percent: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface PhaseRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  order_index: number;
  start_date: string | null;
  due_date: string | null;
  color: string | null;
  created_at: string;
}

interface LabelRow {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  tenant_id: string;
  project_id: string;
  phase_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: Task['status'];
  priority: Task['priority'];
  order_index: number;
  start_date: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  budget_amount: number | null;
  budget_spent: number;
  progress_percent: number;
  custom_fields: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface SubscriptionPlanRow {
  id: string;
  name: 'starter' | 'growth' | 'enterprise';
  display_name: string;
  description: string | null;
  price_monthly_usd: number;
  price_annual_usd: number;
  max_members: number | null;
  max_projects: number | null;
  max_storage_gb: number | null;
  max_meetings_month: number | null;
  features: unknown;
  is_active: boolean;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: 'active' | 'past_due' | 'cancelled' | 'trialing' | 'paused';
  billing_interval: 'monthly' | 'annual';
  current_period_start: string;
  current_period_end: string;
  cancelled_at: string | null;
  cancel_at_period_end: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  updated_at: string;
}

@Injectable()
export class ProjectService {
  private readonly usePostgres = isPostgresEnabled();
  private readonly tenants = new Map<string, Tenant>();
  private readonly templates = new Map<string, ProjectTemplate>();
  private readonly projects = new Map<string, Project>();
  private readonly phases = new Map<string, ProjectPhase>();
  private readonly tasks = new Map<string, Task>();
  private readonly labels = new Map<string, Label>();
  private readonly stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? process.env.Stripe_API_KEY?.trim();
  private readonly stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  private readonly stripe =
    this.stripeSecretKey && this.stripeSecretKey.length > 0
      ? new Stripe(this.stripeSecretKey, {
          apiVersion: '2024-06-20',
        })
      : undefined;

  async createTenant(payload: Partial<Tenant>): Promise<Tenant> {
    if (!payload.name || !payload.slug) {
      throw new BadRequestException('name and slug are required');
    }

    if (this.usePostgres) {
      const result = await query<TenantRow>(
        `INSERT INTO tenants (name, slug, industry_vertical, plan, timezone, locale)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, industry_vertical, plan, timezone, locale, created_at, updated_at`,
        [
          payload.name,
          payload.slug,
          payload.industryVertical ?? 'other',
          payload.plan ?? 'starter',
          payload.timezone ?? 'Africa/Luanda',
          payload.locale ?? 'pt-AO',
        ],
      );
      return this.mapTenant(result.rows[0]);
    }

    const now = new Date().toISOString();
    const tenant: Tenant = {
      id: randomUUID(),
      name: payload.name,
      slug: payload.slug,
      industryVertical: payload.industryVertical ?? 'other',
      plan: payload.plan ?? 'starter',
      timezone: payload.timezone ?? 'Africa/Luanda',
      locale: payload.locale ?? 'pt-AO',
      ownerUserId: payload.ownerUserId,
      createdAt: now,
      updatedAt: now,
    };

    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async onboardingTenant(
    payload: Partial<Tenant> & { templates?: string[] },
  ): Promise<{ tenant: Tenant; templates: ProjectTemplate[] }> {
    const tenant = await this.createTenant(payload);
    const templates = await this.getTemplates();
    const selectedTemplates = templates.filter(
      template => template.isPublic && (!payload.templates?.length || payload.templates.includes(template.id)),
    );

    return { tenant, templates: selectedTemplates };
  }

  async getTenants(): Promise<Tenant[]> {
    if (this.usePostgres) {
      const result = await query<TenantRow>(
        `SELECT id, name, slug, industry_vertical, plan, timezone, locale, created_at, updated_at
         FROM tenants
         WHERE deleted_at IS NULL
         ORDER BY created_at ASC`,
      );
      return result.rows.map(row => this.mapTenant(row));
    }

    return [...this.tenants.values()];
  }

  async getTenant(id: string): Promise<Tenant> {
    if (this.usePostgres) {
      const result = await query<TenantRow>(
        `SELECT id, name, slug, industry_vertical, plan, timezone, locale, created_at, updated_at
         FROM tenants
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [id],
      );

      if (!result.rows[0]) {
        throw new NotFoundException('tenant not found');
      }

      return this.mapTenant(result.rows[0]);
    }

    return this.requireEntity(this.tenants, id, 'tenant');
  }

  async updateTenant(id: string, payload: Partial<Tenant>): Promise<Tenant> {
    if (this.usePostgres) {
      const current = await this.getTenant(id);
      const result = await query<TenantRow>(
        `UPDATE tenants
         SET name = $2,
             slug = $3,
             industry_vertical = $4,
             plan = $5,
             timezone = $6,
             locale = $7,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, slug, industry_vertical, plan, timezone, locale, created_at, updated_at`,
        [
          id,
          payload.name ?? current.name,
          payload.slug ?? current.slug,
          payload.industryVertical ?? current.industryVertical,
          payload.plan ?? current.plan,
          payload.timezone ?? current.timezone,
          payload.locale ?? current.locale,
        ],
      );
      return this.mapTenant(result.rows[0]);
    }

    const tenant = await this.getTenant(id);
    const updated: Tenant = {
      ...tenant,
      ...payload,
      id: tenant.id,
      updatedAt: new Date().toISOString(),
    };

    this.tenants.set(id, updated);
    return updated;
  }

  async deleteTenant(id: string): Promise<{ deleted: boolean }> {
    if (this.usePostgres) {
      const result = await query(`UPDATE tenants SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
      return { deleted: Boolean(result.rowCount) };
    }

    return { deleted: this.tenants.delete(id) };
  }

  async createTemplate(payload: Partial<ProjectTemplate>): Promise<ProjectTemplate> {
    if (!payload.name) {
      throw new BadRequestException('template name is required');
    }

    if (this.usePostgres) {
      const result = await query<TemplateRow>(
        `INSERT INTO project_templates (tenant_id, name, description, industry, icon, color, phases, task_templates, is_public, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)
         RETURNING id, tenant_id, name, description, industry, icon, color, phases, task_templates, is_public, created_by, created_at`,
        [
          payload.tenantId ?? null,
          payload.name,
          payload.description ?? null,
          payload.industry ?? null,
          payload.icon ?? null,
          payload.color ?? null,
          JSON.stringify(payload.phases ?? []),
          JSON.stringify(payload.taskTemplates ?? []),
          payload.isPublic ?? false,
          payload.createdBy ?? null,
        ],
      );
      return this.mapTemplate(result.rows[0]);
    }

    const template: ProjectTemplate = {
      id: randomUUID(),
      tenantId: payload.tenantId,
      name: payload.name,
      description: payload.description,
      industry: payload.industry,
      icon: payload.icon,
      color: payload.color,
      phases: payload.phases ?? [],
      taskTemplates: payload.taskTemplates ?? [],
      isPublic: payload.isPublic ?? false,
      createdBy: payload.createdBy,
      createdAt: new Date().toISOString(),
    };

    this.templates.set(template.id, template);
    return template;
  }

  async getTemplates(industry?: string): Promise<ProjectTemplate[]> {
    if (this.usePostgres) {
      const result = await query<TemplateRow>(
        `SELECT id, tenant_id, name, description, industry, icon, color, phases, task_templates, is_public, created_by, created_at
         FROM project_templates
         WHERE ($1::text IS NULL OR industry = $1 OR is_public = TRUE)
         ORDER BY created_at ASC`,
        [industry ?? null],
      );
      return result.rows.map(row => this.mapTemplate(row));
    }

    return [...this.templates.values()].filter(
      template => !industry || template.industry === industry || template.isPublic,
    );
  }

  async createProject(payload: Partial<Project>): Promise<Project> {
    if (!payload.tenantId || !payload.name || !payload.createdBy) {
      throw new BadRequestException('tenantId, name and createdBy are required');
    }

    if (this.usePostgres) {
      const projectId = await withTransaction(async (client: PoolClient) => {
        const result = await client.query<ProjectRow>(
          `INSERT INTO projects (
             tenant_id, team_id, template_id, name, description, status, industry_vertical, color,
             start_date, due_date, priority, custom_fields, progress_percent, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
           RETURNING id, tenant_id, team_id, template_id, name, description, status, industry_vertical, color,
                     start_date, due_date, priority, custom_fields, progress_percent, created_by, created_at, updated_at`,
          [
            payload.tenantId,
            payload.teamId ?? null,
            payload.templateId ?? null,
            payload.name,
            payload.description ?? null,
            payload.status ?? 'planning',
            payload.industryVertical ?? null,
            payload.color ?? null,
            payload.startDate ?? null,
            payload.dueDate ?? null,
            payload.priority ?? 'medium',
            JSON.stringify(payload.customFields ?? {}),
            payload.progressPercent ?? 0,
            payload.createdBy,
          ],
        );

        const projectId = result.rows[0].id;
        await this.replaceProjectMembers(client, projectId, payload.members ?? []);

        if (payload.templateId) {
          const templateResult = await client.query<TemplateRow>(
            `SELECT id, tenant_id, name, description, industry, icon, color, phases, task_templates, is_public, created_by, created_at
             FROM project_templates
             WHERE id = $1
             LIMIT 1`,
            [payload.templateId],
          );
          const template = templateResult.rows[0];

          if (template) {
            for (const [index, phase] of (template.phases ?? []).entries()) {
              await client.query(
                `INSERT INTO project_phases (project_id, name, description, order_index, color)
                 VALUES ($1, $2, $3, $4, $5)`,
                [projectId, phase.name, phase.description ?? null, index, payload.color ?? null],
              );
            }
          }
        }

        return projectId;
      });
      return this.getProject(projectId);
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      tenantId: payload.tenantId,
      teamId: payload.teamId,
      templateId: payload.templateId,
      name: payload.name,
      description: payload.description,
      status: payload.status ?? 'planning',
      industryVertical: payload.industryVertical,
      color: payload.color,
      startDate: payload.startDate,
      dueDate: payload.dueDate,
      priority: payload.priority ?? 'medium',
      customFields: payload.customFields ?? {},
      progressPercent: payload.progressPercent ?? 0,
      createdBy: payload.createdBy,
      createdAt: now,
      updatedAt: now,
      members: this.normalizeMembers(payload.members ?? []),
    };

    this.projects.set(project.id, project);

    if (project.templateId) {
      const template = this.templates.get(project.templateId);
      if (template) {
        await Promise.all(
          template.phases.map((phase, index) =>
            this.createPhase({
              projectId: project.id,
              name: phase.name,
              description: phase.description,
              orderIndex: index,
            }),
          ),
        );
      }
    }

    return project;
  }

  async getProjects(tenantId?: string): Promise<Project[]> {
    if (this.usePostgres) {
      const result = await query<ProjectRow>(
        `SELECT id, tenant_id, team_id, template_id, name, description, status, industry_vertical, color,
                start_date, due_date, priority, custom_fields, progress_percent, created_by, created_at, updated_at
         FROM projects
         WHERE deleted_at IS NULL
           AND ($1::uuid IS NULL OR tenant_id = $1)
         ORDER BY created_at DESC`,
        [tenantId ?? null],
      );

      const projects = await Promise.all(
        result.rows.map(async row => this.mapProject(row, await this.fetchProjectMembers(row.id))),
      );
      return projects;
    }

    return [...this.projects.values()].filter(project => !tenantId || project.tenantId === tenantId);
  }

  async getProject(id: string): Promise<Project> {
    if (this.usePostgres) {
      const result = await query<ProjectRow>(
        `SELECT id, tenant_id, team_id, template_id, name, description, status, industry_vertical, color,
                start_date, due_date, priority, custom_fields, progress_percent, created_by, created_at, updated_at
         FROM projects
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [id],
      );

      if (!result.rows[0]) {
        throw new NotFoundException('project not found');
      }

      return this.mapProject(result.rows[0], await this.fetchProjectMembers(id));
    }

    return this.requireEntity(this.projects, id, 'project');
  }

  async updateProject(id: string, payload: Partial<Project>): Promise<Project> {
    if (this.usePostgres) {
      const current = await this.getProject(id);
      await withTransaction(async (client: PoolClient) => {
        await client.query(
          `UPDATE projects
           SET team_id = $2,
               template_id = $3,
               name = $4,
               description = $5,
               status = $6,
               industry_vertical = $7,
               color = $8,
               start_date = $9,
               due_date = $10,
               priority = $11,
               custom_fields = $12::jsonb,
               progress_percent = $13,
               updated_at = NOW()
           WHERE id = $1`,
          [
            id,
            payload.teamId ?? current.teamId ?? null,
            payload.templateId ?? current.templateId ?? null,
            payload.name ?? current.name,
            payload.description ?? current.description ?? null,
            payload.status ?? current.status,
            payload.industryVertical ?? current.industryVertical ?? null,
            payload.color ?? current.color ?? null,
            payload.startDate ?? current.startDate ?? null,
            payload.dueDate ?? current.dueDate ?? null,
            payload.priority ?? current.priority,
            JSON.stringify(payload.customFields ?? current.customFields),
            payload.progressPercent ?? current.progressPercent,
          ],
        );

        if (payload.members) {
          await this.replaceProjectMembers(client, id, payload.members);
        }
      });
      return this.getProject(id);
    }

    const project = await this.getProject(id);
    const updated: Project = {
      ...project,
      ...payload,
      id: project.id,
      tenantId: project.tenantId,
      createdBy: project.createdBy,
      members: payload.members ? this.normalizeMembers(payload.members) : project.members,
      updatedAt: new Date().toISOString(),
    };

    this.projects.set(id, updated);
    return updated;
  }

  async deleteProject(id: string): Promise<{ deleted: boolean }> {
    if (this.usePostgres) {
      const result = await query(`UPDATE projects SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
      return { deleted: Boolean(result.rowCount) };
    }

    return { deleted: this.projects.delete(id) };
  }

  async createPhase(payload: Partial<ProjectPhase>): Promise<ProjectPhase> {
    if (!payload.projectId || !payload.name) {
      throw new BadRequestException('projectId and name are required');
    }

    if (this.usePostgres) {
      const currentPhases = await this.getPhases(payload.projectId);
      const result = await query<PhaseRow>(
        `INSERT INTO project_phases (project_id, name, description, order_index, start_date, due_date, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, project_id, name, description, order_index, start_date, due_date, color, created_at`,
        [
          payload.projectId,
          payload.name,
          payload.description ?? null,
          payload.orderIndex ?? currentPhases.length,
          payload.startDate ?? null,
          payload.dueDate ?? null,
          payload.color ?? null,
        ],
      );
      return this.mapPhase(result.rows[0]);
    }

    const phase: ProjectPhase = {
      id: randomUUID(),
      projectId: payload.projectId,
      name: payload.name,
      description: payload.description,
      orderIndex: payload.orderIndex ?? (await this.getPhases(payload.projectId)).length,
      startDate: payload.startDate,
      dueDate: payload.dueDate,
      color: payload.color,
      createdAt: new Date().toISOString(),
    };

    this.phases.set(phase.id, phase);
    return phase;
  }

  async getPhases(projectId?: string): Promise<ProjectPhase[]> {
    if (this.usePostgres) {
      const result = await query<PhaseRow>(
        `SELECT id, project_id, name, description, order_index, start_date, due_date, color, created_at
         FROM project_phases
         WHERE ($1::uuid IS NULL OR project_id = $1)
         ORDER BY order_index ASC, created_at ASC`,
        [projectId ?? null],
      );
      return result.rows.map(row => this.mapPhase(row));
    }

    return [...this.phases.values()]
      .filter(phase => !projectId || phase.projectId === projectId)
      .sort((left, right) => left.orderIndex - right.orderIndex);
  }

  async updatePhase(id: string, payload: Partial<ProjectPhase>): Promise<ProjectPhase> {
    if (this.usePostgres) {
      const current = await this.requirePhase(id);
      const result = await query<PhaseRow>(
        `UPDATE project_phases
         SET name = $2,
             description = $3,
             order_index = $4,
             start_date = $5,
             due_date = $6,
             color = $7
         WHERE id = $1
         RETURNING id, project_id, name, description, order_index, start_date, due_date, color, created_at`,
        [
          id,
          payload.name ?? current.name,
          payload.description ?? current.description ?? null,
          payload.orderIndex ?? current.orderIndex,
          payload.startDate ?? current.startDate ?? null,
          payload.dueDate ?? current.dueDate ?? null,
          payload.color ?? current.color ?? null,
        ],
      );
      return this.mapPhase(result.rows[0]);
    }

    const phase = this.requireEntity(this.phases, id, 'phase');
    const updated: ProjectPhase = {
      ...phase,
      ...payload,
      id: phase.id,
      projectId: phase.projectId,
    };

    this.phases.set(id, updated);
    return updated;
  }

  async deletePhase(id: string): Promise<{ deleted: boolean }> {
    if (this.usePostgres) {
      const result = await query('DELETE FROM project_phases WHERE id = $1', [id]);
      return { deleted: Boolean(result.rowCount) };
    }

    return { deleted: this.phases.delete(id) };
  }

  async createLabel(payload: Partial<Label>): Promise<Label> {
    if (!payload.tenantId || !payload.name) {
      throw new BadRequestException('tenantId and name are required');
    }

    if (this.usePostgres) {
      const result = await query<LabelRow>(
        `INSERT INTO labels (tenant_id, name, color)
         VALUES ($1, $2, $3)
         RETURNING id, tenant_id, name, color, created_at`,
        [payload.tenantId, payload.name, payload.color ?? '#0A2463'],
      );
      return this.mapLabel(result.rows[0]);
    }

    const label: Label = {
      id: randomUUID(),
      tenantId: payload.tenantId,
      name: payload.name,
      color: payload.color ?? '#0A2463',
      createdAt: new Date().toISOString(),
    };

    this.labels.set(label.id, label);
    return label;
  }

  async getLabels(tenantId?: string): Promise<Label[]> {
    if (this.usePostgres) {
      const result = await query<LabelRow>(
        `SELECT id, tenant_id, name, color, created_at
         FROM labels
         WHERE ($1::uuid IS NULL OR tenant_id = $1)
         ORDER BY created_at ASC`,
        [tenantId ?? null],
      );
      return result.rows.map(row => this.mapLabel(row));
    }

    return [...this.labels.values()].filter(label => !tenantId || label.tenantId === tenantId);
  }

  async createTask(payload: Partial<Task>): Promise<Task> {
    if (!payload.tenantId || !payload.projectId || !payload.title || !payload.createdBy) {
      throw new BadRequestException('tenantId, projectId, title and createdBy are required');
    }

    if (this.usePostgres) {
      const taskId = await withTransaction(async (client: PoolClient) => {
        const result = await client.query<TaskRow>(
          `INSERT INTO tasks (
             tenant_id, project_id, phase_id, parent_task_id, title, description, status, priority,
             order_index, start_date, due_date, estimated_hours, actual_hours, budget_amount,
             budget_spent, progress_percent, custom_fields, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18)
           RETURNING id, tenant_id, project_id, phase_id, parent_task_id, title, description, status, priority,
                     order_index, start_date, due_date, estimated_hours, actual_hours, budget_amount,
                     budget_spent, progress_percent, custom_fields, created_by, created_at, updated_at`,
          [
            payload.tenantId,
            payload.projectId,
            payload.phaseId ?? null,
            payload.parentTaskId ?? null,
            payload.title,
            payload.description ?? null,
            payload.status ?? 'todo',
            payload.priority ?? 'medium',
            payload.orderIndex ?? 0,
            payload.startDate ?? null,
            payload.dueDate ?? null,
            payload.estimatedHours ?? null,
            payload.actualHours ?? null,
            payload.budgetAmount ?? null,
            payload.budgetSpent ?? 0,
            payload.progressPercent ?? 0,
            JSON.stringify(payload.customFields ?? {}),
            payload.createdBy,
          ],
        );

        await this.replaceTaskRelations(client, result.rows[0].id, payload);
        return result.rows[0].id;
      });
      return this.getTask(taskId);
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: randomUUID(),
      tenantId: payload.tenantId,
      projectId: payload.projectId,
      phaseId: payload.phaseId,
      parentTaskId: payload.parentTaskId,
      title: payload.title,
      description: payload.description,
      status: payload.status ?? 'todo',
      priority: payload.priority ?? 'medium',
      orderIndex: payload.orderIndex ?? 0,
      startDate: payload.startDate,
      dueDate: payload.dueDate,
      estimatedHours: payload.estimatedHours,
      actualHours: payload.actualHours,
      budgetAmount: payload.budgetAmount,
      budgetSpent: payload.budgetSpent ?? 0,
      progressPercent: payload.progressPercent ?? 0,
      customFields: payload.customFields ?? {},
      createdBy: payload.createdBy,
      createdAt: now,
      updatedAt: now,
      assigneeIds: payload.assigneeIds ?? [],
      labelIds: payload.labelIds ?? [],
      dependencyIds: payload.dependencyIds ?? [],
    };

    this.tasks.set(task.id, task);
    return task;
  }

  async getTasks(projectId?: string): Promise<Task[]> {
    if (this.usePostgres) {
      const result = await query<TaskRow>(
        `SELECT id, tenant_id, project_id, phase_id, parent_task_id, title, description, status, priority,
                order_index, start_date, due_date, estimated_hours, actual_hours, budget_amount,
                budget_spent, progress_percent, custom_fields, created_by, created_at, updated_at
         FROM tasks
         WHERE deleted_at IS NULL
           AND ($1::uuid IS NULL OR project_id = $1)
         ORDER BY created_at DESC`,
        [projectId ?? null],
      );

      return Promise.all(result.rows.map(async row => this.mapTask(row)));
    }

    return [...this.tasks.values()].filter(task => !projectId || task.projectId === projectId);
  }

  async getTask(id: string): Promise<Task> {
    if (this.usePostgres) {
      const result = await query<TaskRow>(
        `SELECT id, tenant_id, project_id, phase_id, parent_task_id, title, description, status, priority,
                order_index, start_date, due_date, estimated_hours, actual_hours, budget_amount,
                budget_spent, progress_percent, custom_fields, created_by, created_at, updated_at
         FROM tasks
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [id],
      );

      if (!result.rows[0]) {
        throw new NotFoundException('task not found');
      }

      return this.mapTask(result.rows[0]);
    }

    return this.requireEntity(this.tasks, id, 'task');
  }

  async updateTask(id: string, payload: Partial<Task>): Promise<Task> {
    if (this.usePostgres) {
      const current = await this.getTask(id);
      await withTransaction(async (client: PoolClient) => {
        await client.query(
          `UPDATE tasks
           SET phase_id = $2,
               parent_task_id = $3,
               title = $4,
               description = $5,
               status = $6,
               priority = $7,
               order_index = $8,
               start_date = $9,
               due_date = $10,
               estimated_hours = $11,
               actual_hours = $12,
               budget_amount = $13,
               budget_spent = $14,
               progress_percent = $15,
               custom_fields = $16::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [
            id,
            payload.phaseId ?? current.phaseId ?? null,
            payload.parentTaskId ?? current.parentTaskId ?? null,
            payload.title ?? current.title,
            payload.description ?? current.description ?? null,
            payload.status ?? current.status,
            payload.priority ?? current.priority,
            payload.orderIndex ?? current.orderIndex,
            payload.startDate ?? current.startDate ?? null,
            payload.dueDate ?? current.dueDate ?? null,
            payload.estimatedHours ?? current.estimatedHours ?? null,
            payload.actualHours ?? current.actualHours ?? null,
            payload.budgetAmount ?? current.budgetAmount ?? null,
            payload.budgetSpent ?? current.budgetSpent,
            payload.progressPercent ?? current.progressPercent,
            JSON.stringify(payload.customFields ?? current.customFields),
          ],
        );

        await this.replaceTaskRelations(client, id, {
          assigneeIds: payload.assigneeIds ?? current.assigneeIds,
          labelIds: payload.labelIds ?? current.labelIds,
          dependencyIds: payload.dependencyIds ?? current.dependencyIds,
        });
      });
      return this.getTask(id);
    }

    const task = await this.getTask(id);
    const updated: Task = {
      ...task,
      ...payload,
      id: task.id,
      tenantId: task.tenantId,
      projectId: task.projectId,
      createdBy: task.createdBy,
      assigneeIds: payload.assigneeIds ?? task.assigneeIds,
      labelIds: payload.labelIds ?? task.labelIds,
      dependencyIds: payload.dependencyIds ?? task.dependencyIds,
      updatedAt: new Date().toISOString(),
    };

    this.tasks.set(id, updated);
    return updated;
  }

  async deleteTask(id: string): Promise<{ deleted: boolean }> {
    if (this.usePostgres) {
      const result = await query(`UPDATE tasks SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
      return { deleted: Boolean(result.rowCount) };
    }

    return { deleted: this.tasks.delete(id) };
  }

  async getBillingPlans(): Promise<Record<string, unknown>[]> {
    if (!this.usePostgres) {
      return [];
    }

    const result = await query<SubscriptionPlanRow>(
      `SELECT id, name, display_name, description, price_monthly_usd, price_annual_usd,
              max_members, max_projects, max_storage_gb, max_meetings_month, features, is_active
       FROM subscription_plans
       WHERE is_active = TRUE
       ORDER BY price_monthly_usd ASC`,
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description ?? undefined,
      prices: {
        monthlyUsd: Number(row.price_monthly_usd),
        annualUsd: Number(row.price_annual_usd),
      },
      limits: {
        maxMembers: row.max_members,
        maxProjects: row.max_projects,
        maxStorageGb: row.max_storage_gb,
        maxMeetingsMonth: row.max_meetings_month,
      },
      features: Array.isArray(row.features) ? row.features : [],
    }));
  }

  async getTenantBillingSubscription(tenantId: string): Promise<Record<string, unknown>> {
    if (!this.usePostgres) {
      return { tenantId, subscription: null };
    }

    const result = await query<SubscriptionRow & SubscriptionPlanRow>(
      `SELECT s.id, s.tenant_id, s.plan_id, s.status, s.billing_interval, s.current_period_start,
              s.current_period_end, s.cancelled_at, s.cancel_at_period_end, s.stripe_customer_id,
              s.stripe_subscription_id, s.stripe_price_id, s.updated_at,
              p.name, p.display_name, p.description, p.price_monthly_usd, p.price_annual_usd,
              p.max_members, p.max_projects, p.max_storage_gb, p.max_meetings_month, p.features, p.is_active
       FROM subscriptions s
       INNER JOIN subscription_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1
       ORDER BY s.updated_at DESC
       LIMIT 1`,
      [tenantId],
    );

    const row = result.rows[0];
    if (!row) return { tenantId, subscription: null };

    return {
      tenantId,
      subscription: {
        id: row.id,
        status: row.status,
        billingInterval: row.billing_interval,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        cancelledAt: row.cancelled_at,
        stripeCustomerId: row.stripe_customer_id,
        stripeSubscriptionId: row.stripe_subscription_id,
        plan: {
          id: row.plan_id,
          name: row.name,
          displayName: row.display_name,
          description: row.description ?? undefined,
        },
      },
    };
  }

  async createStripeCheckoutSession(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.stripe) {
      throw new ServiceUnavailableException('stripe not configured');
    }
    if (!this.usePostgres) {
      throw new ServiceUnavailableException('billing requires postgres');
    }

    const tenantId = String(payload.tenantId ?? '');
    const planName = String(payload.planName ?? '');
    const billingInterval = payload.billingInterval === 'annual' ? 'annual' : 'monthly';
    const successUrl =
      typeof payload.successUrl === 'string'
        ? payload.successUrl
        : process.env.STRIPE_CHECKOUT_SUCCESS_URL ??
          'http://localhost:3000/billing/success?session_id={CHECKOUT_SESSION_ID}';
    const cancelUrl =
      typeof payload.cancelUrl === 'string'
        ? payload.cancelUrl
        : process.env.STRIPE_CHECKOUT_CANCEL_URL ?? 'http://localhost:3000/billing/cancel';
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    if (!tenantId || !planName) {
      throw new BadRequestException('tenantId and planName are required');
    }

    this.assertAllowedCheckoutRedirect(successUrl);
    this.assertAllowedCheckoutRedirect(cancelUrl);

    const tenantResult = await query<{ id: string; name: string }>(
      `SELECT id, name FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    if (!tenantResult.rows[0]) {
      throw new NotFoundException('tenant not found');
    }

    const planResult = await query<SubscriptionPlanRow>(
      `SELECT id, name, display_name, description, price_monthly_usd, price_annual_usd,
              max_members, max_projects, max_storage_gb, max_meetings_month, features, is_active
       FROM subscription_plans
       WHERE name = $1::plan_type AND is_active = TRUE
       LIMIT 1`,
      [planName],
    );
    const plan = planResult.rows[0];
    if (!plan) {
      throw new NotFoundException('plan not found');
    }

    const subscriptionResult = await query<SubscriptionRow>(
      `SELECT id, tenant_id, plan_id, status, billing_interval, current_period_start, current_period_end,
              cancelled_at, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id, updated_at
       FROM subscriptions
       WHERE tenant_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId],
    );
    const existing = subscriptionResult.rows[0];

    let customerId = existing?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email,
        name: tenantResult.rows[0].name,
        metadata: {
          tenantId,
        },
      });
      customerId = customer.id;
    }

    const amountUsd =
      billingInterval === 'annual' ? Number(plan.price_annual_usd) : Number(plan.price_monthly_usd);
    const interval = billingInterval === 'annual' ? 'year' : 'month';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(amountUsd * 100),
            recurring: { interval },
            product_data: {
              name: plan.display_name,
              description: plan.description ?? undefined,
              metadata: {
                tenantId,
                planId: plan.id,
                planName: plan.name,
              },
            },
          },
        },
      ],
      metadata: {
        tenantId,
        planId: plan.id,
        planName: plan.name,
        billingInterval,
      },
      subscription_data: {
        metadata: {
          tenantId,
          planId: plan.id,
          planName: plan.name,
          billingInterval,
        },
      },
    });

    return {
      id: session.id,
      url: session.url,
      tenantId,
      plan: plan.name,
      billingInterval,
    };
  }

  async handleStripeWebhook(rawBody: string, signature?: string): Promise<Record<string, unknown>> {
    if (!this.stripe) {
      throw new ServiceUnavailableException('stripe not configured');
    }
    if (!this.stripeWebhookSecret) {
      throw new ServiceUnavailableException('stripe webhook secret not configured');
    }
    if (!signature) {
      throw new BadRequestException('missing stripe-signature');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.stripeWebhookSecret);
    } catch {
      throw new BadRequestException('invalid stripe webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = String(session.metadata?.tenantId ?? '');
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (subscriptionId) {
          await this.syncStripeSubscriptionById(subscriptionId, tenantId || undefined);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncStripeSubscription(subscription);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.syncStripeInvoice(invoice);
        break;
      }
      default:
        break;
    }

    return { received: true, eventType: event.type };
  }

  health(): Record<string, number | string> {
    return {
      service: 'project-service',
      status: 'ok',
      tenants: this.tenants.size,
      templates: this.templates.size,
      projects: this.projects.size,
      phases: this.phases.size,
      tasks: this.tasks.size,
      labels: this.labels.size,
      persistence: this.usePostgres ? 'postgres' : 'memory',
    };
  }

  private async syncStripeSubscriptionById(subscriptionId: string, tenantHint?: string): Promise<void> {
    if (!this.stripe) return;
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    await this.syncStripeSubscription(subscription, tenantHint);
  }

  private async syncStripeSubscription(
    subscription: Stripe.Subscription,
    tenantHint?: string,
  ): Promise<void> {
    const tenantId = String(subscription.metadata?.tenantId ?? tenantHint ?? '');
    if (!tenantId) return;

    const metadataPlanId = String(subscription.metadata?.planId ?? '');
    let planId = metadataPlanId || undefined;

    if (!planId) {
      const existing = await query<{ plan_id: string }>(
        `SELECT plan_id
         FROM subscriptions
         WHERE stripe_subscription_id = $1
         LIMIT 1`,
        [subscription.id],
      );
      planId = existing.rows[0]?.plan_id;
    }

    if (!planId) {
      const defaultPlan = await query<{ id: string }>(
        `SELECT id FROM subscription_plans WHERE name = 'starter'::plan_type LIMIT 1`,
      );
      planId = defaultPlan.rows[0]?.id;
    }

    if (!planId) return;

    const status = this.mapStripeStatus(subscription.status);
    const priceId = subscription.items.data[0]?.price?.id ?? null;
    const interval =
      subscription.items.data[0]?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly';
    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    await query(
      `INSERT INTO subscriptions (
         tenant_id, plan_id, status, billing_interval, current_period_start, current_period_end,
         stripe_customer_id, stripe_subscription_id, stripe_price_id, cancel_at_period_end, cancelled_at, updated_at
       )
       VALUES ($1, $2, $3::billing_status, $4::billing_interval, to_timestamp($5), to_timestamp($6),
               $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (stripe_subscription_id)
       DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         plan_id = EXCLUDED.plan_id,
         status = EXCLUDED.status,
         billing_interval = EXCLUDED.billing_interval,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         stripe_customer_id = EXCLUDED.stripe_customer_id,
         stripe_price_id = EXCLUDED.stripe_price_id,
         cancel_at_period_end = EXCLUDED.cancel_at_period_end,
         cancelled_at = EXCLUDED.cancelled_at,
         updated_at = NOW()`,
      [
        tenantId,
        planId,
        status,
        interval,
        subscription.current_period_start,
        subscription.current_period_end,
        customerId,
        subscription.id,
        priceId,
        Boolean(subscription.cancel_at_period_end),
        subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      ],
    );
  }

  private async syncStripeInvoice(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId =
      typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
    if (!subscriptionId) return;

    const subscription = await query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id
       FROM subscriptions
       WHERE stripe_subscription_id = $1
       LIMIT 1`,
      [subscriptionId],
    );
    const current = subscription.rows[0];
    if (!current) return;

    await query(
      `INSERT INTO invoices (
         tenant_id, subscription_id, stripe_invoice_id, invoice_number, status, amount_due, amount_paid,
         currency, invoice_pdf_url, period_start, period_end, paid_at, due_date
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, upper($8), $9, to_timestamp($10), to_timestamp($11), $12, $13)
       ON CONFLICT (stripe_invoice_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         amount_due = EXCLUDED.amount_due,
         amount_paid = EXCLUDED.amount_paid,
         invoice_pdf_url = EXCLUDED.invoice_pdf_url,
         paid_at = EXCLUDED.paid_at,
         due_date = EXCLUDED.due_date`,
      [
        current.tenant_id,
        current.id,
        invoice.id,
        invoice.number ?? null,
        invoice.status ?? 'open',
        Number(invoice.amount_due ?? 0) / 100,
        Number(invoice.amount_paid ?? 0) / 100,
        invoice.currency ?? 'usd',
        invoice.hosted_invoice_url ?? null,
        invoice.period_start,
        invoice.period_end,
        invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : null,
        invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      ],
    );
  }

  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionRow['status'] {
    if (status === 'past_due' || status === 'unpaid') return 'past_due';
    if (status === 'canceled') return 'cancelled';
    if (status === 'paused') return 'paused';
    if (status === 'trialing') return 'trialing';
    return 'active';
  }

  private assertAllowedCheckoutRedirect(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('invalid checkout redirect URL');
    }

    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new BadRequestException('checkout redirect URL must use https');
    }

    const allowedOriginsRaw =
      process.env.STRIPE_ALLOWED_REDIRECT_ORIGINS ?? 'http://localhost:3000,https://localhost:3000';
    const allowedOrigins = allowedOriginsRaw
      .split(',')
      .map(origin => origin.trim())
      .filter(origin => origin.length > 0);

    if (allowedOrigins.length === 0) {
      return;
    }

    if (!allowedOrigins.includes(parsed.origin)) {
      throw new BadRequestException('checkout redirect origin is not allowed');
    }
  }

  private async replaceProjectMembers(client: PoolClient, projectId: string, members: ProjectMember[]): Promise<void> {
    await client.query('DELETE FROM project_members WHERE project_id = $1', [projectId]);
    for (const member of this.normalizeMembers(members)) {
      await client.query(
        `INSERT INTO project_members (project_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [projectId, member.userId, member.role],
      );
    }
  }

  private async replaceTaskRelations(
    client: PoolClient,
    taskId: string,
    payload: Partial<Task>,
  ): Promise<void> {
    await client.query('DELETE FROM task_assignees WHERE task_id = $1', [taskId]);
    await client.query('DELETE FROM task_labels WHERE task_id = $1', [taskId]);
    await client.query('DELETE FROM task_dependencies WHERE task_id = $1', [taskId]);

    for (const assigneeId of payload.assigneeIds ?? []) {
      await client.query(
        `INSERT INTO task_assignees (task_id, user_id, assigned_by)
         VALUES ($1, $2, $3)`,
        [taskId, assigneeId, payload.createdBy ?? null],
      );
    }

    for (const labelId of payload.labelIds ?? []) {
      await client.query(
        `INSERT INTO task_labels (task_id, label_id)
         VALUES ($1, $2)`,
        [taskId, labelId],
      );
    }

    for (const dependencyId of payload.dependencyIds ?? []) {
      await client.query(
        `INSERT INTO task_dependencies (task_id, depends_on_id)
         VALUES ($1, $2)`,
        [taskId, dependencyId],
      );
    }
  }

  private async fetchProjectMembers(projectId: string): Promise<ProjectMember[]> {
    const result = await query<{ user_id: string; role: ProjectMember['role'] }>(
      `SELECT user_id, role
       FROM project_members
       WHERE project_id = $1
       ORDER BY joined_at ASC`,
      [projectId],
    );
    return result.rows.map(row => ({ userId: row.user_id, role: row.role }));
  }

  private async mapTask(row: TaskRow): Promise<Task> {
    const [assignees, labels, dependencies] = await Promise.all([
      query<{ user_id: string }>('SELECT user_id FROM task_assignees WHERE task_id = $1', [row.id]),
      query<{ label_id: string }>('SELECT label_id FROM task_labels WHERE task_id = $1', [row.id]),
      query<{ depends_on_id: string }>('SELECT depends_on_id FROM task_dependencies WHERE task_id = $1', [row.id]),
    ]);

    return {
      id: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      phaseId: row.phase_id ?? undefined,
      parentTaskId: row.parent_task_id ?? undefined,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status,
      priority: row.priority,
      orderIndex: row.order_index,
      startDate: row.start_date ?? undefined,
      dueDate: row.due_date ?? undefined,
      estimatedHours: row.estimated_hours ?? undefined,
      actualHours: row.actual_hours ?? undefined,
      budgetAmount: row.budget_amount ?? undefined,
      budgetSpent: row.budget_spent,
      progressPercent: row.progress_percent,
      customFields: row.custom_fields ?? {},
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assigneeIds: assignees.rows.map(entry => entry.user_id),
      labelIds: labels.rows.map(entry => entry.label_id),
      dependencyIds: dependencies.rows.map(entry => entry.depends_on_id),
    };
  }

  private mapProject(row: ProjectRow, members: ProjectMember[]): Project {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      teamId: row.team_id ?? undefined,
      templateId: row.template_id ?? undefined,
      name: row.name,
      description: row.description ?? undefined,
      status: row.status,
      industryVertical: row.industry_vertical ?? undefined,
      color: row.color ?? undefined,
      startDate: row.start_date ?? undefined,
      dueDate: row.due_date ?? undefined,
      priority: row.priority,
      customFields: row.custom_fields ?? {},
      progressPercent: row.progress_percent,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      members,
    };
  }

  private mapPhase(row: PhaseRow): ProjectPhase {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description ?? undefined,
      orderIndex: row.order_index,
      startDate: row.start_date ?? undefined,
      dueDate: row.due_date ?? undefined,
      color: row.color ?? undefined,
      createdAt: row.created_at,
    };
  }

  private mapLabel(row: LabelRow): Label {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at,
    };
  }

  private mapTenant(row: TenantRow): Tenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      industryVertical: row.industry_vertical,
      plan: row.plan,
      timezone: row.timezone,
      locale: row.locale,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapTemplate(row: TemplateRow): ProjectTemplate {
    return {
      id: row.id,
      tenantId: row.tenant_id ?? undefined,
      name: row.name,
      description: row.description ?? undefined,
      industry: row.industry ?? undefined,
      icon: row.icon ?? undefined,
      color: row.color ?? undefined,
      phases: row.phases ?? [],
      taskTemplates: row.task_templates ?? [],
      isPublic: row.is_public,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
    };
  }

  private normalizeMembers(members: ProjectMember[]): ProjectMember[] {
    return members.map(member => ({
      userId: member.userId,
      role: member.role ?? 'member',
    }));
  }

  private requireEntity<T>(collection: Map<string, T>, id: string, name: string): T {
    const entity = collection.get(id);

    if (!entity) {
      throw new NotFoundException(`${name} not found`);
    }

    return entity;
  }

  private async requirePhase(id: string): Promise<ProjectPhase> {
    const phases = await this.getPhases();
    const phase = phases.find(entry => entry.id === id);
    if (!phase) {
      throw new NotFoundException('phase not found');
    }
    return phase;
  }
}
