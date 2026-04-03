import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  VideoGrant,
  WebhookEvent,
  WebhookReceiver,
} from 'livekit-server-sdk';

import { isPostgresEnabled, query, withTransaction } from '@ngola/database';

import {
  AdmitParticipantDto,
  CreateMeetingDto,
  Meeting,
  ParticipantRole,
  TokenRequestDto,
  WaitingParticipant,
} from './meetings.types';

type MeetingRow = {
  id: string;
  tenant_id: string;
  project_id: string | null;
  channel_id: string | null;
  team_id: string | null;
  title: string;
  description: string | null;
  status: Meeting['status'];
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  livekit_room_id: string | null;
  max_participants: number;
  is_recorded: boolean;
  recording_url: string | null;
  ai_summary: string | null;
  ai_decisions: string[] | null;
  ai_action_items: string[] | null;
  ai_processed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);
  private readonly usePostgres = isPostgresEnabled();
  private readonly meetings = new Map<string, Meeting>();
  private readonly apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
  private readonly apiSecret = process.env.LIVEKIT_API_SECRET ?? 'devsecret1234567890abcdef';
  private readonly apiUrl = process.env.LIVEKIT_API_URL ?? 'http://livekit:7880';
  private readonly publicWsUrl = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
  private readonly projectServiceUrl =
    process.env.PROJECT_SERVICE_URL ?? 'http://project-service:3003/api/v1';
  private readonly internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  private readonly openaiModel = process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-4.1-mini';
  private readonly strictAiSummary =
    (process.env.OPENAI_SUMMARY_STRICT ?? 'false').toLowerCase() === 'true';
  private readonly roomClient = new RoomServiceClient(this.apiUrl, this.apiKey, this.apiSecret);
  private readonly webhookReceiver = new WebhookReceiver(this.apiKey, this.apiSecret);
 
  // ==================== LISTAR REUNIÕES (NOVO MÉTODO) ====================
  async list(tenantId?: string): Promise<Meeting[]> {
    this.logger.log(`Listando reuniões${tenantId ? ` para tenant ${tenantId}` : ''}`);

    if (this.usePostgres) {
      let sql = `
        SELECT * FROM meetings
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (tenantId) {
        sql += ` AND tenant_id = $${paramIndex}`;
        params.push(tenantId);
        paramIndex++;
      }

      sql += ` ORDER BY scheduled_at DESC NULLS LAST, created_at DESC`;

      const result = await query<MeetingRow>(sql, params);
      return result.rows.map(row => this.mapMeeting(row));
    }

    // Fallback in-memory
    const all = Array.from(this.meetings.values());
    return tenantId ? all.filter(m => m.tenantId === tenantId) : all;
  }

  async create(payload: CreateMeetingDto): Promise<Meeting> {
    if (!payload.tenantId || !payload.createdBy || !payload.title?.trim()) {
      throw new BadRequestException('tenantId, createdBy and title are required');
    }

    const meetingId = randomUUID();
    const roomName = `meeting-${meetingId}`;

    await this.roomClient.createRoom({
      name: roomName,
      emptyTimeout: 300,
      departureTimeout: 120,
      maxParticipants: payload.maxParticipants ?? 50,
      metadata: JSON.stringify({
        meetingId,
        tenantId: payload.tenantId,
        projectId: payload.projectId ?? null,
      }),
    });

    if (this.usePostgres) {
      await this.assertTenantAndUser(payload.tenantId, payload.createdBy);

      return withTransaction(async client => {
        const result = await client.query<MeetingRow>(
          `INSERT INTO meetings (
             id, tenant_id, project_id, channel_id, team_id, title, description, status, scheduled_at,
             livekit_room_id, max_participants, is_recorded, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id, tenant_id, project_id, channel_id, team_id, title, description, status, scheduled_at,
                     started_at, ended_at, livekit_room_id, max_participants, is_recorded, recording_url,
                     ai_summary, ai_decisions, ai_action_items, ai_processed_at, created_by, created_at, updated_at`,
          [
            meetingId,
            payload.tenantId,
            payload.projectId ?? null,
            payload.channelId ?? null,
            payload.teamId ?? null,
            payload.title.trim(),
            payload.description?.trim() ?? null,
            payload.scheduledFor ? 'scheduled' : 'live',
            payload.scheduledFor ?? null,
            roomName,
            payload.maxParticipants ?? 50,
            payload.isRecorded ?? true,
            payload.createdBy,
          ],
        );

        const participants = payload.participants ?? [];
        const uniqueParticipants = new Map<string, ParticipantRole>();
        uniqueParticipants.set(payload.createdBy, ParticipantRole.Host);
        for (const participant of participants) {
          uniqueParticipants.set(participant.userId, participant.role);
        }

        for (const [userId, role] of uniqueParticipants.entries()) {
          await client.query(
            `INSERT INTO meeting_participants (meeting_id, user_id, is_host)
             VALUES ($1, $2, $3)
             ON CONFLICT (meeting_id, user_id) DO NOTHING`,
            [meetingId, userId, role === ParticipantRole.Host],
          );
        }

        return this.mapMeeting(result.rows[0]);
      });
    }

    const meeting: Meeting = {
      id: meetingId,
      tenantId: payload.tenantId,
      createdBy: payload.createdBy,
      projectId: payload.projectId,
      channelId: payload.channelId,
      teamId: payload.teamId,
      title: payload.title.trim(),
      description: payload.description?.trim(),
      roomName,
      status: payload.scheduledFor ? 'scheduled' : 'live',
      scheduledFor: payload.scheduledFor,
      maxParticipants: payload.maxParticipants ?? 50,
      isRecorded: payload.isRecorded ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.meetings.set(meeting.id, meeting);
    return meeting;
  }

  async getMeeting(meetingId: string): Promise<Meeting> {
    if (this.usePostgres) {
      const result = await query<MeetingRow>(
        `SELECT id, tenant_id, project_id, channel_id, team_id, title, description, status, scheduled_at,
                started_at, ended_at, livekit_room_id, max_participants, is_recorded, recording_url,
                ai_summary, ai_decisions, ai_action_items, ai_processed_at, created_by, created_at, updated_at
         FROM meetings
         WHERE id = $1
         LIMIT 1`,
        [meetingId],
      );

      if (!result.rows[0]) {
        throw new NotFoundException('meeting not found');
      }

      return this.mapMeeting(result.rows[0]);
    }

    const meeting = this.meetings.get(meetingId);
    if (!meeting) {
      throw new NotFoundException('meeting not found');
    }
    return meeting;
  }

  async generateToken(meetingId: string, payload: TokenRequestDto): Promise<{ token: string; expiresIn: number }> {
    const meeting = await this.getMeeting(meetingId);
    if (meeting.status === 'ended' || meeting.status === 'cancelled') {
      throw new BadRequestException(`meeting is ${meeting.status} and cannot accept new participants`);
    }

    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: payload.userId,
      name: payload.name ?? payload.userId,
      ttl: '1h',
      metadata: JSON.stringify({
        meetingId,
        role: payload.role,
        tenantId: meeting.tenantId,
      }),
      attributes: {
        role: payload.role,
        meetingId,
      },
    });

    token.addGrant(this.buildVideoGrant(meeting.roomName, payload.role));

    if (this.usePostgres) {
      await query(
        `INSERT INTO meeting_participants (meeting_id, user_id, is_host)
         VALUES ($1, $2, $3)
         ON CONFLICT (meeting_id, user_id) DO NOTHING`,
        [meetingId, payload.userId, payload.role === ParticipantRole.Host],
      );
    }

    return { token: await token.toJwt(), expiresIn: 3600 };
  }

  async getWaitingRoom(meetingId: string): Promise<{ meetingId: string; participants: WaitingParticipant[] }> {
    const meeting = await this.getMeeting(meetingId);
    const participants = await this.roomClient.listParticipants(meeting.roomName);

    return {
      meetingId,
      participants: participants
        .filter(participant => !this.isHostIdentity(meeting, participant.identity) && !this.isParticipantAdmitted(participant))
        .map(participant => ({
          userId: participant.identity,
          name: participant.name || undefined,
          joinedAt: participant.joinedAt ? new Date(Number(participant.joinedAt) * 1000).toISOString() : undefined,
          isAdmitted: false,
        })),
    };
  }

  async admitParticipant(
    meetingId: string,
    payload: AdmitParticipantDto,
  ): Promise<{ meetingId: string; participantUserId: string; admitted: boolean }> {
    if (!payload.hostUserId || !payload.participantUserId) {
      throw new BadRequestException('hostUserId and participantUserId are required');
    }

    const meeting = await this.getMeeting(meetingId);
    await this.assertHostPermission(meeting, payload.hostUserId);

    try {
      await this.roomClient.updateParticipant(meeting.roomName, payload.participantUserId, {
        permission: {
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        },
        attributes: {
          waitingRoom: 'false',
          admittedBy: payload.hostUserId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('participant does not exist')) {
        throw new BadRequestException('participant must join room before being admitted');
      }
      throw error;
    }

    return {
      meetingId,
      participantUserId: payload.participantUserId,
      admitted: true,
    };
  }

  async endMeeting(meetingId: string): Promise<Meeting | undefined> {
    const meeting = await this.getMeeting(meetingId);
    try {
      await this.roomClient.deleteRoom(meeting.roomName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Idempotency: room may have already been closed by timeout/webhook.
      if (!message.toLowerCase().includes('requested room does not exist')) {
        throw error;
      }
      this.logger.warn(`Room ${meeting.roomName} already closed when ending meeting ${meetingId}`);
    }

    if (this.usePostgres) {
      const endedByWebhook = await this.waitForMeetingEnded(meetingId);
      if (!endedByWebhook) {
        const refreshed = await this.getMeeting(meetingId);
        if (refreshed.status !== 'ended') {
          await this.finalizeMeeting(refreshed);
        }
      }
    }

    return this.getMeeting(meetingId).catch(() => meeting);
  }

  async getRecording(meetingId: string): Promise<{ recordingUrl?: string } | undefined> {
    const meeting = await this.getMeeting(meetingId);
    return meeting ? { recordingUrl: meeting.recordingUrl } : undefined;
  }

  async getSummary(
    meetingId: string,
  ): Promise<{ summary?: string; decisions?: string[]; actionItems?: string[]; createdTaskIds?: string[] } | undefined> {
    const meeting = await this.getMeeting(meetingId);
    if (!meeting) return undefined;
    const createdTaskIds = await this.findCreatedTaskIds(meeting);
    return {
      summary:
        meeting.aiSummary ??
        'Resumo (mock): principais pontos da reunião sobre o projecto, riscos e próximos passos.',
      decisions: meeting.aiDecisions ?? ['Decisão mock: avançar com o plano A'],
      actionItems: meeting.aiActionItems ?? ['Criar tasks no project-service com base no resumo'],
      createdTaskIds,
    };
  }

  async handleWebhook(rawBody: string, authorization?: string): Promise<{ received: boolean; event?: string }> {
    let event: WebhookEvent;

    try {
      event = await this.webhookReceiver.receive(rawBody, authorization, false);
    } catch (error) {
      this.logger.warn(
        `LiveKit webhook signature validation failed, retrying without auth: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );

      try {
        event = await this.webhookReceiver.receive(rawBody, authorization, true);
      } catch (fallbackError) {
        this.logger.warn(
          `LiveKit webhook SDK parsing failed, using raw JSON fallback: ${
            fallbackError instanceof Error ? fallbackError.message : 'unknown error'
          }`,
        );
        event = this.parseRawWebhookEvent(rawBody);
      }
    }

    if (!event.event || !event.room?.name) {
      this.logger.warn(
        `Webhook SDK output incomplete, switching to raw JSON parse. event=${event.event ?? 'empty'} room=${
          event.room?.name ?? 'empty'
        }`,
      );
      event = this.parseRawWebhookEvent(rawBody);
    }

    this.logger.log(
      `Webhook received: event=${event.event ?? 'unknown'} room=${event.room?.name ?? 'n/a'} participant=${
        event.participant?.identity ?? 'n/a'
      }`,
    );

    await this.processWebhookEvent(event);

    return { received: true, event: event.event };
  }

  async renderDemoPage(
    meetingId: string,
    viewer: { userId: string; role: ParticipantRole; name: string },
  ): Promise<string> {
    const meeting = await this.getMeeting(meetingId);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${this.escapeHtml(meeting.title)} Demo</title>
  <style>
    body { font-family: Arial, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:24px; }
    .grid { display:grid; gap:16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card { background:#111827; border:1px solid #334155; border-radius:16px; padding:16px; }
    video { width:100%; background:#020617; border-radius:12px; min-height:220px; object-fit:cover; }
    button { background:#22c55e; color:#052e16; border:0; padding:10px 16px; border-radius:999px; cursor:pointer; font-weight:700; }
    code { color:#93c5fd; }
    .muted { color:#94a3b8; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(meeting.title)}</h1>
  <p class="muted">Open this page in two tabs with different query params. Room: <code>${this.escapeHtml(meeting.roomName)}</code></p>
  <div class="card">
    <p>User: <code>${this.escapeHtml(viewer.userId)}</code> | Role: <code>${this.escapeHtml(viewer.role)}</code></p>
    <button id="join" type="button">Join room</button>
    <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
      <button id="toggle-mic" type="button" disabled>Mic on</button>
      <button id="toggle-cam" type="button" disabled>Cam on</button>
      <button id="share-screen" type="button" disabled>Share screen</button>
    </div>
    <p id="status" class="muted">Not connected</p>
  </div>
  <div class="grid">
    <div class="card"><h3>Local</h3><div id="local"></div></div>
    <div class="card"><h3>Remote</h3><div id="remote"></div></div>
  </div>
  <script>
    const meetingId = ${JSON.stringify(meetingId)};
    const viewer = ${JSON.stringify(viewer)};
    const livekitUrl = ${JSON.stringify(this.publicWsUrl)};
    const statusEl = document.getElementById('status');
    const localEl = document.getElementById('local');
    const remoteEl = document.getElementById('remote');
    const joinButton = document.getElementById('join');
    const micButton = document.getElementById('toggle-mic');
    const camButton = document.getElementById('toggle-cam');
    const screenButton = document.getElementById('share-screen');
    let lk = null;
    let room = null;
    let micEnabled = false;
    let camEnabled = false;
    let screenEnabled = false;

    function setStatus(message) {
      statusEl.textContent = message;
    }

    function setError(message) {
      setStatus('Error: ' + message);
      joinButton.disabled = false;
    }

    function setPublishControlsEnabled(enabled) {
      const readonlyViewer = viewer.role === 'viewer';
      micButton.disabled = !enabled || readonlyViewer;
      camButton.disabled = !enabled || readonlyViewer;
      screenButton.disabled = !enabled || readonlyViewer;
    }

    function updateControlLabels() {
      micButton.textContent = micEnabled ? 'Mic off' : 'Mic on';
      camButton.textContent = camEnabled ? 'Cam off' : 'Cam on';
      screenButton.textContent = screenEnabled ? 'Stop share' : 'Share screen';
    }

    function attachLocalTracks() {
      if (!room) return;
      localEl.innerHTML = '';
      room.localParticipant.getTrackPublications().forEach(publication => {
        const track = publication.track;
        if (!track) return;
        localEl.appendChild(track.attach());
      });
    }

    async function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('failed to load ' + src));
        document.head.appendChild(script);
      });
    }

    async function ensureLiveKitClient() {
      const candidates = [
        'https://cdn.jsdelivr.net/npm/livekit-client/dist/livekit-client.umd.min.js',
        'https://unpkg.com/livekit-client/dist/livekit-client.umd.min.js'
      ];

      for (const src of candidates) {
        try {
          await loadScript(src);
          lk = window.LivekitClient || window.LiveKitClient;
          if (lk && lk.Room) {
            return;
          }
        } catch (error) {
          setStatus('Loading LiveKit SDK from fallback CDN...');
        }
      }

      throw new Error('LiveKit client script did not load from available CDNs.');
    }

    function wireRoomEvents() {
      if (!room || !lk) return;

      room.on(lk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const wrapper = document.createElement('div');
      wrapper.dataset.participant = participant.identity;
      if (track.kind === 'video') {
        const el = track.attach();
        wrapper.appendChild(el);
      } else if (track.kind === 'audio') {
        wrapper.appendChild(track.attach());
      }
      const label = document.createElement('p');
      label.textContent = participant.identity + ' (' + track.kind + ')';
      wrapper.appendChild(label);
      remoteEl.appendChild(wrapper);
      });

      room.on(lk.RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach(el => el.remove());
      });

      room.on(lk.RoomEvent.ParticipantDisconnected, (participant) => {
      [...remoteEl.querySelectorAll('[data-participant]')].forEach(node => {
        if (node.dataset.participant === participant.identity) node.remove();
      });
      });

      room.on(lk.RoomEvent.Disconnected, () => {
        setStatus('Disconnected');
        setPublishControlsEnabled(false);
      });
    }

    micButton.addEventListener('click', async () => {
      if (!room || viewer.role === 'viewer') return;
      try {
        micEnabled = !micEnabled;
        await room.localParticipant.setMicrophoneEnabled(micEnabled);
        updateControlLabels();
      } catch (error) {
        micEnabled = !micEnabled;
        setError(error instanceof Error ? error.message : 'failed to toggle microphone');
      }
    });

    camButton.addEventListener('click', async () => {
      if (!room || viewer.role === 'viewer') return;
      try {
        camEnabled = !camEnabled;
        await room.localParticipant.setCameraEnabled(camEnabled);
        updateControlLabels();
        attachLocalTracks();
      } catch (error) {
        camEnabled = !camEnabled;
        setError(error instanceof Error ? error.message : 'failed to toggle camera');
      }
    });

    screenButton.addEventListener('click', async () => {
      if (!room || viewer.role === 'viewer') return;
      try {
        screenEnabled = !screenEnabled;
        if (typeof room.localParticipant.setScreenShareEnabled !== 'function') {
          throw new Error('screen share not supported by this client');
        }
        await room.localParticipant.setScreenShareEnabled(screenEnabled);
        updateControlLabels();
        attachLocalTracks();
      } catch (error) {
        screenEnabled = !screenEnabled;
        setError(error instanceof Error ? error.message : 'failed to toggle screen share');
      }
    });

    updateControlLabels();
    setPublishControlsEnabled(false);

    joinButton.addEventListener('click', async () => {
      joinButton.disabled = true;

      try {
        if (!lk || !lk.Room) {
          setStatus('Loading LiveKit SDK...');
          await ensureLiveKitClient();
        }
        // Always use a fresh Room instance to avoid reconnect/state mismatch loops
        // when previous attempts failed and left stale internal reconnect state.
        if (room) {
          try {
            room.disconnect();
          } catch (disconnectError) {
            // ignore cleanup errors in demo mode
          }
        }
        room = new lk.Room();
        remoteEl.innerHTML = '';
        localEl.innerHTML = '';
        micEnabled = false;
        camEnabled = false;
        screenEnabled = false;
        updateControlLabels();
        setPublishControlsEnabled(false);
        wireRoomEvents();

        setStatus('Fetching token...');
        const tokenRes = await fetch('/api/v1/meetings/' + meetingId + '/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(viewer)
        });

        if (!tokenRes.ok) {
          throw new Error('Token request failed with ' + tokenRes.status);
        }

        const tokenData = await tokenRes.json();
        if (!tokenData.token) {
          throw new Error('Token payload missing token');
        }

        setStatus('Connecting to room...');
        await room.connect(livekitUrl, tokenData.token);
        setStatus('Connected to ' + room.name);

        setPublishControlsEnabled(true);

        // Viewer joins should not fail because of camera/mic publish attempts.
        if (viewer.role !== 'viewer') {
          try {
            micEnabled = true;
            camEnabled = true;
            await room.localParticipant.setMicrophoneEnabled(true);
            await room.localParticipant.setCameraEnabled(true);
            updateControlLabels();
          } catch (mediaError) {
            micEnabled = false;
            camEnabled = false;
            updateControlLabels();
            const message = mediaError instanceof Error ? mediaError.message : 'media publish failed';
            setStatus('Connected (media warning): ' + message);
          }
        }

        attachLocalTracks();
        room.on(lk.RoomEvent.LocalTrackPublished, attachLocalTracks);
        room.on(lk.RoomEvent.LocalTrackUnpublished, attachLocalTracks);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'unknown error');
      } finally {
        joinButton.disabled = false;
      }
    });
  </script>
</body>
</html>`;
  }

  private buildVideoGrant(roomName: string, role: ParticipantRole): VideoGrant {
    if (role === ParticipantRole.Host) {
      return {
        roomJoin: true,
        room: roomName,
        roomAdmin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
      };
    }

    if (role === ParticipantRole.Presenter) {
      return {
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canPublishSources: [
          TrackSource.CAMERA,
          TrackSource.MICROPHONE,
          TrackSource.SCREEN_SHARE,
          TrackSource.SCREEN_SHARE_AUDIO,
        ],
        canSubscribe: true,
        canPublishData: true,
      };
    }

    return {
      roomJoin: true,
      room: roomName,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
    };
  }

  private async processWebhookEvent(event: WebhookEvent): Promise<void> {
    if (!this.usePostgres) {
      this.logger.warn('Skipping LiveKit webhook processing because Postgres is disabled');
      return;
    }

    const roomName = event.room?.name;
    if (!roomName) {
      this.logger.warn(`Webhook ignored because room.name is missing for event=${event.event ?? 'unknown'}`);
      return;
    }

    const meeting = await this.findMeetingByRoomName(roomName);
    if (!meeting) {
      this.logger.warn(`Webhook ignored because no meeting matched room=${roomName}`);
      return;
    }

    this.logger.log(`Processing webhook event=${event.event} for meeting=${meeting.id} room=${roomName}`);

    switch (event.event) {
      case 'room_started':
        await query(
          `UPDATE meetings
           SET status = 'live', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
           WHERE id = $1`,
          [meeting.id],
        );
        break;
      case 'participant_joined':
        if (event.participant?.identity) {
          await query(
            `INSERT INTO meeting_participants (meeting_id, user_id, joined_at, is_host)
             VALUES ($1, $2, NOW(), FALSE)
             ON CONFLICT (meeting_id, user_id)
             DO UPDATE SET joined_at = COALESCE(meeting_participants.joined_at, NOW())`,
            [meeting.id, event.participant.identity],
          );
        }
        break;
      case 'participant_left':
        if (event.participant?.identity) {
          await query(
            `UPDATE meeting_participants
             SET left_at = NOW()
             WHERE meeting_id = $1 AND user_id = $2`,
            [meeting.id, event.participant.identity],
          );
        }
        break;
      case 'room_finished': {
        await this.finalizeMeeting(meeting);
        break;
      }
      default:
        this.logger.log(`Webhook event ${event.event} received with no persistence side-effect`);
        break;
    }
  }

  private async finalizeMeeting(meeting: Meeting): Promise<void> {
    const summary = await this.generateMeetingSummary(meeting);
    const createdTaskIds = await this.createProjectTasksFromActionItems(meeting, summary.actionItems);

    await query(
      `UPDATE meetings
       SET status = 'ended',
           ended_at = COALESCE(ended_at, NOW()),
           recording_url = COALESCE(recording_url, $2),
           ai_summary = $3,
           ai_decisions = $4::jsonb,
           ai_action_items = $5::jsonb,
           ai_processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [
        meeting.id,
        meeting.recordingUrl ?? `https://mock.livekit.local/recordings/${meeting.id}.mp4`,
        summary.summary,
        JSON.stringify(summary.decisions),
        JSON.stringify(summary.actionItems),
      ],
    );

    if (createdTaskIds.length > 0) {
      const updated = await this.getMeeting(meeting.id);
      updated.createdTaskIds = createdTaskIds;
      this.meetings.set(meeting.id, updated);
    }

    this.logger.log(`Meeting ${meeting.id} finalized with ${createdTaskIds.length} auto-created tasks`);
  }

  private async generateMeetingSummary(meeting: Meeting): Promise<{
    summary: string;
    decisions: string[];
    actionItems: string[];
  }> {
    if (!process.env.OPENAI_API_KEY) {
      this.logger.warn(
        `OPENAI_API_KEY not configured; using mock summary for meeting ${meeting.id}`,
      );
      return {
        summary: `Resumo (mock): reunião "${meeting.title}" concluída com foco em alinhamento, riscos e próximos passos.`,
        decisions: ['Decisão mock: seguir com a execução do plano definido na reunião.'],
        actionItems: ['Rever entregáveis combinados na reunião', 'Criar tasks operacionais no project-service'],
      };
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/responses',
        {
          model: this.openaiModel,
          instructions:
            'Return valid JSON only with keys summary, decisions, actionItems. decisions and actionItems must be arrays of short strings.',
          input: `Meeting title: ${meeting.title}
Description: ${meeting.description ?? 'N/A'}
Project ID: ${meeting.projectId ?? 'N/A'}
Participants are collaborating on a project review. Produce a concise executive summary in Portuguese.`,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const outputText = this.extractOpenAiOutputText(response.data);
      if (!outputText) {
        throw new Error('missing output_text');
      }

      const parsed = this.parseSummaryJson(outputText);
      return {
        summary: String(parsed.summary ?? 'Resumo não disponível.'),
        decisions: Array.isArray(parsed.decisions)
          ? parsed.decisions.map((item: unknown) => String(item))
          : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? parsed.actionItems.map((item: unknown) => String(item))
          : [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `OpenAI summary generation failed for meeting ${meeting.id}: ${message}`,
      );
      if (this.strictAiSummary) {
        throw error;
      }
      return {
        summary: `Resumo (fallback): reunião "${meeting.title}" finalizada. O serviço IA falhou e o sistema gerou um resumo de contingência.`,
        decisions: ['Fallback: validar decisões diretamente com os participantes.'],
        actionItems: ['Fallback: criar manualmente as tasks resultantes da reunião.'],
      };
    }
  }

  private async createProjectTasksFromActionItems(
    meeting: Meeting,
    actionItems: string[],
  ): Promise<string[]> {
    if (!meeting.projectId || actionItems.length === 0) {
      return [];
    }

    const createdTaskIds: string[] = [];

    for (const actionItem of actionItems) {
      try {
        const existing = await query<{ id: string }>(
          `SELECT id
           FROM tasks
           WHERE project_id = $1
             AND deleted_at IS NULL
             AND title = $2
             AND custom_fields->>'meetingId' = $3
           LIMIT 1`,
          [meeting.projectId, actionItem, meeting.id],
        );

        if (existing.rows[0]?.id) {
          createdTaskIds.push(existing.rows[0].id);
          continue;
        }

        const response = await axios.post(
          `${this.projectServiceUrl}/tasks`,
          {
            tenantId: meeting.tenantId,
            projectId: meeting.projectId,
            title: actionItem,
            description: `Task criada automaticamente a partir da reunião "${meeting.title}" (${meeting.id}).`,
            createdBy: meeting.createdBy,
            status: 'todo',
            priority: 'medium',
            customFields: {
              source: 'video-service',
              meetingId: meeting.id,
              roomName: meeting.roomName,
            },
          },
          {
            timeout: 15000,
            headers: this.internalServiceToken
              ? {
                  'x-internal-service-token': this.internalServiceToken,
                }
              : undefined,
          },
        );

        if (response.data?.id) {
          createdTaskIds.push(String(response.data.id));
          this.logger.log(`Created project task ${response.data.id} from meeting ${meeting.id}`);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to create project task from meeting ${meeting.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        // Keep webhook processing resilient if task creation fails.
      }
    }

    return createdTaskIds;
  }

  private async waitForMeetingEnded(
    meetingId: string,
    attempts = 8,
    delayMs = 500,
  ): Promise<boolean> {
    for (let i = 0; i < attempts; i += 1) {
      const current = await this.getMeeting(meetingId);
      if (current.status === 'ended') {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return false;
  }

  private isParticipantAdmitted(participant: { permission?: { canPublish?: boolean } }): boolean {
    return Boolean(participant.permission?.canPublish);
  }

  private isHostIdentity(meeting: Meeting, identity?: string): boolean {
    if (!identity) return false;
    return identity === meeting.createdBy;
  }

  private async assertHostPermission(meeting: Meeting, hostUserId: string): Promise<void> {
    if (!this.usePostgres) {
      if (meeting.createdBy !== hostUserId) {
        throw new BadRequestException('only host can admit participants');
      }
      return;
    }

    const result = await query<{ is_host: boolean }>(
      `SELECT is_host
       FROM meeting_participants
       WHERE meeting_id = $1 AND user_id = $2
       LIMIT 1`,
      [meeting.id, hostUserId],
    );

    if (!result.rows[0]?.is_host) {
      throw new BadRequestException('only host can admit participants');
    }
  }

  private async findCreatedTaskIds(meeting: Meeting): Promise<string[]> {
    if (!this.usePostgres) {
      return meeting.createdTaskIds ?? [];
    }

    const result = await query<{ id: string }>(
      `SELECT id
       FROM tasks
       WHERE deleted_at IS NULL
         AND custom_fields->>'meetingId' = $1
       ORDER BY created_at ASC`,
      [meeting.id],
    );

    return result.rows.map(row => row.id);
  }

  private extractOpenAiOutputText(data: unknown): string | undefined {
    const payload = data as Record<string, unknown> | undefined;
    if (!payload) return undefined;

    const direct = payload.output_text;
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim();
    }

    const output = Array.isArray(payload.output) ? payload.output : [];
    const textParts: string[] = [];

    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const typed = block as Record<string, unknown>;
        if (typed.type === 'output_text' && typeof typed.text === 'string') {
          textParts.push(typed.text);
          continue;
        }
        if (typed.type === 'text' && typeof typed.text === 'string') {
          textParts.push(typed.text);
          continue;
        }
      }
    }

    if (textParts.length === 0) return undefined;
    return textParts.join('\n').trim();
  }

  private parseSummaryJson(rawText: string): Record<string, unknown> {
    const trimmed = rawText.trim();
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (!fenced?.[1]) {
        throw new Error('invalid JSON response');
      }
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    }
  }

  private async findMeetingByRoomName(roomName: string): Promise<Meeting | undefined> {
    const result = await query<MeetingRow>(
      `SELECT id, tenant_id, project_id, channel_id, team_id, title, description, status, scheduled_at,
              started_at, ended_at, livekit_room_id, max_participants, is_recorded, recording_url,
              ai_summary, ai_decisions, ai_action_items, ai_processed_at, created_by, created_at, updated_at
       FROM meetings
       WHERE livekit_room_id = $1
       LIMIT 1`,
      [roomName],
    );

    return result.rows[0] ? this.mapMeeting(result.rows[0]) : undefined;
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

  private mapMeeting(row: MeetingRow): Meeting {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      createdBy: row.created_by,
      projectId: row.project_id ?? undefined,
      channelId: row.channel_id ?? undefined,
      teamId: row.team_id ?? undefined,
      title: row.title,
      description: row.description ?? undefined,
      roomName: row.livekit_room_id ?? `meeting-${row.id}`,
      roomSid: row.livekit_room_id ?? undefined,
      status: row.status,
      scheduledFor: row.scheduled_at ?? undefined,
      startedAt: row.started_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      maxParticipants: row.max_participants,
      isRecorded: row.is_recorded,
      endedAt: row.ended_at ?? undefined,
      recordingUrl: row.recording_url ?? undefined,
      aiSummary: row.ai_summary ?? undefined,
      aiDecisions: row.ai_decisions ?? undefined,
      aiActionItems: row.ai_action_items ?? undefined,
    };
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private parseRawWebhookEvent(rawBody: string): WebhookEvent {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const room =
      parsed.room && typeof parsed.room === 'object'
        ? (parsed.room as Record<string, unknown>)
        : undefined;
    const participant =
      parsed.participant && typeof parsed.participant === 'object'
        ? (parsed.participant as Record<string, unknown>)
        : undefined;

    return {
      event: typeof parsed.event === 'string' ? parsed.event : '',
      room: room
        ? ({
            name: typeof room.name === 'string' ? room.name : '',
            sid: typeof room.sid === 'string' ? room.sid : '',
            metadata: typeof room.metadata === 'string' ? room.metadata : '',
          } as WebhookEvent['room'])
        : undefined,
      participant: participant
        ? ({
            identity: typeof participant.identity === 'string' ? participant.identity : '',
            sid: typeof participant.sid === 'string' ? participant.sid : '',
            name: typeof participant.name === 'string' ? participant.name : '',
          } as WebhookEvent['participant'])
        : undefined,
    } as WebhookEvent;
  }
}
