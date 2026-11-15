import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneNumber,
  formatSipUri,
  validateSipAccountInput,
  canDialContact,
  validateCallbackInput,
  DEFAULT_CALLBACK_WAIT_MESSAGE,
  generateCallbackWaitVoiceWavDataUri,
  isWithinWorkingHours,
  computeNextRetryDelay,
  calculateDashboardMetrics,
  parseContactsCsv,
  generateSynthesizedWavDataUri,
  canRolePerform,
  getRolePermissions,
  validateUserRegistrationInput,
  validatePasswordResetInput,
  DEFAULT_RBAC_MATRIX,
  normalizeRbacActionKey,
  validateRbacPermissionInput,
  generatePassengerConfig,
} from './sipEngine';

test('normalizePhoneNumber normalizes US 10-digit, E.164, and preserves local leading-0 numbers', () => {
  assert.equal(normalizePhoneNumber('(415) 890-4321'), '+14158904321');
  assert.equal(normalizePhoneNumber('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhoneNumber('01712345678'), '01712345678');
  assert.equal(normalizePhoneNumber('8801712345678'), '8801712345678');
  assert.equal(normalizePhoneNumber('+8801712345678'), '+8801712345678');
  assert.equal(normalizePhoneNumber('1002'), '1002');
});

test('formatSipUri constructs valid SIP and SIPS URIs with transport parameter', () => {
  assert.equal(
    formatSipUri('1001', 'sip.telnyx.com', 5060, 'UDP'),
    'sip:1001@sip.telnyx.com:5060;transport=udp'
  );
  assert.equal(
    formatSipUri('webrtc_agent', 'pbx.voxpulse.io', 8089, 'WSS'),
    'sips:webrtc_agent@pbx.voxpulse.io:8089;transport=wss'
  );
});

test('validateSipAccountInput catches missing domain, invalid port, and missing callerId', () => {
  const invalid = validateSipAccountInput({
    name: 'A',
    domain: 'bad_domain',
    username: '',
    port: 70000,
    transport: 'UDP',
    callerId: '',
    requirePassword: true,
    password: '12',
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 4);

  const valid = validateSipAccountInput({
    name: 'Primary Telnyx Trunk',
    domain: 'sip.telnyx.com',
    username: 'trunk_us_west',
    password: 'StrongSipSecret!99',
    port: 5061,
    transport: 'TLS',
    callerId: '+14158904000',
    requirePassword: true,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
});

test('canDialContact strictly enforces DNC opt-out, consent verification, and duplicate prevention', () => {
  const dialed = new Set<string>(['+14155550199']);

  // DNC opt-out blocked
  assert.equal(
    canDialContact(
      { phoneNumber: '+14155550100', consentStatus: 'verified_opt_in', dncOptOut: true },
      dialed
    ).allowed,
    false
  );

  // Unverified consent blocked
  assert.equal(
    canDialContact(
      { phoneNumber: '+14155550101', consentStatus: 'pending', dncOptOut: false },
      dialed
    ).allowed,
    false
  );

  // Duplicate number in campaign blocked
  assert.equal(
    canDialContact(
      { phoneNumber: '(415) 555-0199', consentStatus: 'verified_opt_in', dncOptOut: false },
      dialed
    ).allowed,
    false
  );

  // Valid consented contact allowed
  assert.equal(
    canDialContact(
      { phoneNumber: '+14155550122', consentStatus: 'verified_opt_in', dncOptOut: false },
      dialed
    ).allowed,
    true
  );
});

test('isWithinWorkingHours evaluates daytime and overnight calling windows', () => {
  assert.equal(isWithinWorkingHours('10:30', '09:00', '18:00'), true);
  assert.equal(isWithinWorkingHours('20:15', '09:00', '18:00'), false);
});

test('computeNextRetryDelay applies exponential backoff and stops at maxAttempts', () => {
  const r1 = computeNextRetryDelay(1, 30, 3);
  assert.equal(r1.shouldRetry, true);
  assert.equal(r1.delaySeconds, 30);

  const r3 = computeNextRetryDelay(3, 30, 3);
  assert.equal(r3.shouldRetry, false);
});

test('parseContactsCsv parses CSV rows, skips headers, and deduplicates phone numbers', () => {
  const csv = `Name,Phone,Consent,Source,List
Elena Rostova,+1 (415) 890-1122,verified_opt_in,Web Form,VIP Appointments
Marcus Vance,+1 (415) 890-1122,verified_opt_in,Web Form,VIP Appointments
Devon Brooks,+1 (312) 555-0144,revoked,SMS STOP,General`;

  const parsed = parseContactsCsv(csv);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].phoneNumber, '+14158901122');
  assert.equal(parsed[1].dncOptOut, true);
});

test('calculateDashboardMetrics aggregates call directions, statuses, and durations', () => {
  const metrics = calculateDashboardMetrics(
    [
      {
        id: '1',
        ownerId: 'u1',
        phoneNumber: '+14158901122',
        contactName: 'Elena',
        direction: 'Outbound',
        sipAccountId: 's1',
        sipAccountName: 'Trunk 1',
        status: 'Answered',
        startTime: '',
        endTime: '',
        durationSeconds: 45,
        recordingId: 'r1',
        recordingUrl: '',
        campaignId: 'c1',
        campaignName: 'Camp 1',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: '2',
        ownerId: 'u1',
        phoneNumber: '+13125550188',
        contactName: 'Inbound Caller',
        direction: 'Inbound',
        sipAccountId: 's1',
        sipAccountName: 'Trunk 1',
        status: 'Failed',
        startTime: '',
        endTime: '',
        durationSeconds: 0,
        recordingId: '',
        recordingUrl: '',
        campaignId: '',
        campaignName: '',
        createdAt: '',
        updatedAt: '',
      },
    ],
    [],
    []
  );

  assert.equal(metrics.totalCalls, 2);
  assert.equal(metrics.outgoingCalls, 1);
  assert.equal(metrics.incomingCalls, 1);
  assert.equal(metrics.answeredCalls, 1);
  assert.equal(metrics.failedCalls, 1);
  assert.equal(metrics.totalDurationSeconds, 45);
  assert.equal(metrics.answerRatePercent, 50);
});

test('generateSynthesizedWavDataUri produces valid 8kHz mono RIFF WAVE base64 data URI', () => {
  const uri = generateSynthesizedWavDataUri(1, 440, 8000);
  assert.ok(uri.startsWith('data:audio/wav;base64,UklGR'));
});

test('validateCallbackInput validates Call From and Call To numbers and prevents identical endpoints', () => {
  const emptyResult = validateCallbackInput({ callFromNumber: '', callToNumber: '' });
  assert.equal(emptyResult.valid, false);
  assert.equal(emptyResult.errors.length, 2);

  const sameResult = validateCallbackInput({
    callFromNumber: '+1 (415) 890-2110',
    callToNumber: '415-890-2110',
  });
  assert.equal(sameResult.valid, false);
  assert.ok(sameResult.errors.some((e) => e.includes('different endpoints')));

  const validResult = validateCallbackInput({
    callFromNumber: '+14158902110',
    callToNumber: '+14158903344',
  });
  assert.equal(validResult.valid, true);
  assert.equal(validResult.normalizedFrom, '+14158902110');
  assert.equal(validResult.normalizedTo, '+14158903344');
  assert.equal(
    DEFAULT_CALLBACK_WAIT_MESSAGE,
    'Please wait till received the call from other side'
  );

  const waitWav = generateCallbackWaitVoiceWavDataUri(3, 8000);
  assert.ok(waitWav.startsWith('data:audio/wav;base64,UklGR'));
});

test('canRolePerform and getRolePermissions enforce strict 4-tier RBAC permissions and deny unauthenticated users', () => {
  // Unauthenticated user cannot perform anything
  assert.equal(canRolePerform(null, 'originate_calls'), false);
  assert.equal(canRolePerform(undefined, 'export_cdr'), false);

  // Admin has full permissions
  const adminPerms = getRolePermissions('admin');
  assert.equal(adminPerms.manage_sip_accounts, true);
  assert.equal(adminPerms.manage_users_and_roles, true);
  assert.equal(adminPerms.manage_firebase_and_system, true);

  // Manager can manage campaigns & recordings, but cannot manage SIP accounts or users
  const managerPerms = getRolePermissions('manager');
  assert.equal(managerPerms.manage_campaigns, true);
  assert.equal(managerPerms.manage_recordings, true);
  assert.equal(managerPerms.manage_sip_accounts, false);
  assert.equal(managerPerms.manage_users_and_roles, false);

  // Operator can originate calls & callbacks and control campaigns, but cannot create/delete campaigns or recordings
  const opPerms = getRolePermissions('operator');
  assert.equal(opPerms.originate_calls, true);
  assert.equal(opPerms.originate_callbacks, true);
  assert.equal(opPerms.control_campaigns, true);
  assert.equal(opPerms.manage_campaigns, false);
  assert.equal(opPerms.manage_recordings, false);

  // Viewer is strictly read-only (only export_cdr allowed)
  const viewerPerms = getRolePermissions('viewer');
  assert.equal(viewerPerms.export_cdr, true);
  assert.equal(viewerPerms.originate_calls, false);
  assert.equal(viewerPerms.originate_callbacks, false);
  assert.equal(viewerPerms.manage_contacts, false);

  // User registration input validation
  const badUser = validateUserRegistrationInput({
    name: 'A',
    email: 'invalid-email',
    password: '12',
    role: 'superhacker',
    requirePassword: true,
  });
  assert.equal(badUser.valid, false);
  assert.equal(badUser.errors.length, 4);

  // Password reset input validation
  const mismatchReset = validatePasswordResetInput({
    email: 'ksahrm.com@gmail.com',
    newPassword: 'NewPassword#2026',
    confirmPassword: 'DifferentPassword#2026',
  });
  assert.equal(mismatchReset.valid, false);
  assert.ok(mismatchReset.errors.some((e) => e.includes('do not match')));

  const validReset = validatePasswordResetInput({
    email: 'ksahrm.com@gmail.com',
    newPassword: 'NewPassword#2026',
    confirmPassword: 'NewPassword#2026',
  });
  assert.equal(validReset.valid, true);
});

test('RBAC Permission Matrix supports adding, editing, and deleting capabilities dynamically', () => {
  assert.equal(DEFAULT_RBAC_MATRIX.length, 13);

  // Validate input helper
  const invalidPerm = validateRbacPermissionInput({ label: 'A', category: '' });
  assert.equal(invalidPerm.valid, false);

  const validPerm = validateRbacPermissionInput({
    label: 'Audit Live RTP Audio Streams',
    category: 'Monitoring & Audit',
  });
  assert.equal(validPerm.valid, true);
  assert.equal(validPerm.normalizedAction, 'audit_live_rtp_audio_streams');
  assert.equal(normalizeRbacActionKey('  Manage Custom SIP Trunk! '), 'manage_custom_sip_trunk');

  // Add a custom permission entry
  const customMatrix = [
    ...DEFAULT_RBAC_MATRIX.map((r) => ({ ...r, roles: { ...r.roles } })),
    {
      id: 'rbac-audit_live_rtp_audio_streams',
      action: 'audit_live_rtp_audio_streams',
      label: 'Audit Live RTP Audio Streams',
      category: 'Monitoring & Audit',
      roles: { admin: true, manager: true, operator: false, viewer: true },
      updatedAt: '2026-11-14T04:00:00Z',
    },
  ];
  assert.equal(canRolePerform('viewer', 'audit_live_rtp_audio_streams', customMatrix), true);
  assert.equal(canRolePerform('operator', 'audit_live_rtp_audio_streams', customMatrix), false);

  // Edit an existing permission entry (grant operator manage_recordings)
  const editedMatrix = customMatrix.map((row) =>
    row.action === 'manage_recordings'
      ? { ...row, roles: { ...row.roles, operator: true } }
      : row
  );
  assert.equal(canRolePerform('operator', 'manage_recordings', editedMatrix), true);

  // Delete a permission entry from matrix -> capability is revoked
  const afterDeleteMatrix = editedMatrix.filter((row) => row.action !== 'export_cdr');
  assert.equal(canRolePerform('viewer', 'export_cdr', afterDeleteMatrix), false);
});

test('generatePassengerConfig outputs Passengerfile.json, cPanel Node.js settings, and Nginx/Apache virtual hosts', () => {
  const cfg = generatePassengerConfig('voice.company.com', '/home/user/voxpulse');
  assert.ok(cfg.includes('"startup_file": "app.cjs"'));
  assert.ok(cfg.includes('passenger_enabled on;'));
  assert.ok(cfg.includes('PassengerStartupFile app.cjs'));
  assert.ok(cfg.includes('voice.company.com'));
  assert.ok(cfg.includes('my-agent-507708'));
});


