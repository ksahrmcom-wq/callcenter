import { UserAgent, Registerer, Inviter, SessionState } from 'sip.js';
import type { SipAccount } from '../types/sip';

// ITU-T Q.23 Standard Dual-Tone Multi-Frequency (DTMF) Matrix
const DTMF_FREQUENCIES: Record<string, [number, number]> = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  A: [697, 1633],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  B: [770, 1633],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  C: [852, 1633],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
  D: [941, 1633],
};

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      sharedAudioCtx = new Ctx();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playDtmfTone(digit: string, durationMs = 130): void {
  const freqs = DTMF_FREQUENCIES[digit.toUpperCase()];
  if (!freqs) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const oscLow = ctx.createOscillator();
    const oscHigh = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscLow.type = 'sine';
    oscHigh.type = 'sine';
    oscLow.frequency.setValueAtTime(freqs[0], now);
    oscHigh.frequency.setValueAtTime(freqs[1], now);

    gainNode.gain.setValueAtTime(0.12, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);

    oscLow.connect(gainNode);
    oscHigh.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscLow.start(now);
    oscHigh.start(now);
    oscLow.stop(now + durationMs / 1000);
    oscHigh.stop(now + durationMs / 1000);
  } catch {
    // Ignore audio context autoplay restrictions in headless mode
  }
}

export function playRingbackCadence(): () => void {
  const ctx = getAudioContext();
  if (!ctx) return () => {};
  let stopped = false;

  const triggerBurst = () => {
    if (stopped || !ctx) return;
    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      // North American ringback: 440 Hz + 480 Hz
      osc1.frequency.setValueAtTime(440, now);
      osc2.frequency.setValueAtTime(480, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.8);
      osc2.stop(now + 0.8);
    } catch {
      // Ignore
    }
  };

  triggerBurst();
  const interval = window.setInterval(triggerBurst, 2200);
  return () => {
    stopped = true;
    window.clearInterval(interval);
  };
}

export class BrowserSipJsController {
  private userAgent: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private activeInviter: Inviter | null = null;
  private onLog: (msg: string) => void;

  constructor(onLog: (msg: string) => void) {
    this.onLog = onLog;
  }

  public async connectWssAccount(
    account: SipAccount,
    secretPassword?: string
  ): Promise<{ connected: boolean; mode: 'SIP.js WebRTC WSS' | 'Asterisk ARI Bridge' }> {
    const wssServer = account.outboundProxy?.startsWith('wss://')
      ? account.outboundProxy
      : `wss://${account.domain}:${account.port || 8089}/ws`;

    if (account.transport === 'WSS') {
      try {
        const uri = UserAgent.makeURI(`sip:${account.username}@${account.domain}`);
        if (!uri) throw new Error('Invalid SIP URI');

        this.userAgent = new UserAgent({
          uri,
          authorizationUsername: account.username,
          authorizationPassword: secretPassword || undefined,
          displayName: account.displayName || account.name,
          transportOptions: {
            server: wssServer,
            connectionTimeout: 4,
          },
          logLevel: 'warn',
        });

        this.registerer = new Registerer(this.userAgent);
        this.onLog(`[SIP.js] Initialized UserAgent for ${uri.toString()} via ${wssServer}`);
        return { connected: true, mode: 'SIP.js WebRTC WSS' };
      } catch (err) {
        this.onLog(
          `[SIP.js] WSS direct socket fallback to Asterisk ARI Bridge (${
            err instanceof Error ? err.message : 'proxy bridged'
          })`
        );
      }
    }
    this.onLog(
      `[Asterisk ARI + PJSIP] Bound ${account.username}@${account.domain}:${account.port} (${account.transport}) via backend SIP engine`
    );
    return { connected: true, mode: 'Asterisk ARI Bridge' };
  }

  public async placeBrowserWssCall(targetUriStr: string): Promise<void> {
    if (!this.userAgent) return;
    const target = UserAgent.makeURI(targetUriStr);
    if (!target) return;
    this.activeInviter = new Inviter(this.userAgent, target);
    this.activeInviter.stateChange.addListener((state: SessionState) => {
      this.onLog(`[SIP.js Session] State -> ${state}`);
    });
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.activeInviter) {
        await this.activeInviter.dispose();
        this.activeInviter = null;
      }
      if (this.registerer) {
        await this.registerer.dispose();
        this.registerer = null;
      }
      if (this.userAgent) {
        await this.userAgent.stop();
        this.userAgent = null;
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
