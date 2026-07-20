// Firebase dito ay ginagamit LANG para sa Google sign-in (login).
// Ang datos mismo (learners, grades, atbp.) ay nasa Turso na — tingnan
// ang api/data.js.

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBPYCUePhtEqude50FDUgnJzvAesT_Tm80",
  authDomain: "classrecord-23762.firebaseapp.com",
  projectId: "classrecord-23762",
  storageBucket: "classrecord-23762.firebasestorage.app",
  messagingSenderId: "565222617245",
  appId: "1:565222617245:web:18d62b5ecdece5a0e46474"
};

// OPTIONAL: kung gusto mong limitahan ang pag-login sa email ng paaralan
// lang (hal. "@deped.gov.ph" o "@yourschool.edu.ph"), ilagay dito RIN sa
// ALLOWED_EMAIL_DOMAIN environment variable sa Vercel (para totoong
// ma-enforce sa server, hindi lang sa client).
export const ALLOWED_EMAIL_DOMAIN = "";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
