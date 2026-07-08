/* =====================================================================
   PLAYER DATA (Firestore)
   Persistent, low-frequency stuff only: baseStrength, displayName,
   cosmetics, timestamps. Live position/chat is NOT stored here — that's
   Realtime Database territory, coming in Phase 2, precisely because
   Firestore bills per read/write and position updates happen many times
   a second. Keeping that split from day one avoids a costly rewrite later.

   Writes are throttled (SAVE_INTERVAL_MS) and also flushed on tab close,
   so a player mashing the gym clicker doesn't generate a write per tap.
   ===================================================================== */

import { db, isFirebaseConfigured } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const SAVE_INTERVAL_MS = 8000;

let currentUid = null;
let dirty = false;
let pendingPatch = {};
let saveTimer = null;

function defaultPlayerDoc(displayName){
  return {
    displayName,
    baseStrength: 0,
    clout: 0,
    cosmetics: [],
    merch: [],
    equipped: { head: null, face: null, neck: null, feet: null },
    trophies: { wolf: 0, cockfight: 0 },
    sizeBoosted: false,
    createdAt: serverTimestamp(),
    lastSeen: serverTimestamp()
  };
}

export async function ensurePlayerDoc(uid, displayName){
  if (!isFirebaseConfigured) return defaultPlayerDoc(displayName);
  const ref = doc(db, "players", uid);
  const snap = await getDoc(ref);
  if (snap.exists()){
    return snap.data();
  }
  const fresh = defaultPlayerDoc(displayName);
  await setDoc(ref, fresh);
  return fresh;
}

export function startPlayerSession(uid){
  currentUid = uid;
  dirty = false;
  pendingPatch = {};
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = setInterval(flushPatch, SAVE_INTERVAL_MS);
  window.addEventListener("beforeunload", flushPatch);
}

export function stopPlayerSession(){
  flushPatch();
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = null;
  currentUid = null;
}

/** Queue a partial stat update; actually written to Firestore on the next flush. */
export function queuePatch(patch){
  if (!currentUid) return;
  pendingPatch = { ...pendingPatch, ...patch };
  dirty = true;
}

async function flushPatch(){
  if (!dirty || !currentUid || !isFirebaseConfigured) return;
  const patch = { ...pendingPatch, lastSeen: serverTimestamp() };
  pendingPatch = {};
  dirty = false;
  try{
    await updateDoc(doc(db, "players", currentUid), patch);
  }catch(err){
    console.error("[ChickenFrat] Failed to save player doc:", err);
    // put it back so the next interval retries
    pendingPatch = { ...patch, ...pendingPatch };
    dirty = true;
  }
}
