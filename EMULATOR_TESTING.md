# Testing with the Firebase emulators

Added 2026-08-28.

This exists to answer one question that had no answer: **how do you test the
ownership rule without a second Google account?** Creating one needs a phone
number that accepts SMS, and every number Greg can reach already carries an
account of its own.

The Auth emulator makes a Firebase uid from any address you type. No phone, no
verification, no real account. What the ownership rule actually needs is a
second **uid**, not a second Google login, so this answers the need exactly.

It also unblocks the live-Firestore checks in TODO items 17 and 18, which were
stuck for the same reason.

---

## What you need first

1. **Node.** Already installed.
2. **A Java runtime, version 17 or later.** The **Firestore** emulator is a Java
   program and will not start without one. The Auth emulator is Node and does
   not need it. Check with:

   ```
   java -version
   ```

   If that command is not found, install a JDK — Eclipse Temurin 21 is a good
   choice — and open a new terminal so the PATH updates.

3. **Nothing else.** `firebase-tools` is fetched by `npx` on first use. It is
   deliberately NOT a dependency of this project, so it never slows an ordinary
   install or a deploy.

---

## Running it

Open two terminals in `resistance-band-pwa`.

**Terminal one — the emulators:**

```
npm run emulators
```

Wait for the table of ports. The emulator UI is at http://127.0.0.1:4000.

**Terminal two — the app pointed at them:**

```
npm run dev:emulator
```

Open the address Vite prints. **The browser console must show a warning that
begins `[RBTS] FIREBASE EMULATORS ARE ACTIVE`.** If it does not, the app is
talking to the real project — stop and fix that before touching anything.

`npm run dev` on its own is unchanged and still uses the real project.

---

## Signing in as somebody else

Press SIGN IN in the app. Instead of Google's page you get the emulator's own
sign-in screen. Choose **Add new account**, type any address (`a@test.local`,
`b@test.local`), and it mints a user with a real Firebase uid.

Sign out and repeat with the second address to get the second uid. The emulator
UI's Authentication tab lists both, with their uids.

---

## Signing in from a script, when a popup will not do

Used on 2026-08-29 to run the whole of item 17. `signInWithPopup` opens a
window that browser automation cannot reach, so drive the app's OWN auth object
instead. In the page console:

```js
// The SAME module instance Vite already gave the app, not a second copy.
const fb   = await import('/src/firebase.js')
const auth = await import('/node_modules/.vite/deps/firebase_auth.js?v=...')
// The version hash changes; read it from
// performance.getEntriesByType('resource').

const cred = auth.GoogleAuthProvider.credential(
  JSON.stringify({ sub: 'uid-alpha', email: 'a@test.local',
                   email_verified: true, name: 'Alpha Tester' }))
await auth.signInWithCredential(fb.auth, cred)
```

The Auth emulator accepts that unsigned JSON as an id token and mints a real
uid. Change `sub` and `email` for the second identity. `auth.signOut(fb.auth)`
signs out.

**Stub `window.alert` before you sign in.** The adopt message
(`App.jsx:5528`) is a blocking `alert()`; it froze the tab twice. Every
localStorage write happens BEFORE it, so closing the tab loses nothing.

**Vite binds to `[::1]` only.** Use `http://localhost:5173`, not
`http://127.0.0.1:5173`.

---

## The checks this unblocks

### Item 17 — two accounts on one device (review finding 11)

1. Sign in as `a@test.local`.
2. GEAR tab → BAND CALIBRATION. Enter a rest length on a band.
3. Sign out. Sign in as `b@test.local`.
4. **B must NOT see A's calibration.**
5. **`localStorage.rbts_bandGeom_prev` must hold A's copy.** Read it in the
   browser console.

### Item 17 — a live Firestore adopt

1. Signed in as A, save a calibration. Confirm it reaches Firestore in the
   emulator UI (`users/{uid}/meta/bandGeom`).
2. Clear the local key (`localStorage.removeItem('rbts_bandGeom')`) and reload.
3. **The adopt message appears once**, and `rbts_bandGeom_prev` holds what was
   replaced.

### Item 18 — a body measurement survives a round trip

1. Signed in as A: TODAY → TRAINING STYLE, type a body measurement.
2. Sign out, sign back in as A.
3. **The measurement is still there.** This is the stamping hazard the
   sync-and-ownership spec was built around.

### Item 15 — the TODAY / NEXT chips

These need no sign-in at all and can be checked in the same session.

---

## What a green run proves, and what it does not

It exercises the real Firebase SDK, a real Firestore round trip, and real rule
evaluation, under two separate identities. That is the part that has never been
tested.

It does **not** test the project's deployed security rules or its live data.
`firestore.emulator.rules` mirrors the intended ownership model and is not
compared against production. Read a green run as *the client logic is right*,
never as *the live project is safe*.

---

## Files this added

| file | why |
|---|---|
| `firebase.json` | emulator ports. **No hosting block and no deploy targets**, so `firebase deploy` has nothing here to push. |
| `firestore.emulator.rules` | rules for the emulator. Named so it can never be mistaken for the live `firestore.rules`. |
| `.firebaserc` | names the project, so the emulator uses matching uids and paths. |
| `.env.emulator` | the `VITE_USE_EMULATOR=true` switch, loaded only by `--mode emulator`. Holds no secret. |
| `src/firebase.js` | the connect calls, behind **two** guards. |

The guard in `src/firebase.js` requires `import.meta.env.DEV` **and** the flag.
`DEV` is false in every `vite build` output, so no production bundle can connect
to localhost even if the flag reached the build environment.

---

## Cleaning up

Stop the emulators with Ctrl+C. Their data is in memory and is gone. The app's
own `localStorage` from the dev origin is not — clear it in the browser if you
want a fresh start.
