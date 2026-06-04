// js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBCV9zfsSel5CGITv4pbekb21-Iy3WUoZw",
  authDomain: "survey-fee49.firebaseapp.com",
  projectId: "survey-fee49",
  storageBucket: "survey-fee49.firebasestorage.app",
  messagingSenderId: "298293631489",
  appId: "1:298293631489:web:c1fd60c35872e7b17b3e00"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };

