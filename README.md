# Resistance Band Fitness — PWA

The installable, signed-in version of the resistance band training system.
Live at https://resistance-band-fitness.pages.dev

It is one of two apps that share one engine. The other is the single-file
`fitness_app.html` in the parent repository, which needs no build and no account.
This one adds Google sign-in and Firestore sync so a person's log follows them
across devices.

## Layout

| Path | What it is |
|---|---|
| `src/App.jsx` | The whole interface: TODAY, HISTORY, ANALYZE, LIBRARY, GEAR, BANDS and the program builder |
| `src/data.js` | Exercises, videos, bands, programs |
| `src/phase1.js` | Profiles, splits and the schema migration. A mirror of the parent's module; do not edit here |
| `src/reports.js` | The load model and every report. Generated from the parent's `rbts_reports.js`; do not edit here |
| `src/firebase.js`, `src/metaReconcile.js`, `src/backup.js` | Sign-in, sync, and export / import |
| `public/` | Icons, band images, the Cloudflare `_redirects` file |

`phase1.js` and `reports.js` are copies. Change the parent's files and re-run the
parent's sync script; the parent's parity suites fail if the two apps drift.

## Commands

```
npm install        once
npm run dev        local dev server
npm run build      production build into dist/
npm run preview    serve the built dist/
npm run lint       eslint
```

Testing against the Firebase emulators, which is how the ownership rule is
checked without a second Google account, is described in `EMULATOR_TESTING.md`.

## Deploying

Cloudflare Pages builds the live site from the `main` branch of this repository.
Run `deploy.bat` from this folder. It refuses to push from any other branch,
checks every step, and prints the live address when the push has succeeded.
A push does not prove a deploy: compare the `assets/index-*.js` name the site
serves with the one in `dist/index.html`.

## Tests

The test suites live in the parent repository and cover both apps, including
this one's parse, scope and report parity. Run them from there. No suite renders
a browser, so anything that depends on a click or a layout is checked by hand
against the dated `BROWSER_CHECK_*.md` lists in the parent.
