/* =====================================================================
   MULTIPLAYER (Realtime Database)
   Live position sync + proximity chat. Split from player-data.js (which
   owns Firestore) deliberately: Realtime Database bills by bandwidth
   rather than per-read/write, which is the right fit for something that
   changes many times a second like position — Firestore would rack up
   reads/writes fast at that frequency and cost far more for the same
   data. Firestore stays the source of truth for slow-changing stuff
   (Strength, Clout); this file owns only the fast, ephemeral stuff.

   Data shape at /presence/{uid}:
     { displayName, x, y, updatedAt, chat: { text, sentAt } }

   game.js doesn't touch Firebase directly — it calls the functions
   below and reads getOtherPlayers() each frame.
   ===================================================================== */

import { rtdb, isRealtimeDbConfigured } from "./firebase-init.js";
import {
  ref, set, update, remove, onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

const PRESENCE_WRITE_INTERVAL_MS = 150; // throttle position writes to keep bandwidth cheap
const STALE_PRESENCE_MS = 20000; // ignore presence entries that haven't updated in a while (ghost tabs)

let currentUid = null;
let currentDisplayName = "";
let presenceUnsubscribe = null;
let lastPresenceWriteAt = 0;
let otherPlayersCache = {};

export function isMultiplayerAvailable(){
  return isRealtimeDbConfigured;
}

export function initMultiplayer(uid, displayName){
  if (!isRealtimeDbConfigured) return;
  currentUid = uid;
  currentDisplayName = displayName;
  otherPlayersCache = {};

  const myPresenceRef = ref(rtdb, `presence/${uid}`);

  // clean up automatically if the tab closes/crashes without a graceful sign-out
  onDisconnect(myPresenceRef).remove();

  const presenceRootRef = ref(rtdb, "presence");
  presenceUnsubscribe = onValue(presenceRootRef, (snapshot) => {
    const val = snapshot.val() || {};
    const next = {};
    for (const [otherUid, data] of Object.entries(val)){
      if (otherUid === currentUid) continue;
      if (!data || typeof data.x !== "number" || typeof data.y !== "number") continue;
      next[otherUid] = data;
    }
    otherPlayersCache = next;
  });
}

export function stopMultiplayer(){
  if (presenceUnsubscribe){ presenceUnsubscribe(); presenceUnsubscribe = null; }
  if (currentUid && isRealtimeDbConfigured){
    remove(ref(rtdb, `presence/${currentUid}`)).catch(() => {});
  }
  currentUid = null;
  otherPlayersCache = {};
}

/** Called every frame from game.js — internally throttled, cheap to call often. */
export function updateLocalPresence(x, y){
  if (!currentUid || !isRealtimeDbConfigured) return;
  const now = Date.now();
  if (now - lastPresenceWriteAt < PRESENCE_WRITE_INTERVAL_MS) return;
  lastPresenceWriteAt = now;
  update(ref(rtdb, `presence/${currentUid}`), {
    displayName: currentDisplayName,
    x: Math.round(x),
    y: Math.round(y),
    updatedAt: serverTimestamp()
  }).catch((err) => console.error("[ChickenFrat] presence update failed:", err));
}

export function sendChatMessage(text){
  if (!currentUid || !isRealtimeDbConfigured || !text) return;
  update(ref(rtdb, `presence/${currentUid}`), {
    chat: { text: text.slice(0, 80), sentAt: Date.now() }
  }).catch((err) => console.error("[ChickenFrat] chat send failed:", err));
}

/** Returns a map of { uid: {displayName, x, y, chat?} } for everyone but you, excluding stale/ghost entries. */
export function getOtherPlayers(){
  const now = Date.now();
  const alive = {};
  for (const [otherUid, data] of Object.entries(otherPlayersCache)){
    const updatedAtMs = typeof data.updatedAt === "number" ? data.updatedAt : now; // serverTimestamp resolves async; treat unresolved as fresh
    if (now - updatedAtMs < STALE_PRESENCE_MS) alive[otherUid] = data;
  }
  return alive;
}
