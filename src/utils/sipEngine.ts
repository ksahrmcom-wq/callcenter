import type {
  CallLog,
  Campaign,
  Contact,
  SipAccount,
  SipTransport,
  VoicemailMessage,
  UserRole,
  RbacAction,
  RbacPermissionEntry,
} from '../types/sip';

export function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // If user entered a SIP URI like sip:1001@domain, extract user part
  const sipMatch = trimmed.match(/^sips?:([^@;>]+)/i);
  if (sipMatch) {
    return sipMatch[1].trim();
  }
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d*#]/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  // Never prepend '+' to local numbers starting with '0' (e.g. 017XXXXXXXX or 00880...)
  if (digits.startsWith('0')) return digits;
  // Format standard US 10-digit numbers (e.g., (415) 890-4321 -> +14158904321)
  if (digits.length === 10 && !digits.startsWith('1')) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

export function formatSipUri(
  usernameOrNumber: string,
  domain: string,
  port = 5060,
  transport: SipTransport = 'UDP'
): string {
  const cleanUser = usernameOrNumber.trim().replace(/\s+/g, '');
  const cleanDomain = domain
    .trim()
    .replace(/^(sips?|udp|tcp|tls|wss?):\/?\/?/i, '')
    .replace(/:\d+$/, '');
  const scheme = transport === 'TLS' || transport === 'WSS' ? 'sips' : 'sip';
  const transportParam = `;transport=${transport.toLowerCase()}`;
  return `${scheme}:${cleanUser}@${cleanDomain}:${port}${transportParam}`;
}

export interface SipValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSipAccountInput(input: {
  name?: string;
  domain?: string;
  username?: string;
  password?: string;
  port?: number;
  transport?: string;
  callerId?: string;
  requirePassword?: boolean;
}): SipValidationResult {
  const errors: string[] = [];
  if (!input.name || input.name.trim().length < 2) {
    errors.push('Account name must be at least 2 characters.');
  }
  const cleanedDomain = (input.domain || '')
    .trim()
    .replace(/^(sips?|udp|tcp|tls|wss?):\/?\/?/i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  if (
    !cleanedDomain ||
    !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$|^\d{1,3}(\.\d{1,3}){3}$|^localhost$/i.test(cleanedDomain)
  ) {
    errors.push('Valid SIP Server / Domain or IP is required (e.g., sip.telnyx.com or 103.x.x.x).');
  }
  if (!input.username || input.username.trim().length < 1) {
    errors.push('SIP Username is required.');
  }
  if (input.requirePassword && (!input.password || input.password.trim().length < 3)) {
    errors.push('SIP Password is required.');
  }
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('SIP Port must be between 1 and 65535.');
  }
  if (!input.transport || !['UDP', 'TCP', 'TLS', 'WSS'].includes(input.transport)) {
    errors.push('SIP Transport must be UDP, TCP, TLS, or WSS.');
  }
  if (input.callerId !== undefined && input.callerId.trim().length === 0 && !input.username) {
    errors.push('Caller ID or SIP Username is required.');
  }
  return { valid: errors.length === 0, errors };
}

export interface DialEligibilityResult {
  allowed: boolean;
  reason?: string;
}

export function canDialContact(
  contact: Pick<Contact, 'phoneNumber' | 'consentStatus' | 'dncOptOut'>,
  alreadyDialedNormalizedNumbers: Set<string>
): DialEligibilityResult {
  const normalized = normalizePhoneNumber(contact.phoneNumber);
  if (!normalized || normalized.length < 3) {
    return { allowed: false, reason: 'Invalid phone number format' };
  }
  if (contact.dncOptOut) {
    return { allowed: false, reason: 'Blocked by Do-Not-Call (DNC) Opt-Out list' };
  }
  if (contact.consentStatus !== 'verified_opt_in') {
    return { allowed: false, reason: `Missing verified opt-in consent (status: ${contact.consentStatus})` };
  }
  if (alreadyDialedNormalizedNumbers.has(normalized)) {
    return { allowed: false, reason: 'Duplicate call prevented in active campaign' };
  }
  return { allowed: true };
}

export const DEFAULT_CALLBACK_WAIT_MESSAGE =
  'Please wait till received the call from other side';

export interface CallbackValidationResult {
  valid: boolean;
  normalizedFrom: string;
  normalizedTo: string;
  errors: string[];
}

export function validateCallbackInput(input: {
  callFromNumber?: string;
  callToNumber?: string;
}): CallbackValidationResult {
  const errors: string[] = [];
  const rawFrom = (input.callFromNumber || '').trim();
  const rawTo = (input.callToNumber || '').trim();
  const normalizedFrom = normalizePhoneNumber(rawFrom);
  const normalizedTo = normalizePhoneNumber(rawTo);

  if (!rawFrom || normalizedFrom.length < 3) {
    errors.push('Valid "Call From" phone number or SIP extension is required.');
  }
  if (!rawTo || normalizedTo.length < 3) {
    errors.push('Valid "Call To" phone number or SIP extension is required.');
  }
  if (
    normalizedFrom.length >= 3 &&
    normalizedTo.length >= 3 &&
    normalizedFrom === normalizedTo
  ) {
    errors.push('"Call From" and "Call To" numbers must be two different endpoints.');
  }

  return {
    valid: errors.length === 0,
    normalizedFrom,
    normalizedTo,
    errors,
  };
}

/**
 * Generates an 8000 Hz 16-bit mono PCM WAV audio prompt representing the 9-syllable spoken cadence:
 * "Please wait till re-ceived the call from o-ther side" followed by a pleasant comfort hold chime.
 */
export function generateCallbackWaitVoiceWavDataUri(durationSeconds = 5, sampleRate = 8000): string {
  const clampedDuration = Math.min(Math.max(2, durationSeconds), 10);
  const numSamples = Math.floor(clampedDuration * sampleRate);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // 11 syllable formants for "Please wait till re-ceived the call from o-ther side"
  const syllableFormants = [210, 240, 195, 225, 260, 190, 235, 205, 250, 215, 185];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sampleFloat = 0;
    if (t < 3.3) {
      const sylIdx = Math.min(
        syllableFormants.length - 1,
        Math.floor((t / 3.3) * syllableFormants.length)
      );
      const localT = (t % 0.3) / 0.3;
      const env = localT < 0.82 ? Math.sin((localT / 0.82) * Math.PI) : 0.02;
      const f0 = syllableFormants[sylIdx];
      const f1 = f0 * 2.1;
      const f2 = f0 * 3.4;
      sampleFloat =
        env *
        0.38 *
        (0.55 * Math.sin(2 * Math.PI * f0 * t) +
          0.3 * Math.sin(2 * Math.PI * f1 * t) +
          0.15 * Math.sin(2 * Math.PI * f2 * t));
    } else {
      // Gentle comfort hold chime while ringing Call To party
      const holdEnv = 0.22 * Math.exp(-((t - 3.3) % 1.2) * 1.8);
      sampleFloat =
        holdEnv *
        (0.6 * Math.sin(2 * Math.PI * 440 * t) + 0.4 * Math.sin(2 * Math.PI * 554.37 * t));
    }
    const pcm16 = Math.max(-32768, Math.min(32767, Math.floor(sampleFloat * 32767)));
    view.setInt16(44 + i * 2, pcm16, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(buffer).toString('base64');
  return `data:audio/wav;base64,${base64}`;
}

export function isWithinWorkingHours(
  currentHHMM: string,
  startHHMM: string,
  endHHMM: string
): boolean {
  const toMinutes = (hhmm: string): number => {
    const [hStr, mStr] = hhmm.split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
  };
  const current = toMinutes(currentHHMM);
  const start = toMinutes(startHHMM);
  const end = toMinutes(endHHMM);
  if (start <= end) {
    return current >= start && current <= end;
  }
  // Overnight window
  return current >= start || current <= end;
}

export function computeNextRetryDelay(
  attempt: number,
  baseRetrySeconds: number,
  maxAttempts: number
): { shouldRetry: boolean; delaySeconds: number } {
  if (attempt >= maxAttempts || maxAttempts <= 0) {
    return { shouldRetry: false, delaySeconds: 0 };
  }
  const safeBase = Math.max(5, baseRetrySeconds);
  return {
    shouldRetry: true,
    delaySeconds: safeBase * Math.pow(1.5, Math.max(0, attempt - 1)),
  };
}

export interface DashboardSummaryMetrics {
  totalCalls: number;
  outgoingCalls: number;
  incomingCalls: number;
  answeredCalls: number;
  missedCalls: number;
  failedCalls: number;
  totalDurationSeconds: number;
  answerRatePercent: number;
  successfulCampaigns: number;
  savedVoiceMessages: number;
}

export function calculateDashboardMetrics(
  callLogs: CallLog[],
  campaigns: Campaign[],
  voicemails: VoicemailMessage[]
): DashboardSummaryMetrics {
  const totalCalls = callLogs.length;
  const outgoingCalls = callLogs.filter((c) => c.direction === 'Outbound').length;
  const incomingCalls = callLogs.filter((c) => c.direction === 'Inbound').length;
  const answeredCalls = callLogs.filter(
    (c) => c.status === 'Answered' || c.status === 'Voicemail'
  ).length;
  const missedCalls = callLogs.filter(
    (c) => c.status === 'No Answer' || c.status === 'Busy' || c.status === 'Rejected'
  ).length;
  const failedCalls = callLogs.filter((c) => c.status === 'Failed').length;
  const totalDurationSeconds = callLogs.reduce(
    (acc, c) => acc + (Number(c.durationSeconds) || 0),
    0
  );
  const answerRatePercent =
    totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
  const successfulCampaigns = campaigns.filter(
    (c) => c.status === 'Completed' || (c.answeredCount > 0 && c.status === 'Running')
  ).length;
  const savedVoiceMessages = voicemails.length;

  return {
    totalCalls,
    outgoingCalls,
    incomingCalls,
    answeredCalls,
    missedCalls,
    failedCalls,
    totalDurationSeconds,
    answerRatePercent,
    successfulCampaigns,
    savedVoiceMessages,
  };
}

export interface ParsedContactCsvRow {
  name: string;
  phoneNumber: string;
  consentStatus: 'verified_opt_in' | 'pending' | 'revoked';
  consentSource: string;
  listName: string;
  dncOptOut: boolean;
  notes: string;
}

export function parseContactsCsv(
  csvText: string,
  defaultListName = 'Imported Broadcast List'
): ParsedContactCsvRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const results: ParsedContactCsvRow[] = [];
  const seenNumbers = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && cols.some((c) => /phone|number|name|consent/i.test(c))) {
      continue; // Skip header row
    }
    const name = cols[0] || `Contact ${i + 1}`;
    const rawPhone = cols[1] || cols[0] || '';
    const phoneNumber = normalizePhoneNumber(rawPhone);
    if (!phoneNumber || phoneNumber.length < 4 || seenNumbers.has(phoneNumber)) {
      continue;
    }
    seenNumbers.add(phoneNumber);

    const rawConsent = (cols[2] || 'verified_opt_in').toLowerCase();
    const consentStatus: 'verified_opt_in' | 'pending' | 'revoked' =
      rawConsent.includes('revok') || rawConsent.includes('opt_out')
        ? 'revoked'
        : rawConsent.includes('pend')
        ? 'pending'
        : 'verified_opt_in';
    const consentSource = cols[3] || 'CSV Verified Import';
    const listName = cols[4] || defaultListName;
    const dncOptOut = rawConsent.includes('dnc') || rawConsent.includes('revok');
    const notes = cols[5] || 'Imported via CSV bulk uploader';

    results.push({
      name,
      phoneNumber,
      consentStatus,
      consentSource,
      listName,
      dncOptOut,
      notes,
    });
  }

  return results;
}

export function formatDurationClock(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function generateSynthesizedWavDataUri(
  durationSeconds = 4,
  baseFreqHz = 440,
  sampleRate = 8000
): string {
  const clampedDuration = Math.min(Math.max(1, durationSeconds), 12);
  const numSamples = Math.floor(clampedDuration * sampleRate);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, 1, true); // Mono = 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // 16-bit samples
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Create pleasant speech-like cadence envelope + harmonic chord
    const syllableEnvelope =
      Math.sin(t * Math.PI * 3.5) > -0.2 ? 0.6 + 0.4 * Math.sin(t * Math.PI * 5) : 0.05;
    const f1 = baseFreqHz + 35 * Math.sin(t * 2.5);
    const f2 = baseFreqHz * 1.498;
    const sampleFloat =
      syllableEnvelope *
      0.35 *
      (0.65 * Math.sin(2 * Math.PI * f1 * t) + 0.35 * Math.sin(2 * Math.PI * f2 * t));
    const pcm16 = Math.max(-32768, Math.min(32767, Math.floor(sampleFloat * 32767)));
    view.setInt16(44 + i * 2, pcm16, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(buffer).toString('base64');
  return `data:audio/wav;base64,${base64}`;
}

export function generatePjsipConf(accounts: SipAccount[]): string {
  const sections = accounts.map((acc) => {
    const sectionId = acc.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return `; --- Trunk: ${acc.name} (${acc.transport}:${acc.port}) ---
[${sectionId}_transport]
type=transport
protocol=${acc.transport.toLowerCase()}
bind=0.0.0.0:${acc.port}

[${sectionId}_auth]
type=auth
auth_type=userpass
username=${acc.username}
password=<ENCRYPTED_VAULT_SECRET_${acc.id}>

[${sectionId}_aor]
type=aor
contact=sip:${acc.username}@${acc.domain}:${acc.port}
qualify_frequency=30

[${sectionId}_reg]
type=registration
transport=${sectionId}_transport
outbound_auth=${sectionId}_auth
server_uri=sip:${acc.domain}:${acc.port}
client_uri=sip:${acc.username}@${acc.domain}:${acc.port}
retry_interval=60

[${sectionId}_endpoint]
type=endpoint
transport=${sectionId}_transport
context=from-sip-trunk
disallow=all
allow=ulaw,alaw,opus
outbound_auth=${sectionId}_auth
aors=${sectionId}_aor
from_user=${acc.callerId.replace(/[^\d+]/g, '')}
from_domain=${acc.domain}
direct_media=no
dtmf_mode=rfc4733`;
  });

  return `; Auto-Generated by VoxPulse SIP Architect (Asterisk 20+ PJSIP)
; Generated on ${new Date().toISOString()}

${sections.join('\n\n')}\n`;
}

export function generateExtensionsConf(stasisApp = 'voxpulse-voice-engine'): string {
  return `; Asterisk Dialplan (/etc/asterisk/extensions.conf)
[general]
static=yes
writeprotect=no

[from-sip-trunk]
; Incoming SIP calls routed to ARI Stasis application for auto-answer, welcome playback & voicemail
exten => _X.,1,NoOp(Incoming SIP Call from \${CALLERID(num)} to \${EXTEN})
 same => n,Ringing()
 same => n,Stasis(${stasisApp},inbound,\${CALLERID(num)},\${EXTEN})
 same => n,Hangup()

[voxpulse-outbound]
; Automated Outbound Campaign & Direct SIP Call Handler via ARI
exten => _+1NXXNXXXXXX,1,NoOp(VoxPulse Outbound Consent-Verified Call to \${EXTEN})
 same => n,Set(CALLERID(all)=\${VOXPULSE_CID})
 same => n,Stasis(${stasisApp},outbound,\${EXTEN},\${VOXPULSE_RECORDING_ID})
 same => n,Hangup()
`;
}

export function generateDockerComposeConfig(): string {
  return `version: '3.9'

services:
  voxpulse-app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: voxpulse-web-api
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - ASTERISK_ARI_URL=http://asterisk:8088/ari
      - ASTERISK_ARI_USER=voxpulse_ari
      - ASTERISK_ARI_SECRET=\${ASTERISK_ARI_SECRET}
      - SIP_ENCRYPTION_KEY=\${SIP_ENCRYPTION_KEY}
    depends_on:
      - asterisk
      - postgres

  asterisk:
    image: andrius/asterisk:20-current
    container_name: voxpulse-asterisk-pbx
    restart: unless-stopped
    ports:
      - "5060:5060/udp"
      - "5060:5060/tcp"
      - "5061:5061/tcp"
      - "8088:8088/tcp"
      - "8089:8089/tcp"
      - "10000-10099:10000-10099/udp"
    volumes:
      - ./docker/asterisk/pjsip.conf:/etc/asterisk/pjsip.conf:ro
      - ./docker/asterisk/extensions.conf:/etc/asterisk/extensions.conf:ro
      - ./docker/asterisk/ari.conf:/etc/asterisk/ari.conf:ro
      - voxpulse-recordings:/var/spool/asterisk/recording

  postgres:
    image: postgres:16-alpine
    container_name: voxpulse-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: voxpulse_sip
      POSTGRES_USER: voxpulse
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  nginx:
    image: nginx:1.27-alpine
    container_name: voxpulse-nginx-tls
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - voxpulse-app

volumes:
  pgdata:
  voxpulse-recordings:
`;
}

export function generatePassengerConfig(
  domain = 'sip.yourdomain.com',
  appRoot = '/home/cpaneluser/voxpulse-sip'
): string {
  return `# ============================================================================
# 1. Passengerfile.json (Root of project: ${appRoot}/Passengerfile.json)
# ============================================================================
{
  "app_type": "node",
  "startup_file": "app.cjs",
  "environment": "production",
  "nodejs": "/usr/bin/node",
  "friendly_error_pages": false,
  "min_instances": 1,
  "max_pool_size": 4
}

# ============================================================================
# 2. cPanel "Setup Node.js App" (CloudLinux Phusion Passenger)
# ============================================================================
# - Node.js Version          : 22.x (or 20.x LTS)
# - Application Mode         : Production
# - Application Root         : ${appRoot}
# - Application URL          : https://${domain}
# - Application Startup File : app.cjs
# - Build Command            : npm install && npm run build
# - Firebase Persistence     : All collections & audio files auto-synced to
#                              Firebase Project "my-agent-507708"
#                              (Firestore DB: ai-studio-customercaremana-815d2499-8678-4614-9cd7-dbeac3731ede)

# ============================================================================
# 3. Nginx + Phusion Passenger Virtual Host (/etc/nginx/conf.d/voxpulse.conf)
# ============================================================================
server {
    listen 443 ssl http2;
    server_name ${domain};

    root ${appRoot}/dist;

    # Enable Phusion Passenger Node.js Engine
    passenger_enabled on;
    passenger_app_type node;
    passenger_app_root ${appRoot};
    passenger_startup_file app.cjs;
    passenger_app_env production;
    passenger_sticky_sessions on;

    # Environment Variables for SIP Vault & Asterisk ARI
    passenger_env_var NODE_ENV production;
    passenger_env_var FIREBASE_PROJECT_ID my-agent-507708;

    # WebSocket Upgrade Support for /ws/sip Real-Time Telemetry & Audio
    location /ws/sip {
        passenger_enabled on;
        passenger_app_ group_name voxpulse_ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# ============================================================================
# 4. Apache + Phusion Passenger VirtualHost (/etc/apache2/sites-enabled/voxpulse.conf)
# ============================================================================
<VirtualHost *:443>
    ServerName ${domain}
    DocumentRoot ${appRoot}/dist

    PassengerEnabled on
    PassengerAppType node
    PassengerAppRoot ${appRoot}
    PassengerStartupFile app.cjs
    PassengerAppEnv production

    <Directory ${appRoot}/dist>
        Allow from all
        Options -MultiViews
        Require all granted
    </Directory>
</VirtualHost>
`;
}

// --- ROLE-BASED ACCESS CONTROL (RBAC) ENGINE ---

export interface RoleDefinitionInfo {
  role: UserRole;
  title: string;
  badgeLabel: string;
  summary: string;
  allowedActions: RbacAction[];
}

export const ROLE_DEFINITIONS: Record<UserRole, RoleDefinitionInfo> = {
  admin: {
    role: 'admin',
    title: 'System Administrator',
    badgeLabel: 'ADMIN',
    summary:
      'Full access to SIP Trunks, Calls, Callbacks, Campaigns, Recordings, Users & Roles, and Firebase Cloud Settings.',
    allowedActions: [
      'manage_sip_accounts',
      'register_sip_accounts',
      'originate_calls',
      'originate_callbacks',
      'manage_contacts',
      'manage_recordings',
      'manage_campaigns',
      'control_campaigns',
      'manage_incoming_config',
      'manage_voicemails',
      'export_cdr',
      'manage_users_and_roles',
      'manage_firebase_and_system',
    ],
  },
  manager: {
    role: 'manager',
    title: 'Campaign & Operations Manager',
    badgeLabel: 'MANAGER',
    summary:
      'Full control over Campaigns, Voice Recordings, Contacts, Direct Calls, Callbacks, and Inbound IVR rules. Cannot delete SIP trunks or modify User Roles.',
    allowedActions: [
      'register_sip_accounts',
      'originate_calls',
      'originate_callbacks',
      'manage_contacts',
      'manage_recordings',
      'manage_campaigns',
      'control_campaigns',
      'manage_incoming_config',
      'manage_voicemails',
      'export_cdr',
    ],
  },
  operator: {
    role: 'operator',
    title: 'SIP Call Operator',
    badgeLabel: 'OPERATOR',
    summary:
      'Can originate Direct SIP Calls & Callbacks, start/pause Campaigns, manage Contacts, and review Voicemails. Cannot modify SIP Trunks or delete Campaigns.',
    allowedActions: [
      'register_sip_accounts',
      'originate_calls',
      'originate_callbacks',
      'manage_contacts',
      'control_campaigns',
      'manage_voicemails',
      'export_cdr',
    ],
  },
  viewer: {
    role: 'viewer',
    title: 'Compliance Auditor (Read-Only)',
    badgeLabel: 'VIEWER',
    summary:
      'Read-only inspection of Dashboard KPIs, Call Detail Records (CDR), CSV Exports, Consent Logs, and Voicemails. All calling and write actions are locked.',
    allowedActions: ['export_cdr'],
  },
};

export const DEFAULT_RBAC_MATRIX: RbacPermissionEntry[] = [
  {
    id: 'rbac-export_cdr',
    action: 'export_cdr',
    label: 'Export Call Detail Records (CSV) & Compliance Logs',
    category: 'Monitoring & Audit',
    roles: { admin: true, manager: true, operator: true, viewer: true },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-originate_calls',
    action: 'originate_calls',
    label: 'Originate Direct SIP Call & WebRTC Softphone',
    category: 'Voice Operations',
    roles: { admin: true, manager: true, operator: true, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-originate_callbacks',
    action: 'originate_callbacks',
    label: 'Originate Two-Legged Callback & RTP Conference Bridge',
    category: 'Voice Operations',
    roles: { admin: true, manager: true, operator: true, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_voicemails',
    action: 'manage_voicemails',
    label: 'Review, Mark Read & Delete Incoming Voicemails',
    category: 'Voice Operations',
    roles: { admin: true, manager: true, operator: true, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_contacts',
    action: 'manage_contacts',
    label: 'Create, Import CSV & Manage Contact DNC Consent',
    category: 'Campaigns & Media',
    roles: { admin: true, manager: true, operator: true, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_recordings',
    action: 'manage_recordings',
    label: 'Record, Upload & FFmpeg Convert Voice Recordings',
    category: 'Campaigns & Media',
    roles: { admin: true, manager: true, operator: false, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-control_campaigns',
    action: 'control_campaigns',
    label: 'Start, Pause, Resume & Stop Outbound Campaigns',
    category: 'Campaigns & Media',
    roles: { admin: true, manager: true, operator: true, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_campaigns',
    action: 'manage_campaigns',
    label: 'Create, Configure & Delete Outbound Campaigns',
    category: 'Campaigns & Media',
    roles: { admin: true, manager: true, operator: false, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_incoming_config',
    action: 'manage_incoming_config',
    label: 'Configure Inbound Auto-Answer & IVR Routing Rules',
    category: 'Infrastructure',
    roles: { admin: true, manager: true, operator: false, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-register_sip_accounts',
    action: 'register_sip_accounts',
    label: 'Register, Unregister & Test PJSIP Trunk Endpoints',
    category: 'Infrastructure',
    roles: { admin: true, manager: true, operator: true, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_sip_accounts',
    action: 'manage_sip_accounts',
    label: 'Add, Edit & Delete PJSIP Trunks',
    category: 'Infrastructure',
    roles: { admin: true, manager: false, operator: false, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_firebase_and_system',
    action: 'manage_firebase_and_system',
    label: 'Connect Firebase Auto-Sync & System Snapshots',
    category: 'Administration',
    roles: { admin: true, manager: false, operator: false, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
  {
    id: 'rbac-manage_users_and_roles',
    action: 'manage_users_and_roles',
    label: 'Create Users, Assign Roles & Suspend Accounts',
    category: 'Administration',
    roles: { admin: true, manager: false, operator: false, viewer: false },
    updatedAt: '2026-11-01T08:00:00Z',
  },
];

export function normalizeRbacActionKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export function validateRbacPermissionInput(input: {
  label?: string;
  category?: string;
  action?: string;
}): {
  valid: boolean;
  normalizedAction: string;
  errors: string[];
} {
  const errors: string[] = [];
  const label = String(input.label || '').trim();
  const category = String(input.category || '').trim();
  const rawAction = String(input.action || label).trim();
  const normalizedAction = normalizeRbacActionKey(rawAction);

  if (label.length < 3 || label.length > 140) {
    errors.push('Capability / security action label must be between 3 and 140 characters.');
  }
  if (category.length < 2 || category.length > 80) {
    errors.push('Domain / category must be between 2 and 80 characters.');
  }
  if (normalizedAction.length < 2) {
    errors.push('A valid capability action identifier is required.');
  }

  return {
    valid: errors.length === 0,
    normalizedAction,
    errors,
  };
}

export function canRolePerform(
  role: UserRole | null | undefined,
  action: RbacAction,
  customMatrix?: RbacPermissionEntry[]
): boolean {
  if (!role || !(role in ROLE_DEFINITIONS)) {
    return false;
  }
  if (Array.isArray(customMatrix)) {
    const matched = customMatrix.find(
      (entry) => entry.action === action || entry.id === action
    );
    if (!matched) {
      return false;
    }
    return Boolean(matched.roles?.[role]);
  }
  return ROLE_DEFINITIONS[role].allowedActions.includes(action);
}

export function getRolePermissions(
  role: UserRole | null | undefined,
  customMatrix?: RbacPermissionEntry[]
): Record<RbacAction, boolean> {
  const sourceMatrix =
    Array.isArray(customMatrix) && customMatrix.length > 0
      ? customMatrix
      : DEFAULT_RBAC_MATRIX;
  const map = {} as Record<RbacAction, boolean>;
  for (const row of sourceMatrix) {
    map[row.action] = canRolePerform(role, row.action, sourceMatrix);
  }
  return map;
}

export function validateUserRegistrationInput(input: {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  requirePassword?: boolean;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const role = String(input.role || 'operator');

  if (name.length < 2 || name.length > 100) {
    errors.push('Full name must be between 2 and 100 characters.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('A valid email address is required.');
  }
  if (input.requirePassword && password.length < 4) {
    errors.push('Password must be at least 4 characters.');
  }
  if (!['admin', 'manager', 'operator', 'viewer'].includes(role)) {
    errors.push('Role must be admin, manager, operator, or viewer.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validatePasswordResetInput(input: {
  email?: string;
  newPassword?: string;
  confirmPassword?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const email = String(input.email || '').trim().toLowerCase();
  const newPassword = String(input.newPassword || '');
  const confirmPassword =
    input.confirmPassword !== undefined ? String(input.confirmPassword) : newPassword;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('A valid registered email address is required.');
  }
  if (newPassword.length < 4) {
    errors.push('New password must be at least 4 characters.');
  }
  if (newPassword !== confirmPassword) {
    errors.push('New password and confirmation password do not match.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}



