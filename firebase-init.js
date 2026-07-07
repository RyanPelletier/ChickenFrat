/* =====================================================================
   FIREBASE INIT
   Paste your own project's config below. See FIREBASE_SETUP.md for the
   exact steps to get these values from the Firebase Console.

   Nothing else in the codebase needs to change when you swap projects —
   every other file imports `auth` and `db` from here.
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---- PASTE YOUR FIREBASE CONFIG HERE ----
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
// ------------------------------------------

export const isFirebaseConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = isFirebaseConfigured ? getAuth(app) : null;
export const db = isFirebaseConfigured ? getFirestore(app) : null;
