/* =====================================================================
   MULTIPLAYER (Realtime Database)
   Live position sync + proximity chat + Cockfight Ring matchmaking. Split
   from player-data.js (which owns Firestore) deliberately: Realtime
   Database bills by bandwidth rather than per-read/write, which is the
   right fit for stuff that changes many times a second like position —
   Firestore would rack up reads/writes fast at that frequency and cost
   far more for the same data. Firestore stays the source of truth for
   slow-changing stuff (Strength, Clout, unlocked cosmetics); this file
   owns only the fast, ephemeral stuff.

   Data shape at /presence/{uid}:
     { displayName, x, y, updatedAt, chat: { text, sentAt }, look?: { equipped, driving, size } }

   COCKFIGHT MATCHMAKING (no backend/Cloud Functions, so this is a
   best-effort, client-driven design — fine for a casual small-scale
   game, not bulletproof under heavy concurrent load):
     /cockfight/waiting  — at most one waiting fighter: {uid, displayName, strength, joinedAt}
     /cockfight/results/{uid} — a one-shot result written FOR that uid by whoever beat them to the punch

   The first player to click "Fight" becomes the waiting entry (claimed
   atomically via a transaction, so two simultaneous clicks can't both
   think they're waiting). The next player to click resolves the match
   immediately client-side, writes the result to the waiting player's
   results slot, and clears the waiting slot. The waiting player is
   listening on their own results slot the whole time.

   Because this is peer-to-peer with no server referee, the RTDB rules
   for /cockfight are intentionally more permissive than /presence (any
   signed-in player can write anyone's result) — that's a real trust
   tradeoff for a casual hobby project; see FIREBASE_SETUP.md.

   game.js doesn't touch Firebase directly — it calls the functions
   below and reads getOtherPlayers() / getCockfightState() each frame.
   ===================================================================== */

import { rtdb, isRealtimeDbConfigured } from "./firebase-init.js";
import {
  ref, set, update, remove, get, onValue, onDisconnect, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";

const PRESENCE_WRITE_INTERVAL_MS = 150; // throttle position writes to keep bandwidth cheap
const STALE_PRESENCE_MS = 20000; // ignore presence entries that haven't updated in a while (ghost tabs)

let currentUid = null;
let currentDisplayName = "";
let presenceUnsubscribe = null;
let lastPresenceWriteAt = 0;
let otherPlayersCache = {};
let lastSentCosmeticKey = null;

let cockfightState = "idle"; // "idle" | "waiting"
let cockfightResultUnsub = null;
let pendingCockfightResult = null;

export function isMultiplayerAvailable(){
  return isRealtimeDbConfigured;
}

export function initMultiplayer(uid, displayName){
  if (!isRealtimeDbConfigured) return;
  currentUid = uid;
  currentDisplayName = displayName;
  otherPlayersCache = {};
  lastSentCosmeticKey = null;
  cockfightState = "idle";
  pendingCockfightResult = null;

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
  leaveCockfight();
  if (currentUid && isRealtimeDbConfigured){
    remove(ref(rtdb, `presence/${currentUid}`)).catch(() => {});
  }
  currentUid = null;
  otherPlayersCache = {};
}

/** Called every frame from game.js — internally throttled, cheap to call often. look is {equipped, driving, size}. */
export function updateLocalPresence(x, y, look){
  if (!currentUid || !isRealtimeDbConfigured) return;
  const now = Date.now();
  if (now - lastPresenceWriteAt < PRESENCE_WRITE_INTERVAL_MS) return;
  lastPresenceWriteAt = now;
  const lookKey = look ? JSON.stringify(look) : null;
  const patch = {
    displayName: currentDisplayName,
    x: Math.round(x),
    y: Math.round(y),
    updatedAt: serverTimestamp()
  };
  if (lookKey !== lastSentCosmeticKey){
    patch.look = look || null;
    lastSentCosmeticKey = lookKey;
  }
  update(ref(rtdb, `presence/${currentUid}`), patch)
    .catch((err) => console.error("[ChickenFrat] presence update failed:", err));
}

export function sendChatMessage(text){
  if (!currentUid || !isRealtimeDbConfigured || !text) return;
  update(ref(rtdb, `presence/${currentUid}`), {
    chat: { text: text.slice(0, 80), sentAt: Date.now() }
  }).catch((err) => console.error("[ChickenFrat] chat send failed:", err));
}

/** Returns a map of { uid: {displayName, x, y, chat?, look?} } for everyone but you, excluding stale/ghost entries. */
export function getOtherPlayers(){
  const now = Date.now();
  const alive = {};
  for (const [otherUid, data] of Object.entries(otherPlayersCache)){
    const updatedAtMs = typeof data.updatedAt === "number" ? data.updatedAt : now; // serverTimestamp resolves async; treat unresolved as fresh
    if (now - updatedAtMs < STALE_PRESENCE_MS) alive[otherUid] = data;
  }
  return alive;
}

/* ==================== cockfight matchmaking ==================== */

export function getCockfightState(){
  return cockfightState;
}

/** Call once per frame (cheap) — returns the most recent fight result and clears it, or null. */
export function consumeCockfightResult(){
  const r = pendingCockfightResult;
  pendingCockfightResult = null;
  return r;
}

function resolveFightOutcome(myStrength, opponentStrength){
  const total = Math.max(1, myStrength + opponentStrength);
  const winChance = Math.min(0.9, Math.max(0.1, myStrength / total)); // never a sure thing either way — stays "casual"
  return Math.random() < winChance;
}

export async function joinCockfight(strength){
  if (!isRealtimeDbConfigured || !currentUid || cockfightState === "waiting") return;

  const waitingRef = ref(rtdb, "cockfight/waiting");
  const myEntry = { uid: currentUid, displayName: currentDisplayName, strength, joinedAt: Date.now() };

  try{
    const txResult = await runTransaction(waitingRef, (current) => {
      if (current === null || current.uid === currentUid) return myEntry;
      return; // someone else is already waiting — abort, we'll challenge them below instead
    });

    const iAmNowWaiting = txResult.committed && txResult.snapshot.val() && txResult.snapshot.val().uid === currentUid;

    if (iAmNowWaiting){
      cockfightState = "waiting";
      const resultRef = ref(rtdb, `cockfight/results/${currentUid}`);
      cockfightResultUnsub = onValue(resultRef, (snap) => {
        const val = snap.val();
        if (val){
          pendingCockfightResult = val;
          cockfightState = "idle";
          remove(resultRef).catch(() => {});
          if (cockfightResultUnsub){ cockfightResultUnsub(); cockfightResultUnsub = null; }
        }
      });
      return;
    }

    // someone else was already waiting — read them and resolve the fight right now
    const snap = await get(waitingRef);
    const opponent = snap.val();
    if (!opponent || opponent.uid === currentUid) return; // race: they left first, just bail quietly

    const iWon = resolveFightOutcome(strength, opponent.strength);
    await update(ref(rtdb), {
      [`cockfight/results/${opponent.uid}`]: { won: !iWon, opponentName: currentDisplayName, myStrength: opponent.strength, opponentStrength: strength },
      "cockfight/waiting": null
    });
    pendingCockfightResult = { won: iWon, opponentName: opponent.displayName, myStrength: strength, opponentStrength: opponent.strength };
  }catch(err){
    console.error("[ChickenFrat] cockfight matchmaking failed:", err);
  }
}

export async function leaveCockfight(){
  if (cockfightResultUnsub){ cockfightResultUnsub(); cockfightResultUnsub = null; }
  const wasWaiting = cockfightState === "waiting";
  cockfightState = "idle";
  if (!wasWaiting || !currentUid || !isRealtimeDbConfigured) return;
  try{
    await runTransaction(ref(rtdb, "cockfight/waiting"), (current) => {
      if (current && current.uid === currentUid) return null;
      return; // not ours anymore (already matched) — leave it alone
    });
  }catch(err){ console.error("[ChickenFrat] leaveCockfight cleanup failed:", err); }
}
