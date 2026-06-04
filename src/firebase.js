import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyAJodHPenCAMN8OzTkcX69hXcKFGZ0QZxI",
  authDomain: "resistance-band-fitness-app.firebaseapp.com",
  projectId: "resistance-band-fitness-app",
  storageBucket: "resistance-band-fitness-app.firebasestorage.app",
  messagingSenderId: "217349840891",
  appId: "1:217349840891:web:c15e19b002afad6813355e"
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
