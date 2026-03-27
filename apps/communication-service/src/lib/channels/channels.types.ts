export type Channel = {
  id: string;
  tenantId: string;
  createdBy: string;
  type: 'project' | 'team' | 'direct' | 'announcement' | 'general';
  name?: string;
  description?: string;
  topic?: string;
  projectId?: string;
  teamId?: string;
  isPrivate: boolean;
  isArchived: boolean;
  members: string[];
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  messageCount: number;
};

export type CreateChannelDto = {
  tenantId: string;
  createdBy: string;
  type?: 'project' | 'team' | 'direct' | 'announcement' | 'general';
  name?: string;
  description?: string;
  topic?: string;
  projectId?: string;
  teamId?: string;
  isPrivate?: boolean;
  members?: string[];
};
