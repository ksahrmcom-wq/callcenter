import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  const user = result.user;
  if (user && user.emailVerified) {
    const userPath = `users/${user.uid}`;
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          displayName: (user.displayName || 'SIP Operator').slice(0, 100),
          role: 'operator',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      if (user.email) {
        await setDoc(
          doc(db, 'users', user.uid, 'private', 'info'),
          {
            uid: user.uid,
            email: user.email.slice(0, 254),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  }
  return user;
}

export async function signOutUser() {
  await signOut(auth);
}

export async function sendFirebasePasswordReset(email: string): Promise<boolean> {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return false;
  try {
    await sendPasswordResetEmail(auth, cleanEmail);
    return true;
  } catch {
    // User may be managed in Firestore / platform vault without an active Firebase Auth password provider
    return false;
  }
}

export {
  firebaseConfig,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
};

export type FirestoreCollectionName =
  | 'sipAccounts'
  | 'users'
  | 'rbacMatrix'
  | 'contacts'
  | 'recordings'
  | 'campaigns'
  | 'callbacks'
  | 'callLogs'
  | 'voicemails';

/**
 * Syncs a single entity document to Firebase Firestore when a verified user is authenticated.
 */
export async function syncEntityToFirestore(
  collectionName: FirestoreCollectionName,
  docId: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    return false;
  }
  const cleanId = String(docId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  const path = `${collectionName}/${cleanId}`;
  try {
    await setDoc(doc(db, collectionName, cleanId), payload, { merge: true });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Deletes a single entity document from Firebase Firestore when a verified user is authenticated.
 */
export async function deleteEntityFromFirestore(
  collectionName: FirestoreCollectionName,
  docId: string
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    return false;
  }
  const cleanId = String(docId).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  const path = `${collectionName}/${cleanId}`;
  try {
    await deleteDoc(doc(db, collectionName, cleanId));
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}


