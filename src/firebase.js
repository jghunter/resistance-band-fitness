import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth'

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

/* ---------------------------------------------------------------------------
 * LOCAL EMULATORS (added 2026-08-28)
 *
 * WHY THIS EXISTS. The ownership rule (TODO item 17, review finding 11) needs
 * TWO Firebase uids on one device: sign in as A, take a calibration reading,
 * sign out, sign in as B, and B must NOT receive A's calibration. A second real
 * Google account needs a phone number that accepts SMS, and every number Greg
 * can reach already carries an account of its own. The Auth emulator mints a
 * uid from any address you type, with no phone and no verification, so it
 * answers that need directly. It also unblocks the live-Firestore checks in
 * items 17 and 18, which have been unverifiable for the same reason.
 *
 * THE GUARD IS TWO CONDITIONS, AND BOTH ARE DELIBERATE.
 *
 *   import.meta.env.DEV      -- false in every `vite build` output, so no
 *                               production bundle can ever contain a live
 *                               connection to localhost, even if the flag
 *                               below were set by accident in a build env.
 *   VITE_USE_EMULATOR        -- an explicit opt-in, so an ordinary `npm run
 *                               dev` still talks to the REAL project. Turning
 *                               the emulator on must be a choice, never the
 *                               default: a developer who did not ask for it
 *                               would otherwise silently write nowhere.
 *
 * Run it with `npm run dev:emulator`, which passes `--mode emulator` so Vite
 * loads `.env.emulator`. See EMULATOR_TESTING.md for the whole procedure.
 *
 * WHAT AN EMULATOR RUN DOES AND DOES NOT PROVE. It exercises the real Firebase
 * SDK, a real Firestore round-trip and real rule evaluation, under two separate
 * identities. It does NOT exercise the project's DEPLOYED security rules or its
 * live data -- `firestore.emulator.rules` mirrors the intended model and is not
 * checked against production. Read a green run as "the client logic is right",
 * never as "the live project is safe".
 * ------------------------------------------------------------------------- */
const USE_EMULATOR =
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === 'true'

if (USE_EMULATOR) {
  /* Ports match firebase.json. `disableWarnings` silences the SDK's banner
     about an insecure Auth emulator connection -- it is the point of the
     exercise, and the console noise hides the app's own logs. */
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  /* Loud on purpose. A session that thinks it is signed in to the real project
     while writing to a throwaway emulator is the one confusion this whole
     setup could cause, so it announces itself on every load. */
  console.warn(
    '[RBTS] FIREBASE EMULATORS ARE ACTIVE. Auth 9099, Firestore 8080. ' +
    'Nothing here touches the real project, and nothing here survives ' +
    'stopping the emulator.'
  )
}
