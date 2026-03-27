export enum SocketEvent {
  Message = 'message',
  Notification = 'notification',
  ChannelJoin = 'channel:join',
  ChannelLeave = 'channel:leave',
  UserTyping = 'user:typing',
  MessageEdited = 'message:edited',
  MessageDeleted = 'message:deleted',
  ReactionAdded = 'reaction:added',
  UserPresence = 'user:presence',
  TaskUpdated = 'task:updated',
  AiAlert = 'ai:alert',
}
