import React, { useState, useEffect } from 'react';
import {
  PhoneForwarded,
  PhoneCall,
  PhoneOff,
  Volume2,
  Mic,
  MicOff,
  ArrowRightLeft,
  Users,
  Terminal,
  CheckCircle2,
  Clock,
  Radio,
  RotateCcw,
} from 'lucide-react';
import {
  DEFAULT_CALLBACK_WAIT_MESSAGE,
  formatDurationClock,
  generateCallbackWaitVoiceWavDataUri,
} from '../utils/sipEngine';
import type {
  SipAccount,
  Contact,
  CallbackSession,
  CallStatus,
} from '../types/sip';

interface CallbackViewProps {
  sipAccounts: SipAccount[];
  contacts: Contact[];
  callbacks: CallbackSession[];
  onOriginateCallback: (payload: {
    callFromNumber: string;
    callFromName?: string;
    callToNumber: string;
    callToName?: string;
    sipAccountId: string;
    waitVoiceText: string;
    simulatedLegBOutcome?: CallStatus;
    forceLocalLoopback?: boolean;
  }) => Promise<void>;
  onCallbackAction: (
    callbackId: string,
    action: 'hangup' | 'replay_wait_voice' | 'toggle_mute_from' | 'toggle_mute_to'
  ) => Promise<void>;
}

export function speakCallbackPromptInBrowser(text: string, fallbackWavUri?: string) {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.98;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  } catch {
    // ignore speechSynthesis restriction in headless browser
  }

  try {
    const uri = fallbackWavUri || generateCallbackWaitVoiceWavDataUri(4, 8000);
    const audio = new Audio(uri);
    audio.volume = 0.75;
    audio.play().catch(() => {});
  } catch {
    // ignore autoplay restriction
  }
}

export const CallbackView: React.FC<CallbackViewProps> = ({
  sipAccounts,
  contacts,
  callbacks,
  onOriginateCallback,
  onCallbackAction,
}) => {
  const [callFromNumber, setCallFromNumber] = useState('+14158902110');
  const [callToNumber, setCallToNumber] = useState('+14158903344');
  const [selectedAccountId, setSelectedAccountId] = useState(
    sipAccounts[0]?.id || ''
  );
  const [waitVoiceText, setWaitVoiceText] = useState(
    DEFAULT_CALLBACK_WAIT_MESSAGE
  );
  const [simulatedLegBOutcome, setSimulatedLegBOutcome] =
    useState<CallStatus>('Answered');
  const [forceLocalLoopback, setForceLocalLoopback] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (
      sipAccounts.length > 0 &&
      !sipAccounts.some((a) => a.id === selectedAccountId)
    ) {
      setSelectedAccountId(sipAccounts[0].id);
    }
  }, [sipAccounts, selectedAccountId]);

  const activeAccount =
    sipAccounts.find((a) => a.id === selectedAccountId) || sipAccounts[0];

  // Find active callback session (or most recent one)
  const activeCallback =
    callbacks.find(
      (cb) =>
        cb.status === 'CallingFrom' ||
        cb.status === 'PlayingWaitVoice' ||
        cb.status === 'CallingTo' ||
        cb.status === 'InConference'
    ) || callbacks[0] || null;

  const matchedFromContact = contacts.find((c) =>
    c.phoneNumber
      .replace(/[^\d+]/g, '')
      .endsWith(callFromNumber.replace(/[^\d]/g, '').slice(-10))
  );
  const matchedToContact = contacts.find((c) =>
    c.phoneNumber
      .replace(/[^\d+]/g, '')
      .endsWith(callToNumber.replace(/[^\d]/g, '').slice(-10))
  );

  const handleSwapNumbers = () => {
    const temp = callFromNumber;
    setCallFromNumber(callToNumber);
    setCallToNumber(temp);
  };

  const handleSubmitCallback = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!callFromNumber.trim()) {
      setErrorMsg('Please enter a valid "Call From" phone number.');
      return;
    }
    if (!callToNumber.trim()) {
      setErrorMsg('Please enter a valid "Call To" phone number.');
      return;
    }
    setIsSubmitting(true);
    try {
      await onOriginateCallback({
        callFromNumber: callFromNumber.trim(),
        callFromName: matchedFromContact?.name,
        callToNumber: callToNumber.trim(),
        callToName: matchedToContact?.name,
        sipAccountId: activeAccount?.id || '',
        waitVoiceText: waitVoiceText.trim() || DEFAULT_CALLBACK_WAIT_MESSAGE,
        simulatedLegBOutcome,
        forceLocalLoopback,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to initiate Callback session'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStepState = (
    stepNum: 1 | 2 | 3,
    cb: CallbackSession | null
  ): 'done' | 'active' | 'pending' => {
    if (!cb) return 'pending';
    if (stepNum === 1) {
      if (cb.status === 'CallingFrom') return 'active';
      if (cb.legAAnsweredAt || cb.status === 'Completed') return 'done';
      return 'pending';
    }
    if (stepNum === 2) {
      if (cb.status === 'PlayingWaitVoice' || cb.status === 'CallingTo') {
        return 'active';
      }
      if (cb.status === 'InConference' || cb.conferencedAt) return 'done';
      return 'pending';
    }
    if (stepNum === 3) {
      if (cb.status === 'InConference') return 'active';
      if (cb.status === 'Completed' && cb.conferencedAt) return 'done';
      return 'pending';
    }
    return 'pending';
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Callback Origination Form */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Callback & Auto-Conference Bridge
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Calls &ldquo;Call From&rdquo; first, plays wait voice, then dials &ldquo;Call To&rdquo; &amp; bridges both
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 whitespace-nowrap shrink-0">
              {activeAccount
                ? `${activeAccount.transport}:${activeAccount.port}`
                : 'No Trunk'}
            </span>
          </div>

          <form onSubmit={handleSubmitCallback} className="space-y-4">
            {/* SIP Trunk Selection */}
            <div>
              <label
                htmlFor="callback-sip-account"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Outbound SIP Trunk / Account
              </label>
              <select
                id="callback-sip-account"
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

            {/* Leg A: Call From Number */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="callback-from-number"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Call From Number (First Party Called)
                </label>
                <select
                  aria-label="Quick fill Call From number from contacts"
                  onChange={(e) => {
                    if (e.target.value) setCallFromNumber(e.target.value);
                  }}
                  value=""
                  className="text-xs bg-transparent text-sky-600 dark:text-sky-400 focus:outline-none cursor-pointer"
                >
                  <option value="">Select contact...</option>
                  {contacts
                    .filter((c) => !c.dncOptOut)
                    .map((c) => (
                      <option key={c.id} value={c.phoneNumber}>
                        {c.name} ({c.phoneNumber})
                      </option>
                    ))}
                </select>
              </div>
              <input
                id="callback-from-number"
                type="text"
                value={callFromNumber}
                onChange={(e) => setCallFromNumber(e.target.value)}
                placeholder="+14158902110"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3.5 py-2.5 text-base font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {matchedFromContact && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  First Leg Contact: {matchedFromContact.name} · Hears wait voice on answer
                </p>
              )}
            </div>

            {/* Swap Button */}
            <div className="flex items-center justify-center -my-1">
              <button
                type="button"
                onClick={handleSwapNumbers}
                aria-label="Swap Call From and Call To numbers"
                className="flex items-center gap-1.5 py-1 px-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Swap Numbers</span>
              </button>
            </div>

            {/* Leg B: Call To Number */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="callback-to-number"
                  className="text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Call To Number (Second Party Connected to Conference)
                </label>
                <select
                  aria-label="Quick fill Call To number from contacts"
                  onChange={(e) => {
                    if (e.target.value) setCallToNumber(e.target.value);
                  }}
                  value=""
                  className="text-xs bg-transparent text-sky-600 dark:text-sky-400 focus:outline-none cursor-pointer"
                >
                  <option value="">Select contact...</option>
                  {contacts
                    .filter((c) => !c.dncOptOut)
                    .map((c) => (
                      <option key={c.id} value={c.phoneNumber}>
                        {c.name} ({c.phoneNumber})
                      </option>
                    ))}
                </select>
              </div>
              <input
                id="callback-to-number"
                type="text"
                value={callToNumber}
                onChange={(e) => setCallToNumber(e.target.value)}
                placeholder="+14158903344"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3.5 py-2.5 text-base font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {matchedToContact && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Second Leg Contact: {matchedToContact.name} · Auto-conferences on answer
                </p>
              )}
            </div>

            {/* Wait Voice Message Played to Call From */}
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="callback-wait-voice"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Voice Prompt Played to &ldquo;Call From&rdquo; While Waiting
                  </label>
                  <button
                    type="button"
                    onClick={() => speakCallbackPromptInBrowser(waitVoiceText)}
                    className="flex items-center gap-1 text-xs text-sky-600 dark:text-sky-400 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Preview Wait Voice</span>
                  </button>
                </div>
                <input
                  id="callback-wait-voice"
                  type="text"
                  value={waitVoiceText}
                  onChange={(e) => setWaitVoiceText(e.target.value)}
                  className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Injected as 8000 Hz G.711 u-law RTP audio to Call From immediately after 200 OK until Call To answers.
                </p>
              </div>

              <div className="space-y-2">
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
                    htmlFor="callback-legb-outcome"
                    className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Second Party (&ldquo;Call To&rdquo;) Response Mode (Loopback / Demo Trunks)
                  </label>
                  <select
                    id="callback-legb-outcome"
                    value={simulatedLegBOutcome}
                    onChange={(e) =>
                      setSimulatedLegBOutcome(e.target.value as CallStatus)
                    }
                    className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300"
                  >
                    <option value="Answered">
                      200 OK — Call To Answers &amp; Auto-Bridges Conference
                    </option>
                    <option value="Busy">
                      486 Busy Here — Call To Line Busy
                    </option>
                    <option value="No Answer">
                      480 Temporarily Unavailable — Call To No Answer
                    </option>
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
                <PhoneForwarded className="w-4 h-4" />
                <span>{isSubmitting ? 'Starting Callback...' : 'Call Back'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Live Two-Legged Callback & Automatic Conference Bridge Monitor */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Live Callback &amp; Automatic Conference Bridge
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Real-time two-legged PJSIP origination, wait prompt injection, and full-duplex RTP mixer
                </p>
              </div>
              {activeCallback && (
                <span className="text-xs font-mono tabular-nums text-sky-600 dark:text-sky-400 font-semibold">
                  Bridge: {activeCallback.bridgeId}
                </span>
              )}
            </div>

            {/* 3-Step Visual Progress Pipeline */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              {[
                {
                  num: 1 as const,
                  title: '01. Call From Number',
                  desc: 'Dial first number & wait for 200 OK answer',
                },
                {
                  num: 2 as const,
                  title: '02. Wait Voice & Call To',
                  desc: '"Please wait till received the call from other side"',
                },
                {
                  num: 3 as const,
                  title: '03. Auto Conference',
                  desc: 'Bridge both RTP streams so both talk together',
                },
              ].map((step) => {
                const st = getStepState(step.num, activeCallback);
                return (
                  <div
                    key={step.num}
                    className={`p-3.5 rounded-lg border transition-colors ${
                      st === 'active'
                        ? 'bg-sky-500/10 border-sky-500 text-sky-900 dark:text-sky-100'
                        : st === 'done'
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-100'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>{step.title}</span>
                      {st === 'done' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      )}
                      {st === 'active' && (
                        <Clock className="w-4 h-4 text-sky-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {step.desc}
                    </p>
                  </div>
                );
              })}
            </div>

            {activeCallback ? (
              <div className="space-y-5">
                {/* Status Banner */}
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>Callback Session</span>
                      <span aria-hidden="true">·</span>
                      <span>{activeCallback.sipAccountName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-sky-600 dark:text-sky-400">
                        {activeCallback.status === 'CallingFrom' &&
                          'Step 1: Calling "Call From" Number...'}
                        {activeCallback.status === 'PlayingWaitVoice' &&
                          'Step 2: Playing Wait Voice & Dialing "Call To"...'}
                        {activeCallback.status === 'CallingTo' &&
                          'Step 2: Ringing "Call To" while "Call From" Waits...'}
                        {activeCallback.status === 'InConference' &&
                          'Step 3: Conference Active — Both Parties Talking'}
                        {activeCallback.status === 'Completed' &&
                          'Callback Conference Completed'}
                        {activeCallback.status === 'Failed' &&
                          'Callback Session Ended / Failed'}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1">
                      Voice Prompt: &ldquo;{activeCallback.waitVoiceText}&rdquo;
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-2xl font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatDurationClock(
                        activeCallback.status === 'InConference' ||
                          activeCallback.conferenceDurationSeconds > 0
                          ? activeCallback.conferenceDurationSeconds
                          : activeCallback.durationSeconds
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {activeCallback.status === 'InConference'
                        ? 'Live 2-Way Conference Duration'
                        : 'Total Session Elapsed'}
                    </div>
                  </div>
                </div>

                {/* Two Call Legs Side-by-Side Comparison */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Leg A: Call From */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium">Leg A · Call From</span>
                      <span className="font-mono font-semibold text-sky-600 dark:text-sky-400">
                        {activeCallback.legAStatus}
                      </span>
                    </div>
                    <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {activeCallback.callFromName}
                    </div>
                    <div className="text-sm font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {activeCallback.callFromNumber}
                    </div>
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          activeCallback.status === 'Completed' ||
                          activeCallback.status === 'Failed'
                        }
                        onClick={() =>
                          onCallbackAction(
                            activeCallback.id,
                            'toggle_mute_from'
                          )
                        }
                        className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                      >
                        {activeCallback.legAMuted ? (
                          <>
                            <MicOff className="w-3.5 h-3.5 text-amber-500" />
                            <span>Unmute Call From</span>
                          </>
                        ) : (
                          <>
                            <Mic className="w-3.5 h-3.5" />
                            <span>Mute Call From</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Leg B: Call To */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-medium">Leg B · Call To</span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        {activeCallback.legBStatus}
                      </span>
                    </div>
                    <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {activeCallback.callToName}
                    </div>
                    <div className="text-sm font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {activeCallback.callToNumber}
                    </div>
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          activeCallback.status === 'Completed' ||
                          activeCallback.status === 'Failed'
                        }
                        onClick={() =>
                          onCallbackAction(activeCallback.id, 'toggle_mute_to')
                        }
                        className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                      >
                        {activeCallback.legBMuted ? (
                          <>
                            <MicOff className="w-3.5 h-3.5 text-amber-500" />
                            <span>Unmute Call To</span>
                          </>
                        ) : (
                          <>
                            <Mic className="w-3.5 h-3.5" />
                            <span>Mute Call To</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Conference Controls */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      speakCallbackPromptInBrowser(
                        activeCallback.waitVoiceText,
                        activeCallback.waitVoiceWavUri
                      );
                      if (
                        activeCallback.status !== 'Completed' &&
                        activeCallback.status !== 'Failed'
                      ) {
                        onCallbackAction(
                          activeCallback.id,
                          'replay_wait_voice'
                        );
                      }
                    }}
                    className="flex items-center gap-2 py-2 px-3.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>Hear Wait Voice Prompt</span>
                  </button>

                  {activeCallback.status !== 'Completed' &&
                    activeCallback.status !== 'Failed' && (
                      <button
                        type="button"
                        onClick={() =>
                          onCallbackAction(activeCallback.id, 'hangup')
                        }
                        className="flex items-center gap-2 py-2 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <PhoneOff className="w-4 h-4" />
                        <span>End Conference (Hang Up Both Legs)</span>
                      </button>
                    )}
                </div>

                {/* Live SIP & RTP Conference Bridge Trace */}
                <div className="rounded-lg bg-slate-950 border border-slate-800 p-4">
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="flex items-center gap-1.5 font-medium text-slate-300">
                      <Terminal className="w-3.5 h-3.5 text-sky-400" />
                      <span>Live Callback &amp; Conference Bridge Signaling Trace</span>
                    </span>
                    <span className="font-mono">{activeCallback.id}</span>
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-xs text-slate-300">
                    {activeCallback.sipTrace.map((line, idx) => (
                      <div
                        key={idx}
                        className="py-1 border-b border-slate-900 last:border-0"
                      >
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
                  No Active Callback Conference
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
                  Enter the &ldquo;Call From&rdquo; and &ldquo;Call To&rdquo; numbers on the left and click
                  &ldquo;Call Back&rdquo; to dial the first party, play the wait voice prompt, and
                  automatically conference both sides when the second party answers.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Callback Sessions History Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Callback &amp; Conference Sessions Log
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Two-legged callback history with Leg A, Leg B, wait prompt, and conference bridge duration
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Total Sessions: {callbacks.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3 font-medium">Call From (Leg A)</th>
                <th className="py-2.5 px-3 font-medium">Call To (Leg B)</th>
                <th className="py-2.5 px-3 font-medium">SIP Trunk</th>
                <th className="py-2.5 px-3 font-medium">Stage / Status</th>
                <th className="py-2.5 px-3 font-medium text-right">
                  Conference Duration
                </th>
                <th className="py-2.5 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {callbacks.map((cb) => (
                <tr
                  key={cb.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-950/60 transition-colors"
                >
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {cb.callFromName}
                    </div>
                    <div className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {cb.callFromNumber} · {cb.legAStatus}
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {cb.callToName}
                    </div>
                    <div className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {cb.callToNumber} · {cb.legBStatus}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                    {cb.sipAccountName}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {cb.status}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 ml-1.5">
                      · {cb.bridgeId}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {formatDurationClock(cb.conferenceDurationSeconds)}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setCallFromNumber(cb.callFromNumber);
                        setCallToNumber(cb.callToNumber);
                      }}
                      className="inline-flex items-center gap-1 py-1 px-2.5 rounded border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Load Numbers</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
