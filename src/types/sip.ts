export type SipTransport = 'UDP' | 'TCP' | 'TLS' | 'WSS';
export type SipConnectionStatus = 'Registered' | 'Unregistered' | 'Connecting' | 'Failed';

export interface SipAccount {
  id: string;
  ownerId: string;
  name: string;
  domain: string;
  username: string;
  passwordMasked: string;
  hasPassword?: boolean;
  port: number;
  transport: SipTransport;
  outboundProxy: string;
  displayName: string;
  callerId: string;
  status: SipConnectionStatus;
  lastRegisteredAt?: string;
  latencyMs?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SipLogEntry {
  id: string;
  accountId: string;
  accountName: string;
  timestamp: string;
  level: 'INFO' | 'SIP_TX' | 'SIP_RX' | 'WARN' | 'ERROR';
  method: string;
  summary: string;
  rawPacket?: string;
}

export type ConsentStatus = 'verified_opt_in' | 'pending' | 'revoked';

export interface Contact {
  id: string;
  ownerId: string;
  name: string;
  phoneNumber: string;
  consentStatus: ConsentStatus;
  consentSource: string;
  consentDate: string;
  dncOptOut: boolean;
  listName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceRecording {
  id: string;
  ownerId: string;
  name: string;
  language: string;
  format: string;
  sampleRate: number;
  channels: number;
  durationSeconds: number;
  telephonyConverted: boolean;
  audioUrl: string;
  assignedCampaignIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export type CallDirection = 'Outbound' | 'Inbound';
export type CallStatus =
  | 'Ringing'
  | 'Answered'
  | 'Busy'
  | 'Rejected'
  | 'Failed'
  | 'No Answer'
  | 'Voicemail';

export interface CallLog {
  id: string;
  ownerId: string;
  phoneNumber: string;
  contactName: string;
  direction: CallDirection;
  sipAccountId: string;
  sipAccountName: string;
  status: CallStatus;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  recordingId: string;
  recordingUrl: string;
  campaignId: string;
  campaignName: string;
  sipCallId?: string;
  hangupCause?: string;
  createdAt: string;
  updatedAt: string;
}

export type CampaignStatus = 'Idle' | 'Running' | 'Paused' | 'Stopped' | 'Completed';

export interface Campaign {
  id: string;
  ownerId: string;
  name: string;
  contactList: string;
  sipAccountId: string;
  recordingId: string;
  status: CampaignStatus;
  maxConcurrentCalls: number;
  callIntervalSeconds: number;
  retryAttempts: number;
  retryIntervalSeconds: number;
  workingHoursStart: string;
  workingHoursEnd: string;
  autoDisconnectAfterPlayback: boolean;
  totalContacts: number;
  dialedCount: number;
  answeredCount: number;
  busyCount?: number;
  failedCount: number;
  noAnswerCount?: number;
  skippedDncCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface VoicemailMessage {
  id: string;
  ownerId: string;
  callerNumber: string;
  callerName: string;
  sipAccountId: string;
  sipAccountName?: string;
  durationSeconds: number;
  audioUrl: string;
  isRead: boolean;
  transcriptSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncomingCallConfig {
  autoAnswerEnabled: boolean;
  autoAnswerDelaySeconds: number;
  welcomeRecordingId: string;
  recordVoicemailEnabled: boolean;
  maxVoicemailDurationSeconds: number;
  beepBeforeRecording: boolean;
  activeSipAccountId: string;
}

export interface LiveCallSession {
  callId: string;
  direction: CallDirection;
  phoneNumber: string;
  contactName: string;
  sipAccountId: string;
  sipAccountName: string;
  status: 'Dialing' | 'Ringing' | 'Answered' | 'PlayingAudio' | 'RecordingVoicemail' | 'Ended';
  startedAt: string;
  answeredAt?: string;
  durationSeconds: number;
  recordingId?: string;
  recordingName?: string;
  campaignId?: string;
  campaignName?: string;
  isMuted?: boolean;
  isOnHold?: boolean;
  sipMethodLog: string[];
}

export type UserRole = 'admin' | 'manager' | 'operator' | 'viewer';

export type RbacAction =
  | 'manage_sip_accounts'
  | 'register_sip_accounts'
  | 'originate_calls'
  | 'originate_callbacks'
  | 'manage_contacts'
  | 'manage_recordings'
  | 'manage_campaigns'
  | 'control_campaigns'
  | 'manage_incoming_config'
  | 'manage_voicemails'
  | 'export_cdr'
  | 'manage_users_and_roles'
  | 'manage_firebase_and_system'
  | (string & {});

export interface RbacPermissionEntry {
  id: string;
  action: RbacAction;
  label: string;
  category: string;
  roles: Record<UserRole, boolean>;
  updatedAt: string;
}

export interface RolePermissionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department?: string;
  status: 'Active' | 'Invited' | 'Suspended';
  lastActive: string;
  createdAt?: string;
}


export type CallbackStageStatus =
  | 'CallingFrom'
  | 'PlayingWaitVoice'
  | 'CallingTo'
  | 'InConference'
  | 'Completed'
  | 'Failed';

export type CallbackLegStatus =
  | 'Idle'
  | 'Dialing'
  | 'Ringing'
  | 'Answered'
  | 'PlayingWaitVoice'
  | 'InConference'
  | 'Ended'
  | 'Failed';

export interface CallbackSession {
  id: string;
  ownerId: string;
  callFromNumber: string;
  callFromName: string;
  callToNumber: string;
  callToName: string;
  sipAccountId: string;
  sipAccountName: string;
  waitVoiceText: string;
  waitVoiceWavUri?: string;
  status: CallbackStageStatus;
  legACallId?: string;
  legAStatus: CallbackLegStatus;
  legBCallId?: string;
  legBStatus: CallbackLegStatus;
  legAMuted?: boolean;
  legBMuted?: boolean;
  startedAt: string;
  legAAnsweredAt?: string;
  legBAnsweredAt?: string;
  conferencedAt?: string;
  endedAt?: string;
  durationSeconds: number;
  conferenceDurationSeconds: number;
  bridgeId: string;
  sipTrace: string[];
}

export interface FirebaseSyncCollectionCounts {
  sipAccounts: number;
  users: number;
  rbacMatrix?: number;
  recordings: number;
  voicemails: number;
  contacts: number;
  campaigns: number;
  callbacks: number;
  callLogs: number;
  totalFiles: number;
  totalDocuments: number;
}

export interface FirebaseSyncEventLog {
  id: string;
  timestamp: string;
  operation: 'CONNECT' | 'AUTO_SAVE' | 'AUTO_DELETE' | 'FULL_SYNC' | 'DISCONNECT';
  collection: string;
  documentId: string;
  summary: string;
}

export interface FirebaseSyncStatus {
  connected: boolean;
  autoSaveEnabled: boolean;
  projectId: string;
  databaseId: string;
  storageBucket: string;
  connectedAt?: string;
  lastSyncedAt?: string;
  lastOperationSummary?: string;
  counts: FirebaseSyncCollectionCounts;
  recentEvents: FirebaseSyncEventLog[];
}


