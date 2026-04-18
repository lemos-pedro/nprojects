import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { extractBearerToken, verifyAccessToken } from '@ngola/shared';

import { SocketEvent } from './socket.types';

@WebSocketGateway({ cors: true })
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger(SocketGateway.name);
  private readonly accessSecret = process.env.AUTH_JWT_ACCESS_SECRET ?? 'dev-access-secret';

  afterInit() {
    this.logger.log('socket gateway ready');
  }

  handleConnection(client: Socket) {
    try {
      const token = this.extractSocketToken(client);
      if (!token) {
        throw new Error('missing bearer token');
      }

      const payload = verifyAccessToken(token, this.accessSecret);
      client.data.userId = payload.sub;
      this.logger.log(`client connected ${client.id}`);
    } catch (error) {
      this.logger.warn(
        `socket auth rejected for ${client.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`client disconnected ${client.id}`);
  }

  emitToChannel(channelId: string, event: string, payload: unknown) {
    this.server.to(channelId).emit(event, payload);
  }

  @SubscribeMessage(SocketEvent.Message)
  handleMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown) {
    client.broadcast.emit(SocketEvent.Message, payload);
    return { ack: true };
  }

  @SubscribeMessage(SocketEvent.UserTyping)
  handleTyping(@ConnectedSocket() client: Socket, @MessageBody() payload: { channelId: string; userId: string }) {
    client.broadcast.emit(SocketEvent.UserTyping, payload);
    return { ack: true };
  }

  @SubscribeMessage(SocketEvent.ChannelJoin)
  handleJoin(@ConnectedSocket() client: Socket, @MessageBody() payload: { channelId: string }) {
    client.join(payload.channelId);
    return { joined: payload.channelId };
  }

  @SubscribeMessage(SocketEvent.ChannelLeave)
  handleLeave(@ConnectedSocket() client: Socket, @MessageBody() payload: { channelId: string }) {
    client.leave(payload.channelId);
    return { left: payload.channelId };
  }

  @SubscribeMessage(SocketEvent.MeetingHandRaised)
  handleMeetingHandRaised(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; userId: string; raised: boolean; at?: string },
  ) {
    const eventPayload = { ...payload, at: payload.at ?? new Date().toISOString() };
    client.broadcast.emit(SocketEvent.MeetingHandRaised, eventPayload);
    return { ack: true };
  }

  @SubscribeMessage(SocketEvent.MeetingReaction)
  handleMeetingReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; userId: string; emoji: string; at?: string },
  ) {
    const eventPayload = { ...payload, at: payload.at ?? new Date().toISOString() };
    client.broadcast.emit(SocketEvent.MeetingReaction, eventPayload);
    return { ack: true };
  }

  @SubscribeMessage(SocketEvent.MeetingSpotlight)
  handleMeetingSpotlight(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; targetUserId: string; requestedBy: string; at?: string },
  ) {
    const eventPayload = { ...payload, at: payload.at ?? new Date().toISOString() };
    client.broadcast.emit(SocketEvent.MeetingSpotlight, eventPayload);
    return { ack: true };
  }

  @SubscribeMessage(SocketEvent.MeetingRecordingStatus)
  handleMeetingRecordingStatus(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; isRecording: boolean; changedBy: string; at?: string },
  ) {
    const eventPayload = { ...payload, at: payload.at ?? new Date().toISOString() };
    client.broadcast.emit(SocketEvent.MeetingRecordingStatus, eventPayload);
    return { ack: true };
  }

  @SubscribeMessage(SocketEvent.MeetingMuteAll)
  handleMeetingMuteAll(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { meetingId: string; requestedBy: string; exceptUserIds?: string[]; at?: string },
  ) {
    const eventPayload = { ...payload, at: payload.at ?? new Date().toISOString() };
    client.broadcast.emit(SocketEvent.MeetingMuteAll, eventPayload);
    return { ack: true };
  }

  private extractSocketToken(client: Socket): string | undefined {
    const handshakeAuth = client.handshake.auth as
      | { token?: unknown; authorization?: unknown }
      | undefined;

    if (typeof handshakeAuth?.token === 'string') {
      return this.normalizeSocketToken(handshakeAuth.token);
    }

    if (typeof handshakeAuth?.authorization === 'string') {
      return extractBearerToken(handshakeAuth.authorization);
    }

    const headerAuthorization = client.handshake.headers.authorization;
    if (typeof headerAuthorization === 'string') {
      return extractBearerToken(headerAuthorization);
    }

    const queryToken = client.handshake.query.token;
    if (typeof queryToken === 'string') {
      return this.normalizeSocketToken(queryToken);
    }

    return undefined;
  }

  private normalizeSocketToken(value: string): string | undefined {
    const bearerToken = extractBearerToken(value);
    if (bearerToken) {
      return bearerToken;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}
