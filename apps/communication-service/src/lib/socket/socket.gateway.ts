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

import { SocketEvent } from './socket.types';

@WebSocketGateway({ cors: true })
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer() private server!: Server;

  afterInit() {
    Logger.log('socket gateway ready', 'SocketGateway');
  }

  handleConnection(client: Socket) {
    Logger.log(`client connected ${client.id}`, 'SocketGateway');
  }

  handleDisconnect(client: Socket) {
    Logger.log(`client disconnected ${client.id}`, 'SocketGateway');
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
}
