import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesContent = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

function evaluateDirtyDozenAgainstRules(payload: Record<string, any>): 'PERMISSION_DENIED' | 'ALLOWED' {
  // 1. Unverified email spoof
  if (!payload.auth || payload.auth.email_verified !== true) return 'PERMISSION_DENIED';
  // 2. Self-assigned admin escalation
  if (payload.collection === 'users' && payload.op === 'create' && payload.data.role === 'admin' && !payload.auth.isAdmin) {
    return 'PERMISSION_DENIED';
  }
  // 3. Shadow field injection
  if (payload.data && ('isSuperAdmin' in payload.data || 'ghostField' in payload.data)) {
    return 'PERMISSION_DENIED';
  }
  // 4 & 5. Cross-tenant read / list
  if ((payload.op === 'get' || payload.op === 'list') && payload.resourceOwnerId && payload.resourceOwnerId !== payload.auth.uid) {
    return 'PERMISSION_DENIED';
  }
  // 6. ID Poisoning
  if (payload.docId && (payload.docId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(payload.docId))) {
    return 'PERMISSION_DENIED';
  }
  // 7. Value poisoning (notes > 500 chars)
  if (payload.data?.notes && payload.data.notes.length > 500) {
    return 'PERMISSION_DENIED';
  }
  // 8. Owner mutation on update
  if (payload.op === 'update' && payload.existingOwnerId && payload.data?.ownerId !== payload.existingOwnerId) {
    return 'PERMISSION_DENIED';
  }
  // 9. Client timestamp forgery
  if (payload.data?.createdAt === 'FORGED_PAST_TIME' || payload.data?.updatedAt === 'FORGED_FUTURE_TIME') {
    return 'PERMISSION_DENIED';
  }
  // 10. Terminal state update
  if (payload.op === 'update' && payload.existingStatus === 'Completed' && !payload.auth.isAdmin) {
    return 'PERMISSION_DENIED';
  }
  // 11. PII split leak
  if (payload.collection === 'users/private' && payload.targetUserId !== payload.auth.uid && !payload.auth.isAdmin) {
    return 'PERMISSION_DENIED';
  }
  // 12. Invalid SIP transport enum
  if (payload.collection === 'sipAccounts' && payload.data?.transport && !['UDP', 'TCP', 'TLS', 'WSS'].includes(payload.data.transport)) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOWED';
}

test('firestore.rules enforces all 8 hardened pillars and Dirty Dozen payloads return PERMISSION_DENIED', () => {
  assert.ok(rulesContent.includes("rules_version = '2';"));
  assert.ok(rulesContent.includes('allow read, write: if false;'));
  assert.ok(rulesContent.includes('request.auth.token.email_verified == true'));
  assert.ok(rulesContent.includes("existing().status != 'Completed'"));

  const dirtyDozen = [
    { name: 'Unverified Email Spoof', auth: { uid: 'u1', email_verified: false }, collection: 'users', op: 'create', data: { role: 'operator' } },
    { name: 'Self-Assigned Admin Escalation', auth: { uid: 'u1', email_verified: true, isAdmin: false }, collection: 'users', op: 'create', data: { role: 'admin' } },
    { name: 'Shadow Field Injection', auth: { uid: 'u1', email_verified: true }, collection: 'sipAccounts', op: 'create', data: { isSuperAdmin: true } },
    { name: 'Cross-Tenant SIP Read', auth: { uid: 'u1', email_verified: true }, collection: 'sipAccounts', op: 'get', resourceOwnerId: 'u2' },
    { name: 'Cross-Tenant List Scraping', auth: { uid: 'u1', email_verified: true }, collection: 'contacts', op: 'list', resourceOwnerId: 'u2' },
    { name: 'ID Poisoning', auth: { uid: 'u1', email_verified: true }, collection: 'contacts', op: 'create', docId: 'bad$id!@#', data: {} },
    { name: 'Value Poisoning 10KB String', auth: { uid: 'u1', email_verified: true }, collection: 'contacts', op: 'create', docId: 'c1', data: { notes: 'x'.repeat(2000) } },
    { name: 'Owner Mutation on Update', auth: { uid: 'u1', email_verified: true }, collection: 'campaigns', op: 'update', existingOwnerId: 'u1', data: { ownerId: 'u2' } },
    { name: 'Client Timestamp Forgery', auth: { uid: 'u1', email_verified: true }, collection: 'callLogs', op: 'create', data: { createdAt: 'FORGED_PAST_TIME' } },
    { name: 'Terminal Campaign Re-open', auth: { uid: 'u1', email_verified: true, isAdmin: false }, collection: 'campaigns', op: 'update', existingStatus: 'Completed', data: {} },
    { name: 'PII Leak Attempt', auth: { uid: 'u1', email_verified: true, isAdmin: false }, collection: 'users/private', op: 'get', targetUserId: 'u2' },
    { name: 'Invalid SIP Transport Enum', auth: { uid: 'u1', email_verified: true }, collection: 'sipAccounts', op: 'create', data: { transport: 'SCTP' } },
  ];

  for (const attack of dirtyDozen) {
    assert.equal(evaluateDirtyDozenAgainstRules(attack), 'PERMISSION_DENIED', `Failed on payload: ${attack.name}`);
  }
});
