import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const dbId = (firebaseConfig as any).firestoreDatabaseId;

// Allow forcing fallback to (default) database client-side via environment variable
const forceDefaultDb = (import.meta as any).env?.VITE_FORCE_DEFAULT_DB === 'true' || (import.meta as any).env?.FORCE_DEFAULT_DB === 'true';
const targetDbId = forceDefaultDb ? undefined : ((dbId && dbId !== "(default)") ? dbId : undefined);

if (forceDefaultDb) {
  console.log("[FIREBASE] Forcing use of (default) database on client side.");
} else if (targetDbId) {
  console.log(`[FIREBASE] Using custom database on client side: ${targetDbId}`);
} else {
  console.log("[FIREBASE] Using (default) database on client side.");
}

// Use initializeFirestore with experimentalForceLongPolling enabled to bypass corporate firewalls/iframes blocking WebSockets
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, targetDbId);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  login_hint: 'smokeeatersnd@gmail.com'
});

export const signIn = () => signInWithPopup(auth, googleProvider);
export const signOut = () => auth.signOut();
