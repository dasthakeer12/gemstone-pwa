// auth.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.6.0/firebase-app.js';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/9.6.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyDGNwhOnIJueQVdmrJP2G7ffgLUiI6odxY",
  authDomain: "gemstone-accounting.firebaseapp.com",
  projectId: "gemstone-accounting",
  storageBucket: "gemstone-accounting.firebasestorage.app",
  messagingSenderId: "77908057882",
  appId: "1:77908057882:web:262f97ad2bd84058b016a3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Authentication functions
export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error) {
    throw error;
  }
};

export const logoutUser = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    throw error;
  }
};

export const checkAuthState = (callback) => {
  return onAuthStateChanged(auth, callback);
};