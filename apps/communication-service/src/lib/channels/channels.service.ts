import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { isPostgresEnabled, query, withTransaction } from '@ngola/database';

import { Channel, CreateChannelDto } from './channels.types';

type ChannelRow = {
  id: string;
  tenant_id: string;
  created_by: string;
  type: Channel['type'];
  name: string | null;
  description: string | null;
  topic: string | null;
  project_id: string | null;
  team_id: string | null;
  is_private: boolean;
  is_archived: boolean;
  last_message_at: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class ChannelsService {
  private readonly usePostgres = isPostgresEnabled();
  private readonly channels = new Map<string, Channel>();

  async create(payload: CreateChannelDto): Promise<Channel> {
    if (!payload.tenantId || !payload.createdBy) {
      throw new BadRequestException('tenantId and createdBy are required');
    }

    if (this.usePostgres) {
      await this.assertTenantAndUser(payload.tenantId, payload.createdBy);

      const members = [...new Set([payload.createdBy, ...(payload.members ?? [])])];

      return withTransaction(async client => {
        const result = await client.query<ChannelRow>(
          `INSERT INTO channels (
             tenant_id, project_id, team_id, type, name, description, topic, is_private, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, tenant_id, created_by, type, name, description, topic, project_id, team_id,
                     is_private, is_archived, last_message_at, message_count, created_at, updated_at`,
          [
            payload.tenantId,
            payload.projectId ?? null,
            payload.teamId ?? null,
            payload.type ?? 'project',
            payload.name?.trim() || null,
            payload.description?.trim() || null,
            payload.topic?.trim() || null,
            payload.isPrivate ?? false,
            payload.createdBy,
          ],
        );

        const channel = result.rows[0];

        for (const memberId of members) {
          await client.query(
            `INSERT INTO channel_members (channel_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (channel_id, user_id) DO NOTHING`,
            [channel.id, memberId, memberId === payload.createdBy ? 'admin' : 'member'],
          );
        }

        return this.mapChannel(channel, members);
      });
    }

    const channel: Channel = {
      id: randomUUID(),
      tenantId: payload.tenantId,
      createdBy: payload.createdBy,
      type: payload.type ?? 'project',
      name: payload.name?.trim(),
      description: payload.description?.trim(),
      topic: payload.topic?.trim(),
      projectId: payload.projectId,
      teamId: payload.teamId,
      isPrivate: payload.isPrivate ?? false,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      members: [...new Set([payload.createdBy, ...(payload.members ?? [])])],
      messageCount: 0,
    };
    this.channels.set(channel.id, channel);
    return channel;
  }

  async list(userId?: string): Promise<Channel[]> {
    if (this.usePostgres) {
      const result = userId
        ? await query<ChannelRow>(
            `SELECT c.id, c.tenant_id, c.created_by, c.type, c.name, c.description, c.topic, c.project_id, c.team_id,
                    c.is_private, c.is_archived, c.last_message_at, c.message_count, c.created_at, c.updated_at
             FROM channels c
             INNER JOIN channel_members cm ON cm.channel_id = c.id
             WHERE cm.user_id = $1
             ORDER BY c.created_at ASC`,
            [userId],
          )
        : await query<ChannelRow>(
            `SELECT id, tenant_id, created_by, type, name, description, topic, project_id, team_id,
                    is_private, is_archived, last_message_at, message_count, created_at, updated_at
             FROM channels
             ORDER BY created_at ASC`,
          );

      const channels = await Promise.all(result.rows.map(row => this.getByIdWithMembers(row.id)));
      return channels;
    }

    const channels = [...this.channels.values()];
    return userId ? channels.filter(channel => channel.members.includes(userId)) : channels;
  }

  async findById(channelId: string): Promise<Channel | undefined> {
    if (this.usePostgres) {
      try {
        return await this.getByIdWithMembers(channelId);
      } catch {
        return undefined;
      }
    }

    return this.channels.get(channelId);
  }

  private async getByIdWithMembers(channelId: string): Promise<Channel> {
    const channelResult = await query<ChannelRow>(
      `SELECT id, tenant_id, created_by, type, name, description, topic, project_id, team_id,
              is_private, is_archived, last_message_at, message_count, created_at, updated_at
       FROM channels
       WHERE id = $1
       LIMIT 1`,
      [channelId],
    );

    if (!channelResult.rows[0]) {
      throw new NotFoundException('channel not found');
    }

    const membersResult = await query<{ user_id: string }>(
      `SELECT user_id
       FROM channel_members
       WHERE channel_id = $1
       ORDER BY joined_at ASC`,
      [channelId],
    );

    return this.mapChannel(channelResult.rows[0], membersResult.rows.map(row => row.user_id));
  }

  private async assertTenantAndUser(tenantId: string, userId: string): Promise<void> {
    const tenant = await query<{ id: string }>('SELECT id FROM tenants WHERE id = $1 LIMIT 1', [tenantId]);
    if (!tenant.rows[0]) {
      throw new NotFoundException('tenant not found');
    }

    const user = await query<{ id: string }>(
      'SELECT id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      [userId, tenantId],
    );
    if (!user.rows[0]) {
      throw new NotFoundException('user not found for tenant');
    }
  }

  private mapChannel(row: ChannelRow, members: string[]): Channel {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      createdBy: row.created_by,
      type: row.type,
      name: row.name ?? undefined,
      description: row.description ?? undefined,
      topic: row.topic ?? undefined,
      projectId: row.project_id ?? undefined,
      teamId: row.team_id ?? undefined,
      isPrivate: row.is_private,
      isArchived: row.is_archived,
      members,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: row.last_message_at ?? undefined,
      messageCount: row.message_count,
    };
  }
}
