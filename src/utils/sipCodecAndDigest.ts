import crypto from 'node:crypto';

export interface ParsedSipMessage {
  isResponse: boolean;
  statusCode?: number;
  reasonPhrase?: string;
  method?: string;
  requestUri?: string;
  headers: Record<string, string>;
  rawHeaders: Record<string, string[]>;
  body: string;
}

export function parseSipMessage(raw: string): ParsedSipMessage {
  const normalized = raw.replace(/\r\n/g, '\n');
  const splitIdx = normalized.indexOf('\n\n');
  const headerPart = splitIdx >= 0 ? normalized.slice(0, splitIdx) : normalized;
  const body = splitIdx >= 0 ? normalized.slice(splitIdx + 2) : '';

  const lines = headerPart.split('\n');
  const firstLine = (lines[0] || '').trim();
  const headers: Record<string, string> = {};
  const rawHeaders: Record<string, string[]> = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const lowerKey = key.toLowerCase();
      const val = line.slice(colonIdx + 1).trim();
      headers[lowerKey] = val;
      if (!rawHeaders[lowerKey]) rawHeaders[lowerKey] = [];
      rawHeaders[lowerKey].push(val);
    }
  }

  // Handle compact SIP headers (RFC 3261 Section 7.3.3)
  if (headers['v'] && !headers['via']) headers['via'] = headers['v'];
  if (headers['f'] && !headers['from']) headers['from'] = headers['f'];
  if (headers['t'] && !headers['to']) headers['to'] = headers['t'];
  if (headers['i'] && !headers['call-id']) headers['call-id'] = headers['i'];
  if (headers['m'] && !headers['contact']) headers['contact'] = headers['m'];
  if (headers['c'] && !headers['content-type']) headers['content-type'] = headers['c'];
  if (headers['l'] && !headers['content-length']) headers['content-length'] = headers['l'];

  if (firstLine.startsWith('SIP/2.0')) {
    const match = firstLine.match(/^SIP\/2\.0\s+(\d{3})\s*(.*)$/);
    return {
      isResponse: true,
      statusCode: match ? Number(match[1]) : 0,
      reasonPhrase: match ? match[2].trim() : '',
      headers,
      rawHeaders,
      body,
    };
  }

  const reqMatch = firstLine.match(/^([A-Z]+)\s+(\S+)\s+SIP\/2\.0$/);
  return {
    isResponse: false,
    method: reqMatch ? reqMatch[1] : firstLine.split(' ')[0] || 'UNKNOWN',
    requestUri: reqMatch ? reqMatch[2] : '',
    headers,
    rawHeaders,
    body,
  };
}

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

export function parseDigestChallenge(headerValue: string): DigestChallenge | null {
  if (!headerValue || !/digest/i.test(headerValue)) return null;
  const extract = (key: string): string | undefined => {
    const regex = new RegExp(`${key}\\s*=\\s*(?:"([^"]*)"|([^,\\s]+))`, 'i');
    const match = headerValue.match(regex);
    return match ? match[1] ?? match[2] : undefined;
  };
  const realm = extract('realm');
  const nonce = extract('nonce');
  if (!realm || !nonce) return null;
  return {
    realm,
    nonce,
    qop: extract('qop'),
    opaque: extract('opaque'),
    algorithm: extract('algorithm') || 'MD5',
  };
}

function md5Hex(input: string): string {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

export function computeDigestAuthHeader(params: {
  headerName?: 'Authorization' | 'Proxy-Authorization';
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: DigestChallenge;
  nc?: string;
  cnonce?: string;
}): string {
  const {
    username,
    password,
    method,
    uri,
    challenge,
    nc = '00000001',
    cnonce = crypto.randomBytes(6).toString('hex'),
  } = params;

  const ha1 = md5Hex(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5Hex(`${method}:${uri}`);

  const qopTokens = challenge.qop
    ? challenge.qop.split(',').map((t) => t.trim())
    : [];
  const useAuthQop = qopTokens.includes('auth');

  const responseHash = useAuthQop
    ? md5Hex(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : md5Hex(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `Digest username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${responseHash}"`,
    `algorithm=MD5`,
  ];

  if (challenge.opaque) {
    parts.push(`opaque="${challenge.opaque}"`);
  }
  if (useAuthQop) {
    parts.push(`qop=auth`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }

  return parts.join(', ');
}

export function buildSdpOffer(
  localIp: string,
  rtpPort: number,
  sessionId = String(Math.floor(Date.now() / 1000))
): string {
  return [
    `v=0`,
    `o=voxpulse ${sessionId} ${sessionId} IN IP4 ${localIp}`,
    `s=VoxPulse PJSIP Engine`,
    `c=IN IP4 ${localIp}`,
    `t=0 0`,
    `m=audio ${rtpPort} RTP/AVP 0 8 101`,
    `a=rtpmap:0 PCMU/8000`,
    `a=rtpmap:8 PCMA/8000`,
    `a=rtpmap:101 telephone-event/8000`,
    `a=fmtp:101 0-16`,
    `a=ptime:20`,
    `a=sendrecv`,
    ``,
  ].join('\r\n');
}

export interface RemoteRtpEndpoint {
  remoteIp: string;
  remotePort: number;
  payloadType: number;
}

export function parseSdpMediaEndpoint(sdp: string): RemoteRtpEndpoint | null {
  if (!sdp) return null;
  const lines = sdp.replace(/\r\n/g, '\n').split('\n');
  let remoteIp = '';
  let remotePort = 0;
  let payloadType = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('c=IN IP4 ')) {
      remoteIp = line.slice('c=IN IP4 '.length).split('/')[0].trim();
    } else if (line.startsWith('m=audio ')) {
      const parts = line.split(/\s+/);
      remotePort = Number(parts[1]) || 0;
      if (parts[3] !== undefined) {
        payloadType = Number(parts[3]) || 0;
      }
    }
  }

  if (!remoteIp || !remotePort) return null;
  return { remoteIp, remotePort, payloadType };
}

// ITU-T G.711 mu-law (PCMU) encoder: 16-bit signed linear PCM -> 8-bit mu-law byte
export function linear16ToMulaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  const expLut = [
    0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
  ];

  let pcm = sample;
  const sign = (pcm >> 8) & 0x80;
  if (sign !== 0) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;

  const exponent = expLut[(pcm >> 7) & 0xff];
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  const ulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return ulawByte;
}

// ITU-T G.711 mu-law (PCMU) decoder: 8-bit mu-law byte -> 16-bit signed linear PCM
export function mulawToLinear16(ulawByte: number): number {
  const u = ~ulawByte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign !== 0 ? -sample : sample;
}

export function extractMulawFramesFromWavDataUri(dataUri: string): Uint8Array[] {
  try {
    const commaIdx = dataUri.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
    const buf = Buffer.from(base64, 'base64');
    if (buf.length <= 44) return [];

    let channels = 1;
    let sampleRate = 8000;
    let bitsPerSample = 16;
    let dataOffset = 44;
    let dataByteLength = buf.length - 44;

    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
      let offset = 12;
      while (offset + 8 <= buf.length) {
        const chunkId = buf.toString('ascii', offset, offset + 4);
        const chunkSize = buf.readUInt32LE(offset + 4);
        if (chunkId === 'fmt ' && offset + 24 <= buf.length) {
          channels = Math.max(1, buf.readUInt16LE(offset + 10));
          sampleRate = Math.max(8000, buf.readUInt32LE(offset + 12));
          bitsPerSample = buf.readUInt16LE(offset + 22) || 16;
        } else if (chunkId === 'data') {
          dataOffset = offset + 8;
          dataByteLength = Math.min(chunkSize, buf.length - dataOffset);
          break;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
      }
    }

    const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
    const blockAlign = channels * bytesPerSample;
    const totalInputFrames = Math.floor(dataByteLength / blockAlign);
    if (totalInputFrames <= 0) return [];

    const resampleRatio = sampleRate / 8000;
    const outputSampleCount = Math.floor(totalInputFrames / resampleRatio);
    const mulawBytes = new Uint8Array(outputSampleCount);

    for (let i = 0; i < outputSampleCount; i++) {
      const srcFrameIdx = Math.min(totalInputFrames - 1, Math.floor(i * resampleRatio));
      const pos = dataOffset + srcFrameIdx * blockAlign;
      let sample16 = 0;
      if (bitsPerSample === 16 && pos + 2 <= buf.length) {
        sample16 = buf.readInt16LE(pos);
      } else if (bitsPerSample === 8 && pos + 1 <= buf.length) {
        sample16 = (buf.readUInt8(pos) - 128) * 256;
      }
      mulawBytes[i] = linear16ToMulaw(sample16);
    }

    // Slice into 20ms frames at 8000 Hz = 160 bytes per RTP packet
    const frames: Uint8Array[] = [];
    for (let offset = 0; offset + 160 <= mulawBytes.length; offset += 160) {
      frames.push(mulawBytes.subarray(offset, offset + 160));
    }
    return frames;
  } catch {
    return [];
  }
}

export function buildRtpPacket(
  payload: Uint8Array,
  seqNum: number,
  timestamp: number,
  ssrc: number,
  payloadType = 0,
  marker = false
): Buffer {
  const header = Buffer.alloc(12);
  header[0] = 0x80; // Version 2, P=0, X=0, CC=0
  header[1] = (marker ? 0x80 : 0x00) | (payloadType & 0x7f);
  header.writeUInt16BE(seqNum & 0xffff, 2);
  header.writeUInt32BE(timestamp >>> 0, 4);
  header.writeUInt32BE(ssrc >>> 0, 8);
  return Buffer.concat([header, Buffer.from(payload)]);
}

// RFC 4733 RTP DTMF Event Packet Builder (Payload Type 101)
export function buildRtpDtmfEventPacket(
  digit: string,
  seqNum: number,
  timestamp: number,
  ssrc: number,
  durationSamples = 800,
  endOfEvent = false
): Buffer {
  const dtmfMap: Record<string, number> = {
    '0': 0,
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    '7': 7,
    '8': 8,
    '9': 9,
    '*': 10,
    '#': 11,
    A: 12,
    B: 13,
    C: 14,
    D: 15,
  };
  const eventCode = dtmfMap[digit.toUpperCase()] ?? 0;
  const payload = Buffer.alloc(4);
  payload[0] = eventCode;
  payload[1] = (endOfEvent ? 0x80 : 0x00) | 10; // E-bit + volume 10
  payload.writeUInt16BE(durationSamples & 0xffff, 2);
  return buildRtpPacket(payload, seqNum, timestamp, ssrc, 101, !endOfEvent);
}
