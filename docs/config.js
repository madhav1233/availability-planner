// 1. Paste your Firebase web app settings below.
//    Firebase console → Project settings (gear icon) → Your apps → Web app → "SDK setup and configuration" → Config.
// 2. These values are NOT secrets. Anyone can see them in the page source; that's normal for Firebase.
//    What protects your data is firestore.rules (sign-in + your approval + own-blocks-only).
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};

// What the page calls itself, and who approves new people.
export const planner = {
  title: "Availability planner",
  adminName: "Madhav"
};
