// Firebase dito ay ginagamit LANG para sa Google sign-in (login).
// Ang datos mismo (learners, grades, atbp.) ay nasa Turso na — tingnan
// ang api/data.js. Kaya kailangan mo pa rin ng Firebase project, pero
// hindi mo na kailangang i-enable ang Firestore Database.
//
// 1. Pumunta sa https://console.firebase.google.com
// 2. Gumawa ng bagong project (libre)
// 3. Sa kaliwang menu: Build > Authentication > Get started >
//    i-enable ang "Google" bilang sign-in provider
// 4. Sa Project settings > General > "Your apps", gumawa ng Web App (</>)
// 5. Kopyahin ang mga value mula sa "firebaseConfig" na ibibigay sa iyo
//    at i-paste dito, palitan ang mga "REPLACE_ME".
//
// Ang "projectId" sa ibaba ay dapat ding i-set mo bilang
// FIREBASE_PROJECT_ID environment variable sa Vercel (hindi ito
// sikreto — publikong value ito, ginagamit lang para i-verify ng
// server ang mga Google login token).

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// OPTIONAL: kung gusto mong limitahan ang pag-login sa email ng paaralan
// lang (hal. "@deped.gov.ph" o "@yourschool.edu.ph"), ilagay dito RIN sa
// ALLOWED_EMAIL_DOMAIN environment variable sa Vercel (para totoong
// ma-enforce sa server, hindi lang sa client).
export const ALLOWED_EMAIL_DOMAIN = "";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
