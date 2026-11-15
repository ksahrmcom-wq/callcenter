import React, { useState } from 'react';
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  Trash2,
  CheckCircle2,
  UserPlus,
  Upload,
  FileCode,
  Shield,
  Database,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import {
  formatDurationClock,
  generatePjsipConf,
  generateExtensionsConf,
  generateDockerComposeConfig,
  generatePassengerConfig,
} from '../utils/sipEngine';
import type {
  CallLog,
  SipAccount,
  VoicemailMessage,
  RolePermissionUser,
  FirebaseSyncStatus,
  UserRole,
} from '../types/sip';

interface CallHistoryViewProps {
  callLogs: CallLog[];
  sipAccounts: SipAccount[];
}

export const CallHistoryView: React.FC<CallHistoryViewProps> = ({
  callLogs,
  sipAccounts,
}) => {
  const [search, setSearch] = useState('');
  const [directionFilter, setDirectionFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [accountFilter, setAccountFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('2026-11-01');
  const [dateTo, setDateTo] = useState('2026-12-31');
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const filtered = callLogs.filter((log) => {
    const matchesSearch =
      !search.trim() ||
      log.phoneNumber.includes(search.trim()) ||
      log.contactName.toLowerCase().includes(search.toLowerCase()) ||
      log.campaignName.toLowerCase().includes(search.toLowerCase());
    const matchesDir = directionFilter === 'All' || log.direction === directionFilter;
    const matchesStatus = statusFilter === 'All' || log.status === statusFilter;
    const matchesAccount = accountFilter === 'All' || log.sipAccountId === accountFilter;
    const logDate = (log.startTime || '').slice(0, 10);
    const matchesDate =
      (!dateFrom || logDate >= dateFrom) && (!dateTo || logDate <= dateTo);
    return matchesSearch && matchesDir && matchesStatus && matchesAccount && matchesDate;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const exportCdrCsv = () => {
    const header =
      'Call ID,Phone Number,Contact,Direction,SIP Account,Status,Start Time,End Time,Duration (s),Campaign\n';
    const rows = filtered
      .map(
        (c) =>
          `"${c.id}","${c.phoneNumber}","${c.contactName}","${c.direction}","${c.sipAccountName}","${c.status}","${c.startTime}","${c.endTime}",${c.durationSeconds},"${c.campaignName}"`
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voxpulse-cdr-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Call History & Detail Records (CDR)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Complete audit trail of outbound & inbound SIP sessions · Recording playback · Date-range filtering
          </p>
        </div>

        <button
          type="button"
          onClick={exportCdrCsv}
          className="flex items-center gap-2 py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4" />
          <span>Export CDR CSV</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="md:col-span-2 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search call history"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search number, contact, campaign..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div>
          <select
            aria-label="Filter by call direction"
            value={directionFilter}
            onChange={(e) => {
              setDirectionFilter(e.target.value);
              setPage(1);
            }}
            className="w-full py-2 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="All">All Directions</option>
            <option value="Outbound">Outbound</option>
            <option value="Inbound">Inbound</option>
          </select>
        </div>

        <div>
          <select
            aria-label="Filter by call status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="w-full py-2 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="All">All Statuses</option>
            <option value="Answered">Answered</option>
            <option value="Voicemail">Voicemail</option>
            <option value="No Answer">No Answer</option>
            <option value="Busy">Busy</option>
            <option value="Rejected">Rejected</option>
            <option value="Failed">Failed</option>
          </select>
        </div>

        <div>
          <select
            aria-label="Filter by SIP Account"
            value={accountFilter}
            onChange={(e) => {
              setAccountFilter(e.target.value);
              setPage(1);
            }}
            className="w-full py-2 px-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value="All">All SIP Trunks</option>
            {sipAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="date"
            aria-label="Start date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full py-1.5 px-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-[11px] font-mono text-slate-900 dark:text-slate-100"
          />
          <input
            type="date"
            aria-label="End date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full py-1.5 px-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-[11px] font-mono text-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* CDR Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/60">
                <th className="py-3 px-4">Phone Number & Contact</th>
                <th className="py-3 px-4">Direction & Trunk</th>
                <th className="py-3 px-4">Call Status</th>
                <th className="py-3 px-4">Start & End (UTC)</th>
                <th className="py-3 px-4 text-right">Duration</th>
                <th className="py-3 px-4">Campaign</th>
                <th className="py-3 px-4">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {paginated.map((cdr) => (
                <tr
                  key={cdr.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {cdr.phoneNumber}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {cdr.contactName}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-slate-900 dark:text-slate-200 font-medium">
                      {cdr.direction}
                    </div>
                    <div className="text-slate-500 truncate max-w-[180px]">
                      {cdr.sipAccountName}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`font-medium ${
                        cdr.status === 'Answered' || cdr.status === 'Voicemail'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : cdr.status === 'Failed'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {cdr.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    <div>{cdr.startTime.replace('T', ' ').slice(0, 19)}</div>
                    <div className="text-[11px] text-slate-400">
                      to {cdr.endTime.slice(11, 19)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {formatDurationClock(cdr.durationSeconds)}
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                    {cdr.campaignName || 'Direct Call'}
                  </td>
                  <td className="py-3 px-4">
                    {cdr.recordingUrl ? (
                      <audio controls src={cdr.recordingUrl} className="h-8 w-44" />
                    ) : (
                      <span className="text-slate-400">No audio</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
          <span className="font-mono tabular-nums">
            Showing {paginated.length} of {filtered.length} Call Detail Records (Page {safePage} of {totalPages})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous CDR page"
              className="p-1.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next CDR page"
              className="p-1.5 rounded border border-slate-300 dark:border-slate-700 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- VOICE MESSAGES (INCOMING VOICEMAIL INBOX) ---

interface VoiceMessagesViewProps {
  voicemails: VoicemailMessage[];
  onMarkRead: (id: string) => Promise<void>;
  onDeleteVoicemail: (id: string) => Promise<void>;
}

export const VoiceMessagesView: React.FC<VoiceMessagesViewProps> = ({
  voicemails,
  onMarkRead,
  onDeleteVoicemail,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Saved Incoming Voice Messages
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Recorded caller messages from the automated incoming SIP handler · Play & download WAV
        </p>
      </div>

      <div className="space-y-4">
        {voicemails.map((vm) => (
          <div
            key={vm.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span
                  className={
                    vm.isRead
                      ? 'text-slate-500'
                      : 'font-semibold text-sky-600 dark:text-sky-400'
                  }
                >
                  {vm.isRead ? 'Reviewed' : 'Unread Voicemail'}
                </span>
                <span>·</span>
                <span>{vm.createdAt.replace('T', ' ').slice(0, 19)} UTC</span>
                <span>·</span>
                <span>Duration: {formatDurationClock(vm.durationSeconds)}</span>
                <span>·</span>
                <span>{vm.sipAccountName || vm.sipAccountId}</span>
              </div>

              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {vm.callerName}{' '}
                <span className="font-mono text-sm text-sky-600 dark:text-sky-400">
                  ({vm.callerNumber})
                </span>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 max-w-2xl">
                {vm.transcriptSummary}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <audio controls src={vm.audioUrl} className="h-9 w-56" />

              <a
                href={vm.audioUrl}
                download={`voicemail-${vm.callerNumber}-${vm.id}.wav`}
                className="flex items-center gap-1.5 py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download WAV</span>
              </a>

              {!vm.isRead && (
                <button
                  type="button"
                  onClick={() => onMarkRead(vm.id)}
                  className="flex items-center gap-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark Read</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onDeleteVoicemail(vm.id)}
                aria-label={`Delete voicemail from ${vm.callerNumber}`}
                className="p-2 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- SETTINGS, FIREBASE CLOUD SYNC, ARCHITECTURE, DOCKER & RBAC VIEW ---

interface SettingsViewProps {
  sipAccounts: SipAccount[];
  users: RolePermissionUser[];
  firebaseSync: FirebaseSyncStatus;
  onConnectFirebase: () => Promise<void>;
  onSyncFirebaseNow: () => Promise<void>;
  onDisconnectFirebase: () => Promise<void>;
  onAddUser: (payload: { name: string; email: string; role: UserRole }) => Promise<void>;
  onUpdateUser?: (userId: string, payload: { role?: UserRole; status?: 'Active' | 'Invited' | 'Suspended' }) => Promise<void>;
  onDeleteUser: (userId: string) => Promise<void>;
  onDownloadBackup: () => Promise<void>;
  onRestoreBackup: (jsonText: string) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  sipAccounts,
  users,
  firebaseSync,
  onConnectFirebase,
  onSyncFirebaseNow,
  onDisconnectFirebase,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  onDownloadBackup,
  onRestoreBackup,
}) => {
  const [activeDocTab, setActiveDocTab] = useState<'passenger' | 'pjsip' | 'dialplan' | 'docker'>(
    'passenger'
  );
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('operator');
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [isConnectingFirebase, setIsConnectingFirebase] = useState(false);

  const handleConnectClick = async () => {
    setIsConnectingFirebase(true);
    try {
      await onConnectFirebase();
    } finally {
      setIsConnectingFirebase(false);
    }
  };

  const handleSyncClick = async () => {
    setIsConnectingFirebase(true);
    try {
      await onSyncFirebaseNow();
    } finally {
      setIsConnectingFirebase(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;
    await onAddUser({
      name: newUserName.trim(),
      email: newUserEmail.trim(),
      role: newUserRole,
    });
    setNewUserName('');
    setNewUserEmail('');
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        await onRestoreBackup(reader.result);
        setRestoreStatus('System snapshot restored successfully.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Settings, Firebase Cloud Storage & System Architecture
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Real-time Firebase Firestore & Storage persistence · Asterisk 20 PJSIP + ARI · Role-Based Access Control
        </p>
      </div>

      {/* Firebase Cloud Storage & Automatic Real-Time Synchronization */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-sky-500 shrink-0" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Connect with Firebase — Automatic Cloud Storage & Real-Time Sync
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              When connected, all voice files, user accounts, SIP accounts, contacts, campaigns, callbacks, and call records are stored in Firebase automatically. Any item added is saved automatically, and any item deleted from the app is immediately deleted from Firebase.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {!firebaseSync.connected ? (
              <button
                type="button"
                onClick={handleConnectClick}
                disabled={isConnectingFirebase}
                className="flex items-center gap-2 py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                <Database className="w-4 h-4" />
                <span>
                  {isConnectingFirebase ? 'Connecting to Firebase...' : 'Connect with Firebase'}
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSyncClick}
                  disabled={isConnectingFirebase}
                  className="flex items-center gap-1.5 py-2 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Connected to Firebase (Auto-Save Active)</span>
                </button>
                <button
                  type="button"
                  onClick={handleSyncClick}
                  disabled={isConnectingFirebase}
                  className="flex items-center gap-1.5 py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Sync Now</span>
                </button>
                <button
                  type="button"
                  onClick={onDisconnectFirebase}
                  className="flex items-center gap-1.5 py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-500 hover:text-red-600 dark:hover:text-red-400 cursor-pointer whitespace-nowrap"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Connection Metadata Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Connection Status</div>
            <div
              className={`font-semibold mt-0.5 ${
                firebaseSync.connected
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {firebaseSync.connected
                ? 'Connected · Real-Time Auto-Save & Auto-Delete'
                : 'Standby · Click "Connect with Firebase"'}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Firebase Project ID</div>
            <div className="font-mono text-slate-900 dark:text-slate-100 font-medium mt-0.5 truncate">
              {firebaseSync.projectId}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Firestore Database & Bucket</div>
            <div className="font-mono text-slate-900 dark:text-slate-100 font-medium mt-0.5 truncate">
              {firebaseSync.storageBucket}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Last Automatic Cloud Sync</div>
            <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100 font-medium mt-0.5">
              {firebaseSync.lastSyncedAt
                ? `${firebaseSync.lastSyncedAt.replace('T', ' ').slice(0, 19)} UTC`
                : 'Not yet synced'}
            </div>
          </div>
        </div>

        {/* Per-Collection Stored Counts */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2.5 text-xs">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Audio Files</div>
            <div className="text-lg font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-0.5">
              {firebaseSync.counts.totalFiles}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">User Accounts</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {firebaseSync.counts.users}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">RBAC Rules</div>
            <div className="text-lg font-bold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-0.5">
              {firebaseSync.counts.rbacMatrix ?? 13}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">SIP Accounts</div>
            <div className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
              {firebaseSync.counts.sipAccounts}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Contacts</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {firebaseSync.counts.contacts}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Recordings</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {firebaseSync.counts.recordings}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Campaigns</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {firebaseSync.counts.campaigns}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Callbacks</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {firebaseSync.counts.callbacks}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Call Logs</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
              {firebaseSync.counts.callLogs}
            </div>
          </div>
        </div>

        {/* Live Firebase Sync Event Log */}
        {firebaseSync.recentEvents.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Real-Time Firebase Persistence Audit Log (Auto-Save & Auto-Delete)
              </span>
              <span className="font-mono tabular-nums text-slate-500">
                Total Stored Records: {firebaseSync.counts.totalDocuments}
              </span>
            </div>
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-3.5 max-h-44 overflow-y-auto space-y-1.5 font-mono text-[11px]">
              {firebaseSync.recentEvents.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 text-slate-300">
                  <span className="text-slate-500 shrink-0">
                    {ev.timestamp.slice(11, 19)}
                  </span>
                  <span
                    className={`font-semibold shrink-0 ${
                      ev.operation === 'AUTO_DELETE'
                        ? 'text-red-400'
                        : ev.operation === 'CONNECT' || ev.operation === 'FULL_SYNC'
                        ? 'text-emerald-400'
                        : 'text-sky-400'
                    }`}
                  >
                    [{ev.operation}]
                  </span>
                  <span className="text-slate-200">{ev.summary}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Architecture & Call Flow Overview */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          End-to-End SIP Signaling & RTP Media Call Flow
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              01. SIP Trunk & WebRTC Registration
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Credentials are encrypted with AES-256-GCM in the server vault. Browser WSS accounts
              bind via SIP.js UserAgent while UDP/TCP/TLS trunks register through Asterisk 20 PJSIP
              endpoints with 30s OPTIONS qualify checks.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              02. Consent Gate & Outbound Broadcast
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Every outbound call passes through the DNC & Consent Verification Engine. Upon SIP 200
              OK, Asterisk ARI streams the FFmpeg-converted 8000Hz 16-bit mono PCM recording into
              the RTP channel and hangs up on completion.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              03. Inbound Auto-Attendant & Voicemail
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Incoming SIP INVITEs enter the Asterisk Stasis application, auto-answer after the
              configured delay, play the welcome voice message, emit a 1000Hz beep, and record the
              caller&apos;s voicemail to WAV for dashboard playback.
            </p>
          </div>
        </div>
      </div>

      {/* Phusion Passenger, Asterisk PJSIP, Dialplan, and Docker Compose Config Generator */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-sky-500" />
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Phusion Passenger Hosting & Asterisk Configuration Files
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Ready for Phusion Passenger (`app.cjs` + `Passengerfile.json`) on cPanel, Nginx, or Apache with automatic Firebase persistence
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setActiveDocTab('passenger')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                activeDocTab === 'passenger'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500'
              }`}
            >
              Phusion Passenger (app.cjs)
            </button>
            <button
              type="button"
              onClick={() => setActiveDocTab('pjsip')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                activeDocTab === 'pjsip'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500'
              }`}
            >
              /etc/asterisk/pjsip.conf
            </button>
            <button
              type="button"
              onClick={() => setActiveDocTab('dialplan')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                activeDocTab === 'dialplan'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500'
              }`}
            >
              /etc/asterisk/extensions.conf
            </button>
            <button
              type="button"
              onClick={() => setActiveDocTab('docker')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                activeDocTab === 'docker'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                  : 'text-slate-500'
              }`}
            >
              docker-compose.yml
            </button>
          </div>
        </div>

        <pre className="p-4 rounded-xl bg-slate-950 text-slate-300 font-mono text-xs overflow-x-auto max-h-72">
          {activeDocTab === 'passenger'
            ? generatePassengerConfig()
            : activeDocTab === 'pjsip'
            ? generatePjsipConf(sipAccounts)
            : activeDocTab === 'dialplan'
            ? generateExtensionsConf()
            : generateDockerComposeConfig()}
        </pre>
      </div>

      {/* Role-Based Access Control (RBAC) & Backup/Restore */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-sky-500" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Team Users & Role-Based Permissions (RBAC)
            </h3>
          </div>

          <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <input
              type="text"
              required
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Operator Name"
              className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <input
              type="email"
              required
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="operator@company.com"
              className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as UserRole)}
              className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            >
              <option value="admin">Admin (Full Trunk & Rules)</option>
              <option value="manager">Manager (Campaigns & IVR)</option>
              <option value="operator">Operator (Calls & Campaigns)</option>
              <option value="viewer">Viewer (Read-Only CDR)</option>
            </select>
            <button
              type="submit"
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add User</span>
            </button>
          </form>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {users.map((u) => (
              <div key={u.id} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{u.name}</span>
                  <span className="text-slate-500 ml-2 font-mono">{u.email}</span>
                </div>
                <div className="flex items-center gap-2.5 text-slate-500">
                  {onUpdateUser ? (
                    <select
                      aria-label={`Role for ${u.name}`}
                      value={u.role}
                      onChange={(e) =>
                        onUpdateUser(u.id, { role: e.target.value as UserRole })
                      }
                      className="rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2 py-1 text-xs font-semibold uppercase text-sky-600 dark:text-sky-400"
                    >
                      <option value="admin">ADMIN</option>
                      <option value="manager">MANAGER</option>
                      <option value="operator">OPERATOR</option>
                      <option value="viewer">VIEWER</option>
                    </select>
                  ) : (
                    <span className="font-medium text-sky-600 dark:text-sky-400 uppercase">
                      {u.role}
                    </span>
                  )}
                  <span>·</span>
                  <span>{u.lastActive}</span>
                  <button
                    type="button"
                    onClick={() => onDeleteUser(u.id)}
                    aria-label={`Delete user ${u.name}`}
                    className="p-1.5 rounded text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Platform Backup, Restore & API Webhook
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Export encrypted SIP trunk configurations, consent logs, campaigns, and CDRs as a
            portable JSON snapshot, or restore from an existing backup.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onDownloadBackup}
              className="flex items-center gap-2 py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Download System Backup (.JSON)</span>
            </button>

            <label className="flex items-center gap-2 py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0">
              <Upload className="w-4 h-4" />
              <span>Restore from Snapshot</span>
              <input
                type="file"
                accept=".json"
                onChange={handleRestoreFile}
                className="hidden"
              />
            </label>
          </div>

          {restoreStatus && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {restoreStatus}
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
            <div className="font-medium text-slate-800 dark:text-slate-200">
              REST & WebSocket Integration Endpoints
            </div>
            <div className="font-mono text-[11px] text-slate-500 space-y-1">
              <div>POST /api/calls/originate — Trigger outbound SIP call</div>
              <div>POST /api/incoming-calls/simulate — Inbound SIP INVITE webhook</div>
              <div>WS /ws/sip — Real-time bi-directional SIP state stream</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
