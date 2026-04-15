// File: /js/core/firebase.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyB6j3ywjmvNiSSXo9xZLPRVesYZZlJqzGE",
    authDomain: "bharatpos-244a5.firebaseapp.com",
    projectId: "bharatpos-244a5",
    storageBucket: "bharatpos-244a5.firebasestorage.app",
    messagingSenderId: "135502478185",
    appId: "1:135502478185:web:b22081b57bb34627b59bf8",
    measurementId: "G-49K3N22EHC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);