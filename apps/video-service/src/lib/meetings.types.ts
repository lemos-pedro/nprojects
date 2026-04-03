export enum ParticipantRole {
  Host = 'host',
  Presenter = 'presenter',
  Viewer = 'viewer',
}

export type CreateMeetingDto = {
  tenantId: string;
  createdBy: string;
  projectId?: string;
  channelId?: string;
  teamId?: string;
  title: string;
  description?: string;
  scheduledFor?: string;
  maxParticipants?: number;
  isRecorded?: boolean;
  participants?: { userId: string; role: ParticipantRole; name?: string }[];
};

export type Meeting = {
  id: string;
  tenantId: string;
  createdBy: string;
  projectId?: string;
  channelId?: string;
  teamId?: string;
  title: string;
  description?: string;
  roomName: string;
  roomSid?: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  scheduledFor?: string;
  startedAt?: string;
  createdAt: string;
  updatedAt: string;
  maxParticipants: number;
  isRecorded: boolean;
  endedAt?: string;
  recordingUrl?: string;
  aiSummary?: string;
  aiDecisions?: string[];
  aiActionItems?: string[];
  createdTaskIds?: string[];
};

export type TokenRequestDto = {
  userId: string;
  role: ParticipantRole;
  name?: string;
};

export type AdmitParticipantDto = {
  hostUserId: string;
  participantUserId: string;
};

export type WaitingParticipant = {
  userId: string;
  name?: string;
  joinedAt?: string;
  isAdmitted: boolean;
};
