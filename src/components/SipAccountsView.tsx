import React, { useState } from 'react';
import {
  Server,
  Plus,
  RefreshCw,
  Trash2,
  Edit3,
  CheckCircle2,
  XCircle,
  Lock,
  Terminal,
  Download,
} from 'lucide-react';
import { generatePjsipConf } from '../utils/sipEngine';
import type { SipAccount, SipLogEntry, SipTransport } from '../types/sip';

interface SipAccountsViewProps {
  sipAccounts: SipAccount[];
  sipLogs: SipLogEntry[];
  onSaveAccount: (payload: Partial<SipAccount> & { password?: string; isIpTrunk?: boolean }) => Promise<void>;
  onRegisterAction: (id: string, action: 'register' | 'unregister' | 'test' | 'force-active') => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
}

export const SipAccountsView: React.FC<SipAccountsViewProps> = ({
  sipAccounts,
  sipLogs,
  onSaveAccount,
  onRegisterAction,
  onDeleteAccount,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [port, setPort] = useState(5060);
  const [transport, setTransport] = useState<SipTransport>('UDP');
  const [isIpTrunk, setIsIpTrunk] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [callerId, setCallerId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPjsipModal, setShowPjsipModal] = useState(false);

  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const openCreateForm = () => {
    setEditingId(null);
    setName('');
    setDomain('');
    setUsername('');
    setPassword('');
    setPort(5060);
    setTransport('UDP');
    setIsIpTrunk(false);
    setDisplayName('');
    setCallerId('');
    setFormError(null);
    setStatusFeedback(null);
    setShowForm(true);
  };

  const openEditForm = (acc: SipAccount) => {
    setEditingId(acc.id);
    setName(acc.name);
    setDomain(acc.domain);
    setUsername(acc.username);
    setPassword('');
    setPort(acc.port);
    setTransport(acc.transport);
    setIsIpTrunk(acc.status === 'Registered' && !acc.hasPassword);
    setDisplayName(acc.displayName);
    setCallerId(acc.callerId);
    setFormError(null);
    setStatusFeedback(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusFeedback(null);
    const effectiveCallerId = callerId.trim() || username.trim();
    try {
      await onSaveAccount({
        id: editingId || undefined,
        name: name.trim() || `${username.trim()}@${domain.trim()}`,
        domain: domain.trim(),
        username: username.trim(),
        password,
        port: Number(port),
        transport,
        displayName: displayName.trim() || username.trim() || name.trim(),
        callerId: effectiveCallerId,
        isIpTrunk,
        status: isIpTrunk ? 'Registered' : 'Connecting',
      });
      setShowForm(false);
      setStatusFeedback({
        type: 'ok',
        text: isIpTrunk
          ? `Saved SIP trunk ${username.trim()}@${domain.trim()}:${port} (${transport}) as active Direct IP Trunk.`
          : `Saved SIP account ${username.trim()}@${domain.trim()}:${port} (${transport}) and dispatched PJSIP REGISTER.`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save SIP account');
    }
  };

  const handleRegClick = async (
    id: string,
    action: 'register' | 'unregister' | 'test' | 'force-active'
  ) => {
    setBusyId(id);
    setStatusFeedback(null);
    try {
      await onRegisterAction(id, action);
    } finally {
      setBusyId(null);
    }
  };

  const downloadPjsipConf = () => {
    const content = generatePjsipConf(sipAccounts);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pjsip.conf';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            SIP Trunk & Account Configuration
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Multi-trunk PJSIP / SIP.js management · AES-256-GCM encrypted credentials · UDP, TCP, TLS & WSS
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPjsipModal(!showPjsipModal)}
            className="flex items-center gap-2 py-2 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{showPjsipModal ? 'Hide pjsip.conf' : 'Inspect Asterisk pjsip.conf'}</span>
          </button>

          <button
            type="button"
            onClick={openCreateForm}
            className="flex items-center gap-2 py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add SIP Account</span>
          </button>
        </div>
      </div>

      {/* Optional Asterisk PJSIP Config Preview */}
      {showPjsipModal && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-slate-300">
              /etc/asterisk/pjsip.conf (Auto-generated for {sipAccounts.length} configured trunks)
            </span>
            <button
              type="button"
              onClick={downloadPjsipConf}
              className="flex items-center gap-1.5 py-1.5 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download pjsip.conf</span>
            </button>
          </div>
          <pre className="text-xs font-mono text-slate-300 overflow-x-auto max-h-64 p-3 rounded-lg bg-slate-900/90">
            {generatePjsipConf(sipAccounts)}
          </pre>
        </div>
      )}

      {/* Create / Edit SIP Account Form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {editingId ? 'Edit SIP Account' : 'Configure New SIP Trunk / Account'}
            </h3>
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Lock className="w-3.5 h-3.5" />
              <span>AES-256-GCM Server-Side Vault</span>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="sip-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Account Label
              </label>
              <input
                id="sip-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Telnyx US-East Trunk"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sip-domain"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                SIP Server / Domain
              </label>
              <input
                id="sip-domain"
                type="text"
                required
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="sip.telnyx.com"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sip-username"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                SIP Username
              </label>
              <input
                id="sip-username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="trunk_user_01"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sip-password"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                SIP Password {editingId && '(Leave blank to keep existing)'}
              </label>
              <input
                id="sip-password"
                type="password"
                required={!editingId}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sip-port"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                SIP Port
              </label>
              <input
                id="sip-port"
                type="number"
                required
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sip-transport"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                SIP Transport Protocol
              </label>
              <select
                id="sip-transport"
                value={transport}
                onChange={(e) => setTransport(e.target.value as SipTransport)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              >
                <option value="UDP">UDP (Standard Port 5060)</option>
                <option value="TCP">TCP (Reliable Signaling)</option>
                <option value="TLS">TLS (Encrypted SIP Port 5061)</option>
                <option value="WSS">WSS (Browser WebRTC SIP.js Port 8089)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="sip-trunk-mode"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                SIP Trunk Peering Mode
              </label>
              <select
                id="sip-trunk-mode"
                value={isIpTrunk ? 'ip_trunk' : 'register'}
                onChange={(e) => setIsIpTrunk(e.target.value === 'ip_trunk')}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              >
                <option value="register">Standard SIP Client (REGISTER with Digest Auth)</option>
                <option value="ip_trunk">Static IP Trunk (Direct IP Auth / No REGISTER)</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {isIpTrunk
                  ? 'Calls are routed straight to the SIP Domain without registration. Ideal for telecom gateways and IP-whitelisted carriers.'
                  : 'Sends RFC 3261 REGISTER packets directly to the SIP Domain host.'}
              </p>
            </div>

            <div>
              <label
                htmlFor="sip-display-name"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Display Name (From Header)
              </label>
              <input
                id="sip-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="VoxPulse Customer Care"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="sip-caller-id"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Caller ID (Defaults to SIP Username)
              </label>
              <input
                id="sip-caller-id"
                type="text"
                value={callerId}
                onChange={(e) => setCallerId(e.target.value)}
                placeholder={username || '+14158904000'}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {formError && (
            <div role="alert" className="text-xs text-red-600 dark:text-red-400">
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
            >
              Save & Register SIP Account
            </button>
          </div>
        </form>
      )}

      {statusFeedback && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-700 dark:text-sky-300"
        >
          {statusFeedback.text}
        </div>
      )}

      {/* SIP Accounts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {sipAccounts.map((acc) => {
          const isRegistered = acc.status === 'Registered';
          const isBusy = busyId === acc.id;

          return (
            <div
              key={acc.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {acc.name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                      <span>{acc.transport}</span>
                      <span aria-hidden="true">·</span>
                      <span>Port {acc.port}</span>
                      <span aria-hidden="true">·</span>
                      <span>{acc.latencyMs ? `${acc.latencyMs}ms RTT` : 'Idle'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs font-medium shrink-0">
                    {isRegistered ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Registered</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <XCircle className="w-4 h-4" />
                        <span>{acc.status}</span>
                      </span>
                    )}
                  </div>
                </div>

                <dl className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">SIP Domain</dt>
                    <dd className="font-mono text-slate-900 dark:text-slate-200">{acc.domain}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Auth Username</dt>
                    <dd className="font-mono text-slate-900 dark:text-slate-200">{acc.username}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Auth Secret</dt>
                    <dd className="font-mono text-slate-500">{acc.passwordMasked} (AES-256)</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Direct Endpoint</dt>
                    <dd className="font-mono text-slate-900 dark:text-slate-200">
                      {acc.domain}:{acc.port} ({acc.transport})
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500 dark:text-slate-400">Caller ID</dt>
                    <dd className="font-mono tabular-nums text-sky-600 dark:text-sky-400">
                      {acc.callerId}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isRegistered ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      aria-label={`Unregister ${acc.name}`}
                      onClick={() => handleRegClick(acc.id, 'unregister')}
                      className="py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Unregister
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={isBusy}
                        aria-label={`Register ${acc.name}`}
                        onClick={() => handleRegClick(acc.id, 'register')}
                        className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {isBusy ? 'Registering...' : 'Register'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        aria-label={`Set ${acc.name} as Active IP Trunk`}
                        onClick={() => handleRegClick(acc.id, 'force-active')}
                        className="py-1.5 px-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer whitespace-nowrap shrink-0"
                        title="Direct IP Peering: Mark trunk active for immediate calling without REGISTER handshake"
                      >
                        Set Active (IP Trunk)
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    disabled={isBusy}
                    aria-label={`Test SIP ${acc.name}`}
                    onClick={() => handleRegClick(acc.id, 'test')}
                    className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} />
                    <span>Test SIP</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditForm(acc)}
                    aria-label={`Edit ${acc.name}`}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteAccount(acc.id)}
                    aria-label={`Delete ${acc.name}`}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live SIP Connection & Registration Trace Logs */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-sky-500" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Real-Time SIP Registration & Signaling Logs
            </h3>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            Showing {sipLogs.length} events
          </span>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto font-mono text-xs">
          {sipLogs.map((log) => (
            <div
              key={log.id}
              className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sky-600 dark:text-sky-400">
                    {log.level}
                  </span>
                  <span>·</span>
                  <span className="text-slate-900 dark:text-slate-200 font-medium">
                    {log.method}
                  </span>
                  <span>·</span>
                  <span>{log.accountName}</span>
                </div>
                <span className="tabular-nums">{log.timestamp.slice(11, 19)} UTC</span>
              </div>
              <div className="text-slate-700 dark:text-slate-300 mt-1">{log.summary}</div>
              {log.rawPacket && (
                <details className="mt-1.5">
                  <summary className="text-[11px] text-sky-600 dark:text-sky-400 cursor-pointer">
                    Inspect Raw RFC 3261 SIP Frame
                  </summary>
                  <pre className="mt-1.5 p-2.5 rounded bg-slate-900 text-slate-300 text-[11px] overflow-x-auto">
                    {log.rawPacket}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
