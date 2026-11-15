# VoxPulse SIP — Phusion Passenger Hosting, Firebase Cloud Persistence & Ubuntu Deployment Guide

## 1. System Architecture
```
+-------------------------------------------------------------------------+
|                 React + TypeScript + Tailwind + SIP.js SPA              |
|  - Direct WebRTC Softphone (SIP.js UserAgent + ITU-T Q.23 DTMF Synth)   |
|  - Two-Legged Callback & Automatic RTP Conference Bridge                |
|  - Dynamic Role-Based Access Control (RBAC) Permission Matrix           |
|  - Live WebSocket Call Monitor (/ws/sip)                                |
+------------------------------------+------------------------------------+
                                     | HTTPS / WSS (Passenger / Port 3000)
                                     v
+-------------------------------------------------------------------------+
|        Phusion Passenger + Node.js (`app.cjs` -> `server.js`)           |
|  - AES-256-GCM Credential Vault (Never exposes SIP passwords to UI)     |
|  - Consent & Do-Not-Call (DNC) Enforcement Gate                         |
|  - Outbound Campaign Scheduler (Concurrency, Intervals, Retries)        |
|  - FFmpeg / 8000Hz 16-bit Mono PCM Telephony Audio Transcoder           |
+-----------------+-----------------------------------+-------------------+
                  |UDP/TCP/TLS PJSIP + ARI            | Firebase Auto-Sync
                  v                                   v
+------------------------------------+  +---------------------------------+
|   Asterisk 20 PBX / External SIP   |  | Firebase Firestore & Storage    |
|  - UDP/TCP 5060, TLS 5061, WSS 8089|  | - Project: my-agent-507708      |
|  - RTP Media Bridge (10000-10099)  |  | - All Users, Roles, SIP Trunks, |
|                                    |  |   Audio Files, Campaigns, CDRs  |
+------------------------------------+  +---------------------------------+
```

---

## 2. Hosting with Phusion Passenger (cPanel / CloudLinux / Nginx / Apache)

This application is pre-configured for **Phusion Passenger** with both:
- **`app.cjs`**: CommonJS startup wrapper that boots the compiled `server.js` bundle in production (or falls back to `server.ts` via `tsx`).
- **`Passengerfile.json`**: Declarative Passenger configuration (`"app_type": "node"`, `"startup_file": "app.cjs"`, `"environment": "production"`).

### Option A: cPanel "Setup Node.js App" (Phusion Passenger)
1. Upload the project files to your cPanel directory (e.g., `/home/username/voxpulse-sip`).
2. Open **cPanel -> Setup Node.js App -> Create Application**:
   - **Node.js version**: `22.x` (or `20.x`)
   - **Application mode**: `Production`
   - **Application root**: `voxpulse-sip`
   - **Application URL**: Select your domain/subdomain
   - **Application startup file**: `app.cjs`
3. Click **Create**, then click **Run NPM Install** (or open cPanel Terminal and run):
   ```bash
   npm install
   npm run build
   ```
   This builds the frontend SPA into `dist/` and bundles the backend server into `server.js`.
4. Click **Restart** in the cPanel Node.js App manager.
5. Verify health status at `https://yourdomain.com/api/health`.

### Option B: Phusion Passenger Standalone / Nginx / Apache VPS
```bash
# 1. Install dependencies & build production bundle (dist/ + server.js)
npm install
npm run build

# 2. Start with Phusion Passenger Standalone (reads Passengerfile.json automatically)
passenger start

# Or start directly with Node.js:
NODE_ENV=production node app.cjs
```

---

## 3. Firebase Cloud Persistence (`my-agent-507708`)
- **Project ID**: `my-agent-507708`
- **Firestore Database**: `ai-studio-customercaremana-815d2499-8678-4614-9cd7-dbeac3731ede`
- **Storage Bucket**: `my-agent-507708.firebasestorage.app`
- **Auto-Synced Entities**:
  - `sipAccounts` (plus AES-256-GCM encrypted password vault)
  - `users` (all user accounts, roles, statuses, and password reset vault)
  - `rbacMatrix` (dynamic Role-Based Access Control capabilities across Admin, Manager, Operator, Viewer)
  - `contacts` (DNC & opt-in consent records)
  - `recordings` & `voicemails` (8000Hz 16-bit mono WAV audio files)
  - `campaigns`, `callbacks`, `callLogs`, and `incomingConfig`
- Any addition, edit, or deletion in the application is automatically synced to Firebase and mirrored to `.voxpulse-firebase-cloud.json` so data persists across Phusion Passenger restarts.
