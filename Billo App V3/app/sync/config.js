/* Billo live sync — your Firebase project's web config.
   Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
   Paste it below (these values are public identifiers, not secrets; access is controlled by
   firebase/firestore.rules). Leave it as null and the app works exactly as before, fully offline,
   with live sync hidden. Full walkthrough: SYNC-SETUP.md */
window.BILLO_FIREBASE_CONFIG = {
  apiKey: "AIzaSyChxURVVOXN76ImcgxIQVn9jE-pCXiiYeM",
  authDomain: "billo-app-e3a6f.firebaseapp.com",
  projectId: "billo-app-e3a6f",
  storageBucket: "billo-app-e3a6f.firebasestorage.app",
  messagingSenderId: "190372993169",
  appId: "1:190372993169:web:b05cbdccd58f4d359e4730"
};
/* Where invite links point (the web version of Billo). Friends who tap an invite open this and
   join in their browser — or in the app, once you host the same address for the Android build. */
window.BILLO_WEB_URL = "https://resonant-gnome-2b289a.netlify.app/";

/* template:
window.BILLO_FIREBASE_CONFIG = {
  apiKey: "…",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "…",
  appId: "…"
}; */
