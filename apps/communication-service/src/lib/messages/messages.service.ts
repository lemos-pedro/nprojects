import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { query, isPostgresEnabled } from '@ngola/database';

import { CreateMessageDto, EditMessageDto, Message, ReactionDto } from './messages.types';
import { SocketGateway } from '../socket/socket.gateway';
import { SocketEvent } from '../socket/socket.types';

type MessageRow = {
  id: string;
  channel_id: string;
  user_id: string;
  parent_id: string | null;
  type: Message['type'];
  content: string | null;
  metadata: { attachments?: string[] } | null;
  is_pinned: boolean;
  edited_at: string | null;
  created_at: string;
  deleted_at: string | null;
  sender_name: string | null;
};

@Injectable()
export class MessagesService {
  private readonly usePostgres = isPostgresEnabled();
  private readonly messages = new Map<string, Message[]>();

  constructor(private readonly socketGateway: SocketGateway) {}

  async create(payload: CreateMessageDto): Promise<Message> {
    if (!payload.channelId || !payload.senderId || !payload.content?.trim()) {
      throw new BadRequestException('channelId, senderId and content are required');
    }

    if (this.usePostgres) {
      const channelResult = await query<{ id: string }>(
        `SELECT c.id
         FROM channels c
         INNER JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = $2
         WHERE c.id = $1
         LIMIT 1`,
        [payload.channelId, payload.senderId],
      );

      if (!channelResult.rows[0]) {
        throw new NotFoundException('channel not found or sender is not a member');
      }

      const result = await query<MessageRow>(
        `INSERT INTO messages (channel_id, user_id, parent_id, type, content, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, channel_id, user_id, parent_id, type, content, metadata, is_pinned, edited_at, created_at, deleted_at`,
        [
          payload.channelId,
          payload.senderId,
          payload.parentId ?? null,
          payload.type ?? 'text',
          payload.content.trim(),
          JSON.stringify({ attachments: payload.attachments ?? [] }),
        ],
      );

      await query(
        `UPDATE channels
         SET last_message_at = NOW(),
             message_count = message_count + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [payload.channelId],
      );

      const message = await this.getById(result.rows[0].id);
      this.socketGateway.emitToChannel(payload.channelId, SocketEvent.Message, message);
      return message;
    }

    const message: Message = {
      id: randomUUID(),
      channelId: payload.channelId,
      senderId: payload.senderId,
      type: payload.type ?? 'text',
      content: payload.content.trim(),
      createdAt: new Date().toISOString(),
      parentId: payload.parentId,
      reactions: {},
      attachments: payload.attachments ?? [],
    };
    const list = this.messages.get(payload.channelId) ?? [];
    list.push(message);
    this.messages.set(payload.channelId, list);
    return message;
  }

  async listByChannel(channelId: string): Promise<Message[]> {
    if (this.usePostgres) {
      const result = await query<MessageRow>(
        `SELECT m.id, m.channel_id, m.user_id, m.parent_id, m.type, m.content, m.metadata,
                m.is_pinned, m.edited_at, m.created_at, m.deleted_at, u.full_name as sender_name
         FROM messages m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = $1
         ORDER BY m.created_at ASC`,
        [channelId],
      );

      return Promise.all(result.rows.map(row => this.mapMessage(row)));
    }

    return this.messages.get(channelId) ?? [];
  }

  async edit(messageId: string, payload: EditMessageDto): Promise<Message | undefined> {
    if (this.usePostgres) {
      const result = await query<MessageRow>(
        `UPDATE messages
         SET content = $2,
             is_edited = TRUE,
             edited_at = NOW()
         WHERE id = $1
         RETURNING id, channel_id, user_id, parent_id, type, content, metadata, is_pinned, edited_at, created_at, deleted_at`,
        [messageId, payload.content?.trim() ?? ''],
      );

      return result.rows[0] ? this.mapMessage(result.rows[0]) : undefined;
    }

    const message = this.findById(messageId);
    if (!message) return undefined;
    message.content = payload.content ?? message.content;
    message.editedAt = new Date().toISOString();
    return message;
  }

  async softDelete(messageId: string): Promise<Message | undefined> {
    if (this.usePostgres) {
      const result = await query<MessageRow>(
        `UPDATE messages
         SET deleted_at = NOW()
         WHERE id = $1
         RETURNING id, channel_id, user_id, parent_id, type, content, metadata, is_pinned, edited_at, created_at, deleted_at`,
        [messageId],
      );

      return result.rows[0] ? this.mapMessage(result.rows[0]) : undefined;
    }

    const message = this.findById(messageId);
    if (!message) return undefined;
    message.deletedAt = new Date().toISOString();
    return message;
  }

  async setPinned(messageId: string, pinned: boolean): Promise<Message | undefined> {
    if (this.usePostgres) {
      const result = await query<MessageRow>(
        `UPDATE messages
         SET is_pinned = $2
         WHERE id = $1
         RETURNING id, channel_id, user_id, parent_id, type, content, metadata, is_pinned, edited_at, created_at, deleted_at`,
        [messageId, pinned],
      );

      return result.rows[0] ? this.mapMessage(result.rows[0]) : undefined;
    }

    const message = this.findById(messageId);
    if (!message) return undefined;
    message.pinned = pinned;
    return message;
  }

  async addReaction(messageId: string, payload: ReactionDto): Promise<Message | undefined> {
    if (this.usePostgres) {
      await query(
        `INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [messageId, payload.userId, payload.emoji],
      );

      return this.getById(messageId);
    }

    const message = this.findById(messageId);
    if (!message) return undefined;
    if (!message.reactions[payload.emoji]) {
      message.reactions[payload.emoji] = [];
    }
    if (!message.reactions[payload.emoji].includes(payload.userId)) {
      message.reactions[payload.emoji].push(payload.userId);
    }
    return message;
  }

  private findById(messageId: string): Message | undefined {
    for (const list of this.messages.values()) {
      const found = list.find(m => m.id === messageId);
      if (found) return found;
    }
    return undefined;
  }

  private async getById(messageId: string): Promise<Message> {
    const result = await query<MessageRow>(
      `SELECT m.id, m.channel_id, m.user_id, m.parent_id, m.type, m.content, m.metadata,
              m.is_pinned, m.edited_at, m.created_at, m.deleted_at, u.full_name as sender_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.id = $1
       LIMIT 1`,
      [messageId],
    );

    if (!result.rows[0]) {
      throw new NotFoundException('message not found');
    }

    return this.mapMessage(result.rows[0]);
  }

  private async mapMessage(row: MessageRow): Promise<Message> {
    const reactionsResult = await query<{ emoji: string; user_id: string }>(
      `SELECT emoji, user_id
       FROM message_reactions
       WHERE message_id = $1
       ORDER BY created_at ASC`,
      [row.id],
    );

    const reactions = reactionsResult.rows.reduce<Record<string, string[]>>((acc, reaction) => {
      if (!acc[reaction.emoji]) {
        acc[reaction.emoji] = [];
      }
      acc[reaction.emoji].push(reaction.user_id);
      return acc;
    }, {});

    return {
      id: row.id,
      channelId: row.channel_id,
      senderId: row.user_id,
      senderName: row.sender_name ?? undefined,
      type: row.type,
      content: row.content ?? '',
      createdAt: row.created_at,
      editedAt: row.edited_at ?? undefined,
      deletedAt: row.deleted_at ?? undefined,
      pinned: row.is_pinned,
      parentId: row.parent_id ?? undefined,
      reactions,
      attachments: row.metadata?.attachments ?? [],
    };
  }
}
