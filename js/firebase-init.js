/* =====================================================================
   FIREBASE INIT
   Paste your own project's config below. See FIREBASE_SETUP.md for the
   exact steps to get these values from the Firebase Console.

   Nothing else in the codebase needs to change when you swap projects —
   every other file imports `auth` and `db` from here.
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

// ---- PASTE YOUR FIREBASE CONFIG HERE ----
// NOTE: databaseURL is required for multiplayer (Realtime Database) and is
// NOT always included in the config snippet Firebase shows you when you
// first register a web app — see FIREBASE_SETUP.md step "Realtime Database"
// for exactly where to find it if it's missing here.
const firebaseConfig = {
  apiKey: "AIzaSyDjeIDTyGmHpimWwiTyCyhA9b7Y1EOsH5w",
  authDomain: "chickenfrat-7deeb.firebaseapp.com",
  projectId: "chickenfrat-7deeb",
  storageBucket: "chickenfrat-7deeb.firebasestorage.app",
  messagingSenderId: "118353333006",
  appId: "1:118353333006:web:42c18a604b78fd5a68255f",
  databaseURL: "YOUR_DATABASE_URL"
};
// ------------------------------------------

export const isFirebaseConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";
export const isRealtimeDbConfigured = isFirebaseConfigured && firebaseConfig.databaseURL !== "YOUR_DATABASE_URL";

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = isFirebaseConfigured ? getAuth(app) : null;
export const db = isFirebaseConfigured ? getFirestore(app) : null;
export const rtdb = isRealtimeDbConfigured ? getDatabase(app) : null;
