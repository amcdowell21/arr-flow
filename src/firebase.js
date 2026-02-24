import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDwJ4ZlryuUErKb9j-S6lhEOwl4t4nksjo",
  authDomain: "arr-flow.firebaseapp.com",
  projectId: "arr-flow",
  storageBucket: "arr-flow.firebasestorage.app",
  messagingSenderId: "151943620973",
  appId: "1:151943620973:web:2d6ade1f9e6c948d905264",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
