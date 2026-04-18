export type Message = {
  id: string;
  channelId: string;
  senderId: string;
  senderName?: string;
  type: 'text' | 'file' | 'image' | 'system' | 'task_update' | 'meeting_summary';
  content: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  pinned?: boolean;
  parentId?: string;
  reactions: Record<string, string[]>; // emoji -> userIds
  attachments?: string[];
};

export type CreateMessageDto = {
  channelId: string;
  senderId: string;
  content: string;
  type?: 'text' | 'file' | 'image' | 'system' | 'task_update' | 'meeting_summary';
  parentId?: string;
  attachments?: string[];
};

export type EditMessageDto = {
  content?: string;
};

export type ReactionDto = {
  emoji: string;
  userId: string;
};
