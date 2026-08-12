// js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDs-KoBvWL10TkJfhc4aRAK8_Wd5tNOI44",
  authDomain: "encuesta-f913f.firebaseapp.com",
  projectId: "encuesta-f913f",
  storageBucket: "encuesta-f913f.firebasestorage.app",
  messagingSenderId: "1006380215931",
  appId: "1:1006380215931:web:32025f2dba0b41efaa3cde"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
