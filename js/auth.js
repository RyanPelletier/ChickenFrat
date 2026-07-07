/* =====================================================================
   AUTH
   Wires the sign-in/sign-up overlay to Firebase Auth. On successful auth,
   ensures a Firestore player doc exists, then fires a `cf:authready`
   CustomEvent on window with { uid, displayName, playerData } — game.js
   listens for that event and doesn't otherwise know anything about auth.
   ===================================================================== */

import { auth, isFirebaseConfigured } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { ensurePlayerDoc, startPlayerSession, stopPlayerSession } from "./player-data.js";

const authOverlay = document.getElementById("auth-overlay");
const authError = document.getElementById("auth-error");
const authConfigNotice = document.getElementById("auth-config-notice");
const authForms = document.getElementById("auth-forms");
const signinForm = document.getElementById("signin-form");
const signupForm = document.getElementById("signup-form");
const hudUsername = document.getElementById("hud-username");
const hudSignoutBtn = document.getElementById("hud-signout-btn");

const googleProvider = new GoogleAuthProvider();

function showError(msg){
  authError.textContent = msg;
}

function friendlyAuthError(err){
  const code = err && err.code || "";
  if (code.includes("email-already-in-use")) return "That email's already got a frat account.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Email or password's off — try again.";
  if (code.includes("weak-password")) return "Password needs to be at least 6 characters.";
  if (code.includes("invalid-email")) return "That email doesn't look right.";
  if (code.includes("operation-not-allowed")) return "This sign-in method isn't turned on yet in the Firebase Console (Authentication → Sign-in method).";
  if (code.includes("network-request-failed")) return "Network hiccup — check your connection and try again.";
  if (code.includes("popup-closed-by-user")) return "Google sign-in window closed before finishing.";
  if (code.includes("unauthorized-domain")) return "This domain isn't authorized yet — add it under Authentication → Settings → Authorized domains.";
  return code ? `Something broke (${code}).` : "Something broke. Try again in a sec.";
}

/* ---------------- tab switching ---------------- */
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    showError("");
    if (tab.dataset.tab === "signin"){
      signinForm.hidden = false;
      signupForm.hidden = true;
    }else{
      signupForm.hidden = false;
      signinForm.hidden = true;
    }
  });
});

/* ---------------- config check ---------------- */
if (!isFirebaseConfigured){
  authForms.hidden = true;
  authConfigNotice.hidden = false;
}

/* ---------------- sign up ---------------- */
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const displayName = document.getElementById("signup-displayname").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!displayName){ showError("Every frat brother needs a name."); return; }

  const submitBtn = signupForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName });
    // onAuthStateChanged below picks up from here
  }catch(err){
    console.error(err);
    showError(friendlyAuthError(err));
  }finally{
    submitBtn.disabled = false;
  }
});

/* ---------------- sign in ---------------- */
signinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;
  const submitBtn = signinForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(err){
    console.error(err);
    showError(friendlyAuthError(err));
  }finally{
    submitBtn.disabled = false;
  }
});

/* ---------------- google sign in ---------------- */
document.getElementById("google-signin-btn").addEventListener("click", async () => {
  showError("");
  try{
    await signInWithPopup(auth, googleProvider);
  }catch(err){
    console.error(err);
    showError(friendlyAuthError(err));
  }
});

/* ---------------- sign out ---------------- */
hudSignoutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

/* ---------------- auth state ---------------- */
if (isFirebaseConfigured){
  onAuthStateChanged(auth, async (user) => {
    if (user){
      const displayName = user.displayName || "Anonymous Chicken";
      try{
        const playerData = await ensurePlayerDoc(user.uid, displayName);
        startPlayerSession(user.uid);

        hudUsername.textContent = displayName;
        hudSignoutBtn.hidden = false;
        authOverlay.hidden = true;

        window.dispatchEvent(new CustomEvent("cf:authready", {
          detail: { uid: user.uid, displayName, playerData }
        }));
      }catch(err){
        console.error("[ChickenFrat] Signed in, but couldn't load/create player data:", err);
        showError("Signed in, but couldn't reach your save data. Check that Firestore Database is created in the Firebase Console (Build → Firestore Database), then refresh.");
      }
    }else{
      stopPlayerSession();
      hudUsername.textContent = "";
      hudSignoutBtn.hidden = true;
      authOverlay.hidden = false;
      window.dispatchEvent(new CustomEvent("cf:signout"));
    }
  });
}
