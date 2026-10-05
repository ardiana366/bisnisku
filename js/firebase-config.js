/**
 * Bisnisku — firebase-config.js
 * Embedded Firebase config + Firestore with persistent IndexedDB cache
 * (offline-first, multi-tab safe). No login: data isolation is done by an
 * anonymous per-device ID (see db.js).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

/* ==================================================================
 *  >>> START: PASTE YOUR FIREBASE PROJECT KEYS HERE <<<
 *  Firebase Console → Project settings → Your apps → Web app → SDK config
 * ================================================================== */
export const firebaseConfig = {
  apiKey: "AIzaSyDRFyfr7j9wOlWMb8sLSFfzVUOBmFuUdC0",
  authDomain: "bisnis-fe6b2.firebaseapp.com",
  projectId: "bisnis-fe6b2",
  storageBucket: "bisnis-fe6b2.firebasestorage.app",
  messagingSenderId: "733452788382",
  appId: "1:733452788382:web:449ede669ba4f69af5d18f",
  measurementId: "G-XH13NTCWZF"
};
/* ==================================================================
 *  >>> END: PASTE YOUR FIREBASE PROJECT KEYS HERE <<<
 *
 *  Firestore rules (Firebase Console → Firestore → Rules). The app has no
 *  login, so each device is isolated only by its random, unguessable UUID:
 *
 *    rules_version = '2';
 *    service cloud.firestore {
 *      match /databases/{database}/documents {
 *        match /devices/{deviceId}/{document=**} {
 *          allow read, write: if true;
 *        }
 *      }
 *    }
 * ================================================================== */

/** True while the placeholder keys above are still untouched. */
export const isConfigPlaceholder = [firebaseConfig.apiKey, firebaseConfig.projectId].some(
  (v) => String(v).startsWith("YOUR_")
);

export const app = initializeApp(firebaseConfig);

let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (err) {
  // e.g. IndexedDB blocked (private mode) → fall back to the default instance.
  console.warn("[Bisnisku] Persistent cache unavailable, using default Firestore.", err);
  firestore = getFirestore(app);
}

export const db = firestore;
