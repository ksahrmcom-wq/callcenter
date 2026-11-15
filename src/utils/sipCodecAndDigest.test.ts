import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSipMessage,
  parseDigestChallenge,
  computeDigestAuthHeader,
  buildSdpOffer,
  parseSdpMediaEndpoint,
  linear16ToMulaw,
  mulawToLinear16,
  buildRtpPacket,
  buildRtpDtmfEventPacket,
} from './sipCodecAndDigest';

test('parseSipMessage parses 401 Unauthorized and extracts WWW-Authenticate challenge', () => {
  const raw = [
    'SIP/2.0 401 Unauthorized',
    'Via: SIP/2.0/UDP 10.0.0.2:5060;branch=z9hG4bK-1234',
    'From: <sip:1001@sip.example.com>;tag=aa11',
    'To: <sip:1001@sip.example.com>;tag=bb22',
    'Call-ID: call-991@voxpulse',
    'CSeq: 1 REGISTER',
    'WWW-Authenticate: Digest realm="sip.example.com", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", qop="auth", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    'Content-Length: 0',
    '',
    '',
  ].join('\r\n');

  const parsed = parseSipMessage(raw);
  assert.equal(parsed.isResponse, true);
  assert.equal(parsed.statusCode, 401);
  assert.equal(parsed.reasonPhrase, 'Unauthorized');

  const challenge = parseDigestChallenge(parsed.headers['www-authenticate']);
  assert.ok(challenge);
  assert.equal(challenge.realm, 'sip.example.com');
  assert.equal(challenge.nonce, 'dcd98b7102dd2f0e8b11d0f600bfb0c093');
  assert.equal(challenge.qop, 'auth');

  const authHeader = computeDigestAuthHeader({
    username: '1001',
    password: 'MySecretPassword',
    method: 'REGISTER',
    uri: 'sip:sip.example.com:5060',
    challenge,
    nc: '00000001',
    cnonce: '0a4f113b',
  });
  assert.ok(authHeader.startsWith('Digest username="1001"'));
  assert.ok(authHeader.includes('realm="sip.example.com"'));
  assert.ok(authHeader.includes('response="'));
  assert.ok(authHeader.includes('qop=auth'));
});

test('buildSdpOffer and parseSdpMediaEndpoint round-trip RTP IP and port accurately', () => {
  const sdp = buildSdpOffer('203.0.113.45', 16402, '998877');
  const endpoint = parseSdpMediaEndpoint(sdp);
  assert.ok(endpoint);
  assert.equal(endpoint.remoteIp, '203.0.113.45');
  assert.equal(endpoint.remotePort, 16402);
  assert.equal(endpoint.payloadType, 0);
});

test('G.711 mu-law encoder and decoder preserve audio waveform polarity and amplitude', () => {
  const original = 12400;
  const encoded = linear16ToMulaw(original);
  const decoded = mulawToLinear16(encoded);
  assert.ok(Math.abs(decoded - original) < 500);

  const negativeOriginal = -12400;
  const negDecoded = mulawToLinear16(linear16ToMulaw(negativeOriginal));
  assert.ok(Math.abs(negDecoded - negativeOriginal) < 500);
});

test('buildRtpPacket and buildRtpDtmfEventPacket construct valid 12-byte RFC 3550 headers', () => {
  const pcmFrame = new Uint8Array(160).fill(0x7f);
  const rtp = buildRtpPacket(pcmFrame, 42, 320, 0x12345678, 0, true);
  assert.equal(rtp.length, 172);
  assert.equal(rtp[0], 0x80);
  assert.equal(rtp[1], 0x80); // Marker bit set, PT=0
  assert.equal(rtp.readUInt16BE(2), 42);
  assert.equal(rtp.readUInt32BE(4), 320);

  const dtmfPkt = buildRtpDtmfEventPacket('5', 43, 480, 0x12345678, 800, true);
  assert.equal(dtmfPkt.length, 16);
  assert.equal(dtmfPkt[1] & 0x7f, 101); // Payload type 101
  assert.equal(dtmfPkt[12], 5); // Digit 5
});

test('executeRealSipRegister and ActivePjsipCallController perform real UDP RFC 3261 Digest Auth and RTP media setup', async () => {
  const {
    startLocalPjsipLoopbackServer,
    executeRealSipRegister,
    ActivePjsipCallController,
  } = await import('./pjsipNetworkEngine.ts');

  const uas = await startLocalPjsipLoopbackServer(0);
  try {
    const testAccount = {
      id: 'test-sip-1',
      ownerId: 'user-1',
      name: 'Test PJSIP Trunk',
      domain: '127.0.0.1',
      username: '1001',
      passwordMasked: '••••••••',
      hasPassword: true,
      port: uas.port,
      transport: 'UDP' as const,
      outboundProxy: `127.0.0.1:${uas.port}`,
      displayName: 'Test Agent',
      callerId: '1001',
      status: 'Unregistered' as const,
      createdAt: '',
      updatedAt: '',
    };

    const regResult = await executeRealSipRegister(testAccount, 'SecretPass123', false, 2000);
    assert.equal(regResult.success, true);
    assert.equal(regResult.statusCode, 200);
    assert.equal(regResult.txPackets.length, 2); // CSeq 1 REGISTER + CSeq 2 Authenticated REGISTER

    const statesObserved: string[] = [];
    await new Promise<void>((resolve) => {
      const controller = new ActivePjsipCallController({
        account: testAccount,
        passwordPlain: 'SecretPass123',
        destination: '01712345678',
        callbacks: {
          onSipPacket: () => {},
          onStateChange: (status) => {
            statesObserved.push(status);
            if (status === 'Answered' || status === 'PlayingAudio') {
              controller.hangup('Test Complete');
              setTimeout(() => resolve(), 280);
            }
          },
        },
      });
      controller.start();
    });

    assert.ok(statesObserved.includes('Ringing'));
    assert.ok(statesObserved.includes('Answered'));

    // Test direct SIP account with NO outboundProxy defined
    const directAccount = {
      id: 'test-sip-direct',
      ownerId: 'user-1',
      name: 'Direct Peering Trunk',
      domain: `127.0.0.1:${uas.port}`,
      username: '1002',
      passwordMasked: '••••••••',
      hasPassword: true,
      port: uas.port,
      transport: 'UDP' as const,
      displayName: 'Direct Agent',
      callerId: '1002',
      status: 'Unregistered' as const,
      createdAt: '',
      updatedAt: '',
    };
    const directResult = await executeRealSipRegister(directAccount, 'SecretPass123', false, 2000);
    assert.equal(directResult.success, true);
    assert.equal(directResult.statusCode, 200);
  } finally {
    uas.close();
  }
});
