import React, { useState, useEffect } from 'react';
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Pause,
  Play,
  Volume2,
  Radio,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { playDtmfTone, playRingbackCadence } from '../lib/sipWebRtcClient';
import { formatDurationClock, formatSipUri } from '../utils/sipEngine';
import type {
  SipAccount,
  VoiceRecording,
  Contact,
  LiveCallSession,
  CallStatus,
} from '../types/sip';

interface DirectSoftphoneProps {
  sipAccounts: SipAccount[];
  recordings: VoiceRecording[];
  contacts: Contact[];
  liveCalls: LiveCallSession[];
  onOriginateCall: (payload: {
    phoneNumber: string;
    contactName?: string;
    sipAccountId: string;
    recordingId: string;
    autoPlayOnAnswer: boolean;
    autoDisconnectAfterPlayback: boolean;
    simulatedOutcome: CallStatus;
    forceLocalLoopback?: boolean;
  }) => Promise<void>;
  onCallAction: (
    callId: string,
    action: string,
    extra?: { recordingId?: string; digit?: string }
  ) => Promise<void>;
  onSendMicPcm?: (callId: string, samples: number[]) => void;
}

const KEYPAD_KEYS = [
  { digit: '1', sub: 'OO' },
  { digit: '2', sub: 'ABC' },
  { digit: '3', sub: 'DEF' },
  { digit: '4', sub: 'GHI' },
  { digit: '5', sub: 'JKL' },
  { digit: '6', sub: 'MNO' },
  { digit: '7', sub: 'PQRS' },
  { digit: '8', sub: 'TUV' },
  { digit: '9', sub: 'WXYZ' },
  { digit: '*', sub: 'TONE' },
  { digit: '0', sub: '+' },
  { digit: '#', sub: 'SEND' },
];

export const DirectSoftphonePanel: React.FC<DirectSoftphoneProps> = ({
  sipAccounts,
  recordings,
  contacts,
  liveCalls,
  onOriginateCall,
  onCallAction,
  onSendMicPcm,
}) => {
  const [phoneNumber, setPhoneNumber] = useState('+14158902110');
  const [selectedAccountId, setSelectedAccountId] = useState(
    sipAccounts[0]?.id || ''
  );
  const [selectedRecordingId, setSelectedRecordingId] = useState(
    recordings[0]?.id || ''
  );
  const [autoPlayOnAnswer, setAutoPlayOnAnswer] = useState(true);
  const [autoDisconnect, setAutoDisconnect] = useState(false);
  const [simulatedOutcome, setSimulatedOutcome] =
    useState<CallStatus>('Answered');
  const [forceLocalLoopback, setForceLocalLoopback] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync selectedAccountId when user adds a new SIP account (which is placed at sipAccounts[0])
  useEffect(() => {
    if (sipAccounts.length > 0 && !sipAccounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(sipAccounts[0].id);
    }
  }, [sipAccounts, selectedAccountId]);

  const activeAccount =
    sipAccounts.find((a) => a.id === selectedAccountId) || sipAccounts[0];
  const currentLiveCall = liveCalls[0] || null;

  // Play North American ringback tone while call is in Ringing state
  useEffect(() => {
    if (currentLiveCall?.status === 'Ringing') {
      const stopRingback = playRingbackCadence();
      return () => stopRingback();
    }
  }, [currentLiveCall?.callId, currentLiveCall?.status]);

  // Capture live browser microphone audio and stream 8kHz PCM to PJSIP RTP engine when call is Answered
  useEffect(() => {
    if (
      !currentLiveCall ||
      (currentLiveCall.status !== 'Answered' && currentLiveCall.status !== 'PlayingAudio') ||
      currentLiveCall.isMuted ||
      !onSendMicPcm ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return;
    }

    let cancelled = false;
    let mediaStream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStream = stream;
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtx = new Ctx({ sampleRate: 8000 });
        const source = audioCtx.createMediaStreamSource(stream);
        processor = audioCtx.createScriptProcessor(1024, 1, 1);
        processor.onaudioprocess = (ev) => {
          if (cancelled) return;
          const input = ev.inputBuffer.getChannelData(0);
          const pcm16: number[] = new Array(input.length);
          for (let i = 0; i < input.length; i++) {
            pcm16[i] = Math.max(-32768, Math.min(32767, Math.floor(input[i] * 32767)));
          }
          onSendMicPcm(currentLiveCall.callId, pcm16);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      })
      .catch(() => {
        // Microphone optional in headless or restricted environments
      });

    return () => {
      cancelled = true;
      try {
        if (processor) processor.disconnect();
      } catch {
        // ignore
      }
      try {
        if (audioCtx) audioCtx.close();
      } catch {
        // ignore
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [currentLiveCall?.callId, currentLiveCall?.status, currentLiveCall?.isMuted, onSendMicPcm]);

  const matchedContact = contacts.find((c) =>
    c.phoneNumber.replace(/[^\d+]/g, '').endsWith(phoneNumber.replace(/[^\d]/g, '').slice(-10))
  );

  const handleDigitPress = (digit: string) => {
    playDtmfTone(digit, 140);
    if (currentLiveCall) {
      onCallAction(currentLiveCall.callId, 'dtmf', { digit });
    } else {
      setPhoneNumber((prev) => `${prev}${digit}`);
    }
  };

  const handlePlaceCall = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!phoneNumber.trim()) {
      setErrorMsg('Enter a valid destination phone number or SIP URI.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onOriginateCall({
        phoneNumber: phoneNumber.trim(),
        contactName: matchedContact?.name,
        sipAccountId: activeAccount?.id || '',
        recordingId: selectedRecordingId,
        autoPlayOnAnswer,
        autoDisconnectAfterPlayback: autoDisconnect,
        simulatedOutcome,
        forceLocalLoopback,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to place SIP call');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Direct SIP WebRTC / ARI Softphone Keypad */}
      <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Direct SIP Softphone & Bridge
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              SIP.js WebRTC WSS · Asterisk 20 PJSIP Origination · ITU-T Q.23 DTMF
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
            {activeAccount ? `${activeAccount.transport}:${activeAccount.port}` : 'No Trunk'}
          </span>
        </div>

        <form onSubmit={handlePlaceCall} className="space-y-4">
          <div>
            <label
              htmlFor="direct-sip-account"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
            >
              Outbound SIP Trunk / Account
            </label>
            <select
              id="direct-sip-account"
              value={activeAccount?.id || ''}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {sipAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.callerId} · {acc.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="direct-dial-input"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Destination Number or SIP Extension
              </label>
              <select
                aria-label="Quick fill from authorized contacts"
                onChange={(e) => {
                  if (e.target.value) setPhoneNumber(e.target.value);
                }}
                value=""
                className="text-xs bg-transparent text-sky-600 dark:text-sky-400 focus:outline-none cursor-pointer"
              >
                <option value="">Quick-fill consented contact...</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.phoneNumber}>
                    {c.name} ({c.phoneNumber}) {c.dncOptOut ? '[DNC]' : ''}
                  </option>
                ))}
              </select>
            </div>
            <input
              id="direct-dial-input"
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1 (415) 890-2110"
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3.5 py-2.5 text-lg font-mono tabular-nums tracking-wide text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            {activeAccount && (
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                URI: {formatSipUri(phoneNumber || '100', activeAccount.domain, activeAccount.port, activeAccount.transport)}
              </p>
            )}
            {matchedContact && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>
                  {matchedContact.name} · Consent: {matchedContact.consentStatus} ·{' '}
                  {matchedContact.dncOptOut ? 'DNC Opt-Out Active' : 'Authorized'}
                </span>
              </p>
            )}
          </div>

          {/* 12-Button ITU-T DTMF Keypad */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {KEYPAD_KEYS.map((k) => (
              <button
                key={k.digit}
                type="button"
                onClick={() => handleDigitPress(k.digit)}
                aria-label={`Dialpad key ${k.digit}`}
                className="flex flex-col items-center justify-center py-2.5 px-3 rounded-lg bg-slate-100 dark:bg-slate-950 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer"
              >
                <span className="text-base font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {k.digit}
                </span>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                  {k.sub}
                </span>
              </button>
            ))}
          </div>

          {/* Pre-Recorded Voice Injection Settings */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div>
              <label
                htmlFor="direct-voice-recording"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Automated Voice Message on Answer
              </label>
              <select
                id="direct-voice-recording"
                value={selectedRecordingId}
                onChange={(e) => setSelectedRecordingId(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">None (Live Two-Way Voice Only)</option>
                {recordings.map((rec) => (
                  <option key={rec.id} value={rec.id}>
                    {rec.name} ({rec.durationSeconds}s · {rec.language})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPlayOnAnswer}
                  onChange={(e) => setAutoPlayOnAnswer(e.target.checked)}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>Play automatically on 200 OK</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDisconnect}
                  onChange={(e) => setAutoDisconnect(e.target.checked)}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>Auto-hangup after playback</span>
              </label>
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceLocalLoopback}
                  onChange={(e) => setForceLocalLoopback(e.target.checked)}
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>Route via Local PJSIP Loopback UAS (127.0.0.1:5090 Test Mode)</span>
              </label>

              <div>
                <label
                  htmlFor="sip-response-test-mode"
                  className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                >
                  Remote Endpoint Response Verification Mode (Loopback / Demo Trunks)
                </label>
                <select
                  id="sip-response-test-mode"
                  value={simulatedOutcome}
                  onChange={(e) => setSimulatedOutcome(e.target.value as CallStatus)}
                  className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300"
                >
                  <option value="Answered">200 OK — Recipient Answers Call</option>
                  <option value="Busy">486 Busy Here — Line Busy</option>
                  <option value="Rejected">603 Decline — Call Rejected</option>
                  <option value="No Answer">480 Temporarily Unavailable — No Answer</option>
                  <option value="Failed">503 Service Unavailable — Network / Trunk Failed</option>
                </select>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-300"
            >
              {errorMsg}
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Phone className="w-4 h-4" />
              <span>{isSubmitting ? 'Originating SIP INVITE...' : 'Place SIP Call'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Right Column: Live Call Control & Real-Time SIP Signaling Monitor */}
      <div className="lg:col-span-7 space-y-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Active SIP Channel & RTP Media Bridge
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Real-time PJSIP call control, G.711 u-law RTP audio stream, and RFC 3261 dialog state
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Active Channels: {liveCalls.length}
            </span>
          </div>

          {currentLiveCall ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{currentLiveCall.direction} SIP Call</span>
                    <span aria-hidden="true">·</span>
                    <span>{currentLiveCall.sipAccountName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-sky-600 dark:text-sky-400">
                      {currentLiveCall.status}
                    </span>
                  </div>
                  <div className="text-xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                    {currentLiveCall.contactName}
                  </div>
                  <div className="text-sm font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    {currentLiveCall.phoneNumber}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-2xl font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatDurationClock(currentLiveCall.durationSeconds)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {currentLiveCall.answeredAt
                      ? 'Connected · RTP G.711 u-law (8000 Hz)'
                      : 'Signaling · Timer starts on 200 OK'}
                  </div>
                </div>
              </div>

              {/* Live Call Controls */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onCallAction(currentLiveCall.callId, 'toggle_mute')}
                  className="flex items-center gap-2 py-2 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {currentLiveCall.isMuted ? (
                    <>
                      <MicOff className="w-4 h-4 text-amber-500" />
                      <span>Unmute Mic</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4" />
                      <span>Mute Mic</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onCallAction(currentLiveCall.callId, 'toggle_hold')}
                  className="flex items-center gap-2 py-2 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {currentLiveCall.isOnHold ? (
                    <>
                      <Play className="w-4 h-4 text-sky-500" />
                      <span>Resume Call</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-4 h-4" />
                      <span>Hold (re-INVITE)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onCallAction(currentLiveCall.callId, 'play_recording', {
                      recordingId: selectedRecordingId || recordings[0]?.id,
                    })
                  }
                  className="flex items-center gap-2 py-2 px-3.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Play Voice Message Now</span>
                </button>

                <button
                  type="button"
                  onClick={() => onCallAction(currentLiveCall.callId, 'hangup')}
                  className="flex items-center gap-2 py-2 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ml-auto"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>Hang Up (SIP BYE)</span>
                </button>
              </div>

              {/* Live SIP Signaling Dialog Trace */}
              <div className="rounded-lg bg-slate-950 border border-slate-800 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span className="flex items-center gap-1.5 font-medium text-slate-300">
                    <Terminal className="w-3.5 h-3.5 text-sky-400" />
                    <span>Live SIP Dialog & ARI Media Trace</span>
                  </span>
                  <span className="font-mono">{currentLiveCall.callId}</span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-xs text-slate-300">
                  {currentLiveCall.sipMethodLog.map((line, idx) => (
                    <div key={idx} className="py-1 border-b border-slate-900 last:border-0">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 px-6 text-center rounded-xl bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-800">
              <Radio className="w-8 h-8 text-slate-400 mx-auto mb-3" />
              <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                No Active SIP Call in Progress
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
                Enter any E.164 phone number or select a consented contact on the left and click
                &ldquo;Place SIP Call&rdquo; to initiate a live SIP session with automated voice
                playback.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
