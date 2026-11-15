# Firestore Security Specification (Phase 0 & Red Team Audit)

## 1. Data Invariants
1. **Global Default-Deny**: All paths not explicitly matched deny both read and write (`allow read, write: if false;`).
2. **Verified Identity**: All writes require `request.auth != null && request.auth.token.email_verified == true`.
3. **Owner Isolation & No Blanket Reads**: Every collection (`sipAccounts`, `contacts`, `recordings`, `campaigns`, `callLogs`, `voicemails`) enforces `resource.data.ownerId == request.auth.uid` on both `get` and `list`. No `allow list: if isSignedIn()` blanket rules exist.
4. **PII Split Isolation**: User emails are stored strictly in `/users/{userId}/private/{docId}` and restricted to `isOwner(userId) || isAdmin()`.
5. **Self-Assigned Privilege Prevention**: Users creating `/users/{userId}` can only set `role == 'operator'` or `role == 'viewer'` (unless `isAdmin()`). `role`, `uid`, and `createdAt` are immutable for non-admin updates.
6. **Temporal Integrity**: Every `create` enforces `incoming().createdAt == request.time && incoming().updatedAt == request.time`. Every `update` enforces `incoming().updatedAt == request.time && incoming().createdAt == existing().createdAt`.
7. **Terminal State Locking**: Once a `Campaign` reaches `status == 'Completed'`, non-admin updates are blocked.

## 2. The "Dirty Dozen" Payloads
1. **Unverified Email Spoof**: `{ uid: "u1", role: "admin" }` with `email_verified: false` -> `PERMISSION_DENIED`.
2. **Self-Assigned Admin Escalation**: Creating `/users/u1` with `role: "admin"` by non-admin -> `PERMISSION_DENIED`.
3. **Shadow Field Injection**: Adding `isSuperAdmin: true` to `/sipAccounts/s1` -> `PERMISSION_DENIED` via `hasOnly`.
4. **Cross-Tenant SIP Account Read**: Reading `/sipAccounts/s1` where `ownerId != request.auth.uid` -> `PERMISSION_DENIED`.
5. **Cross-Tenant List Scraping**: Listing `/contacts` without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED`.
6. **ID Poisoning**: Document ID > 128 chars or containing invalid regex characters -> `PERMISSION_DENIED` via `isValidId()`.
7. **Value Poisoning (Denial of Wallet)**: `notes` field with 10,000 characters on `/contacts/c1` -> `PERMISSION_DENIED` via `.size() <= 500`.
8. **Owner Mutation on Update**: Updating `ownerId` on `/campaigns/camp1` -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: Providing past/future `createdAt` or `updatedAt` != `request.time` -> `PERMISSION_DENIED`.
10. **Terminal Campaign Re-open**: Updating `/campaigns/camp1` when `existing().status == 'Completed'` as non-admin -> `PERMISSION_DENIED`.
11. **PII Leak Attempt**: Reading `/users/otherUser/private/info` -> `PERMISSION_DENIED`.
12. **Unbounded Transport/Status Enum Bypass**: Setting `transport: "SCTP"` on `/sipAccounts/s1` -> `PERMISSION_DENIED`.

## 3. Red Team Conflict Report
- **Identity Spoofing**: Blocked (`incoming().ownerId == request.auth.uid` on create; `incoming().ownerId == existing().ownerId` on update).
- **State Shortcutting / Terminal State**: Blocked (`existing().status != 'Completed' || isAdmin()`).
- **Resource / Value Poisoning**: Blocked (`isValidId()` on all single-doc ops + `isValid[Entity]()` wrapping every `create` and `update`).
