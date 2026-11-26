// 1. Paste your Firebase web app settings below.
//    Firebase console → Project settings (gear icon) → Your apps → Web app → "SDK setup and configuration" → Config.
// 2. These values are NOT secrets. Anyone can see them in the page source; that's normal for Firebase.
//    What protects your data is firestore.rules (sign-in + your approval + own-blocks-only).
export const firebaseConfig = {
  apiKey: "AIzaSyAwOXYpy_XRaYnGcIflWtmMC9dfmujAU8o",
  authDomain: "availability-planner-1ba44.firebaseapp.com",
  projectId: "availability-planner-1ba44",
  storageBucket: "availability-planner-1ba44.firebasestorage.app",
  messagingSenderId: "793865179389",
  appId: "1:793865179389:web:d9c2c737c492fb19cbee94"
};

// What the page calls itself, and who approves new people.
export const planner = {
  title: "Availability planner",
  adminName: "Madhav"
};
