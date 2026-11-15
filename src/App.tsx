import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard,
  PhoneCall,
  PhoneForwarded,
  Server,
  Users,
  Mic,
  Megaphone,
  PhoneIncoming,
  History,
  Voicemail,
  Settings,
  Shield,
  Sun,
  Moon,
  LogOut,
  PhoneOff,
  Play,
  Volume2,
  Lock,
} from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  db,
  doc,
  setDoc,
  serverTimestamp,
  signInWithGoogle,
  signOutUser,
  handleFirestoreError,
  OperationType,
  syncEntityToFirestore,
  deleteEntityFromFirestore,
} from './lib/firebase';
import {
  calculateDashboardMetrics,
  formatDurationClock,
  canRolePerform,
  ROLE_DEFINITIONS,
  DEFAULT_RBAC_MATRIX,
} from './utils/sipEngine';
import { DirectSoftphonePanel } from './components/DirectSoftphoneModal';
import {
  CallbackView,
  speakCallbackPromptInBrowser,
} from './components/CallbackView';
import { SipAccountsView } from './components/SipAccountsView';
import {
  ContactsView,
  VoiceRecordingsView,
} from './components/ContactsAndRecordingsView';
import {
  CampaignsView,
  IncomingCallsView,
} from './components/CampaignsAndInboundView';
import {
  CallHistoryView,
  VoiceMessagesView,
  SettingsView,
} from './components/HistoryAndSettingsView';
import {
  AuthGateScreen,
  UsersAndRolesView,
} from './components/AuthAndRolesView';
import type {
  SipAccount,
  SipLogEntry,
  Contact,
  VoiceRecording,
  Campaign,
  CallLog,
  VoicemailMessage,
  IncomingCallConfig,
  LiveCallSession,
  RolePermissionUser,
  CallStatus,
  CallbackSession,
  FirebaseSyncStatus,
  UserRole,
  RbacAction,
  RbacPermissionEntry,
} from './types/sip';

type NavSection =
  | 'dashboard'
  | 'direct-call'
  | 'callback'
  | 'sip-accounts'
  | 'contacts'
  | 'recordings'
  | 'campaigns'
  | 'incoming-calls'
  | 'call-history'
  | 'voice-messages'
  | 'users-roles'
  | 'settings';

const NAV_ITEMS: { id: NavSection; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'direct-call', label: 'Direct SIP Call', icon: PhoneCall },
  { id: 'callback', label: 'Callback', icon: PhoneForwarded },
  { id: 'sip-accounts', label: 'SIP Accounts', icon: Server },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'recordings', label: 'Voice Recordings', icon: Mic },
  { id: 'campaigns', label: 'Outgoing Campaigns', icon: Megaphone },
  { id: 'incoming-calls', label: 'Incoming Calls', icon: PhoneIncoming },
  { id: 'call-history', label: 'Call History', icon: History },
  { id: 'voice-messages', label: 'Voice Messages', icon: Voicemail },
  { id: 'users-roles', label: 'Users & Roles', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const SESSION_STORAGE_KEY = 'voxpulse_active_session_user_v1';

export default function App() {
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [isDark, setIsDark] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeSessionUser, setActiveSessionUser] = useState<RolePermissionUser | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.email && parsed.role) {
          return parsed as RolePermissionUser;
        }
      }
    } catch {
      // ignore storage errors
    }
    return null;
  });
  const [rbacAlert, setRbacAlert] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  // Server-authoritative state synced via WebSocket (/ws/sip) and REST
  const [sipAccounts, setSipAccounts] = useState<SipAccount[]>([]);
  const [sipLogs, setSipLogs] = useState<SipLogEntry[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recordings, setRecordings] = useState<VoiceRecording[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [voicemails, setVoicemails] = useState<VoicemailMessage[]>([]);
  const [incomingConfig, setIncomingConfig] = useState<IncomingCallConfig>({
    autoAnswerEnabled: true,
    autoAnswerDelaySeconds: 2,
    welcomeRecordingId: 'rec-welcome-ivr',
    recordVoicemailEnabled: true,
    maxVoicemailDurationSeconds: 60,
    beepBeforeRecording: true,
    activeSipAccountId: 'sip-trunk-us-west',
  });
  const [liveCalls, setLiveCalls] = useState<LiveCallSession[]>([]);
  const [callbacks, setCallbacks] = useState<CallbackSession[]>([]);
  const [users, setUsers] = useState<RolePermissionUser[]>([]);
  const [rbacMatrix, setRbacMatrix] = useState<RbacPermissionEntry[]>(DEFAULT_RBAC_MATRIX);
  const [firebaseSync, setFirebaseSync] = useState<FirebaseSyncStatus>({
    connected: true,
    autoSaveEnabled: true,
    projectId: 'my-agent-507708',
    databaseId: 'ai-studio-customercaremana-815d2499-8678-4614-9cd7-dbeac3731ede',
    storageBucket: 'my-agent-507708.firebasestorage.app',
    counts: {
      sipAccounts: 3,
      users: 4,
      recordings: 3,
      voicemails: 2,
      contacts: 5,
      campaigns: 2,
      callbacks: 1,
      callLogs: 5,
      totalFiles: 5,
      totalDocuments: 25,
    },
    recentEvents: [],
  });
  const [quickDialNumber, setQuickDialNumber] = useState('+14158902110');

  const wsRef = useRef<WebSocket | null>(null);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  const applyServerState = useCallback((srv: Record<string, any>) => {
    if (!srv) return;
    if (Array.isArray(srv.sipAccounts)) setSipAccounts(srv.sipAccounts);
    if (Array.isArray(srv.sipLogs)) setSipLogs(srv.sipLogs);
    if (Array.isArray(srv.contacts)) setContacts(srv.contacts);
    if (Array.isArray(srv.recordings)) setRecordings(srv.recordings);
    if (Array.isArray(srv.campaigns)) setCampaigns(srv.campaigns);
    if (Array.isArray(srv.callLogs)) setCallLogs(srv.callLogs);
    if (Array.isArray(srv.voicemails)) setVoicemails(srv.voicemails);
    if (srv.incomingConfig) setIncomingConfig(srv.incomingConfig);
    if (Array.isArray(srv.liveCalls)) setLiveCalls(srv.liveCalls);
    if (Array.isArray(srv.callbacks)) setCallbacks(srv.callbacks);
    if (Array.isArray(srv.users)) setUsers(srv.users);
    if (Array.isArray(srv.rbacMatrix)) setRbacMatrix(srv.rbacMatrix);
    if (srv.firebaseSync) setFirebaseSync(srv.firebaseSync);
  }, []);

  // Initial fetch + WebSocket real-time subscription
  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((data) => {
        if (data?.state) applyServerState(data.state);
      })
      .catch(() => {});

    let reconnectTimer: number | null = null;
    let isUnmounted = false;

    const connectWs = () => {
      if (isUnmounted) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/sip`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isUnmounted) setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.state) {
            applyServerState(msg.state);
          }
          if (msg.type === 'call:remoteAudio' && typeof msg.wavDataUri === 'string') {
            try {
              const audio = new Audio(msg.wavDataUri);
              audio.volume = 0.85;
              audio.play().catch(() => {});
            } catch {
              // ignore audio autoplay restriction
            }
          }
          if (msg.type === 'callback:waitPromptPlaying') {
            speakCallbackPromptInBrowser(
              msg.waitVoiceText || 'Please wait till received the call from other side',
              msg.wavDataUri
            );
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        if (!isUnmounted) {
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    };

    connectWs();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [applyServerState]);

  const handleSendMicPcm = useCallback((callId: string, samples: number[]) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'call:micPcm',
          callId,
          samples,
        })
      );
    }
  }, []);

  // Optional Firestore cloud mirroring when user is authenticated & verified
  const mirrorCallToFirestore = async (cdr: CallLog) => {
    if (!currentUser || !currentUser.emailVerified) return;
    const path = `callLogs/${cdr.id}`;
    try {
      await setDoc(doc(db, 'callLogs', cdr.id), {
        ownerId: currentUser.uid,
        phoneNumber: cdr.phoneNumber.slice(0, 32),
        contactName: cdr.contactName.slice(0, 120),
        direction: cdr.direction,
        sipAccountId: cdr.sipAccountId.slice(0, 128),
        sipAccountName: cdr.sipAccountName.slice(0, 100),
        status: cdr.status,
        startTime: cdr.startTime.slice(0, 64),
        endTime: cdr.endTime.slice(0, 64),
        durationSeconds: Number(cdr.durationSeconds) || 0,
        recordingId: (cdr.recordingId || 'none').slice(0, 128),
        recordingUrl: (cdr.recordingUrl || '').slice(0, 500),
        campaignId: (cdr.campaignId || 'direct').slice(0, 128),
        campaignName: (cdr.campaignName || 'Direct Call').slice(0, 120),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  // Sync activeSessionUser with updated server users array (e.g. when role changes)
  useEffect(() => {
    if (!activeSessionUser || users.length === 0) return;
    const found = users.find((u) => u.id === activeSessionUser.id || u.email === activeSessionUser.email);
    if (found) {
      if (found.status === 'Suspended') {
        setActiveSessionUser(null);
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } else if (
        found.role !== activeSessionUser.role ||
        found.name !== activeSessionUser.name ||
        found.status !== activeSessionUser.status
      ) {
        setActiveSessionUser(found);
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(found));
      }
    }
  }, [users, activeSessionUser]);

  const handleSetSessionUser = useCallback((user: RolePermissionUser | null) => {
    setActiveSessionUser(user);
    setRbacAlert(null);
    if (user) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  const handleSignOutAll = async () => {
    handleSetSessionUser(null);
    if (currentUser) {
      await signOutUser().catch(() => {});
    }
  };

  const handleGoogleSignInGate = async () => {
    const gUser = await signInWithGoogle();
    if (gUser?.email) {
      const res = await fetch('/api/auth/google-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: gUser.email,
          name: gUser.displayName || gUser.email.split('@')[0],
        }),
      });
      const data = await res.json();
      if (data?.user) {
        handleSetSessionUser(data.user);
      }
    }
  };

  const requirePermission = (action: RbacAction, actionLabel: string): boolean => {
    if (!activeSessionUser) {
      setRbacAlert('Authentication required: Please sign in to perform this action.');
      return false;
    }
    if (!canRolePerform(activeSessionUser.role, action, rbacMatrix)) {
      const msg = `Permission Denied: Your current role (${activeSessionUser.role.toUpperCase()}) is not authorized to ${actionLabel}.`;
      setRbacAlert(msg);
      throw new Error(msg);
    }
    setRbacAlert(null);
    return true;
  };

  // --- API Action Handlers ---
  const handleOriginateCall = async (payload: {
    phoneNumber: string;
    contactName?: string;
    sipAccountId: string;
    recordingId: string;
    autoPlayOnAnswer: boolean;
    autoDisconnectAfterPlayback: boolean;
    simulatedOutcome: CallStatus;
    forceLocalLoopback?: boolean;
  }) => {
    requirePermission('originate_calls', 'originate direct SIP calls');
    const res = await fetch('/api/calls/originate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to originate SIP call');
    }
  };

  const handleCallAction = async (
    callId: string,
    action: string,
    extra?: { recordingId?: string; digit?: string }
  ) => {
    const res = await fetch(`/api/calls/${callId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    const data = await res.json();
    if (data?.cdr) {
      await mirrorCallToFirestore(data.cdr);
    }
  };

  const handleOriginateCallback = async (payload: {
    callFromNumber: string;
    callFromName?: string;
    callToNumber: string;
    callToName?: string;
    sipAccountId: string;
    waitVoiceText: string;
    simulatedLegBOutcome?: CallStatus;
    forceLocalLoopback?: boolean;
  }) => {
    requirePermission('originate_callbacks', 'originate two-legged callback sessions');
    const res = await fetch('/api/callbacks/originate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to originate Callback session');
    }
  };

  const handleCallbackAction = async (
    callbackId: string,
    action: 'hangup' | 'replay_wait_voice' | 'toggle_mute_from' | 'toggle_mute_to'
  ) => {
    await fetch(`/api/callbacks/${callbackId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  };

  const handleSaveSipAccount = async (
    payload: Partial<SipAccount> & { password?: string }
  ) => {
    requirePermission('manage_sip_accounts', 'add or modify SIP trunk accounts');
    const res = await fetch('/api/sip-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save SIP account');
    }
    if (firebaseSync.connected && currentUser?.emailVerified && data?.account) {
      const acc: SipAccount = data.account;
      await syncEntityToFirestore('sipAccounts', acc.id, {
        ownerId: currentUser.uid,
        name: acc.name.slice(0, 100),
        domain: acc.domain.slice(0, 255),
        username: acc.username.slice(0, 128),
        encryptedPassword: acc.passwordMasked || 'aes-256-gcm-vault',
        port: Number(acc.port) || 5060,
        transport: acc.transport,
        outboundProxy: (acc.outboundProxy || '').slice(0, 255),
        displayName: (acc.displayName || acc.name).slice(0, 100),
        callerId: (acc.callerId || acc.username).slice(0, 64),
        status: acc.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleRegisterSipAccount = async (
    id: string,
    action: 'register' | 'unregister' | 'test'
  ) => {
    requirePermission('register_sip_accounts', 'register or unregister SIP trunks');
    await fetch(`/api/sip-accounts/${id}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  };

  const handleDeleteSipAccount = async (id: string) => {
    requirePermission('manage_sip_accounts', 'delete SIP trunk accounts');
    await fetch(`/api/sip-accounts/${id}`, { method: 'DELETE' });
    if (firebaseSync.connected && currentUser?.emailVerified) {
      await deleteEntityFromFirestore('sipAccounts', id);
    }
  };

  const handleAddContact = async (payload: Partial<Contact>) => {
    requirePermission('manage_contacts', 'add or modify contacts');
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to add contact');
    }
    if (firebaseSync.connected && currentUser?.emailVerified && data?.contact) {
      const c: Contact = data.contact;
      await syncEntityToFirestore('contacts', c.id, {
        ownerId: currentUser.uid,
        name: c.name.slice(0, 120),
        phoneNumber: c.phoneNumber.slice(0, 32),
        consentStatus: c.consentStatus,
        consentSource: c.consentSource.slice(0, 120),
        consentDate: c.consentDate.slice(0, 64),
        dncOptOut: Boolean(c.dncOptOut),
        listName: c.listName.slice(0, 80),
        notes: (c.notes || '').slice(0, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleImportCsv = async (csvText: string, listName: string) => {
    const res = await fetch('/api/contacts/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText, listName }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to import CSV');
    }
    return data;
  };

  const handleToggleDnc = async (id: string, dncOptOut: boolean) => {
    await fetch(`/api/contacts/${id}/dnc`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dncOptOut }),
    });
  };

  const handleDeleteContact = async (id: string) => {
    await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    if (firebaseSync.connected && currentUser?.emailVerified) {
      await deleteEntityFromFirestore('contacts', id);
    }
  };

  const handleCreateRecording = async (payload: {
    name: string;
    language: string;
    durationSeconds: number;
    audioUrl?: string;
    convertWithFfmpeg: boolean;
    toneFreqHz?: number;
  }) => {
    const res = await fetch('/api/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (firebaseSync.connected && currentUser?.emailVerified && data?.recording) {
      const r: VoiceRecording = data.recording;
      await syncEntityToFirestore('recordings', r.id, {
        ownerId: currentUser.uid,
        name: r.name.slice(0, 120),
        language: r.language.slice(0, 32),
        format: r.format.slice(0, 32),
        sampleRate: Number(r.sampleRate) || 8000,
        channels: Number(r.channels) || 1,
        durationSeconds: Number(r.durationSeconds) || 5,
        telephonyConverted: Boolean(r.telephonyConverted),
        audioUrl: (r.audioUrl || '').slice(0, 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleUpdateRecording = async (
    id: string,
    payload: { name?: string; language?: string; convertTelephony?: boolean }
  ) => {
    await fetch(`/api/recordings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const handleDeleteRecording = async (id: string) => {
    await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
    if (firebaseSync.connected && currentUser?.emailVerified) {
      await deleteEntityFromFirestore('recordings', id);
    }
  };

  const handleCreateCampaign = async (
    payload: Partial<Campaign> & { customPhoneNumbers?: string; startImmediately?: boolean }
  ) => {
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (firebaseSync.connected && currentUser?.emailVerified && data?.campaign) {
      const camp: Campaign = data.campaign;
      await syncEntityToFirestore('campaigns', camp.id, {
        ownerId: currentUser.uid,
        name: camp.name.slice(0, 120),
        contactList: camp.contactList.slice(0, 80),
        sipAccountId: camp.sipAccountId.slice(0, 128),
        recordingId: camp.recordingId.slice(0, 128),
        status: camp.status,
        maxConcurrentCalls: camp.maxConcurrentCalls,
        callIntervalSeconds: camp.callIntervalSeconds,
        retryAttempts: camp.retryAttempts,
        retryIntervalSeconds: camp.retryIntervalSeconds,
        workingHoursStart: camp.workingHoursStart.slice(0, 16),
        workingHoursEnd: camp.workingHoursEnd.slice(0, 16),
        autoDisconnectAfterPlayback: Boolean(camp.autoDisconnectAfterPlayback),
        totalContacts: camp.totalContacts,
        dialedCount: camp.dialedCount,
        answeredCount: camp.answeredCount,
        failedCount: camp.failedCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleUpdateCampaign = async (
    id: string,
    payload: Partial<Campaign> & { customPhoneNumbers?: string }
  ) => {
    await fetch(`/api/campaigns/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const handleControlCampaign = async (
    id: string,
    action: 'start' | 'pause' | 'resume' | 'stop'
  ) => {
    await fetch(`/api/campaigns/${id}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  };

  const handleDeleteCampaign = async (id: string) => {
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    if (firebaseSync.connected && currentUser?.emailVerified) {
      await deleteEntityFromFirestore('campaigns', id);
    }
  };

  const handleUpdateIncomingConfig = async (cfg: Partial<IncomingCallConfig>) => {
    await fetch('/api/incoming-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  };

  const handleSimulateIncomingCall = async (payload: {
    callerNumber: string;
    callerName: string;
    sipAccountId: string;
    callerMessageText: string;
  }) => {
    await fetch('/api/incoming-calls/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const handleMarkVoicemailRead = async (id: string) => {
    await fetch(`/api/voicemails/${id}/read`, { method: 'PATCH' });
  };

  const handleDeleteVoicemail = async (id: string) => {
    await fetch(`/api/voicemails/${id}`, { method: 'DELETE' });
    if (firebaseSync.connected && currentUser?.emailVerified) {
      await deleteEntityFromFirestore('voicemails', id);
    }
  };

  const handleAddUser = async (payload: {
    name: string;
    email: string;
    role: UserRole;
    department?: string;
    password?: string;
  }) => {
    requirePermission('manage_users_and_roles', 'create user accounts');
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to create user');
    }
    if (firebaseSync.connected && currentUser?.emailVerified && data?.user) {
      const u: RolePermissionUser = data.user;
      await syncEntityToFirestore('users', u.id, {
        uid: u.id,
        email: u.email,
        displayName: u.name,
        role: u.role,
        department: u.department || 'Operations',
        status: u.status || 'Active',
        createdAt: serverTimestamp(),
      });
    }
  };

  const handleUpdateUser = async (
    userId: string,
    payload: { role?: UserRole; status?: 'Active' | 'Invited' | 'Suspended'; department?: string }
  ) => {
    requirePermission('manage_users_and_roles', 'modify user roles or status');
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update user');
    }
    if (firebaseSync.connected && currentUser?.emailVerified && data?.user) {
      const u: RolePermissionUser = data.user;
      await syncEntityToFirestore('users', u.id, {
        uid: u.id,
        email: u.email,
        displayName: u.name,
        role: u.role,
        department: u.department || 'Operations',
        status: u.status || 'Active',
        createdAt: serverTimestamp(),
      });
    }
  };

  const handleDeleteUser = async (userId: string) => {
    requirePermission('manage_users_and_roles', 'delete user accounts');
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete user');
    }
    if (firebaseSync.connected && currentUser?.emailVerified) {
      await deleteEntityFromFirestore('users', userId);
    }
  };

  const handleAddPermission = async (payload: {
    label: string;
    category: string;
    action?: string;
    roles: Record<UserRole, boolean>;
  }) => {
    const res = await fetch('/api/rbac-matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to add RBAC permission');
    }
    if (Array.isArray(data.rbacMatrix)) {
      setRbacMatrix(data.rbacMatrix);
    }
    if (firebaseSync.connected && currentUser?.emailVerified && data?.permission) {
      await syncEntityToFirestore('rbacMatrix', data.permission.id, {
        ...data.permission,
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleUpdatePermission = async (
    permissionId: string,
    payload: {
      label?: string;
      category?: string;
      action?: string;
      roles?: Record<UserRole, boolean>;
    }
  ) => {
    const res = await fetch(`/api/rbac-matrix/${encodeURIComponent(permissionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update RBAC permission');
    }
    if (Array.isArray(data.rbacMatrix)) {
      setRbacMatrix(data.rbacMatrix);
    }
    if (firebaseSync.connected && currentUser?.emailVerified && data?.permission) {
      await syncEntityToFirestore('rbacMatrix', data.permission.id, {
        ...data.permission,
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleDeletePermission = async (permissionId: string) => {
    const res = await fetch(`/api/rbac-matrix/${encodeURIComponent(permissionId)}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete RBAC permission');
    }
    if (Array.isArray(data.rbacMatrix)) {
      setRbacMatrix(data.rbacMatrix);
    }
    if (firebaseSync.connected && currentUser?.emailVerified) {
      await deleteEntityFromFirestore('rbacMatrix', permissionId);
    }
  };

  const handleResetPermissions = async () => {
    const res = await fetch('/api/rbac-matrix/reset', {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to reset RBAC matrix');
    }
    if (Array.isArray(data.rbacMatrix)) {
      setRbacMatrix(data.rbacMatrix);
    }
  };

  const handleConnectFirebase = async () => {
    const res = await fetch('/api/firebase/connect', { method: 'POST' });
    const data = await res.json();
    if (data?.firebaseSync) {
      setFirebaseSync(data.firebaseSync);
    }
  };

  const handleSyncFirebaseNow = async () => {
    const res = await fetch('/api/firebase/sync', { method: 'POST' });
    const data = await res.json();
    if (data?.firebaseSync) {
      setFirebaseSync(data.firebaseSync);
    }
  };

  const handleDisconnectFirebase = async () => {
    const res = await fetch('/api/firebase/disconnect', { method: 'POST' });
    const data = await res.json();
    if (data?.firebaseSync) {
      setFirebaseSync(data.firebaseSync);
    }
  };

  const handleDownloadBackup = async () => {
    const res = await fetch('/api/backup');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voxpulse-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestoreBackup = async (jsonText: string) => {
    const parsed = JSON.parse(jsonText);
    await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
  };

  const metrics = calculateDashboardMetrics(callLogs, campaigns, voicemails);
  const currentNavLabel =
    NAV_ITEMS.find((n) => n.id === activeNav)?.label || 'Dashboard';

  // MANDATORY AUTHENTICATION GATE: This site cannot be used without a signed-in user
  if (!activeSessionUser) {
    return (
      <AuthGateScreen
        users={users}
        isDark={isDark}
        onToggleDark={() => setIsDark(!isDark)}
        onLoginSuccess={(u) => handleSetSessionUser(u)}
        onGoogleLogin={handleGoogleSignInGate}
      />
    );
  }

  const activeRoleDef = ROLE_DEFINITIONS[activeSessionUser.role];

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar Navigation */}
      <aside className="hidden lg:flex w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex-col justify-between">
        <div>
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display whitespace-nowrap">
              VoxPulse SIP
            </span>
          </div>

          <nav aria-label="Main Sidebar Navigation" className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  {item.id === 'voice-messages' &&
                    voicemails.some((v) => !v.isRead) && (
                      <span className="font-mono text-[11px] tabular-nums">
                        {voicemails.filter((v) => !v.isRead).length}
                      </span>
                    )}
                  {item.id === 'users-roles' && (
                    <span className="font-mono text-[10px] uppercase tracking-wider opacity-80">
                      {activeRoleDef.badgeLabel}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer: Active User Role + Registered Trunks Summary */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
          <div className="pb-2 mb-2 border-b border-slate-200 dark:border-slate-800 space-y-1">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Authenticated User
            </div>
            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
              {activeSessionUser.name}
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-sky-600 dark:text-sky-400 font-bold uppercase">
                Role: {activeRoleDef.badgeLabel}
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                {activeSessionUser.status || 'Active'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span>SIP Trunks Online</span>
            <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
              {sipAccounts.filter((a) => a.status === 'Registered').length} /{' '}
              {sipAccounts.length}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span>ARI / WS Signaling</span>
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {wsConnected ? 'Connected' : 'Reconnecting'}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span>Firebase Cloud</span>
            <span
              className={`font-mono font-semibold ${
                firebaseSync.connected
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {firebaseSync.connected ? 'Auto-Sync' : 'Standby'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb Left — User Role & Primary Action Right */}
        <header className="flex items-center justify-between gap-4 px-4 lg:px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0">
            <span className="font-bold lg:font-medium text-slate-900 dark:text-slate-100 lg:text-slate-600 lg:dark:text-slate-400">
              VoxPulse
            </span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-900 dark:text-slate-100 font-semibold">
              {currentNavLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Active User & Quick Role Account Switcher */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs">
              <Shield className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {activeSessionUser.name}
              </span>
              <span className="font-mono font-bold uppercase text-sky-600 dark:text-sky-400">
                [{activeSessionUser.role}]
              </span>
              <select
                aria-label="Quick switch active user role account"
                value={activeSessionUser.id}
                onChange={(e) => {
                  const target = users.find((u) => u.id === e.target.value);
                  if (target && target.status !== 'Suspended') {
                    handleSetSessionUser(target);
                  }
                }}
                className="ml-1 bg-transparent font-mono text-[11px] text-slate-600 dark:text-slate-400 focus:outline-none cursor-pointer"
              >
                {users
                  .filter((u) => u.status !== 'Suspended')
                  .map((u) => (
                    <option
                      key={u.id}
                      value={u.id}
                      className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                    >
                      Switch: {u.name} ({u.role.toUpperCase()})
                    </option>
                  ))}
              </select>
            </div>

            {canRolePerform(activeSessionUser.role, 'originate_calls', rbacMatrix) && (
              <button
                type="button"
                onClick={() => setActiveNav('direct-call')}
                className="flex items-center gap-2 py-2 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Direct SIP Call</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsDark(!isDark)}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={handleSignOutAll}
              className="flex items-center gap-1.5 py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {/* Mobile Horizontal Navigation Strip (<1024px) */}
        <nav
          aria-label="Mobile Navigation"
          className="flex lg:hidden items-center gap-1.5 overflow-x-auto px-4 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Active Call Banner when a SIP call is live */}
        {liveCalls.length > 0 && (
          <div className="bg-sky-950 text-sky-100 px-6 py-2.5 border-b border-sky-800 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-emerald-400">
                LIVE SIP SESSION ({liveCalls[0].status})
              </span>
              <span>·</span>
              <span className="font-medium">{liveCalls[0].contactName}</span>
              <span className="font-mono tabular-nums text-sky-300">
                ({liveCalls[0].phoneNumber})
              </span>
              <span>·</span>
              <span className="font-mono tabular-nums">
                Duration: {formatDurationClock(liveCalls[0].durationSeconds)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleCallAction(liveCalls[0].callId, 'play_recording', {
                    recordingId: recordings[0]?.id,
                  })
                }
                className="flex items-center gap-1 py-1 px-2.5 rounded bg-sky-700 hover:bg-sky-600 text-white cursor-pointer whitespace-nowrap"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Play Audio</span>
              </button>
              <button
                type="button"
                onClick={() => handleCallAction(liveCalls[0].callId, 'hangup')}
                className="flex items-center gap-1 py-1 px-2.5 rounded bg-red-600 hover:bg-red-500 text-white cursor-pointer whitespace-nowrap"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Hang Up</span>
              </button>
            </div>
          </div>
        )}

        {/* Viewport Container */}
        <main className="flex-1 p-4 lg:p-6 overflow-y-auto max-w-[1440px] w-full mx-auto space-y-4">
          {rbacAlert && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-400 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-2 font-medium">
                <Lock className="w-4 h-4 shrink-0" />
                <span>{rbacAlert}</span>
              </div>
              <button
                type="button"
                onClick={() => setRbacAlert(null)}
                className="text-xs underline cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeNav === 'dashboard' && (
            <div className="space-y-6">
              {/* 9 Required KPI Cards in Structured Single-Line Label Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Total Calls
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {metrics.totalCalls}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Outgoing Calls
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-1">
                    {metrics.outgoingCalls}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Incoming Calls
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400 mt-1">
                    {metrics.incomingCalls}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Answered Calls
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                    {metrics.answeredCalls}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Missed Calls
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
                    {metrics.missedCalls}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Failed Calls
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 mt-1">
                    {metrics.failedCalls}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Total Call Duration
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                    {formatDurationClock(metrics.totalDurationSeconds)}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Successful Campaigns
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                    {metrics.successfulCampaigns}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    Saved Voice Messages
                  </div>
                  <div className="text-2xl font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-1">
                    {metrics.savedVoiceMessages}
                  </div>
                </div>
              </div>

              {/* Dashboard Middle Row: Quick Direct SIP Launcher + Active Campaign Control */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Quick Direct SIP Call Widget */}
                <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          Quick Direct SIP Call & Audio Injection
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Dial any authorized contact or number directly over registered SIP trunk
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveNav('direct-call')}
                        className="text-xs text-sky-600 dark:text-sky-400 hover:underline cursor-pointer whitespace-nowrap"
                      >
                        Open Full Keypad
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label
                          htmlFor="dash-quick-phone"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                        >
                          Destination Phone Number (E.164)
                        </label>
                        <input
                          id="dash-quick-phone"
                          type="text"
                          value={quickDialNumber}
                          onChange={(e) => setQuickDialNumber(e.target.value)}
                          className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {contacts
                          .filter((c) => !c.dncOptOut)
                          .slice(0, 3)
                          .map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setQuickDialNumber(c.phoneNumber)}
                              className="py-1 px-2.5 rounded border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              {c.name} ({c.phoneNumber})
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        handleOriginateCall({
                          phoneNumber: quickDialNumber,
                          sipAccountId: sipAccounts[0]?.id || '',
                          recordingId: recordings[0]?.id || '',
                          autoPlayOnAnswer: true,
                          autoDisconnectAfterPlayback: false,
                          simulatedOutcome: 'Answered',
                        })
                      }
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                    >
                      <PhoneCall className="w-4 h-4" />
                      <span>Originate Direct SIP Call</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleSimulateIncomingCall({
                          callerNumber: '+14158909920',
                          callerName: 'Inbound Patient Line',
                          sipAccountId: sipAccounts[0]?.id || '',
                          callerMessageText:
                            'Automated inbound test voicemail recorded from dashboard.',
                        })
                      }
                      className="py-2.5 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                    >
                      Test Inbound Call
                    </button>
                  </div>
                </div>

                {/* Active Campaigns & Trunk Status */}
                <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          Automated Voice Broadcast Campaigns
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Real-time progress, consent enforcement, and automated playback
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveNav('campaigns')}
                        className="text-xs text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        Manage Campaigns
                      </button>
                    </div>

                    <div className="space-y-3">
                      {campaigns.slice(0, 3).map((camp) => {
                        const pct =
                          camp.totalContacts > 0
                            ? Math.min(
                                100,
                                Math.round((camp.dialedCount / camp.totalContacts) * 100)
                              )
                            : 0;
                        return (
                          <div
                            key={camp.id}
                            className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                  {camp.name}
                                </span>
                                <span className="text-xs text-slate-500 ml-2">
                                  · {camp.status} · {camp.dialedCount}/{camp.totalContacts} dialed
                                </span>
                              </div>
                              {camp.status !== 'Running' && (
                                <button
                                  type="button"
                                  onClick={() => handleControlCampaign(camp.id, 'start')}
                                  className="flex items-center gap-1 py-1 px-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
                                >
                                  <Play className="w-3 h-3" />
                                  <span>Start</span>
                                </button>
                              )}
                            </div>
                            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-full bg-sky-500 transition-all duration-300"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Call History Table on Dashboard */}
              <CallHistoryView callLogs={callLogs} sipAccounts={sipAccounts} />
            </div>
          )}

          {activeNav === 'direct-call' && (
            <DirectSoftphonePanel
              sipAccounts={sipAccounts}
              recordings={recordings}
              contacts={contacts}
              liveCalls={liveCalls}
              onOriginateCall={handleOriginateCall}
              onCallAction={handleCallAction}
              onSendMicPcm={handleSendMicPcm}
            />
          )}

          {activeNav === 'callback' && (
            <CallbackView
              sipAccounts={sipAccounts}
              contacts={contacts}
              callbacks={callbacks}
              onOriginateCallback={handleOriginateCallback}
              onCallbackAction={handleCallbackAction}
            />
          )}

          {activeNav === 'sip-accounts' && (
            <SipAccountsView
              sipAccounts={sipAccounts}
              sipLogs={sipLogs}
              onSaveAccount={handleSaveSipAccount}
              onRegisterAction={handleRegisterSipAccount}
              onDeleteAccount={handleDeleteSipAccount}
            />
          )}

          {activeNav === 'contacts' && (
            <ContactsView
              contacts={contacts}
              onAddContact={handleAddContact}
              onImportCsv={handleImportCsv}
              onToggleDnc={handleToggleDnc}
              onDeleteContact={handleDeleteContact}
              onQuickDialContact={(c) => {
                setQuickDialNumber(c.phoneNumber);
                setActiveNav('direct-call');
              }}
            />
          )}

          {activeNav === 'recordings' && (
            <VoiceRecordingsView
              recordings={recordings}
              onCreateRecording={handleCreateRecording}
              onUpdateRecording={handleUpdateRecording}
              onDeleteRecording={handleDeleteRecording}
            />
          )}

          {activeNav === 'campaigns' && (
            <CampaignsView
              campaigns={campaigns}
              sipAccounts={sipAccounts}
              recordings={recordings}
              contacts={contacts}
              liveCalls={liveCalls}
              onCreateCampaign={handleCreateCampaign}
              onUpdateCampaign={handleUpdateCampaign}
              onControlCampaign={handleControlCampaign}
              onDeleteCampaign={handleDeleteCampaign}
              onCallAction={handleCallAction}
            />
          )}

          {activeNav === 'incoming-calls' && (
            <IncomingCallsView
              incomingConfig={incomingConfig}
              sipAccounts={sipAccounts}
              recordings={recordings}
              liveCalls={liveCalls}
              onUpdateConfig={handleUpdateIncomingConfig}
              onSimulateIncomingCall={handleSimulateIncomingCall}
              onCallAction={handleCallAction}
            />
          )}

          {activeNav === 'call-history' && (
            <CallHistoryView callLogs={callLogs} sipAccounts={sipAccounts} />
          )}

          {activeNav === 'voice-messages' && (
            <VoiceMessagesView
              voicemails={voicemails}
              onMarkRead={handleMarkVoicemailRead}
              onDeleteVoicemail={handleDeleteVoicemail}
            />
          )}

          {activeNav === 'users-roles' && (
            <UsersAndRolesView
              users={users}
              activeUser={activeSessionUser}
              rbacMatrix={rbacMatrix}
              onAddUser={handleAddUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              onSwitchActiveUser={(u) => handleSetSessionUser(u)}
              onAddPermission={handleAddPermission}
              onUpdatePermission={handleUpdatePermission}
              onDeletePermission={handleDeletePermission}
              onResetPermissions={handleResetPermissions}
            />
          )}

          {activeNav === 'settings' && (
            <SettingsView
              sipAccounts={sipAccounts}
              users={users}
              firebaseSync={firebaseSync}
              onConnectFirebase={handleConnectFirebase}
              onSyncFirebaseNow={handleSyncFirebaseNow}
              onDisconnectFirebase={handleDisconnectFirebase}
              onAddUser={handleAddUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              onDownloadBackup={handleDownloadBackup}
              onRestoreBackup={handleRestoreBackup}
            />
          )}
        </main>
      </div>
    </div>
  );
}
