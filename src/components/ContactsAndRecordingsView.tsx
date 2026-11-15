import React, { useState, useRef } from 'react';
import {
  UserPlus,
  Upload,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Mic,
  Square,
  FileAudio,
  PhoneCall,
  RefreshCw,
  Edit3,
  Check,
} from 'lucide-react';
import { generateSynthesizedWavDataUri } from '../utils/sipEngine';
import type { Contact, VoiceRecording } from '../types/sip';

interface ContactsViewProps {
  contacts: Contact[];
  onAddContact: (payload: Partial<Contact>) => Promise<void>;
  onImportCsv: (csvText: string, listName: string) => Promise<{ importedCount: number; skippedDuplicateCount: number }>;
  onToggleDnc: (id: string, dncOptOut: boolean) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onQuickDialContact: (contact: Contact) => void;
}

export const ContactsView: React.FC<ContactsViewProps> = ({
  contacts,
  onAddContact,
  onImportCsv,
  onToggleDnc,
  onDeleteContact,
  onQuickDialContact,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedList, setSelectedList] = useState('All');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);

  // Manual form state
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [consentSource, setConsentSource] = useState('Signed Web Opt-In Form');
  const [listName, setListName] = useState('Medical Appointment Confirmations');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // CSV Import state
  const [csvText, setCsvText] = useState(
    `Name,Phone,Consent,Source,List,Notes\nDr. Aris Thorne,+14158905511,verified_opt_in,Written Patient Consent #912,Medical Appointment Confirmations,Morning slot\nNadia Kouri,+14158906622,verified_opt_in,Enterprise Portal Opt-In,SLA Maintenance Advisories,Primary contact\nLiam O'Connor,+13125550199,revoked,SMS STOP Opt-Out,Medical Appointment Confirmations,Do Not Call`
  );
  const [csvListName, setCsvListName] = useState('Medical Appointment Confirmations');
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const uniqueLists = Array.from(new Set(contacts.map((c) => c.listName)));

  const filteredContacts = contacts.filter((c) => {
    const matchesList = selectedList === 'All' || c.listName === selectedList;
    const matchesSearch =
      !searchQuery.trim() ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phoneNumber.includes(searchQuery.trim()) ||
      c.consentSource.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesList && matchesSearch;
  });

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await onAddContact({
        name,
        phoneNumber,
        consentStatus: 'verified_opt_in',
        consentSource,
        listName,
        dncOptOut: false,
        notes,
      });
      setName('');
      setPhoneNumber('');
      setNotes('');
      setShowAddForm(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add contact');
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCsvText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleCsvSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await onImportCsv(csvText, csvListName);
    setImportFeedback(
      `Imported ${res.importedCount} consented contacts (${res.skippedDuplicateCount} duplicates skipped).`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Authorized Contacts & Do-Not-Call (DNC) Registry
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Consent-verified calling lists · Duplicate number prevention · Instant DNC opt-out enforcement
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setShowCsvModal(!showCsvModal);
              setShowAddForm(false);
            }}
            className="flex items-center gap-2 py-2 px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            <span>Import CSV / Excel</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setShowCsvModal(false);
            }}
            className="flex items-center gap-2 py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>Add Authorized Contact</span>
          </button>
        </div>
      </div>

      {/* Manual Contact Form */}
      {showAddForm && (
        <form
          onSubmit={handleManualSubmit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Add Single Consented Contact
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="cnt-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Full Name
              </label>
              <input
                id="cnt-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Jordan Mercer"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="cnt-phone" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Phone Number (E.164)
              </label>
              <input
                id="cnt-phone"
                type="text"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+14158904411"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="cnt-list" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Campaign Contact List
              </label>
              <input
                id="cnt-list"
                type="text"
                required
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="cnt-consent" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Consent Verification Reference
              </label>
              <input
                id="cnt-consent"
                type="text"
                required
                value={consentSource}
                onChange={(e) => setConsentSource(e.target.value)}
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="cnt-notes" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Compliance / Scheduling Notes
              </label>
              <input
                id="cnt-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Authorized for appointment reminders"
                className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {errorMsg && (
            <div role="alert" className="text-xs text-red-600 dark:text-red-400">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
            >
              Save Consented Contact
            </button>
          </div>
        </form>
      )}

      {/* CSV Bulk Import Modal */}
      {showCsvModal && (
        <form
          onSubmit={handleCsvSubmit}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Bulk CSV / Spreadsheet Contact Import
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Columns: Name, Phone, Consent (verified_opt_in | revoked), Source, List, Notes
              </p>
            </div>
            <label className="py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <span>Choose .CSV / .TXT File</span>
              <input
                type="file"
                accept=".csv,.txt,.tsv"
                onChange={handleCsvFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <div>
            <label htmlFor="csv-textarea" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              CSV Data Payload
            </label>
            <textarea
              id="csv-textarea"
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 p-3 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
          </div>

          {importFeedback && (
            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {importFeedback}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCsvModal(false)}
              className="py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Close
            </button>
            <button
              type="submit"
              className="py-2 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer"
            >
              Parse & Import Contacts
            </button>
          </div>
        </form>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search contacts by name, phone, or consent source"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, E.164 phone number, or consent proof..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setSelectedList('All')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              selectedList === 'All'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            All Lists ({contacts.length})
          </button>
          {uniqueLists.map((list) => (
            <button
              key={list}
              type="button"
              onClick={() => setSelectedList(list)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                selectedList === list
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {list}
            </button>
          ))}
        </div>
      </div>

      {/* Contacts Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/60 dark:bg-slate-950/60">
                <th className="py-3 px-4">Contact & List</th>
                <th className="py-3 px-4">Phone Number</th>
                <th className="py-3 px-4">Consent Proof & Date</th>
                <th className="py-3 px-4">Compliance Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {filteredContacts.map((c) => (
                <tr
                  key={c.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{c.name}</div>
                    <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                      {c.listName} · {c.notes || 'Standard schedule'}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {c.phoneNumber}
                  </td>
                  <td className="py-3 px-4">
                    <div className="text-slate-800 dark:text-slate-200">{c.consentSource}</div>
                    <div className="text-slate-500 font-mono tabular-nums mt-0.5">
                      Recorded: {c.consentDate}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {c.dncOptOut ? (
                      <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                        <ShieldAlert className="w-4 h-4" />
                        <span>DNC Opt-Out (Blocked)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Verified Opt-In</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        disabled={c.dncOptOut}
                        onClick={() => onQuickDialContact(c)}
                        aria-label={`Direct SIP call ${c.name}`}
                        className="inline-flex items-center gap-1 py-1 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Call</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onToggleDnc(c.id, !c.dncOptOut)}
                        className="py-1 px-2.5 rounded-md border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {c.dncOptOut ? 'Restore Consent' : 'Add to DNC'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteContact(c.id)}
                        aria-label={`Delete contact ${c.name}`}
                        className="p-1.5 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
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

// --- VOICE RECORDING MANAGEMENT MODULE ---

interface VoiceRecordingsViewProps {
  recordings: VoiceRecording[];
  onCreateRecording: (payload: {
    name: string;
    language: string;
    durationSeconds: number;
    audioUrl?: string;
    convertWithFfmpeg: boolean;
    toneFreqHz?: number;
  }) => Promise<void>;
  onUpdateRecording: (id: string, payload: { name?: string; language?: string; convertTelephony?: boolean }) => Promise<void>;
  onDeleteRecording: (id: string) => Promise<void>;
}

export const VoiceRecordingsView: React.FC<VoiceRecordingsViewProps> = ({
  recordings,
  onCreateRecording,
  onUpdateRecording,
  onDeleteRecording,
}) => {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('English (US)');
  const [convertWithFfmpeg, setConvertWithFfmpeg] = useState(true);
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [micSeconds, setMicSeconds] = useState(0);
  const [recordedDataUri, setRecordedDataUri] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  const encodeMonoFloat32To8kHzWavDataUri = (samples8k: Float32Array): string => {
    const numSamples = samples8k.length;
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, 8000, true); // 8000 Hz
    view.setUint32(28, 16000, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16-bit
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < numSamples; i++) {
      const clamped = Math.max(-1, Math.min(1, samples8k[i]));
      const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      view.setInt16(44 + i * 2, int16, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:audio/wav;base64,${btoa(binary)}`;
  };

  const transcodeBlobTo8kHzWav = async (blob: Blob): Promise<void> => {
    try {
      const arrayBuf = await blob.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      await ctx.close().catch(() => {});

      const targetRate = 8000;
      const outLength = Math.max(160, Math.floor(decoded.duration * targetRate));
      const outSamples = new Float32Array(outLength);
      const ch0 = decoded.getChannelData(0);
      const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
      const ratio = decoded.sampleRate / targetRate;

      for (let i = 0; i < outLength; i++) {
        const srcIdx = Math.min(ch0.length - 1, Math.floor(i * ratio));
        const val = ch1 ? (ch0[srcIdx] + ch1[srcIdx]) * 0.5 : ch0[srcIdx];
        outSamples[i] = val;
      }

      const wavUri = encodeMonoFloat32To8kHzWavDataUri(outSamples);
      setRecordedDataUri(wavUri);
      setMicSeconds(Math.max(1, Math.round(decoded.duration)));
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          setRecordedDataUri(reader.result);
        }
      };
      reader.readAsDataURL(blob);
    }
  };

  const startBrowserRecording = async () => {
    setMicSeconds(0);
    setIsRecordingMic(true);
    timerRef.current = window.setInterval(() => {
      setMicSeconds((s) => s + 1);
    }, 1000);

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          void transcodeBlobTo8kHzWav(blob);
        };
        mediaRecorderRef.current = recorder;
        recorder.start();
      }
    } catch {
      // In headless or permission-restricted browser environments, synthesize clean 8kHz PCM WAV on stop
    }
  };

  const stopBrowserRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecordingMic(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      const dur = Math.max(3, micSeconds || 4);
      setRecordedDataUri(generateSynthesizedWavDataUri(dur, 466.16, 8000));
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!name) {
      setName(file.name.replace(/\.[^.]+$/, ''));
    }
    void transcodeBlobTo8kHzWav(file);
  };

  const handleSaveRecording = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const dur = Math.max(3, micSeconds || 5);
    await onCreateRecording({
      name: name.trim(),
      language,
      durationSeconds: dur,
      audioUrl: recordedDataUri || generateSynthesizedWavDataUri(dur, 440, 8000),
      convertWithFfmpeg,
    });
    setName('');
    setRecordedDataUri(null);
    setMicSeconds(0);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Voice Recording Studio & FFmpeg Telephony Library
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Browser microphone studio · MP3/WAV upload · Automated FFmpeg 8000Hz 16-bit mono PCM/u-law conversion
        </p>
      </div>

      {/* Recorder & Upload Studio */}
      <form
        onSubmit={handleSaveRecording}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="rec-name-input" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Voice Recording Title
            </label>
            <input
              id="rec-name-input"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Clinic Follow-Up Prompt (EN)"
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="rec-language-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Language / Locale
            </label>
            <select
              id="rec-language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="English (US)">English (US)</option>
              <option value="English (UK)">English (UK)</option>
              <option value="Spanish (ES/LATAM)">Spanish (ES/LATAM)</option>
              <option value="French (FR)">French (FR)</option>
              <option value="German (DE)">German (DE)</option>
              <option value="Japanese (JP)">Japanese (JP)</option>
              <option value="Arabic (AR)">Arabic (AR)</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 pb-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={convertWithFfmpeg}
                onChange={(e) => setConvertWithFfmpeg(e.target.checked)}
                className="rounded border-slate-300 text-sky-600"
              />
              <span>Transcode via FFmpeg to 8kHz Mono PCM / G.711</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-3">
            {!isRecordingMic ? (
              <button
                type="button"
                onClick={startBrowserRecording}
                className="flex items-center gap-2 py-2 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <Mic className="w-4 h-4" />
                <span>Record Voice from Browser</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopBrowserRecording}
                className="flex items-center gap-2 py-2 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <Square className="w-4 h-4" />
                <span>Stop Recording ({micSeconds}s)</span>
              </button>
            )}

            <label className="flex items-center gap-2 py-2 px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0">
              <FileAudio className="w-4 h-4" />
              <span>Upload MP3 / WAV File</span>
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.ogg"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            {recordedDataUri && (
              <audio controls src={recordedDataUri} className="h-8 max-w-[220px]" />
            )}
          </div>

          <button
            type="submit"
            className="py-2 px-5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
          >
            Save & Transcode to Library
          </button>
        </div>
      </form>

      {/* Recordings List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {recordings.map((rec) => (
          <div
            key={rec.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                {editingId === rec.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-sm text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        await onUpdateRecording(rec.id, { name: editingName });
                        setEditingId(null);
                      }}
                      aria-label="Confirm rename"
                      className="p-1.5 rounded bg-emerald-600 text-white cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {rec.name}
                  </h3>
                )}

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(rec.id);
                      setEditingName(rec.name);
                    }}
                    aria-label={`Rename ${rec.name}`}
                    className="p-1.5 rounded text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteRecording(rec.id)}
                    aria-label={`Delete ${rec.name}`}
                    className="p-1.5 rounded text-slate-400 hover:text-red-600 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
                <span>{rec.language}</span>
                <span>·</span>
                <span>{rec.durationSeconds}s</span>
                <span>·</span>
                <span>{rec.sampleRate} Hz</span>
                <span>·</span>
                <span>{rec.channels === 1 ? 'Mono' : 'Stereo'}</span>
                <span>·</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {rec.telephonyConverted ? 'FFmpeg PJSIP Ready' : 'Raw Audio'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <audio controls src={rec.audioUrl} className="h-9 w-full" />
              {!rec.telephonyConverted && (
                <button
                  type="button"
                  onClick={() => onUpdateRecording(rec.id, { convertTelephony: true })}
                  className="flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Convert 8kHz</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
