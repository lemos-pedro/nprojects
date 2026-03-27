export type IndustryVertical =
  | 'telecom'
  | 'oil_energy'
  | 'construction'
  | 'financial'
  | 'tech_startup'
  | 'other';

export type ProjectStatus =
  | 'planning'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'cancelled'
  | 'archived';

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type MemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer' | 'guest';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  industryVertical: IndustryVertical;
  plan: 'starter' | 'growth' | 'enterprise';
  timezone: string;
  locale: string;
  ownerUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTemplate {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  industry?: IndustryVertical;
  icon?: string;
  color?: string;
  phases: Array<{ name: string; description?: string }>;
  taskTemplates: Array<{ title: string; description?: string; priority?: TaskPriority }>;
  isPublic: boolean;
  createdBy?: string;
  createdAt: string;
}

export interface ProjectMember {
  userId: string;
  role: MemberRole;
}

export interface Project {
  id: string;
  tenantId: string;
  teamId?: string;
  templateId?: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  industryVertical?: IndustryVertical;
  color?: string;
  startDate?: string;
  dueDate?: string;
  priority: TaskPriority;
  customFields: Record<string, unknown>;
  progressPercent: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members: ProjectMember[];
}

export interface ProjectPhase {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  orderIndex: number;
  startDate?: string;
  dueDate?: string;
  color?: string;
  createdAt: string;
}

export interface Label {
  id: string;
  tenantId: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface Task {
  id: string;
  tenantId: string;
  projectId: string;
  phaseId?: string;
  parentTaskId?: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  orderIndex: number;
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  actualHours?: number;
  budgetAmount?: number;
  budgetSpent: number;
  progressPercent: number;
  customFields: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  assigneeIds: string[];
  labelIds: string[];
  dependencyIds: string[];
}
