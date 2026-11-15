import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import {
  parseSipMessage,
  parseDigestChallenge,
  computeDigestAuthHeader,
  buildSdpOffer,
  parseSdpMediaEndpoint,
  extractMulawFramesFromWavDataUri,
  buildRtpPacket,
  buildRtpDtmfEventPacket,
  linear16ToMulaw,
  mulawToLinear16,
} from './sipCodecAndDigest.ts';
import type { SipAccount, CallStatus } from '../types/sip.ts';

export interface ResolvedSipEndpoint {
  host: string;
  port: number;
  domainHost: string;
  transport: 'UDP' | 'TCP' | 'TLS' | 'WSS';
}

export function cleanSipHostAndPort(
  domainInput: string,
  outboundProxyInput: string,
  defaultPort: number,
  transport: 'UDP' | 'TCP' | 'TLS' | 'WSS',
  loopbackPort?: number
): ResolvedSipEndpoint {
  const stripScheme = (s: string) =>
    s
      .trim()
      .replace(/^(sips?|udp|tcp|tls|wss?):\/?\/?/i, '')
      .replace(/\/.*$/, '')
      .trim();

  const cleanDomainRaw = stripScheme(domainInput);
  const domainParts = cleanDomainRaw.split(':');
  const domainHost = domainParts[0] || 'localhost';
  const domainPort = domainParts[1] ? Number(domainParts[1]) : defaultPort || 5060;

  if (loopbackPort) {
    return {
      host: '127.0.0.1',
      port: loopbackPort,
      domainHost,
      transport: 'UDP',
    };
  }

  const cleanProxyRaw = outboundProxyInput ? stripScheme(outboundProxyInput) : '';
  if (cleanProxyRaw && transport !== 'WSS') {
    const proxyParts = cleanProxyRaw.split(':');
    const host = proxyParts[0] || domainHost;
    const port = proxyParts[1] ? Number(proxyParts[1]) : domainPort;
    return { host, port: port || 5060, domainHost, transport };
  }

  return {
    host: domainHost,
    port: domainPort || 5060,
    domainHost,
    transport,
  };
}

export function formatDialStringForSip(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return '';
  const sipMatch = trimmed.match(/^sips?:([^@;>]+)/i);
  if (sipMatch) {
    return sipMatch[1].trim();
  }
  // Preserve leading '+' if typed, or exact digits (including leading '0' for local numbers)
  const hasLeadingPlus = trimmed.startsWith('+');
  const cleaned = trimmed.replace(/[^\d*#a-zA-Z_-]/g, '');
  return hasLeadingPlus ? `+${cleaned}` : cleaned;
}

async function discoverLocalIpForHost(targetHost: string, targetPort: number): Promise<string> {
  if (targetHost === '127.0.0.1' || targetHost === 'localhost') {
    return '127.0.0.1';
  }
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let settled = false;
    const done = (ip: string) => {
      if (settled) return;
      settled = true;
      try {
        sock.close();
      } catch {
        // ignore
      }
      resolve(ip || '127.0.0.1');
    };
    const timer = setTimeout(() => done('127.0.0.1'), 400);
    sock.once('error', () => {
      clearTimeout(timer);
      done('127.0.0.1');
    });
    try {
      sock.connect(targetPort || 5060, targetHost, () => {
        clearTimeout(timer);
        try {
          const addr = sock.address();
          done(typeof addr === 'object' && addr.address ? addr.address : '127.0.0.1');
        } catch {
          done('127.0.0.1');
        }
      });
    } catch {
      clearTimeout(timer);
      done('127.0.0.1');
    }
  });
}

function extractContactUri(contactHeader: string | undefined, fallbackUri: string): string {
  if (!contactHeader) return fallbackUri;
  const angleMatch = contactHeader.match(/<([^>]+)>/);
  if (angleMatch) return angleMatch[1];
  const bareMatch = contactHeader.match(/(sips?:[^\s;>,]+)/i);
  if (bareMatch) return bareMatch[1];
  return fallbackUri;
}

function extractTagFromHeader(headerVal: string | undefined): string {
  if (!headerVal) return '';
  const match = headerVal.match(/;tag=([^;\s>]+)/i);
  return match ? match[1] : '';
}

export interface SipRegisterResult {
  success: boolean;
  statusCode: number;
  reasonPhrase: string;
  latencyMs: number;
  txPackets: string[];
  rxPackets: string[];
}

export async function executeRealSipRegister(
  account: SipAccount,
  passwordPlain: string,
  unregister = false,
  timeoutMs = 4000,
  loopbackPort?: number
): Promise<SipRegisterResult> {
  const startMs = Date.now();
  const endpoint = cleanSipHostAndPort(
    account.domain,
    account.outboundProxy,
    account.port,
    account.transport,
    loopbackPort
  );

  let targetIp = endpoint.host;
  if (targetIp !== '127.0.0.1' && targetIp !== 'localhost') {
    try {
      const resolved = await dns.lookup(endpoint.host, { family: 4 });
      if (resolved?.address) targetIp = resolved.address;
    } catch {
      // Keep hostname if DNS lookup fails
    }
  } else {
    targetIp = '127.0.0.1';
  }

  const localIp = await discoverLocalIpForHost(targetIp, endpoint.port);
  const callId = `${crypto.randomBytes(8).toString('hex')}@${localIp}`;
  const fromTag = crypto.randomBytes(4).toString('hex');
  const expiresSec = unregister ? 0 : 3600;
  const requestUri = `sip:${endpoint.domainHost}`;
  const txPackets: string[] = [];
  const rxPackets: string[] = [];

  const buildRegisterPacket = (
    cseq: number,
    localPort: number,
    authHeaderLine?: string
  ): string => {
    const branch = `z9hG4bK-${crypto.randomBytes(5).toString('hex')}`;
    const proto = endpoint.transport === 'WSS' ? 'UDP' : endpoint.transport;
    const lines = [
      `REGISTER ${requestUri} SIP/2.0`,
      `Via: SIP/2.0/${proto} ${localIp}:${localPort};rport;branch=${branch}`,
      `Max-Forwards: 70`,
      `From: "${account.displayName || account.username}" <sip:${account.username}@${endpoint.domainHost}>;tag=${fromTag}`,
      `To: <sip:${account.username}@${endpoint.domainHost}>`,
      `Call-ID: ${callId}`,
      `CSeq: ${cseq} REGISTER`,
      `Contact: <sip:${account.username}@${localIp}:${localPort};transport=${proto.toLowerCase()}>`,
      `Expires: ${expiresSec}`,
      `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, MESSAGE, NOTIFY`,
      `User-Agent: VoxPulse-PJSIP/20.8.0`,
    ];
    if (authHeaderLine) {
      lines.push(authHeaderLine);
    }
    lines.push(`Content-Length: 0`, `\r\n`);
    return lines.join('\r\n');
  };

  return new Promise((resolve) => {
    let settled = false;
    let authAttempts = 0;
    let udpSock: dgram.Socket | null = null;
    let tcpSock: net.Socket | tls.TLSSocket | null = null;

    const finish = (
      success: boolean,
      statusCode: number,
      reasonPhrase: string
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (udpSock) udpSock.close();
      } catch {
        // ignore
      }
      try {
        if (tcpSock) tcpSock.destroy();
      } catch {
        // ignore
      }
      resolve({
        success,
        statusCode,
        reasonPhrase,
        latencyMs: Math.max(4, Date.now() - startMs),
        txPackets,
        rxPackets,
      });
    };

    const timer = setTimeout(() => {
      finish(
        false,
        408,
        `Request Timeout (No ${endpoint.transport} response from ${endpoint.host}:${endpoint.port})`
      );
    }, timeoutMs);

    const onIncomingMessage = (raw: string, localPort: number, sendFn: (pkt: string) => void) => {
      rxPackets.push(raw);
      const parsed = parseSipMessage(raw);
      if (!parsed.isResponse || !parsed.statusCode) return;

      if (parsed.statusCode === 100) {
        return;
      }

      if (
        (parsed.statusCode === 401 || parsed.statusCode === 407) &&
        authAttempts < 2 &&
        passwordPlain
      ) {
        authAttempts += 1;
        const challengeRaw =
          parsed.headers['www-authenticate'] || parsed.headers['proxy-authenticate'];
        const challenge = parseDigestChallenge(challengeRaw);
        if (challenge) {
          const headerKey =
            parsed.statusCode === 407 ? 'Proxy-Authorization' : 'Authorization';
          const digestVal = computeDigestAuthHeader({
            headerName: headerKey,
            username: account.username,
            password: passwordPlain,
            method: 'REGISTER',
            uri: requestUri,
            challenge,
            nc: `0000000${authAttempts}`,
          });
          const pkt2 = buildRegisterPacket(authAttempts + 1, localPort, `${headerKey}: ${digestVal}`);
          txPackets.push(pkt2);
          sendFn(pkt2);
          return;
        }
      }

      if (parsed.statusCode === 200) {
        finish(true, 200, parsed.reasonPhrase || 'OK');
      } else {
        finish(false, parsed.statusCode, parsed.reasonPhrase || 'SIP Registration Failed');
      }
    };

    if (endpoint.transport === 'TCP' || endpoint.transport === 'TLS') {
      const sendStream = (pkt: string) => {
        if (tcpSock && !tcpSock.destroyed) {
          tcpSock.write(Buffer.from(pkt, 'utf8'));
        }
      };
      const onConnect = () => {
        if (!tcpSock) return;
        const localPort = tcpSock.localPort || 5060;
        const pkt1 = buildRegisterPacket(1, localPort);
        txPackets.push(pkt1);
        sendStream(pkt1);
      };
      if (endpoint.transport === 'TLS') {
        tcpSock = tls.connect(
          {
            host: targetIp,
            port: endpoint.port,
            servername: endpoint.host,
            rejectUnauthorized: false,
          },
          onConnect
        );
      } else {
        tcpSock = net.connect({ host: targetIp, port: endpoint.port }, onConnect);
      }
      tcpSock.on('data', (chunk) => {
        const localPort = tcpSock?.localPort || 5060;
        onIncomingMessage(chunk.toString('utf8'), localPort, sendStream);
      });
      tcpSock.on('error', (err) => {
        finish(false, 503, `${endpoint.transport} Socket Error: ${err.message}`);
      });
    } else {
      udpSock = dgram.createSocket('udp4');
      const sendUdp = (pkt: string) => {
        if (udpSock) {
          udpSock.send(Buffer.from(pkt, 'utf8'), endpoint.port, targetIp);
        }
      };
      udpSock.on('error', (err) => {
        finish(false, 503, `UDP Socket Error: ${err.message}`);
      });
      udpSock.on('message', (msg) => {
        const addr = udpSock?.address();
        const localPort = typeof addr === 'object' ? addr.port : 5060;
        onIncomingMessage(msg.toString('utf8'), localPort, sendUdp);
      });
      udpSock.bind(0, () => {
        const addr = udpSock!.address();
        const localPort = typeof addr === 'object' ? addr.port : 5060;
        const pkt1 = buildRegisterPacket(1, localPort);
        txPackets.push(pkt1);
        sendUdp(pkt1);
      });
    }
  });
}

export interface PjsipCallCallbacks {
  onSipPacket: (
    direction: 'SIP_TX' | 'SIP_RX' | 'INFO' | 'WARN' | 'ERROR',
    method: string,
    summary: string,
    rawPacket?: string
  ) => void;
  onStateChange: (
    status: 'Dialing' | 'Ringing' | 'Answered' | 'PlayingAudio' | 'Ended',
    logLine: string,
    finalOutcome?: CallStatus,
    hangupCause?: string
  ) => void;
  onRemoteRtpAudio?: (pcmBase64WavChunk: string) => void;
}

export class ActivePjsipCallController {
  private sipSock: dgram.Socket | null = null;
  private tcpStream: net.Socket | tls.TLSSocket | null = null;
  private rtpSock: dgram.Socket | null = null;
  private rtpInterval: NodeJS.Timeout | null = null;
  private callTimeoutTimer: NodeJS.Timeout | null = null;

  private account: SipAccount;
  private passwordPlain: string;
  private dialedNumber: string;
  private endpoint: ResolvedSipEndpoint;
  private targetIp = '';
  private localIp = '127.0.0.1';
  private localSipPort = 5060;
  private localRtpPort = 16000;

  private regCallId = '';
  private regFromTag = '';
  private regAuthAttempts = 0;
  private inviteSent = false;

  private callId = '';
  private fromTag = '';
  private toTag = '';
  private inviteBranch = '';
  private inviteCseq = 1;
  private currentCseq = 1;
  private remoteContactUri = '';
  private remoteRtpIp = '';
  private remoteRtpPort = 0;

  private isAnswered = false;
  private isTerminated = false;
  private authAttempts = 0;
  private isMuted = false;

  // RTP state
  private rtpSeq = Math.floor(Math.random() * 10000);
  private rtpTimestamp = Math.floor(Math.random() * 100000);
  private rtpSsrc = crypto.randomBytes(4).readUInt32BE(0);
  private playbackFrames: Uint8Array[] = [];
  private playbackCursor = 0;
  private micFramesQueue: Uint8Array[] = [];
  private bridgedFramesQueue: Uint8Array[] = [];
  private bridgedPeer: ActivePjsipCallController | null = null;
  private autoDisconnectAfterPlayback = false;
  private simulatedOutcomeOption: CallStatus;
  private callbacks: PjsipCallCallbacks;

  constructor(params: {
    account: SipAccount;
    passwordPlain: string;
    destination: string;
    initialRecordingWavUri?: string;
    autoDisconnectAfterPlayback?: boolean;
    simulatedOutcomeOption?: CallStatus;
    loopbackPort?: number;
    callbacks: PjsipCallCallbacks;
  }) {
    this.account = params.account;
    this.passwordPlain = params.passwordPlain;
    this.dialedNumber = formatDialStringForSip(params.destination);
    this.endpoint = cleanSipHostAndPort(
      params.account.domain,
      params.account.outboundProxy,
      params.account.port,
      params.account.transport,
      params.loopbackPort
    );
    this.autoDisconnectAfterPlayback = Boolean(params.autoDisconnectAfterPlayback);
    this.simulatedOutcomeOption = params.simulatedOutcomeOption || 'Answered';
    this.callbacks = params.callbacks;

    if (params.initialRecordingWavUri) {
      this.playbackFrames = extractMulawFramesFromWavDataUri(params.initialRecordingWavUri);
    }
  }

  public async start(): Promise<void> {
    this.targetIp = this.endpoint.host;
    if (this.targetIp !== '127.0.0.1' && this.targetIp !== 'localhost') {
      try {
        const resolved = await dns.lookup(this.endpoint.host, { family: 4 });
        if (resolved?.address) {
          this.targetIp = resolved.address;
        }
      } catch {
        // fallback to hostname
      }
    } else {
      this.targetIp = '127.0.0.1';
    }

    this.localIp = await discoverLocalIpForHost(this.targetIp, this.endpoint.port);
    this.callId = `${crypto.randomBytes(8).toString('hex')}@${this.localIp}`;
    this.fromTag = crypto.randomBytes(4).toString('hex');
    this.regCallId = `reg-${crypto.randomBytes(6).toString('hex')}@${this.localIp}`;
    this.regFromTag = crypto.randomBytes(4).toString('hex');

    // 1. Bind real local UDP RTP socket
    this.rtpSock = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => {
      this.rtpSock!.bind(0, () => {
        const addr = this.rtpSock!.address();
        this.localRtpPort = typeof addr === 'object' ? addr.port : 16400;
        resolve();
      });
    });

    // Listen for incoming RTP audio packets from the remote party
    const inboundPcmBuffer: number[] = [];
    this.rtpSock.on('message', (msg) => {
      if (msg.length <= 12) return;
      const pt = msg[1] & 0x7f;
      if (pt !== 0 && pt !== 8) return;
      const payload = msg.subarray(12);
      // Forward RTP audio frame directly to bridged conference call leg if active
      if (this.bridgedPeer && !this.isMuted && !this.bridgedPeer.isTerminated) {
        this.bridgedPeer.pushBridgedMulawFrame(new Uint8Array(payload));
      }
      for (let i = 0; i < payload.length; i++) {
        inboundPcmBuffer.push(mulawToLinear16(payload[i]));
      }
      if (inboundPcmBuffer.length >= 1600 && this.callbacks.onRemoteRtpAudio) {
        const chunkSamples = inboundPcmBuffer.splice(0, 1600);
        const wavUri = this.encodePcmSamplesToWavDataUri(chunkSamples, 8000);
        this.callbacks.onRemoteRtpAudio(wavUri);
      }
    });

    // 2. Bind SIP signaling socket (UDP or TCP/TLS)
    if (this.endpoint.transport === 'TCP' || this.endpoint.transport === 'TLS') {
      await this.startStreamSipTransport();
    } else {
      await this.startUdpSipTransport();
    }

    // Ring / Invite timeout guard (45 seconds)
    this.callTimeoutTimer = setTimeout(() => {
      if (!this.isAnswered && !this.isTerminated) {
        this.callbacks.onStateChange(
          'Ended',
          `408 Request Timeout — No answer or response from ${this.endpoint.host}:${this.endpoint.port}`,
          'No Answer',
          '408 Request Timeout (No Response from SIP Server)'
        );
        this.hangupInternal(true);
      }
    }, 45000);
  }

  private async startUdpSipTransport(): Promise<void> {
    this.sipSock = dgram.createSocket('udp4');
    this.sipSock.on('error', (err) => {
      if (!this.isTerminated) {
        this.callbacks.onStateChange(
          'Ended',
          `UDP SIP Socket Error: ${err.message}`,
          'Failed',
          `UDP Error: ${err.message}`
        );
        this.cleanupSockets();
      }
    });

    this.sipSock.on('message', (msg) => {
      this.handleIncomingSipData(msg.toString('utf8'));
    });

    await new Promise<void>((resolve) => {
      this.sipSock!.bind(0, () => {
        const addr = this.sipSock!.address();
        this.localSipPort = typeof addr === 'object' ? addr.port : 5060;
        resolve();
      });
    });

    this.beginRegistrationAndInviteFlow();
  }

  private async startStreamSipTransport(): Promise<void> {
    return new Promise((resolve) => {
      const onConnect = () => {
        if (!this.tcpStream) return;
        this.localSipPort = this.tcpStream.localPort || 5060;
        this.beginRegistrationAndInviteFlow();
        resolve();
      };

      if (this.endpoint.transport === 'TLS') {
        this.tcpStream = tls.connect(
          {
            host: this.targetIp,
            port: this.endpoint.port,
            servername: this.endpoint.host,
            rejectUnauthorized: false,
          },
          onConnect
        );
      } else {
        this.tcpStream = net.connect(
          { host: this.targetIp, port: this.endpoint.port },
          onConnect
        );
      }

      this.tcpStream.on('data', (chunk) => {
        this.handleIncomingSipData(chunk.toString('utf8'));
      });

      this.tcpStream.on('error', (err) => {
        if (!this.isTerminated) {
          this.callbacks.onStateChange(
            'Ended',
            `${this.endpoint.transport} Connection Failed: ${err.message}`,
            'Failed',
            `${this.endpoint.transport} Error: ${err.message}`
          );
          this.cleanupSockets();
        }
        resolve();
      });
    });
  }

  private beginRegistrationAndInviteFlow() {
    // Bind Contact on the exact socket port via REGISTER first, then send INVITE when 200 OK arrives (or after 450ms fallback for trunks that don't use REGISTER)
    this.sendSocketRegister(1);
    setTimeout(() => {
      if (!this.inviteSent && !this.isTerminated) {
        this.inviteSent = true;
        this.sendInvite(1);
      }
    }, 450);
  }

  private sendSocketRegister(cseq: number, authHeaderLine?: string) {
    const branch = `z9hG4bK-${crypto.randomBytes(5).toString('hex')}`;
    const proto = this.endpoint.transport === 'WSS' ? 'UDP' : this.endpoint.transport;
    const requestUri = `sip:${this.endpoint.domainHost}`;
    const lines = [
      `REGISTER ${requestUri} SIP/2.0`,
      `Via: SIP/2.0/${proto} ${this.localIp}:${this.localSipPort};rport;branch=${branch}`,
      `Max-Forwards: 70`,
      `From: "${this.account.displayName || this.account.username}" <sip:${this.account.username}@${this.endpoint.domainHost}>;tag=${this.regFromTag}`,
      `To: <sip:${this.account.username}@${this.endpoint.domainHost}>`,
      `Call-ID: ${this.regCallId}`,
      `CSeq: ${cseq} REGISTER`,
      `Contact: <sip:${this.account.username}@${this.localIp}:${this.localSipPort};transport=${proto.toLowerCase()}>`,
      `Expires: 3600`,
      `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO`,
      `User-Agent: VoxPulse-PJSIP/20.8.0`,
    ];
    if (authHeaderLine) {
      lines.push(authHeaderLine);
    }
    lines.push(`Content-Length: 0`, `\r\n`);
    this.transmitSipPacket(
      lines.join('\r\n'),
      cseq > 1 ? 'REGISTER (Auth)' : 'REGISTER',
      `Binding SIP Contact ${this.account.username}@${this.localIp}:${this.localSipPort} on ${this.endpoint.host}:${this.endpoint.port}`
    );
  }

  private transmitSipPacket(packet: string, methodLabel: string, summary: string) {
    if (this.isTerminated) return;
    this.callbacks.onSipPacket('SIP_TX', methodLabel, summary, packet);
    const buf = Buffer.from(packet, 'utf8');
    if (this.tcpStream && !this.tcpStream.destroyed) {
      this.tcpStream.write(buf);
    } else if (this.sipSock) {
      this.sipSock.send(buf, this.endpoint.port, this.targetIp);
    }
  }

  private sendInvite(cseq: number, authHeaderLine?: string) {
    this.inviteSent = true;
    this.inviteCseq = cseq;
    this.currentCseq = cseq;
    this.inviteBranch = `z9hG4bK-${crypto.randomBytes(5).toString('hex')}`;
    const proto = this.endpoint.transport === 'WSS' ? 'UDP' : this.endpoint.transport;
    const requestUri = `sip:${this.dialedNumber}@${this.endpoint.domainHost}`;
    const sdpBody = buildSdpOffer(this.localIp, this.localRtpPort);
    const contentLen = Buffer.byteLength(sdpBody, 'utf8');

    const fromUser = this.account.username;
    const display = this.account.displayName || this.account.callerId || this.account.username;

    const headers = [
      `INVITE ${requestUri} SIP/2.0`,
      `Via: SIP/2.0/${proto} ${this.localIp}:${this.localSipPort};rport;branch=${this.inviteBranch}`,
      `Max-Forwards: 70`,
      `From: "${display}" <sip:${fromUser}@${this.endpoint.domainHost}>;tag=${this.fromTag}`,
      `To: <sip:${this.dialedNumber}@${this.endpoint.domainHost}>`,
      `Call-ID: ${this.callId}`,
      `CSeq: ${cseq} INVITE`,
      `Contact: <sip:${fromUser}@${this.localIp}:${this.localSipPort};transport=${proto.toLowerCase()}>`,
      `Allow: INVITE, ACK, CANCEL, BYE, OPTIONS, INFO, PRACK, UPDATE`,
      `Supported: replaces, timer`,
      `X-VoxPulse-Test-Outcome: ${this.simulatedOutcomeOption}`,
      `User-Agent: VoxPulse-PJSIP/20.8.0`,
    ];

    if (authHeaderLine) {
      headers.push(authHeaderLine);
    }

    headers.push(
      `Content-Type: application/sdp`,
      `Content-Length: ${contentLen}`,
      ``,
      sdpBody
    );

    const pkt = headers.join('\r\n');
    this.transmitSipPacket(
      pkt,
      cseq > 1 ? 'INVITE (Auth)' : 'INVITE',
      `INVITE ${requestUri} via ${this.endpoint.host}:${this.endpoint.port} (SDP RTP Port ${this.localRtpPort})`
    );
  }

  private sendAck(
    cseq: number,
    targetUri: string,
    toHeaderVal?: string,
    useInviteTransactionBranch = false
  ) {
    const proto = this.endpoint.transport === 'WSS' ? 'UDP' : this.endpoint.transport;
    // Per RFC 3261 17.1.1.3: Non-2xx ACK MUST reuse the INVITE Via branch; 2xx ACK uses a new branch
    const branch = useInviteTransactionBranch
      ? this.inviteBranch
      : `z9hG4bK-${crypto.randomBytes(5).toString('hex')}`;
    const fromUser = this.account.username;
    const display = this.account.displayName || this.account.callerId || fromUser;
    const toLine =
      toHeaderVal ||
      `<sip:${this.dialedNumber}@${this.endpoint.domainHost}>${this.toTag ? `;tag=${this.toTag}` : ''}`;

    const pkt = [
      `ACK ${targetUri} SIP/2.0`,
      `Via: SIP/2.0/${proto} ${this.localIp}:${this.localSipPort};rport;branch=${branch}`,
      `Max-Forwards: 70`,
      `From: "${display}" <sip:${fromUser}@${this.endpoint.domainHost}>;tag=${this.fromTag}`,
      `To: ${toLine}`,
      `Call-ID: ${this.callId}`,
      `CSeq: ${cseq} ACK`,
      `Contact: <sip:${fromUser}@${this.localIp}:${this.localSipPort};transport=${proto.toLowerCase()}>`,
      `User-Agent: VoxPulse-PJSIP/20.8.0`,
      `Content-Length: 0`,
      `\r\n`,
    ].join('\r\n');

    this.transmitSipPacket(pkt, 'ACK', `ACK ${targetUri} (CSeq ${cseq})`);
  }

  private handleIncomingSipData(rawChunk: string) {
    if (this.isTerminated) return;
    const parsed = parseSipMessage(rawChunk);

    // Handle incoming BYE or OPTIONS from remote SIP server during call
    if (!parsed.isResponse && parsed.method) {
      this.callbacks.onSipPacket(
        'SIP_RX',
        parsed.method,
        `Received ${parsed.method} from remote SIP endpoint`,
        rawChunk
      );

      if (parsed.method === 'BYE') {
        const okReply = [
          `SIP/2.0 200 OK`,
          `Via: ${parsed.headers['via'] || ''}`,
          `From: ${parsed.headers['from'] || ''}`,
          `To: ${parsed.headers['to'] || ''}`,
          `Call-ID: ${this.callId}`,
          `CSeq: ${parsed.headers['cseq'] || '1 BYE'}`,
          `Content-Length: 0`,
          `\r\n`,
        ].join('\r\n');
        this.transmitSipPacket(okReply, '200 OK (BYE)', '200 OK — Remote party hung up');
        this.isTerminated = true;
        this.callbacks.onStateChange(
          'Ended',
          'Remote party hung up (Received SIP BYE)',
          this.isAnswered ? 'Answered' : 'No Answer',
          '16 Normal Call Clearing (Remote BYE)'
        );
        this.cleanupSockets();
      } else if (parsed.method === 'OPTIONS') {
        const okReply = [
          `SIP/2.0 200 OK`,
          `Via: ${parsed.headers['via'] || ''}`,
          `From: ${parsed.headers['from'] || ''}`,
          `To: ${parsed.headers['to'] || ''};tag=${this.fromTag}`,
          `Call-ID: ${parsed.headers['call-id'] || this.callId}`,
          `CSeq: ${parsed.headers['cseq'] || '1 OPTIONS'}`,
          `Content-Length: 0`,
          `\r\n`,
        ].join('\r\n');
        this.transmitSipPacket(okReply, '200 OK', '200 OK (Keepalive OPTIONS)');
      }
      return;
    }

    if (!parsed.isResponse || !parsed.statusCode) return;

    const code = parsed.statusCode;
    const reason = parsed.reasonPhrase || '';
    const cseqHeader = (parsed.headers['cseq'] || '').toUpperCase();

    this.callbacks.onSipPacket(
      code >= 400 && code !== 401 && code !== 407 ? 'WARN' : 'SIP_RX',
      `${code} ${reason}`,
      `SIP/2.0 ${code} ${reason} (${cseqHeader})`,
      rawChunk
    );

    // Handle responses to our pre-call socket REGISTER
    if (cseqHeader.includes('REGISTER')) {
      if ((code === 401 || code === 407) && this.regAuthAttempts < 2 && this.passwordPlain) {
        this.regAuthAttempts += 1;
        const challengeRaw =
          parsed.headers['www-authenticate'] || parsed.headers['proxy-authenticate'];
        const challenge = parseDigestChallenge(challengeRaw);
        if (challenge) {
          const headerKey = code === 407 ? 'Proxy-Authorization' : 'Authorization';
          const digestVal = computeDigestAuthHeader({
            headerName: headerKey,
            username: this.account.username,
            password: this.passwordPlain,
            method: 'REGISTER',
            uri: `sip:${this.endpoint.domainHost}`,
            challenge,
            nc: `0000000${this.regAuthAttempts}`,
          });
          this.sendSocketRegister(this.regAuthAttempts + 1, `${headerKey}: ${digestVal}`);
          return;
        }
      }
      if (code === 200 && !this.inviteSent && !this.isTerminated) {
        this.inviteSent = true;
        this.sendInvite(1);
      }
      return;
    }

    const rxToTag = extractTagFromHeader(parsed.headers['to']);
    if (rxToTag) this.toTag = rxToTag;

    // 1. Provisional 100 Trying
    if (code === 100) {
      this.callbacks.onStateChange(
        'Dialing',
        `100 Trying received from ${this.endpoint.host}:${this.endpoint.port}`
      );
      return;
    }

    // 2. Provisional 180 Ringing / 183 Session Progress
    if (code === 180 || code === 183) {
      if (parsed.body) {
        const earlyMedia = parseSdpMediaEndpoint(parsed.body);
        if (earlyMedia) {
          this.remoteRtpIp = earlyMedia.remoteIp;
          this.remoteRtpPort = earlyMedia.remotePort;
        }
      }
      this.callbacks.onStateChange(
        'Ringing',
        `${code} ${reason} — Remote phone is ringing (waiting for 200 OK answer)`
      );
      return;
    }

    // 3. Digest Authentication Challenge (401 Unauthorized / 407 Proxy Authentication Required)
    if ((code === 401 || code === 407) && this.authAttempts < 3 && cseqHeader.includes('INVITE')) {
      this.authAttempts += 1;
      const reqUri = `sip:${this.dialedNumber}@${this.endpoint.domainHost}`;
      // Non-2xx ACK MUST use matching inviteBranch per RFC 3261 17.1.1.3
      this.sendAck(this.inviteCseq, reqUri, parsed.headers['to'], true);

      const challengeRaw =
        parsed.headers['www-authenticate'] || parsed.headers['proxy-authenticate'];
      const challenge = parseDigestChallenge(challengeRaw);

      if (challenge && this.passwordPlain) {
        const headerKey = code === 407 ? 'Proxy-Authorization' : 'Authorization';
        const digestVal = computeDigestAuthHeader({
          headerName: headerKey,
          username: this.account.username,
          password: this.passwordPlain,
          method: 'INVITE',
          uri: reqUri,
          challenge,
          nc: `0000000${this.authAttempts}`,
        });
        this.callbacks.onStateChange(
          'Dialing',
          `Authenticated ${code} ${reason} via MD5 Digest -> Sent INVITE (CSeq ${this.inviteCseq + 1})`
        );
        this.sendInvite(this.inviteCseq + 1, `${headerKey}: ${digestVal}`);
        return;
      }
    }

    // 4. 200 OK for INVITE -> Call Answered!
    if (code === 200 && cseqHeader.includes('INVITE')) {
      const fallbackUri = `sip:${this.dialedNumber}@${this.endpoint.domainHost}:${this.endpoint.port}`;
      this.remoteContactUri = extractContactUri(parsed.headers['contact'], fallbackUri);

      // Send mandatory 2xx ACK (new branch) to establish call dialog
      this.sendAck(this.inviteCseq, this.remoteContactUri, parsed.headers['to'], false);

      if (parsed.body) {
        const media = parseSdpMediaEndpoint(parsed.body);
        if (media) {
          this.remoteRtpIp = media.remoteIp;
          this.remoteRtpPort = media.remotePort;
        }
      }

      if (!this.isAnswered) {
        this.isAnswered = true;
        if (this.callTimeoutTimer) {
          clearTimeout(this.callTimeoutTimer);
          this.callTimeoutTimer = null;
        }
        this.startRtpMediaStream();
        const nextStatus = this.playbackFrames.length > 0 ? 'PlayingAudio' : 'Answered';
        this.callbacks.onStateChange(
          nextStatus,
          `200 OK — Call Answered! RTP G.711 u-law stream active -> ${this.remoteRtpIp || this.targetIp}:${this.remoteRtpPort || 'RTP'}`
        );
      }
      return;
    }

    // 5. Final Error Responses (4xx, 5xx, 6xx) on INVITE
    if (code >= 400 && cseqHeader.includes('INVITE')) {
      const reqUri = `sip:${this.dialedNumber}@${this.endpoint.domainHost}`;
      this.sendAck(this.inviteCseq, reqUri, parsed.headers['to'], true);

      this.isTerminated = true;
      const mappedStatus: CallStatus =
        code === 486 || code === 600
          ? 'Busy'
          : code === 603 || code === 403 || code === 401 || code === 407
          ? 'Rejected'
          : code === 408 || code === 480
          ? 'No Answer'
          : 'Failed';

      this.callbacks.onStateChange(
        'Ended',
        `SIP ${code} ${reason} — Call ended by remote SIP server`,
        mappedStatus,
        `SIP ${code} ${reason}`
      );
      this.cleanupSockets();
    }
  }

  private startRtpMediaStream() {
    if (this.rtpInterval) clearInterval(this.rtpInterval);
    if (this.isTerminated) return;
    const destIp =
      this.remoteRtpIp && this.remoteRtpIp !== '0.0.0.0' ? this.remoteRtpIp : this.targetIp;
    const destPort = this.remoteRtpPort || 16000;

    let isFirstPacket = true;
    // Send 160-byte G.711 mu-law frame every 20ms (50 packets/sec)
    this.rtpInterval = setInterval(() => {
      if (this.isTerminated || !this.rtpSock) return;

      let frame: Uint8Array | null = null;
      if (this.micFramesQueue.length > 0 && !this.isMuted) {
        frame = this.micFramesQueue.shift()!;
      } else if (this.bridgedFramesQueue.length > 0) {
        frame = this.bridgedFramesQueue.shift()!;
      } else if (this.playbackFrames.length > 0 && this.playbackCursor < this.playbackFrames.length) {
        frame = this.playbackFrames[this.playbackCursor];
        this.playbackCursor += 1;
        if (
          this.playbackCursor >= this.playbackFrames.length &&
          this.autoDisconnectAfterPlayback
        ) {
          this.hangup('16 Normal Call Clearing (Auto-Disconnect After Playback)');
          return;
        }
      } else {
        // Send G.711 mu-law silence (0xff) to keep NAT & RTP media path open
        frame = new Uint8Array(160).fill(0xff);
      }

      const pkt = buildRtpPacket(
        frame,
        this.rtpSeq++,
        this.rtpTimestamp,
        this.rtpSsrc,
        0,
        isFirstPacket
      );
      isFirstPacket = false;
      this.rtpTimestamp = (this.rtpTimestamp + 160) >>> 0;

      if (destPort > 0) {
        this.rtpSock.send(pkt, destPort, destIp);
      }
    }, 20);
  }

  public injectVoiceRecording(wavDataUri: string) {
    const frames = extractMulawFramesFromWavDataUri(wavDataUri);
    if (frames.length > 0) {
      this.playbackFrames = frames;
      this.playbackCursor = 0;
    }
  }

  public clearPlaybackQueue() {
    this.playbackFrames = [];
    this.playbackCursor = 0;
  }

  public pushBridgedMulawFrame(frame: Uint8Array) {
    if (this.isTerminated) return;
    const normalized = new Uint8Array(160).fill(0xff);
    normalized.set(frame.subarray(0, Math.min(160, frame.length)));
    if (this.bridgedFramesQueue.length >= 25) {
      this.bridgedFramesQueue.shift();
    }
    this.bridgedFramesQueue.push(normalized);
  }

  public bridgeRtpWith(peer: ActivePjsipCallController) {
    this.bridgedPeer = peer;
    peer.bridgedPeer = this;
    this.clearPlaybackQueue();
    peer.clearPlaybackQueue();
  }

  public getRtpEndpointInfo(): {
    localRtpPort: number;
    remoteRtpIp: string;
    remoteRtpPort: number;
    isBridged: boolean;
  } {
    return {
      localRtpPort: this.localRtpPort,
      remoteRtpIp: this.remoteRtpIp || this.targetIp,
      remoteRtpPort: this.remoteRtpPort || 16000,
      isBridged: Boolean(this.bridgedPeer),
    };
  }

  public pushBrowserMicPcm16(pcm16Samples: number[]) {
    if (this.isMuted || !pcm16Samples.length) return;
    const mulaw = new Uint8Array(pcm16Samples.length);
    for (let i = 0; i < pcm16Samples.length; i++) {
      mulaw[i] = linear16ToMulaw(pcm16Samples[i]);
    }
    for (let offset = 0; offset + 160 <= mulaw.length; offset += 160) {
      this.micFramesQueue.push(mulaw.subarray(offset, offset + 160));
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public sendDtmf(digit: string) {
    if (this.isTerminated) return;
    if (this.rtpSock && this.remoteRtpPort > 0) {
      const destIp =
        this.remoteRtpIp && this.remoteRtpIp !== '0.0.0.0' ? this.remoteRtpIp : this.targetIp;
      for (let i = 0; i < 3; i++) {
        const pkt = buildRtpDtmfEventPacket(
          digit,
          this.rtpSeq++,
          this.rtpTimestamp,
          this.rtpSsrc,
          160 * (i + 1),
          i === 2
        );
        this.rtpSock.send(pkt, this.remoteRtpPort, destIp);
      }
    }
    if (this.isAnswered) {
      this.currentCseq += 1;
      const proto = this.endpoint.transport === 'WSS' ? 'UDP' : this.endpoint.transport;
      const branch = `z9hG4bK-${crypto.randomBytes(5).toString('hex')}`;
      const targetUri =
        this.remoteContactUri || `sip:${this.dialedNumber}@${this.endpoint.domainHost}`;
      const body = `Signal=${digit}\r\nDuration=160\r\n`;
      const pkt = [
        `INFO ${targetUri} SIP/2.0`,
        `Via: SIP/2.0/${proto} ${this.localIp}:${this.localSipPort};rport;branch=${branch}`,
        `Max-Forwards: 70`,
        `From: <sip:${this.account.username}@${this.endpoint.domainHost}>;tag=${this.fromTag}`,
        `To: <sip:${this.dialedNumber}@${this.endpoint.domainHost}>${this.toTag ? `;tag=${this.toTag}` : ''}`,
        `Call-ID: ${this.callId}`,
        `CSeq: ${this.currentCseq} INFO`,
        `Content-Type: application/dtmf-relay`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        ``,
        body,
      ].join('\r\n');
      this.transmitSipPacket(pkt, 'INFO (DTMF)', `Sent DTMF '${digit}' via RFC 4733 + SIP INFO`);
    }
  }

  public hangup(hangupCause = '16 Normal Call Clearing (Operator Hangup)') {
    if (this.isTerminated) return;
    this.hangupInternal(false, hangupCause);
  }

  private hangupInternal(isTimeout: boolean, hangupCause = '16 Normal Call Clearing') {
    if (this.isTerminated) return;
    const proto = this.endpoint.transport === 'WSS' ? 'UDP' : this.endpoint.transport;
    const fromUser = this.account.username;
    const display = this.account.displayName || this.account.callerId || fromUser;

    if (!this.isAnswered) {
      const reqUri = `sip:${this.dialedNumber}@${this.endpoint.domainHost}`;
      const cancelPkt = [
        `CANCEL ${reqUri} SIP/2.0`,
        `Via: SIP/2.0/${proto} ${this.localIp}:${this.localSipPort};rport;branch=${this.inviteBranch}`,
        `Max-Forwards: 70`,
        `From: "${display}" <sip:${fromUser}@${this.endpoint.domainHost}>;tag=${this.fromTag}`,
        `To: <sip:${this.dialedNumber}@${this.endpoint.domainHost}>`,
        `Call-ID: ${this.callId}`,
        `CSeq: ${this.inviteCseq} CANCEL`,
        `User-Agent: VoxPulse-PJSIP/20.8.0`,
        `Content-Length: 0`,
        `\r\n`,
      ].join('\r\n');
      this.transmitSipPacket(cancelPkt, 'CANCEL', `CANCEL ${reqUri} (Aborting ringing call)`);
    } else {
      this.currentCseq += 1;
      const branch = `z9hG4bK-${crypto.randomBytes(5).toString('hex')}`;
      const targetUri =
        this.remoteContactUri || `sip:${this.dialedNumber}@${this.endpoint.domainHost}`;
      const byePkt = [
        `BYE ${targetUri} SIP/2.0`,
        `Via: SIP/2.0/${proto} ${this.localIp}:${this.localSipPort};rport;branch=${branch}`,
        `Max-Forwards: 70`,
        `From: "${display}" <sip:${fromUser}@${this.endpoint.domainHost}>;tag=${this.fromTag}`,
        `To: <sip:${this.dialedNumber}@${this.endpoint.domainHost}>${this.toTag ? `;tag=${this.toTag}` : ''}`,
        `Call-ID: ${this.callId}`,
        `CSeq: ${this.currentCseq} BYE`,
        `User-Agent: VoxPulse-PJSIP/20.8.0`,
        `Content-Length: 0`,
        `\r\n`,
      ].join('\r\n');
      this.transmitSipPacket(byePkt, 'BYE', `BYE ${targetUri} (${hangupCause})`);
    }

    this.isTerminated = true;
    if (!isTimeout) {
      this.callbacks.onStateChange(
        'Ended',
        `Call ended (${hangupCause})`,
        this.isAnswered ? 'Answered' : 'Rejected',
        hangupCause
      );
    }
    this.cleanupSockets();
  }

  private encodePcmSamplesToWavDataUri(samples: number[], sampleRate = 8000): string {
    const buffer = Buffer.alloc(44 + samples.length * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + samples.length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-32768, Math.min(32767, samples[i]));
      buffer.writeInt16LE(clamped, 44 + i * 2);
    }
    return `data:audio/wav;base64,${buffer.toString('base64')}`;
  }

  private cleanupSockets() {
    if (this.callTimeoutTimer) {
      clearTimeout(this.callTimeoutTimer);
      this.callTimeoutTimer = null;
    }
    if (this.rtpInterval) {
      clearInterval(this.rtpInterval);
      this.rtpInterval = null;
    }
    try {
      this.sipSock?.unref();
      this.rtpSock?.unref();
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        if (this.sipSock) {
          this.sipSock.close();
          this.sipSock = null;
        }
      } catch {
        // ignore
      }
      try {
        if (this.tcpStream) {
          this.tcpStream.destroy();
          this.tcpStream = null;
        }
      } catch {
        // ignore
      }
      try {
        if (this.rtpSock) {
          this.rtpSock.close();
          this.rtpSock = null;
        }
      } catch {
        // ignore
      }
    }, 80).unref();
  }
}

/**
 * Embedded Local RFC 3261 PJSIP UAS (User Agent Server) + RTP Media Endpoint.
 * Runs on 127.0.0.1 so local loopback trunks and automated verification tests
 * execute real UDP SIP signaling (REGISTER, INVITE, 401 Digest Challenge,
 * 100 Trying, 180 Ringing, 200 OK with SDP, ACK, CANCEL, BYE) and real RTP audio.
 */
export async function startLocalPjsipLoopbackServer(preferredPort = 5090): Promise<{
  port: number;
  close: () => void;
}> {
  const sipServer = dgram.createSocket('udp4');
  const rtpServer = dgram.createSocket('udp4');
  let rtpPort = 16090;

  await new Promise<void>((resolve) => {
    rtpServer.bind(0, '127.0.0.1', () => {
      const addr = rtpServer.address();
      if (typeof addr === 'object') rtpPort = addr.port;
      resolve();
    });
  });

  // Echo incoming RTP packets back to sender with a pleasant 440Hz harmonic confirmation tone or loopback
  rtpServer.on('message', (msg, rinfo) => {
    if (msg.length >= 12) {
      rtpServer.send(msg, rinfo.port, rinfo.address);
    }
  });

  const pendingTimers = new Map<string, NodeJS.Timeout[]>();

  sipServer.on('message', (msg, rinfo) => {
    const raw = msg.toString('utf8');
    const parsed = parseSipMessage(raw);
    if (parsed.isResponse || !parsed.method) return;

    const via = parsed.headers['via'] || '';
    const from = parsed.headers['from'] || '';
    const to = parsed.headers['to'] || '';
    const callId = parsed.headers['call-id'] || '';
    const cseq = parsed.headers['cseq'] || '';
    const auth = parsed.headers['authorization'] || parsed.headers['proxy-authorization'];
    const uasTag = `pjsip-uas-${callId.slice(0, 6)}`;
    const toWithTag = to.includes(';tag=') ? to : `${to};tag=${uasTag}`;

    const sendReply = (lines: string[]) => {
      const payload = lines.join('\r\n');
      sipServer.send(Buffer.from(payload, 'utf8'), rinfo.port, rinfo.address);
    };

    if (parsed.method === 'REGISTER') {
      if (!auth) {
        const nonce = crypto.randomBytes(8).toString('hex');
        sendReply([
          `SIP/2.0 401 Unauthorized`,
          `Via: ${via}`,
          `From: ${from}`,
          `To: ${toWithTag}`,
          `Call-ID: ${callId}`,
          `CSeq: ${cseq}`,
          `WWW-Authenticate: Digest realm="voxpulse-pjsip", nonce="${nonce}", algorithm=MD5, qop="auth"`,
          `Server: Asterisk PBX 20.8.0 / PJSIP-UAS`,
          `Content-Length: 0`,
          `\r\n`,
        ]);
        return;
      }

      sendReply([
        `SIP/2.0 200 OK`,
        `Via: ${via};received=${rinfo.address};rport=${rinfo.port}`,
        `From: ${from}`,
        `To: ${toWithTag}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq}`,
        `Contact: <sip:uas@127.0.0.1:${preferredPort}>;expires=3600`,
        `Server: Asterisk PBX 20.8.0 / PJSIP-UAS`,
        `Content-Length: 0`,
        `\r\n`,
      ]);
      return;
    }

    if (parsed.method === 'INVITE') {
      if (!auth) {
        const nonce = crypto.randomBytes(8).toString('hex');
        sendReply([
          `SIP/2.0 401 Unauthorized`,
          `Via: ${via}`,
          `From: ${from}`,
          `To: ${toWithTag}`,
          `Call-ID: ${callId}`,
          `CSeq: ${cseq}`,
          `WWW-Authenticate: Digest realm="voxpulse-pjsip", nonce="${nonce}", algorithm=MD5, qop="auth"`,
          `Server: Asterisk PBX 20.8.0 / PJSIP-UAS`,
          `Content-Length: 0`,
          `\r\n`,
        ]);
        return;
      }

      // Authenticated INVITE -> 100 Trying immediately
      sendReply([
        `SIP/2.0 100 Trying`,
        `Via: ${via}`,
        `From: ${from}`,
        `To: ${to}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq}`,
        `Server: Asterisk PBX 20.8.0 / PJSIP-UAS`,
        `Content-Length: 0`,
        `\r\n`,
      ]);

      const requestedOutcome = (parsed.headers['x-voxpulse-test-outcome'] || 'Answered') as CallStatus;
      const timers: NodeJS.Timeout[] = [];

      // 180 Ringing after 350ms
      timers.push(
        setTimeout(() => {
          sendReply([
            `SIP/2.0 180 Ringing`,
            `Via: ${via}`,
            `From: ${from}`,
            `To: ${toWithTag}`,
            `Call-ID: ${callId}`,
            `CSeq: ${cseq}`,
            `Contact: <sip:uas@127.0.0.1:${preferredPort}>`,
            `Server: Asterisk PBX 20.8.0 / PJSIP-UAS`,
            `Content-Length: 0`,
            `\r\n`,
          ]);
        }, 350)
      );

      // Final response after 1100ms
      timers.push(
        setTimeout(() => {
          if (requestedOutcome !== 'Answered') {
            const errorMap: Record<string, [number, string]> = {
              Busy: [486, 'Busy Here'],
              Rejected: [603, 'Decline'],
              'No Answer': [480, 'Temporarily Unavailable'],
              Failed: [503, 'Service Unavailable'],
            };
            const [errCode, errReason] = errorMap[requestedOutcome] || [486, 'Busy Here'];
            sendReply([
              `SIP/2.0 ${errCode} ${errReason}`,
              `Via: ${via}`,
              `From: ${from}`,
              `To: ${toWithTag}`,
              `Call-ID: ${callId}`,
              `CSeq: ${cseq}`,
              `Server: Asterisk PBX 20.8.0 / PJSIP-UAS`,
              `Content-Length: 0`,
              `\r\n`,
            ]);
            return;
          }

          const sdpAnswer = buildSdpOffer('127.0.0.1', rtpPort);
          const sdpLen = Buffer.byteLength(sdpAnswer, 'utf8');
          const addr = sipServer.address();
          const actualSipPort = typeof addr === 'object' ? addr.port : preferredPort;

          sendReply([
            `SIP/2.0 200 OK`,
            `Via: ${via}`,
            `From: ${from}`,
            `To: ${toWithTag}`,
            `Call-ID: ${callId}`,
            `CSeq: ${cseq}`,
            `Contact: <sip:uas@127.0.0.1:${actualSipPort}>`,
            `Server: Asterisk PBX 20.8.0 / PJSIP-UAS`,
            `Content-Type: application/sdp`,
            `Content-Length: ${sdpLen}`,
            ``,
            sdpAnswer,
          ]);
        }, 1100)
      );

      pendingTimers.set(callId, timers);
      return;
    }

    if (parsed.method === 'CANCEL') {
      const timers = pendingTimers.get(callId);
      if (timers) {
        timers.forEach((t) => clearTimeout(t));
        pendingTimers.delete(callId);
      }
      sendReply([
        `SIP/2.0 200 OK`,
        `Via: ${via}`,
        `From: ${from}`,
        `To: ${toWithTag}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq}`,
        `Content-Length: 0`,
        `\r\n`,
      ]);
      return;
    }

    if (parsed.method === 'BYE' || parsed.method === 'INFO' || parsed.method === 'OPTIONS') {
      const timers = pendingTimers.get(callId);
      if (timers) {
        timers.forEach((t) => clearTimeout(t));
        pendingTimers.delete(callId);
      }
      sendReply([
        `SIP/2.0 200 OK`,
        `Via: ${via}`,
        `From: ${from}`,
        `To: ${toWithTag}`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq}`,
        `Content-Length: 0`,
        `\r\n`,
      ]);
    }
  });

  const boundPort = await new Promise<number>((resolve) => {
    sipServer.once('error', () => {
      sipServer.bind(0, '127.0.0.1', () => {
        const addr = sipServer.address();
        resolve(typeof addr === 'object' ? addr.port : preferredPort);
      });
    });
    sipServer.bind(preferredPort, '127.0.0.1', () => {
      const addr = sipServer.address();
      resolve(typeof addr === 'object' ? addr.port : preferredPort);
    });
  });

  return {
    port: boundPort,
    close: () => {
      pendingTimers.forEach((timers) => timers.forEach((t) => clearTimeout(t)));
      pendingTimers.clear();
      try {
        sipServer.close();
      } catch {
        // ignore
      }
      try {
        rtpServer.close();
      } catch {
        // ignore
      }
    },
  };
}
