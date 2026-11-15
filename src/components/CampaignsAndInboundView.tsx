import React, { useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Plus,
  Trash2,
  PhoneIncoming,
  PhoneCall,
  PhoneOff,
  Volume2,
  Disc,
  ShieldCheck,
} from 'lucide-react';
import { formatDurationClock } from '../utils/sipEngine';
import type {
  Campaign,
  SipAccount,
  VoiceRecording,
  Contact,
  IncomingCallConfig,
  LiveCallSession,
} from '../types/sip';

interface CampaignsViewProps {
  campaigns: Campaign[];
  sipAccounts: SipAccount[];
  recordings: VoiceRecording[];
  contacts: Contact[];
  liveCalls: LiveCallSession[];
  onCreateCampaign: (
    payload: Partial<Campaign> & {
      customPhoneNumbers?: string;
      startImmediately?: boolean;
    }
  ) => Promise<void>;
  onUpdateCampaign: (
    id: string,
    payload: Partial<Campaign> & { customPhoneNumbers?: string }
  ) => Promise<void>;
  onControlCampaign: (
    id: string,
    action: 'start' | 'pause' | 'resume' | 'stop'
  ) => Promise<void>;
  onDeleteCampaign: (id: string) => Promise<void>;
  onCallAction: (
    callId: string,
    action: string,
    extra?: { recordingId?: string; digit?: string }
  ) => Promise<void>;
}

export const CampaignsView: React.FC<CampaignsViewProps> = ({
  campaigns,
  sipAccounts,
  recordings,
  contacts,
  liveCalls,
  onCreateCampaign,
  onUpdateCampaign,
  onControlCampaign,
  onDeleteCampaign,
  onCallAction,
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [contactList, setContactList] = useState('All Contacts');
  const [customPhoneNumbers, setCustomPhoneNumbers] = useState('');
  const [sipAccountId, setSipAccountId] = useState(sipAccounts[0]?.id || '');
  const [recordingId, setRecordingId] = useState(recordings[0]?.id || '');
  const [maxConcurrentCalls, setMaxConcurrentCalls] = useState(3);
  const [callIntervalSeconds, setCallIntervalSeconds] = useState(2);
  const [retryAttempts, setRetryAttempts] = useState(2);
  const [retryIntervalSeconds, setRetryIntervalSeconds] = useState(30);
  const [workingHoursStart, setWorkingHoursStart] = useState('08:00');
  const [workingHoursEnd, setWorkingHoursEnd] = useState('21:00');
  const [autoDisconnect, setAutoDisconnect] = useState(true);
  const [quickNumbersByCamp, setQuickNumbersByCamp] = useState<Record<string, string>>({});
  const [busyCampId, setBusyCampId] = useState<string | null>(null);

  React.useEffect(() => {
    if (sipAccounts.length > 0 && !sipAccounts.some((a) => a.id === sipAccountId)) {
      setSipAccountId(sipAccounts[0].id);
    }
  }, [sipAccounts, sipAccountId]);

  React.useEffect(() => {
    if (recordings.length > 0 && !recordings.some((r) => r.id === recordingId)) {
      setRecordingId(recordings[0].id);
    }
  }, [recordings, recordingId]);

  const uniqueLists = [
    'All Contacts',
    ...Array.from(new Set(contacts.map((c) => c.listName).filter(Boolean))),
  ];

  const submitCampaign = async (startImmediately: boolean) => {
    if (!name.trim()) return;
    await onCreateCampaign({
      name: name.trim(),
      contactList,
      customPhoneNumbers: customPhoneNumbers.trim(),
      sipAccountId: sipAccountId || sipAccounts[0]?.id || '',
      recordingId: recordingId || recordings[0]?.id || '',
      maxConcurrentCalls,
      callIntervalSeconds,
      retryAttempts,
      retryIntervalSeconds,
      workingHoursStart,
      workingHoursEnd,
      autoDisconnectAfterPlayback: autoDisconnect,
      startImmediately,
    });
    setName('');
    setCustomPhoneNumbers('');
    setShowCreate(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCampaign(false);
  };

  const handleQuickAddAndStart = async (camp: Campaign) => {
    const raw = (quickNumbersByCamp[camp.id] || '').trim();
    setBusyCampId(camp.id);
    try {
      if (raw) {
        await onUpdateCampaign(camp.id, { customPhoneNumbers: raw });
        setQuickNumbersByCamp((prev) => ({ ...prev, [camp.id]: '' }));
      }
      await onControlCampaign(
        camp.id,
        camp.status === 'Paused' ? 'resume' : 'start'
      );
    } finally {
      setBusyCampId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Automated Outgoing Voice Campaigns
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real PJSIP outbound dialing · Automatic 8kHz G.711 u-law voice playback on 200 OK · Concurrency & retry engine
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Create Voice Campaign</span>
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Configure Outbound Voice Broadcast Campaign
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="camp-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Campaign Name
              </label>
              <input
                id="camp-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Q4 Patient Appointment Reminders"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="camp-list"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Authorized Contact List
              </label>
              <select
                id="camp-list"
                value={contactList}
                onChange={(e) => setContactList(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              >
                {uniqueLists.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="camp-sip"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                SIP Trunk Account
              </label>
              <select
                id="camp-sip"
                value={sipAccountId}
                onChange={(e) => setSipAccountId(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              >
                {sipAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.callerId} · {a.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="camp-rec"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Voice Recording to Play on Answer
              </label>
              <select
                id="camp-rec"
                value={recordingId}
                onChange={(e) => setRecordingId(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              >
                {recordings.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.durationSeconds}s)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="camp-conc"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Max Concurrent Calls
              </label>
              <input
                id="camp-conc"
                type="number"
                min={1}
                max={50}
                value={maxConcurrentCalls}
                onChange={(e) => setMaxConcurrentCalls(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="camp-int"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Calling Interval (Seconds)
              </label>
              <input
                id="camp-int"
                type="number"
                min={1}
                max={300}
                value={callIntervalSeconds}
                onChange={(e) => setCallIntervalSeconds(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="camp-retry"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Retry Attempts on Busy / No Answer
              </label>
              <input
                id="camp-retry"
                type="number"
                min={0}
                max={5}
                value={retryAttempts}
                onChange={(e) => setRetryAttempts(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="camp-retry-int"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Retry Interval (Seconds)
              </label>
              <input
                id="camp-retry-int"
                type="number"
                min={5}
                max={3600}
                value={retryIntervalSeconds}
                onChange={(e) => setRetryIntervalSeconds(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="camp-start-hr"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Window Start
                </label>
                <input
                  id="camp-start-hr"
                  type="time"
                  value={workingHoursStart}
                  onChange={(e) => setWorkingHoursStart(e.target.value)}
                  className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="camp-end-hr"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Window End
                </label>
                <input
                  id="camp-end-hr"
                  type="time"
                  value={workingHoursEnd}
                  onChange={(e) => setWorkingHoursEnd(e.target.value)}
                  className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="camp-custom-numbers"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Direct Phone Numbers to Dial (Optional — comma or newline separated)
            </label>
            <textarea
              id="camp-custom-numbers"
              rows={2}
              value={customPhoneNumbers}
              onChange={(e) => setCustomPhoneNumbers(e.target.value)}
              placeholder="e.g., 01712345678, +8801812345678, +14158902110"
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoDisconnect}
                onChange={(e) => setAutoDisconnect(e.target.checked)}
                className="rounded border-slate-300 text-sky-600"
              />
              <span>Automatically disconnect SIP call after voice message finishes playing</span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
              >
                Save Campaign
              </button>
              <button
                type="button"
                onClick={() => submitCampaign(true)}
                className="flex items-center gap-1.5 py-2 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Save & Start Now</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Campaigns List */}
      <div className="space-y-4">
        {campaigns.map((camp) => {
          const pct =
            camp.totalContacts > 0
              ? Math.min(100, Math.round((camp.dialedCount / camp.totalContacts) * 100))
              : 0;
          const campLiveCalls = liveCalls.filter((c) => c.campaignId === camp.id);
          const isBusy = busyCampId === camp.id;

          return (
            <div
              key={camp.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-sky-600 dark:text-sky-400">
                      {camp.status}
                    </span>
                    <span>·</span>
                    <span>List: {camp.contactList}</span>
                    <span>·</span>
                    <span>
                      Window: {camp.workingHoursStart}–{camp.workingHoursEnd}
                    </span>
                    <span>·</span>
                    <span>Max Concurrent: {camp.maxConcurrentCalls}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">
                    {camp.name}
                  </h3>
                </div>

                {/* Campaign Controls */}
                <div className="flex items-center gap-2">
                  {camp.status !== 'Running' && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleQuickAddAndStart(camp)}
                      className="flex items-center gap-1.5 py-2 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>
                        {camp.status === 'Paused' ? 'Resume Campaign' : 'Start Campaign'}
                      </span>
                    </button>
                  )}

                  {camp.status === 'Running' && (
                    <button
                      type="button"
                      onClick={() => onControlCampaign(camp.id, 'pause')}
                      className="flex items-center gap-1.5 py-2 px-3.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </button>
                  )}

                  {(camp.status === 'Running' || camp.status === 'Paused') && (
                    <button
                      type="button"
                      onClick={() => onControlCampaign(camp.id, 'stop')}
                      className="flex items-center gap-1.5 py-2 px-3.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Square className="w-3.5 h-3.5" />
                      <span>Stop</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onDeleteCampaign(camp.id)}
                    aria-label={`Delete campaign ${camp.name}`}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Inline SIP Account, Recording, Contact List & Quick Number Entry */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Outbound SIP Trunk Account
                  </label>
                  <select
                    aria-label={`SIP Account for ${camp.name}`}
                    value={camp.sipAccountId}
                    onChange={(e) =>
                      onUpdateCampaign(camp.id, { sipAccountId: e.target.value })
                    }
                    className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {sipAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.callerId} · {a.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Voice Recording Played on 200 OK
                  </label>
                  <select
                    aria-label={`Voice Recording for ${camp.name}`}
                    value={camp.recordingId}
                    onChange={(e) =>
                      onUpdateCampaign(camp.id, { recordingId: e.target.value })
                    }
                    className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {recordings.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.durationSeconds}s)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Target Contact List
                  </label>
                  <select
                    aria-label={`Contact List for ${camp.name}`}
                    value={camp.contactList}
                    onChange={(e) =>
                      onUpdateCampaign(camp.id, { contactList: e.target.value })
                    }
                    className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {uniqueLists.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                    Add Numbers Directly to Dial
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={quickNumbersByCamp[camp.id] || ''}
                      onChange={(e) =>
                        setQuickNumbersByCamp((prev) => ({
                          ...prev,
                          [camp.id]: e.target.value,
                        }))
                      }
                      placeholder="017XXXXXXXX, +1415..."
                      className="flex-1 min-w-0 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100"
                    />
                    {(quickNumbersByCamp[camp.id] || '').trim() && (
                      <button
                        type="button"
                        onClick={async () => {
                          const raw = (quickNumbersByCamp[camp.id] || '').trim();
                          if (!raw) return;
                          await onUpdateCampaign(camp.id, { customPhoneNumbers: raw });
                          setQuickNumbersByCamp((prev) => ({ ...prev, [camp.id]: '' }));
                        }}
                        className="py-1.5 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer shrink-0"
                      >
                        Add
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Live Active Campaign Calls Monitor */}
              {campLiveCalls.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="text-xs font-medium text-sky-400">
                    Active PJSIP Campaign Calls ({campLiveCalls.length} Concurrent)
                  </div>
                  <div className="space-y-2">
                    {campLiveCalls.map((lc) => (
                      <div
                        key={lc.callId}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                      >
                        <div className="flex items-center gap-2 text-slate-200">
                          <span className="font-semibold text-emerald-400">
                            {lc.status}
                          </span>
                          <span>·</span>
                          <span className="font-medium">{lc.contactName}</span>
                          <span className="font-mono text-sky-300">
                            ({lc.phoneNumber})
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono tabular-nums text-slate-300">
                            {formatDurationClock(lc.durationSeconds)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onCallAction(lc.callId, 'hangup')}
                            className="py-1 px-2.5 rounded bg-red-600 hover:bg-red-500 text-white text-[11px] cursor-pointer"
                          >
                            Hang Up
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Campaign Progress Bar & Telemetry */}
              <div className="space-y-2 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                  <span className="text-slate-600 dark:text-slate-300">
                    Progress: {camp.dialedCount} / {camp.totalContacts} Authorized Contacts Dialed ({pct}%)
                  </span>
                  <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Answered: {camp.answeredCount}
                    </span>
                    <span>·</span>
                    <span>Failed/No Answer: {camp.failedCount}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-sky-500" />
                      <span>DNC Opt-Outs Skipped: {camp.skippedDncCount || 0}</span>
                    </span>
                  </div>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- INCOMING CALL AUTOMATION MODULE ---

interface IncomingCallsViewProps {
  incomingConfig: IncomingCallConfig;
  sipAccounts: SipAccount[];
  recordings: VoiceRecording[];
  liveCalls: LiveCallSession[];
  onUpdateConfig: (cfg: Partial<IncomingCallConfig>) => Promise<void>;
  onSimulateIncomingCall: (payload: {
    callerNumber: string;
    callerName: string;
    sipAccountId: string;
    callerMessageText: string;
  }) => Promise<void>;
  onCallAction: (callId: string, action: string, extra?: { recordingId?: string }) => Promise<void>;
}

export const IncomingCallsView: React.FC<IncomingCallsViewProps> = ({
  incomingConfig,
  sipAccounts,
  recordings,
  liveCalls,
  onUpdateConfig,
  onSimulateIncomingCall,
  onCallAction,
}) => {
  const [callerNumber, setCallerNumber] = useState('+14158909920');
  const [callerName, setCallerName] = useState('Bay Area Clinic Dispatch');
  const [callerMessageText, setCallerMessageText] = useState(
    'Hello, please confirm tomorrow morning specialist availability and return our call at extension 204.'
  );

  const inboundCalls = liveCalls.filter((c) => c.direction === 'Inbound');

  const handleTestInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSimulateIncomingCall({
      callerNumber,
      callerName,
      sipAccountId: incomingConfig.activeSipAccountId || sipAccounts[0]?.id || '',
      callerMessageText,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Auto-Attendant & Voicemail Configuration */}
      <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Incoming SIP Call Automation & Auto-Attendant
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Asterisk ARI inbound Stasis workflow · Welcome greeting playback · Voicemail recorder
          </p>
        </div>

        <div className="space-y-4">
          <label className="flex items-center justify-between p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Auto-Answer Incoming SIP Calls (200 OK)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                When enabled, incoming INVITEs are answered automatically after the ring delay
              </div>
            </div>
            <input
              type="checkbox"
              checked={incomingConfig.autoAnswerEnabled}
              onChange={(e) => onUpdateConfig({ autoAnswerEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-sky-600"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="in-delay" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Auto-Answer Ring Delay (Seconds)
              </label>
              <input
                id="in-delay"
                type="number"
                min={1}
                max={30}
                value={incomingConfig.autoAnswerDelaySeconds}
                onChange={(e) =>
                  onUpdateConfig({ autoAnswerDelaySeconds: Number(e.target.value) })
                }
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="in-max-vm" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Max Voicemail Duration (Seconds)
              </label>
              <input
                id="in-max-vm"
                type="number"
                min={10}
                max={300}
                value={incomingConfig.maxVoicemailDurationSeconds}
                onChange={(e) =>
                  onUpdateConfig({ maxVoicemailDurationSeconds: Number(e.target.value) })
                }
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="in-welcome-rec" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Welcome Voice Message Played on Answer
            </label>
            <select
              id="in-welcome-rec"
              value={incomingConfig.welcomeRecordingId}
              onChange={(e) => onUpdateConfig({ welcomeRecordingId: e.target.value })}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.durationSeconds}s · {r.language})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="in-trunk" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Primary Inbound DID / SIP Trunk
            </label>
            <select
              id="in-trunk"
              value={incomingConfig.activeSipAccountId}
              onChange={(e) => onUpdateConfig({ activeSipAccountId: e.target.value })}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              {sipAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} (DID: {a.callerId})
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={incomingConfig.recordVoicemailEnabled}
              onChange={(e) => onUpdateConfig({ recordVoicemailEnabled: e.target.checked })}
              className="rounded border-slate-300 text-sky-600"
            />
            <span>Play 1000Hz beep after welcome message and record caller voice message to WAV</span>
          </label>
        </div>
      </div>

      {/* Right: Live Inbound Call Console & Incoming SIP INVITE Trigger */}
      <div className="lg:col-span-6 space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Live Incoming Call Queue & Manual Operator Override
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              Ringing / Active: {inboundCalls.length}
            </span>
          </div>

          {inboundCalls.length > 0 ? (
            inboundCalls.map((call) => (
              <div
                key={call.callId}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-sky-600 dark:text-sky-400 font-semibold">
                      Inbound SIP {call.status}
                    </div>
                    <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {call.contactName}
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500">
                      Caller ID: {call.phoneNumber} · Trunk: {call.sipAccountName}
                    </div>
                  </div>
                  <div className="text-xl font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatDurationClock(call.durationSeconds)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {call.status === 'Ringing' && (
                    <button
                      type="button"
                      onClick={() => onCallAction(call.callId, 'answer_inbound')}
                      className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>Answer Manually</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      onCallAction(call.callId, 'play_recording', {
                        recordingId: incomingConfig.welcomeRecordingId,
                      })
                    }
                    className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Play Welcome Message</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onCallAction(call.callId, 'record_voicemail')}
                    className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <Disc className="w-3.5 h-3.5 text-red-500" />
                    <span>Record Voicemail</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onCallAction(call.callId, 'hangup')}
                    className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium cursor-pointer ml-auto"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>{call.status === 'Ringing' ? 'Reject (486)' : 'End Call'}</span>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 px-4 text-center rounded-lg bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-800 text-xs text-slate-500">
              Listening on PJSIP UDP/5060, TLS/5061 & WSS/8089 for incoming SIP INVITE requests.
            </div>
          )}
        </div>

        {/* Test Incoming SIP Call Generator */}
        <form
          onSubmit={handleTestInbound}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <PhoneIncoming className="w-4 h-4 text-sky-500" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Trigger Test Incoming SIP INVITE
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Injects an inbound SIP INVITE into the handler to verify auto-answer, welcome audio playback, and caller voicemail recording.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sim-caller-num" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Caller Number
              </label>
              <input
                id="sim-caller-num"
                type="text"
                value={callerNumber}
                onChange={(e) => setCallerNumber(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="sim-caller-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Caller ID Name
              </label>
              <input
                id="sim-caller-name"
                type="text"
                value={callerName}
                onChange={(e) => setCallerName(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="sim-vm-text" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Caller Spoken Voicemail Payload
            </label>
            <input
              id="sim-vm-text"
              type="text"
              value={callerMessageText}
              onChange={(e) => setCallerMessageText(e.target.value)}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
          >
            <PhoneIncoming className="w-4 h-4" />
            <span>Dispatch Incoming SIP INVITE</span>
          </button>
        </form>
      </div>
    </div>
  );
};
