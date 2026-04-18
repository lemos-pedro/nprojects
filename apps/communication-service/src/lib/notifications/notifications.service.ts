import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { isPostgresEnabled, query } from '@ngola/database';

import { SocketEvent } from '../socket/socket.types';
import { SocketGateway } from '../socket/socket.gateway';

type Notification = {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  read: boolean;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
  metadata: unknown;
};

@Injectable()
export class NotificationsService {
  private readonly usePostgres = isPostgresEnabled();
  private readonly notifications = new Map<string, Notification[]>(); // userId -> notifications

  constructor(private readonly gateway: SocketGateway) {}

  async list(userId: string): Promise<Notification[]> {
    if (this.usePostgres) {
      const result = await query<NotificationRow>(
        `SELECT id, user_id, type, title, body, is_read, created_at, metadata
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );

      return result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        payload: {
          title: row.title,
          body: row.body,
          metadata: row.metadata,
        },
        read: row.is_read,
        createdAt: row.created_at,
      }));
    }

    return this.notifications.get(userId) ?? [];
  }

  async markRead(notificationId: string): Promise<{ id: string; read: boolean } | undefined> {
    if (this.usePostgres) {
      const result = await query<{ id: string }>(
        `UPDATE notifications
         SET is_read = TRUE, read_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [notificationId],
      );
      return result.rows[0] ? { id: result.rows[0].id, read: true } : undefined;
    }

    const notif = this.findById(notificationId);
    if (!notif) return undefined;
    notif.read = true;
    return { id: notif.id, read: true };
  }

  async markAll(userId: string): Promise<{ userId: string; readAll: boolean }> {
    if (this.usePostgres) {
      await query(
        `UPDATE notifications
         SET is_read = TRUE, read_at = NOW()
         WHERE user_id = $1 AND is_read = FALSE`,
        [userId],
      );
      return { userId, readAll: true };
    }

    const list = this.notifications.get(userId) ?? [];
    list.forEach(n => (n.read = true));
    this.notifications.set(userId, list);
    return { userId, readAll: true };
  }

  async notify(userId: string, type: string, payload: unknown): Promise<Notification> {
    if (this.usePostgres) {
      const userResult = await query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId],
      );

      if (!userResult.rows[0]) {
        throw new NotFoundException('user not found');
      }

      const normalizedType = this.normalizeNotificationType(type);
      const title =
        typeof payload === 'object' && payload && 'title' in (payload as Record<string, unknown>)
          ? String((payload as Record<string, unknown>).title)
          : normalizedType;
      const body =
        typeof payload === 'object' && payload && 'body' in (payload as Record<string, unknown>)
          ? String((payload as Record<string, unknown>).body)
          : null;

      const result = await query<NotificationRow>(
        `INSERT INTO notifications (tenant_id, user_id, type, title, body, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, user_id, type, title, body, is_read, created_at, metadata`,
        [
          userResult.rows[0].tenant_id,
          userId,
          normalizedType,
          title,
          body,
          JSON.stringify(payload ?? {}),
        ],
      );

      const notification = {
        id: result.rows[0].id,
        userId: result.rows[0].user_id,
        type: result.rows[0].type,
        payload: {
          title: result.rows[0].title,
          body: result.rows[0].body,
          metadata: result.rows[0].metadata,
        },
        read: result.rows[0].is_read,
        createdAt: result.rows[0].created_at,
      };

      this.gateway.emitToChannel(userId, SocketEvent.Notification, notification);
      Logger.debug(`notification emitted`, 'NotificationsService');
      return notification;
    }

    const notif: Notification = {
      id: randomUUID(),
      userId,
      type,
      payload,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const list = this.notifications.get(userId) ?? [];
    list.push(notif);
    this.notifications.set(userId, list);
    // broadcast to all clients
    this.gateway.emitToChannel(userId, SocketEvent.Notification, notif);
    Logger.debug(`notification emitted`, 'NotificationsService');
    return notif;
  }

  private findById(notificationId: string): Notification | undefined {
    for (const list of this.notifications.values()) {
      const found = list.find(n => n.id === notificationId);
      if (found) return found;
    }
    return undefined;
  }

  private normalizeNotificationType(type: string): string {
    const allowed = new Set([
      'task_assigned',
      'task_updated',
      'message',
      'mention',
      'meeting_starting',
      'ai_alert',
      'billing',
      'system',
    ]);

    return allowed.has(type) ? type : 'system';
  }
}
