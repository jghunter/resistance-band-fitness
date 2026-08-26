import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { collection, doc, setDoc, deleteDoc, getDoc, getDocs, query, orderBy } from 'firebase/firestore'
import { db, auth, googleProvider } from './firebase'
import {
  C, EXERCISE_NAMES, TECHNIQUES, VIDEOS, PROGRAMS,
  SESSION_FOCUS, getSessionFocus, dayName, dayShort, SLOT_LABELS, exGroup, ALL_GROUPS,
  exClass, EX_CLASS_RANK, GROUP_META, registerCustomEx, unregisterCustomEx,
  BANDS, COLOR_HEX, BAND_BRANDS, GEAR,
  GEAR_TYPES, GEAR_TYPE_LABELS, GEAR_TYPE_CAP, gearTypeCap, inferGearType,
  calcToday, PROG_REPS,
  getTechMap, getWeekTechniques,
  progSplitDays, progLengthWeeks, progDeloadWeek, progWorkWeeks, progBlockWorkouts,
  sessionForIdx, weekForIdx, wpw,
  SCHED_PRESETS, WEEKDAY_ABBR, schedDaysOf, schedKeyForDays, schedLabel,
  isDeloadWeek, isDeloadWorkout, isDeloadSession, deloadProtocolText,
  saveCustomProgram, deleteCustomProgram, getCustomPrograms, mergeCustomPrograms,
  setCustomPrograms, getCustomProgramTombstones, setCustomProgramTombstones,
  resolveProgIdx,
  getSessionEx, effSplitId, progNativeSplitId, splitsReg,
  splitScheduleCheck, weekdayMapFor,
  focusForWeekSession, focusMuscleOf, orderSlotsByFocus,
  /* progDefaultSets was USED at getOrInit/addEx but never imported — opening
     any exercise in the PWA threw ReferenceError. Introduced 2026-07-30 with
     the 1→3 set seeding change; esbuild does not flag an undeclared global. */
  progDefaultSets, TRAINING_STYLE,
  /* Belt band path inputs. Mirrored from the profile; no editor here (the HTML
     app owns it), same as defaultSets / volumeModel. */
  /* bodyMeasureNum is imported, not re-derived: the belt-default effect reads a
     landmark out of BODY_MEASURE by key, and a bare truthiness check there would
     accept the string "28" that this guard exists to refuse. */
  BODY_MEASURE, bodyMeasureComplete, bodyMeasureNum,
} from './data'
import RBTS_PHASE1 from './phase1.js'
import RBTS_REPORTS from './reports.js'
import { extractInventory } from './backup.js'
import { unwrapMeta, reconcileBandGeom, reconcileProfiles,
         unwrapCustomPrograms, reconcileCustomPrograms } from './metaReconcile.js'

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL DATE HELPER — avoid toISOString() (UTC), which rolls the date forward
// for afternoon/evening workouts in zones behind UTC (e.g. Hawaii UTC-10).
// ─────────────────────────────────────────────────────────────────────────────
const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

// ── Phase 1: ensure profile registry exists (additive · idempotent · non-destructive) ──
try { if (RBTS_PHASE1 && RBTS_PHASE1.migrateToProfiles) RBTS_PHASE1.migrateToProfiles() }
catch (e) { console.warn('RBTS_PHASE1 migrate failed', e) }
const RBTS_AP = (() => { try { return localStorage.getItem('rbts_activeProfile') || 'greg' } catch { return 'greg' } })()
const apk = (base) => (RBTS_PHASE1 ? RBTS_PHASE1.profileKey(base, RBTS_AP) : ('rbts_' + base))

// ── Per-account SETTINGS (Phase 2): start date, schedule, active program ──
// Stored locally under the active profile's namespaced keys (the same keys
// TodayTab used before) AND, when signed in, synced to users/{uid}/meta/settings
// with last-write-wins by `updatedAt` — the same reconcile pattern as the log.
function lsGet(key, def) {
  try { const s = localStorage.getItem(key); return s !== null ? JSON.parse(s) : def } catch { return def }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }
function getLocalSettings() {
  return {
    startDate: lsGet(apk('startDate'), '2026-06-01'),
    schedule:  lsGet(apk('schedule'),  'MWF'),
    progIdx:   lsGet(apk('progIdx'),   0),
    splitId:   lsGet(apk('splitId'),   ''),   // P6: global split override ('' = program native)
    updatedAt: lsGet(apk('settingsUpdatedAt'), 0),
  }
}
// Write settings to localStorage; when `uid` is given, also push to Firestore.
function persistSettings(s, uid) {
  lsSet(apk('startDate'), s.startDate)
  lsSet(apk('schedule'),  s.schedule)
  lsSet(apk('progIdx'),   s.progIdx)
  lsSet(apk('splitId'),   s.splitId ?? '')
  lsSet(apk('settingsUpdatedAt'), s.updatedAt || 0)
  if (uid) saveSettingsToFirestore(uid, s).catch(e => console.error('Save settings failed:', e))
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const widget = {
  background:C.bgWidget, border:`1px solid ${C.accentDim}`,
  borderRadius:8, boxShadow:`0 0 12px ${C.accentGlow}`, padding:16,
}
const lbl = { fontSize:10, letterSpacing:'0.12em', textTransform:'uppercase',
  color:C.textSec, display:'block', marginBottom:4 }
const readoutStyle = { fontFamily:'monospace', fontSize:18, color:C.readout,
  textShadow:`0 0 8px rgba(0,212,255,0.5)` }
const pill = (color) => ({
  display:'inline-block', padding:'2px 7px', borderRadius:4, fontSize:9,
  fontFamily:'monospace', letterSpacing:'0.1em', textTransform:'uppercase',
  fontWeight:700, background:`${color}22`, border:`1px solid ${color}66`, color,
})
const btn = (active, color=C.accent) => ({
  background: active ? `${color}22` : 'transparent',
  border:`1px solid ${active ? color : C.dimGray}`,
  color: active ? color : C.textSec,
  borderRadius:4, padding:'4px 10px', fontFamily:'monospace',
  fontSize:11, cursor:'pointer', letterSpacing:'0.08em',
  textTransform:'uppercase', transition:'all 0.15s',
})
const inputStyle = {
  background:C.bgInput, border:`1px solid ${C.accentDim}`, color:C.text,
  borderRadius:4, padding:'5px 8px', fontFamily:'monospace', fontSize:12, outline:'none',
}

// Schedule picker: preset buttons (3–6 day) PLUS a per-weekday toggle row for any
// custom set of training days. The active program's split rotates across whichever
// days are chosen, automatically. Mirrors ScheduleChooser in fitness_app.html.
function ScheduleChooser({ sched, setSched, prog, startDate }) {
  const days = schedDaysOf(sched)
  const activeKey = schedKeyForDays(days)
  // P2: optional prog/startDate light up the compatibility banner + weekday map
  const chk = prog ? splitScheduleCheck(prog, sched) : null
  const map = (prog && chk && chk.ok && chk.driftFree)
    ? weekdayMapFor(prog, startDate, sched) : null
  const toggleDay = (dn) => {
    const has = days.includes(dn)
    const nd = has ? days.filter(x => x !== dn) : days.concat([dn])
    if (nd.length === 0) return                 // never allow zero training days
    setSched(schedKeyForDays(nd))
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,maxWidth:430}}>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {SCHED_PRESETS.map(p => (
          <button key={p.key} style={btn(activeKey===p.key)} onClick={()=>setSched(p.key)}>
            {p.label} · {p.sub}
          </button>
        ))}
      </div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{fontFamily:'monospace',fontSize:10,color:C.textSec,
          letterSpacing:'0.08em',marginRight:2}}>CUSTOM</span>
        {[1,2,3,4,5,6,0].map(dn => {
          const on = days.includes(dn)
          return (
            <button key={dn} onClick={()=>toggleDay(dn)}
              style={{...btn(on), padding:'5px 8px', minWidth:30, fontSize:11}}>
              {WEEKDAY_ABBR[dn].charAt(0)}
            </button>
          )
        })}
      </div>
      <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,lineHeight:1.5}}>
        {schedLabel(sched)} — your program's split rotates across these days automatically.
      </span>
      {chk && (!chk.ok || !chk.driftFree) && (
        <div style={{border:`1px solid ${C.amber}`,borderRadius:6,padding:'8px 10px',
          display:'flex',flexDirection:'column',gap:6}}>
          <span style={{fontFamily:'monospace',fontSize:10,color:C.amber,lineHeight:1.5}}>
            ⚠ {chk.msg}
          </span>
          {chk.suggestions.length > 0 && (
            <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.textSec,
                letterSpacing:'0.08em'}}>TRY:</span>
              {chk.suggestions.map((p,i) => (
                <button key={i} onClick={()=>setSched(schedKeyForDays(p.days))}
                  style={{...btn(false),padding:'4px 8px',fontSize:10}}>{p.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {map && (
        <span style={{fontFamily:'monospace',fontSize:10,color:C.textSec,lineHeight:1.6}}>
          {map.map(m => WEEKDAY_ABBR[m.dn].toUpperCase()+' '+dayName(prog, m.sKey)).join(' · ')}
        </span>
      )}
    </div>
  )
}

// P3: global split picker — one setting, applies to the active program.
// '' = program's own split; anything else re-derives sessions per muscle.
function SplitChooser({ split, setSplit, prog }) {
  const S = splitsReg()
  const native = progNativeSplitId(prog)
  const cur = split || ''
  const nativeLbl = (S[native] && S[native].label) || native
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6,maxWidth:430}}>
      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        <button style={btn(cur==='')} onClick={()=>setSplit('')}>
          PROGRAM DEFAULT · {nativeLbl}</button>
        {Object.keys(S).map(id => (
          <button key={id} style={btn(cur===id)} onClick={()=>setSplit(id)}>{S[id].label}</button>
        ))}
      </div>
      <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,lineHeight:1.5}}>
        Sessions re-derive from the program's per-muscle exercises. Your week and
        workout count are kept when you switch.
      </span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: intensifier / segmented-set helpers (registry from phase1.js)
// A set is EITHER a simple set ({reps,bands}) OR a segmented set
// ({intensifier, segments:[{bands,reps}]}). Both may carry an optional `rir`.
// These mirror the helpers in fitness_app.html so both apps read/write the
// identical persisted shape (schemaVersion 2).
// ─────────────────────────────────────────────────────────────────────────────
const INTENS = (RBTS_PHASE1 && RBTS_PHASE1.INTENSIFIERS) ? RBTS_PHASE1.INTENSIFIERS : { straight:{label:'Straight Set',order:0} }
const INTENS_OPTS = Object.keys(INTENS).sort((a,b) => (INTENS[a].order||99)-(INTENS[b].order||99))
const intensLabel = (k) => (INTENS[k] && INTENS[k].label) || k
const setIntensifier = (s) => (s && s.intensifier) ? s.intensifier : ((s && s.drop) ? 'drop_set' : 'straight')
const isPlainSet = (s) => setIntensifier(s) === 'straight'
const DEFAULT_RIR = (() => { try {
  const ps = JSON.parse(localStorage.getItem('rbts_profiles') || '[]')
  const ap = localStorage.getItem('rbts_activeProfile') || 'greg'
  const p = ps.find(x => x.id === ap)
  return (p && typeof p.rirTarget === 'number') ? p.rirTarget : 1
} catch { return 1 } })()
// ── Phase 3: active-profile-driven progression targets (default to legacy globals) ──
/* Resolved through `population`: PROFILE_DEFAULTS < POPULATION_DEFAULTS <
   whatever the profile set explicitly. A population default NEVER overrides an
   explicit field — Greg's rirTarget of 1 stays 1 under older_adult, which
   would otherwise suggest 2. Mirrors fitness_app.html. */
const _ACTIVE_PROFILE = (() => { try {
  const ps = JSON.parse(localStorage.getItem('rbts_profiles') || '[]')
  const ap = localStorage.getItem('rbts_activeProfile') || 'greg'
  const raw = ps.find(x => x.id === ap) || null
  if (!raw) return null
  return (RBTS_PHASE1 && RBTS_PHASE1.resolveProfile) ? RBTS_PHASE1.resolveProfile(raw) : raw
} catch { return null } })()
const PROG_TARGET_REPS = (_ACTIVE_PROFILE && typeof _ACTIVE_PROFILE.progressReps === 'number') ? _ACTIVE_PROFILE.progressReps : PROG_REPS
const RIR_TARGET = (_ACTIVE_PROFILE && typeof _ACTIVE_PROFILE.rirTarget === 'number') ? _ACTIVE_PROFILE.rirTarget : DEFAULT_RIR
const REP_RANGE = (_ACTIVE_PROFILE && Array.isArray(_ACTIVE_PROFILE.repTarget) && _ACTIVE_PROFILE.repTarget.length === 2) ? _ACTIVE_PROFILE.repTarget : [8, PROG_TARGET_REPS]
const setRepsOf  = (s) => (s && Array.isArray(s.segments)) ? s.segments.reduce((a,g)=>a+(g.reps||0),0) : ((s && s.reps) || 0)
const setBandsOf = (s) => (s && Array.isArray(s.segments)) ? (((s.segments[0]||{}).bands) || []) : ((s && s.bands) || [])
// Does this set name a band ANYWHERE? setBandsOf reads only the FIRST segment,
// which is right for the ATTACH AT picker (one rig per set) but wrong as a
// "has any band" test: a drop set whose first phase is still empty would
// report none. The fold button gates on this.
const setHasAnyBand = (s) => {
  if (!s) return false
  if (Array.isArray(s.segments)) return s.segments.some(g => ((g && g.bands) || []).length > 0)
  return ((s.bands) || []).length > 0
}
// ── Per-side (L/R) logging for unilateral exercises (mirrors fitness_app.html) ──
// side is OPTIONAL and set-level (like rir): absent = bilateral, zero migration.
// Coexists with intensifiers/segments — a drop set on the left leg =
// side:"L" + segments, so partial/drop reps can differ per side naturally.
const setSide  = (s) => (s && (s.side === 'L' || s.side === 'R')) ? s.side : null
const nextSide = (cur) => cur == null ? 'L' : (cur === 'L' ? 'R' : null)
// Partial reps (SPEC_partial_reps.md): optional set-level count of partial-ROM
// reps done after the full reps. Display-only — never counted in progression,
// sseReps, or volume-load.
const partialsSfx = (s) => (s && s.partials > 0) ? ` +${s.partials}p` : ''
// Unilateral moves pre-tag the Today card's first two sets L/R. Alternating
// moves (105, 132) intentionally excluded — both sides happen inside one set.
const EX_UNILATERAL = new Set([
  5, 12, 24, 27, 29, 44, 49, 80, 91, 92, 93, 102, 103, 104, 106, 107, 108,
  118, 133, 146, 147, 152, 169, 217,
  220, 222,   // side plank row, bird dog (per-side)
])
const isUnilateral = (id) => EX_UNILATERAL.has(Number(id))
/* Seed the program's prescribed set count, not one, and a REAL rir value.
   initSets used to seed exactly ONE set, so the analyzer's 10-sets/week
   landmarks could never be satisfied and UNDER fired forever. rir was left
   null with a placeholder, so progressionState skipped the RIR cap entirely
   and READY was decided purely on rep count. Empty sets are still dropped on
   save (setHasData), so seeding three costs nothing. */
const initSets = (id, n) => {
  const count = Math.max(1, n || 1)
  const out = []
  for (let i = 0; i < count; i++) {
    if (isUnilateral(id)) {
      out.push({reps:0,bands:[],side:'L',rir:RIR_TARGET})
      out.push({reps:0,bands:[],side:'R',rir:RIR_TARGET})
    } else {
      out.push({reps:0,bands:[],rir:RIR_TARGET})
    }
  }
  return out
}
const setHasData = (s) => (s && Array.isArray(s.segments))
  ? s.segments.some(g => (g.reps||0) > 0 || (g.bands||[]).length > 0)
  : !!(s && ((s.reps||0) > 0 || (s.bands||[]).length > 0))
function setTopLoad(st) {
  if (RBTS_PHASE1 && RBTS_PHASE1.normalizeSet) {
    const n = RBTS_PHASE1.normalizeSet(st)
    return n.segments.reduce((m,seg) => {
      const sr = (seg.bands||[]).reduce((a,id)=>a+bandResById(id), 0)
      return sr > m ? sr : m
    }, 0)
  }
  return setLoad(st)
}
function setVol(st) {
  return (RBTS_PHASE1 && RBTS_PHASE1.volumeLoad) ? RBTS_PHASE1.volumeLoad(st, bandResById) : setLoad(st)*(st.reps||0)
}
// Strip empty sets and persist the canonical Phase-2 shape (matches html saveEntry)
function cleanExercises(ex) {
  const out = {}
  Object.entries(ex || {}).forEach(([id, sets]) => {
    if (!sets.some(setHasData)) return
    out[id] = sets.map(s => {
      const o = { reps: s.reps || 0, bands: (s.bands||[]).slice() }
      if (s.drop) o.drop = true
      if (s.intensifier && s.intensifier !== 'straight') o.intensifier = s.intensifier
      if (s.rir != null && s.rir !== '') o.rir = s.rir
      if (s.partials) o.partials = s.partials
      /* This function REBUILDS each set field by field, so anything not named
         here is silently discarded at save time -- the user sees the value on
         screen and it is gone from the entry. Two were:
           doubled -- the belt fold. A doubled band stamps a multiple of the
                      singled load; dropping the flag saves a doubled set as
                      singled, quietly.
           side    -- L/R. addSet auto-alternates it and progressionState
                      evaluates the two sides independently, so losing it
                      collapsed unilateral work into bilateral on every save.
         fitness_app.html keeps whole set objects (it only filters), which is
         why neither showed up there. */
      if (s.doubled) o.doubled = true
      if (s.side === 'L' || s.side === 'R') o.side = s.side
      if (Array.isArray(s.segments) && s.segments.length)
        o.segments = s.segments.map(g => ({ bands:(g.bands||[]).slice(), reps:g.reps||0, secs:g.secs }))
      return o
    })
  })
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// localStorage hook (for settings only)
// ─────────────────────────────────────────────────────────────────────────────
function useLS(key, def) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s !== null ? JSON.parse(s) : def }
    catch { return def }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
  }, [key, val])
  return [val, setVal]
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE LOG HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function loadLogFromFirestore(uid) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'workouts'), orderBy('date','desc')))
  return snap.docs.map(d => d.data())
}

/* Firestore REJECTS undefined field values outright -- setDoc throws
   "Unsupported field value: undefined (found in field load.9.stretchIn)"
   unless the app is initialised with ignoreUndefinedProperties.

   stampLoad deliberately builds a fixed-shape object and leaves the
   inapplicable keys undefined (`deltaIn` XOR `stretchIn`, plus `doubled` /
   `attachIn` / `belowRated` on non-belt sets), so EVERY entry that logged a
   band carries them. localStorage never noticed -- JSON.stringify drops
   undefined -- so the PWA appeared to save while the cloud write threw and was
   swallowed by the caller's catch. The workout survived on that one device and
   silently never synced.

   Stripping here rather than at the call sites because all three entry writes
   (save, merge-import, sign-in push) funnel through this function, and rather
   than in stampLoad because the undefined keys are correct in-memory: they mean
   "not applicable", and JSON already erases them everywhere else. */
function stripUndefined(v) {
  if (Array.isArray(v)) return v.map(stripUndefined)
  if (v && typeof v === 'object') {
    const out = {}
    Object.keys(v).forEach(k => { if (v[k] !== undefined) out[k] = stripUndefined(v[k]) })
    return out
  }
  return v
}

async function saveEntryToFirestore(uid, entry) {
  const docId = `${entry.date}_${entry.session}`
  await setDoc(doc(db, 'users', uid, 'workouts', docId), stripUndefined(entry))
}

/* A failed cloud write is INVISIBLE: localStorage already holds the entry, the
   UI says SAVED, and the only trace is a bare `console.error('Save failed:')`
   with no indication of WHICH workout or that anything is now single-copy.
   That swallow is the actual reason the undefined-field rejection survived the
   whole life of the load model -- stripUndefined fixes today's shape, but the
   next undefined-valued field would regress exactly as quietly.

   Deliberately NOT a retry, a UI banner or a sync-status indicator (out of
   scope). Just enough for a silent failure to be legible in the console: which
   path, which dates, and that this device is now the only copy. */
function logCloudWriteFailure(where, dates, err) {
  const list = (Array.isArray(dates) ? dates : [dates]).filter(Boolean)
  /* Every OTHER call site's failure leaves the entry saved locally but not
     synced. Fold migration's does not: its localStorage write sits in the
     SAME try, after the cloud write this reports on, so a failure here means
     local was never touched either -- the pre-migration data is still what's
     on disk, and it will retry on the next sign-in. */
  const tail = where === 'fold migration'
    ? 'failed to sync their fold migration: ' + (list.join(', ') || '(date unknown)') +
      '. Local storage was NOT updated either, so this device still holds the pre-migration data and will retry on the next sign-in.'
    : 'saved locally but NOT synced: ' + (list.join(', ') || '(date unknown)') +
      '. This device is now the only copy.'
  console.error(
    '[rbts] CLOUD WRITE FAILED (' + where + ') — ' +
    (list.length ? list.length : 'an unknown number of') +
    ' entr' + (list.length === 1 ? 'y' : 'ies') + ' ' + tail,
    err)
}

// Last-write-wins timestamp (ms) for a log entry. Prefers explicit updatedAt
// (stamped on every save / merge-import / edit), falls back to completedAt,
// else 0 (treated as oldest). Used to reconcile localStorage ↔ Firestore so a
// re-imported or edited correction overwrites a stale cloud copy of the same date.
function entryTs(e) {
  if (!e) return 0
  if (typeof e.updatedAt === 'number') return e.updatedAt
  const c = e.completedAt ? Date.parse(e.completedAt) : NaN
  return Number.isNaN(c) ? 0 : c
}

/* One-time conversion of the pre-2026-08-04 fold encoding. The pure function
   lives in rbts_reports.js so both apps share it; see the HTML app's
   ensureFoldMigration for the two-guard rationale (date cutoff bounds scope,
   flag gives idempotency).

   TWO flags, not one, because the PWA has TWO independent stores. A single
   flat flag let whichever path ran first (typically the signed-out
   localStorage path) mark the migration done, so the Firestore path's own
   call returned immediately without ever touching the cloud copy -- and
   because the migration does not bump updatedAt, the sign-in reconciliation
   never pushed the fix either. The cloud data then stayed on the old
   encoding permanently. `flagKey` is passed in per call site so each store
   tracks its own completion: 'rbts_foldMigration' for the two localStorage
   paths (unchanged, so anyone who already ran the old single-flag version is
   unaffected), 'rbts_foldMigration_cloud_<uid>' for Firestore, keyed by uid
   because two accounts on one device are genuinely different datasets.

   Neither flag is the correctness guarantee -- both are short-circuits. A
   localStorage flag records a fact about a DEVICE, and the reworked picker
   can now enter two REAL copies of one band into a pre-cutoff entry, which a
   second device with its own flag unset would then collapse. The guarantee is
   the per-entry `foldMigrated: true` marker migrateFoldEncoding writes, which
   travels through Firestore and through export/import. `flagKey` may be null,
   which means run REGARDLESS of any flag -- what the import path needs, since
   a flag says nothing about a backup file written weeks ago. */
const FOLD_CUTOFF = '2026-08-04'
function migrateFoldOnce(entries, flagKey) {
  // RBTS_REPORTS is a static import (top of file), so it can never itself be
  // falsy -- but reports.js is a GENERATED copy (python sync_phase_module.py)
  // and a stale one predating Task 1 would lack this method, so that half of
  // the guard stays.
  if (!RBTS_REPORTS.migrateFoldEncoding) return { entries, changedDates: [], touchedDates: [] }
  if (flagKey && localStorage.getItem(flagKey) === FOLD_CUTOFF) {
    return { entries, changedDates: [], touchedDates: [] }
  }
  let res
  try {
    res = RBTS_REPORTS.migrateFoldEncoding(entries, FOLD_CUTOFF)
  } catch (e) {
    // This runs on every load over data that can arrive from a user-imported
    // backup JSON -- a throw here must never be able to break the log load.
    // Leave the flag unset so the next load retries, and hand back the
    // entries untouched.
    console.error('[fold migration] threw, will retry next load:', e)
    return { entries, changedDates: [], touchedDates: [] }
  }
  if (res.changed.length || res.skipped.length) {
    console.log(`[fold migration] collapsed ${res.changed.length} set(s), skipped ${res.skipped.length}`)
    res.skipped.forEach(s =>
      console.log(`  SKIPPED ${s.date} ex${s.exId} set${s.set} [${s.shapes}]: ${s.reason}`))
  }
  // touchedDates is the SUPERSET: it includes entries that gained only the
  // marker. Persist by that, not by changedDates -- a marker computed and not
  // written protects nothing. On Greg's log this grows the Firestore write
  // from ~10 entries to ~32, which is the intended cost.
  const dates = [...new Set(res.changed.map(c => c.date))]
  const tDates = [...new Set(res.touched.map(c => c.date))]
  return { entries: res.log, changedDates: dates, touchedDates: tDates }
}

/* Write the whole log, read it back, byte-compare. Mirrors the HTML app's
   saveLog. Ordinarily the PWA's bare setItem is tolerable -- a normal save is
   rewritten next session -- but the migration write is the largest the app
   ever performs and is paired with a RUN-ONCE flag, so a store that truncates
   rather than throwing would set the flag over a corrupt log and the next
   JSON.parse would fall into `catch { setLog([]) }`. Signed in that recovers
   from the cloud; signed out it does not. */
function writeLogVerified(entries) {
  let json
  try { json = JSON.stringify(entries) } catch { return false }
  try {
    localStorage.setItem('rbts_log', json)
    return localStorage.getItem('rbts_log') === json
  } catch { return false }
}

/* ONE resolution of "what is my log right now", shared by the clash DIALOG and
   the merge that APPLIES its answer. They resolved it differently for exactly
   one commit and it cost a Critical: the dialog fell back to React state, the
   merge read an absent `rbts_log` as `[]`. On a freshly signed-in device --
   where React state is full and the key does not exist, which is the ordinary
   state, see logRef -- KEEP MINE therefore computed EVERY incoming entry as
   "fresh" and pushed the file's version of every clashing session to Firestore,
   destroying the user's own copy in the cloud and in localStorage.

   An absent key is NOT an empty log. `fallback` is the caller's live in-memory
   copy; only a stored ARRAY outranks it. */
function logBase(fallback) {
  try {
    const ls = JSON.parse(localStorage.getItem('rbts_log') || 'null')
    if (Array.isArray(ls)) return ls
  } catch { /* unparseable: the in-memory copy is the better answer */ }
  return Array.isArray(fallback) ? fallback : []
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE GEAR + MY-BANDS HELPERS
//   gear  → users/{uid}/gear/{itemId}   (one doc per equipment item)
//   bands → users/{uid}/meta/myBands    ({ ids: [...] })
// ─────────────────────────────────────────────────────────────────────────────
async function loadGearFromFirestore(uid) {
  const snap = await getDocs(collection(db, 'users', uid, 'gear'))
  return snap.docs.map(d => d.data())
}
async function saveGearItemToFirestore(uid, item) {
  await setDoc(doc(db, 'users', uid, 'gear', item.id), item)
}
async function deleteGearItemFromFirestore(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'gear', id))
}
async function loadMyBandsFromFirestore(uid) {
  const d = await getDoc(doc(db, 'users', uid, 'meta', 'myBands'))
  return d.exists() ? (d.data().ids || []) : null
}
async function saveMyBandsToFirestore(uid, ids) {
  await setDoc(doc(db, 'users', uid, 'meta', 'myBands'), { ids })
}
async function loadSettingsFromFirestore(uid) {
  const d = await getDoc(doc(db, 'users', uid, 'meta', 'settings'))
  return d.exists() ? d.data() : null
}
async function saveSettingsToFirestore(uid, settings) {
  await setDoc(doc(db, 'users', uid, 'meta', 'settings'), settings)
}
async function loadCustomExFromFirestore(uid) {
  const d = await getDoc(doc(db, 'users', uid, 'meta', 'customExercises'))
  return d.exists() ? d.data() : null   // { list:[...], updatedAt }
}
async function saveCustomExToFirestore(uid, payload) {
  await setDoc(doc(db, 'users', uid, 'meta', 'customExercises'), payload)
}
/* Custom programs. NOT last-write-wins like the three keys around it -- union
   by id with tombstones, because a whole-document rule silently deletes a
   program authored on the other device between syncs. reconcileCustomPrograms
   in metaReconcile.js owns and documents that policy. */
async function loadCustomProgramsFromFirestore(uid) {
  const d = await getDoc(doc(db, 'users', uid, 'meta', 'customPrograms'))
  return d.exists() ? d.data() : null   // { data:{list,tombstones}, updatedAt }
}
async function saveCustomProgramsToFirestore(uid, payload) {
  await setDoc(doc(db, 'users', uid, 'meta', 'customPrograms'), payload)
}

/* Band calibration and the training profile were localStorage-only, so a
   measurement typed on the iPad never reached the iPhone. Same
   users/{uid}/meta/{name} pattern as settings and customExercises above.

   The stored payload is WRAPPED as { data, updatedAt }: neither rbts_bandGeom
   (a bare {bandId: {...}} map) nor a profile carries a timestamp of its own.
   unwrapMeta (metaReconcile.js) treats a document with no `updatedAt` --
   including one written before this wrapper existed -- as updatedAt 0, the
   oldest possible value, so a legacy document can never look newer than a
   freshly-stamped one and discard real measurements on first sync. The
   reconcile decision itself (reconcileMeta) lives in metaReconcile.js so it
   can be unit-tested directly; this file only wires it to Firestore reads
   and localStorage writes. */
async function saveBandGeomToFirestore(uid, payload) {
  await setDoc(doc(db, 'users', uid, 'meta', 'bandGeom'), payload)
}
async function loadBandGeomFromFirestore(uid) {
  const d = await getDoc(doc(db, 'users', uid, 'meta', 'bandGeom'))
  return d.exists() ? d.data() : null
}
async function saveProfileToFirestore(uid, payload) {
  await setDoc(doc(db, 'users', uid, 'meta', 'profile'), payload)
}
async function loadProfileFromFirestore(uid) {
  const d = await getDoc(doc(db, 'users', uid, 'meta', 'profile'))
  return d.exists() ? d.data() : null
}

// ── Local (signed-out) gear + my-bands storage ──
// Phase 1 (multi-user): gear no longer auto-seeds from GEAR. New and signed-out
// users start EMPTY so nobody inherits Greg's personal inventory. Greg's own gear
// lives in his Firestore account (loaded on sign-in) and in already-saved
// localStorage on his existing devices. flattenGearSeed/GEAR are kept for a future
// optional "load starter equipment" prompt.
const GEAR_KEY = 'rbts_gear'
function flattenGearSeed(seed) {
  const out = []; let n = 0; const t = Date.now()
  seed.forEach(g => (g.items || []).forEach(it => {
    out.push({ id:`g${t}_${n++}`, brand:g.brand, name:it.name, qty:it.qty || 1,
      status:(it.status === 'preorder' ? 'inbound' : (it.status || 'owned')), note:it.note || '',
      type: inferGearType(it.name) })
  }))
  return out
}
// Backfill `type` on gear saved before the field existed (applies to both
// Firestore docs and localStorage), and retag belts stuck on "other" from
// before the belt type existed. Recomputed on every load — persisted lazily
// whenever an item is next edited in the GEAR tab.
function withGearTypes(items) {
  return (items || []).map(it => {
    if (!it.type) return { ...it, type: inferGearType(it.name) }
    if (it.type === 'other' && /belt/i.test(it.name || '')) return { ...it, type: 'belt' }
    return it
  })
}
function getLocalGear() {
  try { const raw = localStorage.getItem(GEAR_KEY); if (raw) return JSON.parse(raw) } catch {}
  return []   // no stored gear yet → start empty (do NOT seed Greg's GEAR_SEED)
}
function saveLocalGear(items) { try { localStorage.setItem(GEAR_KEY, JSON.stringify(items)) } catch {} }
function getLocalMyBands() { try { return JSON.parse(localStorage.getItem('rbts_myBands') || '[]') } catch { return [] } }
function saveLocalMyBands(ids) { try { localStorage.setItem('rbts_myBands', JSON.stringify(ids)) } catch {} }

/* Band geometry (rest length + Tension Master readings) and bodyweight.
   Kept in their own keys rather than inside BANDS, which is the synced source
   of truth for four files. Mirrors fitness_app.html.

   Both rbts_bandGeom and rbts_profiles are now ALSO synced to Firestore
   (Task 6) so a measurement or profile change follows the account across
   devices, same as gear/settings/customExercises. Each carries its own
   *UpdatedAt key, stamped on every local write, because unlike a workout log
   entry neither payload has a natural timestamp field of its own — see
   metaReconcile.js for how a document with no timestamp (a legacy write, or
   one from before this feature) is treated as the oldest possible value. */
const BAND_GEOM_KEY    = 'rbts_bandGeom'
const BAND_GEOM_TS_KEY = 'rbts_bandGeomUpdatedAt'
const PROFILES_TS_KEY  = 'rbts_profilesUpdatedAt'
const CUSTOM_PROG_TS_KEY = 'rbts_customProgramsUpdatedAt'
function localCustomProgramsUpdatedAt() {
  try { return Number(localStorage.getItem(CUSTOM_PROG_TS_KEY) || 0) } catch { return 0 }
}
function stampCustomPrograms(ts) {
  try { localStorage.setItem(CUSTOM_PROG_TS_KEY, String(ts)) } catch {}
}
/* Local edit -> stamp -> push, BEST EFFORT. Offline, the localStorage write
   and the stamp have already happened by the time this runs, and the push is
   retried by the sign-in reconcile. A failed push must never block the UI or
   lose the local edit. */
async function pushCustomPrograms(uid) {
  const ts = Date.now()
  stampCustomPrograms(ts)
  if (!uid) return
  try {
    await saveCustomProgramsToFirestore(uid, {
      data: { list: getCustomPrograms(), tombstones: getCustomProgramTombstones() },
      updatedAt: ts,
    })
  } catch (e) { console.error('Custom program push failed:', e) }
}
/* Profiles travel in the backup file too — see the export builder. Read fresh
   rather than cached: a profile imported mid-session must be exportable. */
function getLocalProfiles() {
  try { const a = JSON.parse(localStorage.getItem('rbts_profiles') || '[]'); return Array.isArray(a) ? a : [] }
  catch { return [] }
}
function localProfilesUpdatedAt() { try { return Number(localStorage.getItem(PROFILES_TS_KEY) || 0) } catch { return 0 } }
// Write the profile list locally (stamping updatedAt) and, when signed in,
// push it to Firestore. localStorage is written first and always succeeds or
// fails independently of the (best-effort) cloud push — mirrors
// saveLocalBandGeom below and persistSettings above.
function saveLocalProfiles(list, uid) {
  try { localStorage.setItem('rbts_profiles', JSON.stringify(list)) } catch { return false }
  const ts = Date.now()
  try { localStorage.setItem(PROFILES_TS_KEY, String(ts)) } catch {}
  if (uid) saveProfileToFirestore(uid, { data: list, updatedAt: ts }).catch(e => console.error('Save profile failed:', e))
  return true
}
function getLocalBandGeom() { try { return JSON.parse(localStorage.getItem(BAND_GEOM_KEY) || '{}') || {} } catch { return {} } }
function localBandGeomUpdatedAt() { try { return Number(localStorage.getItem(BAND_GEOM_TS_KEY) || 0) } catch { return 0 } }
// Write band calibration locally (stamping updatedAt) and, when signed in,
// push it to Firestore. localStorage is written first and always succeeds or
// fails independently of the (best-effort) cloud push.
function saveLocalBandGeom(g, uid) {
  try { localStorage.setItem(BAND_GEOM_KEY, JSON.stringify(g)) } catch { return false }
  const ts = Date.now()
  try { localStorage.setItem(BAND_GEOM_TS_KEY, String(ts)) } catch {}
  if (uid) saveBandGeomToFirestore(uid, { data: g, updatedAt: ts }).catch(e => console.error('Save band calibration failed:', e))
  return true
}
const BW_KEY = 'rbts_bodyweight'
function getLocalBodyweight() {
  try {
    const a = JSON.parse(localStorage.getItem(BW_KEY) || '[]')
    return Array.isArray(a)
      ? a.filter(e => e && e.date && isFinite(e.lb))
         .sort((x, y) => String(x.date).localeCompare(String(y.date)))
      : []
  } catch { return [] }
}
function saveLocalBodyweight(a) { try { localStorage.setItem(BW_KEY, JSON.stringify(a)); return true } catch { return false } }

// ── Custom exercises (GLOBAL key — shared across profiles, mirrors the HTML
// app's rbts_customExercises). Each item: {id(≥1000), name, group, cls, url?,
// start?, end?, custom:true}. Registered into the live catalog at load and
// whenever the list changes; synced to users/{uid}/meta/customExercises with
// doc-level last-write-wins (same pattern as settings).
const CUSTOM_EX_KEY    = 'rbts_customExercises'
const CUSTOM_EX_TS_KEY = 'rbts_customExercisesUpdatedAt'
function getLocalCustomEx() { try { return JSON.parse(localStorage.getItem(CUSTOM_EX_KEY) || '[]') } catch { return [] } }
function saveLocalCustomEx(list) { try { localStorage.setItem(CUSTOM_EX_KEY, JSON.stringify(list)) } catch {} }
function getLocalCustomExTs() { try { return JSON.parse(localStorage.getItem(CUSTOM_EX_TS_KEY) || '0') } catch { return 0 } }
function saveLocalCustomExTs(ts) { try { localStorage.setItem(CUSTOM_EX_TS_KEY, JSON.stringify(ts)) } catch {} }
function nextCustomExId(list) { let max = 999; list.forEach(e => { if (e.id > max) max = e.id }); return max + 1 }
// Swap the registered set from `prev` to `next`: unregister removed ids, then
// (re)register everything in next.
function applyCustomExList(prev, next) {
  const keep = new Set(next.map(e => Number(e.id)))
  ;(prev || []).forEach(e => { if (!keep.has(Number(e.id))) unregisterCustomEx(e.id) })
  next.forEach(registerCustomEx)
}
// Register persisted customs immediately so every consumer (Today, History,
// Library, program builder, CSV export) resolves them from the first render.
getLocalCustomEx().forEach(registerCustomEx)

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function resolveVideo(id) {
  const v = VIDEOS[id]
  if (!v) return null
  if (typeof v === 'string') return { url:v, embedUrl:null }
  // Extract the YouTube video id from any common URL shape: watch?v=, /shorts/,
  // youtu.be/, or /embed/. Shorts embed fine via the /embed/ID player.
  const m = v.url.match(/[?&]v=([^&]+)/) || v.url.match(/\/shorts\/([^?&/]+)/)
        || v.url.match(/youtu\.be\/([^?&/]+)/) || v.url.match(/\/embed\/([^?&/]+)/)
  if (!m) return { url:v.url, embedUrl:null }
  const vid = m[1]
  let p = 'autoplay=1&rel=0'
  if (v.start != null) p += '&start=' + v.start
  if (v.end   != null) p += '&end='   + v.end
  return {
    url:      v.start != null ? v.url + '&t=' + v.start + 's' : v.url,
    embedUrl: 'https://www.youtube.com/embed/' + vid + '?' + p,
    label:    v.label ?? null,
  }
}

function VideoModal({ embedUrl, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div onClick={onClose} style={{
      position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,
    }}>
      <div onClick={e=>e.stopPropagation()} style={{position:'relative',width:'min(600px,92vw)'}}>
        <button onClick={onClose} style={{
          position:'absolute',top:-30,right:0,background:'none',border:'none',
          color:'#fff',fontSize:13,cursor:'pointer',fontFamily:'monospace',
          letterSpacing:'0.1em',opacity:0.8,
        }}>✕ CLOSE</button>
        <div style={{position:'relative',paddingBottom:'56.25%',height:0}}>
          <iframe src={embedUrl}
            style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',
              border:'none',borderRadius:6}}
            allow="autoplay; encrypted-media"
            allowFullScreen/>
        </div>
      </div>
    </div>
  )
}

function WatchDemoButton({ id }) {
  const video = resolveVideo(id)
  const [open, setOpen] = useState(false)
  const base = {fontSize:10,fontFamily:'monospace',letterSpacing:'0.08em'}
  if (!video)
    return <span style={{...base,color:C.dimGray}}>— VIDEO PENDING —</span>
  if (!video.embedUrl)
    return <a href={video.url} target="_blank" rel="noreferrer"
             style={{...base,color:C.green,textDecoration:'none'}}>▶ WATCH DEMO</a>
  return (
    <>
      <button onClick={()=>setOpen(true)}
        style={{...base,color:C.green,background:'none',border:'none',
          cursor:'pointer',padding:0,textAlign:'left'}}>▶ WATCH DEMO</button>
      {open && <VideoModal embedUrl={video.embedUrl} onClose={()=>setOpen(false)}/>}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EXERCISE CARD (read-only, for Programs/Library tabs)
// ─────────────────────────────────────────────────────────────────────────────
function ExCard({ id, role, techKey }) {
  const name  = EXERCISE_NAMES[id] ?? `Exercise #${id}`
  const group = exGroup(id)
  const tech  = techKey ? TECHNIQUES[techKey]?.split(' — ')[0] : null
  return (
    <div style={{
      background:C.bgInput, borderRadius:6, padding:'10px 12px',
      border:`1px solid ${techKey ? C.amber+'55' : 'rgba(255,255,255,0.06)'}`,
      boxShadow: techKey ? `0 0 8px ${C.amber}22` : 'none',
      display:'flex', flexDirection:'column', gap:5,
    }}>
      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>#{id}</span>
        <span style={pill(group.color)}>{group.label}</span>
        {role && <span style={pill(C.readout)}>{role}</span>}
      </div>
      <div style={{fontFamily:'monospace',fontSize:12,color:C.text,lineHeight:1.4}}>{name}</div>
      {tech && (
        <div style={{fontSize:10,fontFamily:'monospace',color:C.amber,
          background:`${C.amber}18`,border:`1px solid ${C.amber}44`,
          borderRadius:4,padding:'2px 6px',letterSpacing:'0.06em'}}>
          ⚡ {tech}
        </div>
      )}
      <WatchDemoButton id={id}/>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION VIEW (read-only, for Programs tab)
// ─────────────────────────────────────────────────────────────────────────────
function SessionView({ prog, sKey, week }) {
  const session  = getSessionEx(prog, sKey)   // P3: native or derived
  const focus    = getSessionFocus(prog, sKey)
  const isDeload = isDeloadSession(prog, week, sKey)
  const techMap  = getTechMap(prog, week, sKey)
  const focusLabel = focusForWeekSession(prog, week, sKey)   // P5 (null for legacy)
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <span style={{fontFamily:'monospace',fontSize:22,fontWeight:700,
          color:focus.color,textShadow:`0 0 12px ${focus.color}66`}}>{sKey}</span>
        <span style={{fontFamily:'monospace',fontSize:13,color:focus.color,
          letterSpacing:'0.12em'}}>{focus.label}</span>
        {focusLabel && <span style={pill(C.readout)}>FOCUS: {String(focusLabel).toUpperCase()}</span>}
        {isDeload && <span style={pill(C.deload)}>DELOAD ≤50%</span>}
        {!isDeload && Object.keys(techMap).length > 0 &&
          <span style={pill(C.amber)}>{Object.keys(techMap).length} TECHNIQUE{Object.keys(techMap).length>1?'S':''}</span>}
      </div>
      <div>
        <span style={lbl}>PRIMARY — COMPOUND + ISOLATION</span>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {Object.entries(session.primary).map(([slot,id]) => (
            <ExCard key={slot} id={id} role={SLOT_LABELS[slot]} techKey={techMap[slot]??null}/>
          ))}
        </div>
      </div>
      <div>
        <span style={lbl}>ACCESSORIES</span>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))',gap:8}}>
          {orderSlotsByFocus(session.accessories, focusMuscleOf(focusLabel)).map(([slot,id]) => (
            <ExCard key={slot} id={id} techKey={techMap[slot]??null}/>
          ))}
        </div>
      </div>
      {isDeload && (
        <div style={{...widget,border:'1px solid rgba(168,85,247,0.3)',boxShadow:'0 0 12px rgba(168,85,247,0.15)'}}>
          <span style={lbl}>DELOAD PROTOCOL</span>
          <p style={{fontFamily:'monospace',fontSize:12,color:C.textSec,margin:0,lineHeight:1.7}}>
            {deloadProtocolText(prog)}
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BAND PICKER
// ─────────────────────────────────────────────────────────────────────────────
function BandPicker({ selected, onChange, doubled }) {
  const [open, setOpen]       = useState(false)
  const [search, setSearch]   = useState('')
  const [bFilter, setBFilter] = useState('All')
  const pickerRef             = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleOut(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOut)
    return () => document.removeEventListener('mousedown', handleOut)
  }, [open])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return BANDS.filter(b => {
      if (bFilter !== 'All' && b.brand !== bFilter) return false
      if (q) return b.brand.toLowerCase().includes(q) || b.color.toLowerCase().includes(q) ||
                     b.model.toLowerCase().includes(q) || b.res.includes(q) ||
                     (b.resKg||'').includes(q)
      return true
    })
  }, [search, bFilter])

  // Stack model: a MULTISET of band ids. A repeated id is TWO PHYSICAL BANDS of
  // that model, side by side.
  //
  // THE FOLD IS NOT HERE. `bands` (how many) and `doubled` (whether the whole
  // stack is folded on itself) are INDEPENDENT AXES; the fold is owned by the
  // set row's SINGLED/DOUBLED button. This picker used to express the fold by
  // duplicating every id, which lied about the count and handed the belt path
  // d = 1 for a folded band. The `doubled` prop is DISPLAY ONLY.
  const MAX_PER_BAND = 4
  const counts = {}; const distinct = []
  selected.forEach(id => { if (counts[id]==null){counts[id]=0;distinct.push(id)} counts[id]++ })
  const stackBand0 = distinct.length ? BANDS.find(x=>x.id===distinct[0]) : null
  const stackLen = stackBand0 ? stackBand0.lengthIn : null
  /* Delegates to the shared module, same as fitness_app.html. These were
     inline in both apps and both carried the one-or-none defect: the row
     handler called removeBandId whenever the band was already selected, so a
     second tap deleted it rather than adding a copy. */
  const STACK_OPTS = {
    maxPerBand: MAX_PER_BAND,
    lengthOf: (id) => { const b = BANDS.find(x=>x.id===id); return b ? b.lengthIn : null },
  }
  const addBand = (id) => {
    if (!BANDS.find(x=>x.id===id)) return
    onChange(RBTS_REPORTS.stackAdd(selected, id, STACK_OPTS))
  }
  const removeBandId = (id) => onChange(RBTS_REPORTS.stackRemoveAll(selected, id))
  const setCount = (id, n) => {
    if (distinct.indexOf(id) < 0) return
    const want = Math.max(1, Math.min(MAX_PER_BAND, n))
    let out = selected
    while (RBTS_REPORTS.stackCountOf(out, id) > want) out = RBTS_REPORTS.stackRemoveOne(out, id)
    while (RBTS_REPORTS.stackCountOf(out, id) < want) {
      const grown = RBTS_REPORTS.stackAdd(out, id, STACK_OPTS)
      if (grown.length === out.length) break
      out = grown
    }
    if (out !== selected) onChange(out)
  }

  return (
    <div ref={pickerRef} style={{position:'relative'}}>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,alignItems:'center'}}>
        {distinct.map(id => {
          const b = BANDS.find(x => x.id === id)
          if (!b) return null
          const hex = COLOR_HEX[b.color] || '#888'
          const cnt = counts[id]
          const step = {cursor:'pointer',color:C.dimGray,fontSize:12,lineHeight:1,
                        padding:'3px 5px',userSelect:'none'}
          return (
            <span key={id} style={{
              background:hex+'22',border:`1px solid ${hex}66`,borderRadius:4,
              padding:'2px 4px 2px 7px',fontFamily:'monospace',fontSize:9,color:C.text,
              display:'flex',alignItems:'center',gap:2,
            }}>
              <span style={{width:8,height:8,borderRadius:'50%',background:hex,flexShrink:0}}/>
              <span style={{marginRight:2}}>{b.brand.split(' ')[0]} {b.color} {b.model}</span>
              {/* Count is always shown, including at x1. A repeated id is TWO
                  PHYSICAL BANDS -- not the fold, which lives on the set row. */}
              <span title="Remove one of these bands" onClick={() => setCount(id, cnt-1)}
                style={{...step, ...(cnt<=1 ? {opacity:0.3,cursor:'default'} : {})}}>&minus;</span>
              <span title={`${cnt} physical band${cnt===1?'':'s'} of this model, side by side`}
                style={{color:cnt>1?C.amber:C.textSec,fontWeight:700,minWidth:14,textAlign:'center'}}>
                &times;{cnt}
              </span>
              <span title={cnt>=MAX_PER_BAND ? `Maximum ${MAX_PER_BAND} of one band` : 'Add another band of this model'}
                onClick={() => setCount(id, cnt+1)}
                style={{...step, ...(cnt>=MAX_PER_BAND ? {opacity:0.3,cursor:'default'} : {})}}>+</span>
              <span style={{color:C.dimGray,marginLeft:2}}>{b.res}</span>
              <span title="Remove this band" onClick={() => removeBandId(id)}
                style={{cursor:'pointer',color:C.dimGray,fontSize:14,lineHeight:1,padding:'4px 6px',margin:'-4px -2px -4px 2px'}}>&#10005;</span>
            </span>
          )
        })}
        {doubled && (
          /* Display only -- the fold is set on the SET ROW. The band ratings
             above are the PHYSICAL bands unfolded; the EFFECTIVE figure below
             the sets is what accounts for the fold. This app has no
             totalBandRes readout in this row, so the marker sits at the END
             of the tag row rather than beside a lbs range (cf. fitness_app.html). */
          <span title="This set is folded -- see the SINGLED/DOUBLED button on the set row. The band ratings above are for the bands unfolded; the EFFECTIVE figure accounts for the fold."
            style={{fontFamily:'monospace',fontSize:9,color:C.amber,
            padding:'2px 6px',background:C.amber+'18',borderRadius:3,
            border:`1px solid ${C.amber}66`,fontWeight:700}}>
            FOLDED
          </span>
        )}
        <button style={{...btn(false),fontSize:9,padding:'2px 8px'}}
          onClick={() => setOpen(o=>!o)}>
          {selected.length ? '+ STACK' : '+ BAND'}
        </button>
      </div>
      {open && (
        <div style={{
          position:'absolute',zIndex:300,top:'100%',left:0,marginTop:4,
          background:C.bgPanel,border:`1px solid ${C.accentDim}`,borderRadius:6,
          boxShadow:'0 8px 32px rgba(0,0,0,0.75)',padding:10,width:400,
          maxHeight:300,overflow:'auto',
        }}>
          <div style={{display:'flex',gap:6,marginBottom:8}}>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search brand / color / resistance"
              style={{...inputStyle,flex:1,fontSize:11}}/>
            <button style={{...btn(false,C.green),fontSize:10,padding:'4px 10px'}}
              onClick={()=>setOpen(false)}>DONE</button>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:8}}>
            {BAND_BRANDS.map(br => (
              <button key={br} style={{...btn(bFilter===br),fontSize:9,padding:'2px 6px'}}
                onClick={()=>setBFilter(br)}>{br}</button>
            ))}
          </div>
          {filtered.map(b => {
            const hex = COLOR_HEX[b.color] || '#888'
            const cnt = counts[b.id] || 0
            const lenMismatch = stackLen != null && b.lengthIn !== stackLen && cnt === 0
            return (
              <div key={b.id} onClick={() => { if(!lenMismatch){addBand(b.id)} }}
                title={cnt>0
                  ? (cnt>=MAX_PER_BAND
                      ? `Maximum ${MAX_PER_BAND} of one band — tap the ✕ to remove`
                      : `Tap to add another (you have ${cnt}) — tap the ✕ to remove`)
                  : (lenMismatch ? `Different length (${b.lengthIn}") — stack only bands of ${stackLen}"` : 'Tap to add')}
                style={{
                display:'flex',alignItems:'center',gap:8,padding:'5px 7px',
                borderRadius:4,cursor:lenMismatch?'not-allowed':'pointer',marginBottom:2,
                opacity:lenMismatch?0.4:1,
                background:cnt>0 ? C.accent+'18' : 'transparent',
                border:`1px solid ${cnt>0 ? C.accent : 'transparent'}`,
              }}>
                <span style={{width:10,height:10,borderRadius:'50%',flexShrink:0,background:hex}}/>
                <span style={{fontFamily:'monospace',fontSize:11,color:C.text,flex:1}}>
                  {b.brand} {b.color} {b.model}
                </span>
                <span style={{fontFamily:'monospace',fontSize:10,color:C.readout,flexShrink:0}}>
                  {b.res} lbs{b.resKg ? <span style={{color:C.dimGray}}> · {b.resKg} kg</span> : null}
                </span>
                <span style={{fontFamily:'monospace',fontSize:9,color:lenMismatch?C.amber:C.dimGray,flexShrink:0}}>
                  {b.lengthIn}"{lenMismatch?' ≠':''}
                </span>
                {/* The badge is the REMOVE control and stops propagation, so
                    it cannot be mistaken for another add. The row body adds. */}
                {cnt>0 && (
                  <span onClick={(e)=>{ e.stopPropagation(); removeBandId(b.id) }}
                    title={`Remove ${cnt>1 ? `all ${cnt} of these bands` : 'this band'} from the stack`}
                    style={{background:C.accent,color:'#000',borderRadius:10,padding:'1px 6px',
                      fontSize:9,fontWeight:'bold',cursor:'pointer',flexShrink:0}}>×{cnt} ✕</span>
                )}
              </div>
            )
          })}
          {filtered.length===0 && (
            <div style={{fontFamily:'monospace',fontSize:11,color:C.dimGray,padding:'8px 4px'}}>No bands match</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGED EXERCISE CARD
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GEAR PICKER — in-workout equipment selector (port of fitness_app.html's)
// Gear is logged PER EXERCISE, not per set (equipment setup doesn't change
// set-to-set the way band resistance does). Cap-1 types (bar/footplate/belt)
// behave like radios — picking a new one swaps out the old; cap-2 types
// (handle/anchor) grey out once full. Inventory comes in as a prop (App's
// Firestore-synced gear state), unlike the HTML which reads localStorage.
// ─────────────────────────────────────────────────────────────────────────────
function GearPicker({ inv, selected, onChange, bands, doubled, attachHeightIn, onAttachChange, exId, opening, onOpeningChange, bandPath, onBandPathChange }) {
  const [open, setOpen]       = useState(false)
  const [tFilter, setTFilter] = useState('All')
  const pickerRef             = useRef(null)
  /* The CUSTOM attach height AS TYPED. Until 2026-08-14 the box was driven by
     the PRICED result, so every keystroke that was not already a valid answer
     blanked it: typing 2 then 4 to reach 24 gave blank, then a fresh 4. The
     field could not be typed into at all, on ANY exercise.

     null means "not being edited", and the box then shows whatever height is
     actually recorded -- priced or not -- which is the second half of the fix:
     a stored height the model cannot price was invisible, so the warning under
     the box referred to a number nothing on screen showed and CLEAR looked
     inert while having something to clear. */
  const [customText, setCustomText] = useState(null)

  useEffect(() => {
    if (!open) return
    function handleOut(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOut)
    return () => document.removeEventListener('mousedown', handleOut)
  }, [open])

  const sel  = selected || []
  const all  = inv || []
  const byId = {}; all.forEach(g => { byId[g.id] = g })

  /* Seed the attachment height from the BELT when nothing is recorded yet.
     The landmark is a property of the belt (beltAttachDefault), and leaving it
     blank is not a neutral default — it degrades the exercise to RATED with no
     recomputation possible later, which is exactly what happened to
     2026-08-03's split squat in the HTML app. Only ever fills an EMPTY value,
     so it cannot undo a height the user picked. In an effect, not in render,
     because it calls back up into the log. */
  /* 2026-08-06: when the belt has no opinion (no belt on the rig at all, or a
     withdrawn default), a PLAIN plate rig still has a default -- the per-
     exercise grip height from plateGripDefault. Same "only ever fills an
     EMPTY value" discipline as the belt branch above. */
  /* 2026-08-10: a belt whose landmark is withdrawn by ONE adjustable extender
     is not unknowable -- the strap hangs straight down from the landmark by a
     measured amount, so beltAttachDerived COMPUTES the height instead of asking
     for it. Tried first, because where it answers there is nothing to default. */
  const selKey = sel.slice().sort().join(',')
  const gearOf = id => byId[id]
  const derNow = RBTS_REPORTS.beltAttachDerived
    ? RBTS_REPORTS.beltAttachDerived(sel, gearOf, BODY_MEASURE, opening)
    : null
  const lastDer = useRef(null)
  /* A user pressing CLEAR on a DERIVABLE rig is a deliberate choice -- "an
     explicit height always wins: a choice the user made is never overridden
     by a table" applies to clearing as much as to typing. Without this ref,
     the field goes empty for exactly one tick before the seeding effect sees
     an empty field and refills it on the same render -- CLEAR is inert.
     Records the height that was derived AND actually cleared; the effect below
     refuses to refill while the live derivation still matches it. When the
     opening (or strap) changes, the derivation no longer matches the recorded
     value and seeding resumes on its own -- no separate "resume" logic. */
  const clearedDerRef = useRef(null)
  useEffect(() => {
    if (!RBTS_REPORTS.beltAttachDefault) return
    const setH = onAttachChange || (()=>{})
    /* The whole derived-path decision lives in attachSeedDecision, in
       rbts_reports.js, where node can run it -- this component holds only the
       refs and the setter. Logic left in here is untestable: the harness cannot
       render React, and regex over source text proves nothing about a state
       machine. That is how the CLEAR ordering defect survived a green suite. */
    const dec = RBTS_REPORTS.attachSeedDecision({
      attachIn: attachHeightIn,
      derivedIn: derNow ? derNow.heightIn : null,
      lastDerivedIn: lastDer.current,
      clearedDerivedIn: clearedDerRef.current
    })
    lastDer.current = dec.lastDerivedIn
    clearedDerRef.current = dec.clearedDerivedIn
    if (dec.write != null) setH(dec.write)
    if (derNow) return
    if (attachHeightIn != null) return
    const lm = RBTS_REPORTS.beltAttachDefault(sel, gearOf)
    /* plateGripDefaultFor, not plateGripDefault: something hanging inline
       below the grip (a rope, the X Straps) puts the attachment at a height
       no table entry describes, so the default is WITHDRAWN and the field
       stays blank for the user to fill. Exactly what beltAttachDefault has
       done on the belt side since 2026-08-03. The derivation above is the one
       case where that length is KNOWN; where it is not, this still withdraws.
       The engine calls the same functions, so the seeded value and the
       computed one cannot disagree. */
    const h = lm
      ? bodyMeasureNum(BODY_MEASURE[lm])
      : (RBTS_REPORTS.beltPlateOf(sel, gearOf)
          ? RBTS_REPORTS.plateGripDefaultFor(exId, BODY_MEASURE, sel, gearOf) : null)
    if (h == null) return                      // not measured: stay blank, say so
    setH(h)
  }, [selKey, attachHeightIn, opening])

  const typeCounts = {}
  sel.forEach(id => {
    const g = byId[id]; const t = g ? (g.type || 'other') : 'other'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  })

  function toggle(id) {
    const g = byId[id]; if (!g) return
    const t = g.type || 'other'
    const cap = gearTypeCap(t)
    if (sel.indexOf(id) >= 0) { onChange(sel.filter(x => x !== id)); return }
    if (cap === 1) {
      // Radio behavior within the type — a bar swaps for a bar, never stacks.
      onChange(sel.filter(x => { const og = byId[x]; return !og || (og.type || 'other') !== t }).concat([id]))
      return
    }
    if ((typeCounts[t] || 0) >= cap) return
    onChange([...sel, id])
  }
  const removeId = (id) => onChange(sel.filter(x => x !== id))

  const filtered = all.filter(g => {
    // Inbound gear stays listed (with its amber pill) — orders arrive and get
    // used before anyone remembers to flip the status dot to owned.
    if (tFilter !== 'All' && (g.type || 'other') !== tFilter) return false
    return true
  }).sort((a, b) => {
    // Group by type (bar → footplate → handle → anchor → belt → other), then
    // brand, so items are findable in the long scrolling list.
    const ta = GEAR_TYPES.indexOf(a.type || 'other'), tb = GEAR_TYPES.indexOf(b.type || 'other')
    if (ta !== tb) return ta - tb
    const ba = (a.brand || '') + ' ' + (a.name || ''), bb = (b.brand || '') + ' ' + (b.name || '')
    return ba < bb ? -1 : ba > bb ? 1 : 0
  })

  return (
    <div ref={pickerRef} style={{position:'relative'}}>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,alignItems:'center'}}>
        {sel.map(id => {
          const g = byId[id]
          if (!g) return null
          return (
            <span key={id} style={{
              background:`${C.readout}18`,border:`1px solid ${C.readout}55`,borderRadius:4,
              padding:'2px 7px',fontFamily:'monospace',fontSize:9,color:C.text,
              display:'flex',alignItems:'center',gap:4,
            }}>
              <span style={{color:C.dimGray}}>{GEAR_TYPE_LABELS[g.type||'other']}</span>
              {g.brand} {g.name}
              <span onClick={()=>removeId(id)}
                style={{cursor:'pointer',color:C.dimGray,fontSize:14,lineHeight:1,padding:'4px 6px',margin:'-4px -4px -4px 0'}}>✕</span>
            </span>
          )
        })}
        <button style={{...btn(false),fontSize:9,padding:'2px 8px'}}
          onClick={()=>setOpen(o=>!o)}>
          {sel.length ? '+ MORE GEAR' : '+ GEAR'}
        </button>
      </div>
      {/* ── ATTACH AT ───────────────────────────────────────────────────────
          Only a footplate AND a belt together make this a belt setup, and only
          then is there an attachment height to record. A bar may also be on
          the list — that IS the normal rig (the X3 belt hangs a strap and hook
          below the bar), so it is deliberately not excluded.

          The height is per EXERCISE, not per set: the band and the doubling
          change between sets, where the belt hooks does not.

          Sub-rated options are MARKED, not hidden. A singled 41in band on a
          footplate sits below the vendor's rated span at every landmark up to
          hip height, so hiding them would leave the picker empty and the
          exercise unloggable. */}
      {(() => {
        const gearOf = (id) => byId[id]
        const plate = RBTS_REPORTS.beltPlateOf(sel, gearOf)
        if (!plate) return null
        const beltOn = RBTS_REPORTS.beltBeltPresent(sel, gearOf)
        /* No guess when a measurement is missing: the belt path degrades to
           RATED and says so, rather than inventing a hip height. A plain
           plate rig (no belt) needs the same body measurements to compute
           beltReach's width term, so the gate is unchanged -- only WHICH
           rigs reach it has widened. */
        if (!bodyMeasureComplete()) return (
          <div style={{fontFamily:'monospace',fontSize:9,color:C.amber,marginTop:6}}>
            SET BODY MEASUREMENTS IN THE HTML APP (TODAY → TRAINING STYLE) TO COMPUTE {beltOn ? 'BELT' : 'PLATE'} LOAD
          </div>
        )
        const bandId = (bands || [])[0]
        const band = bandId ? BANDS.find(b => b.id === bandId) : null
        if (!band) return (
          <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginTop:6}}>
            PICK A BAND TO CHOOSE AN ATTACHMENT HEIGHT
          </div>
        )
        /* beltAttachOptions wants a RESOLVED dims object, not the gear item —
           resolveGearDims is what turns a PWA-shaped item with no stored dims
           into the table lookup. Passing the raw item fabricates a reach.

           The landmark list comes from what sits at the band's TOP end: a
           racked bar can terminate at the shoulder, a belt never does. One
           fixed list served both rigs until 2026-08-10, which is why a front
           squat was offered three landmarks and none of them the answer.
           Guarded: reports.js is generated and lags rbts_reports.js between
           syncs, and an absent list falls back to the belt keys, not a throw. */
        const top = RBTS_REPORTS.plateTopSpan(sel, gearOf)
        const lmKeys = RBTS_REPORTS.attachLandmarkKeys
          ? RBTS_REPORTS.attachLandmarkKeys(top.kind) : undefined
        /* `plate` is the gear ITEM; resolveGearDims(plate) is its dims. The
           path resolver wants the item. */
        const bPath = RBTS_REPORTS.plateBandPathOf
          ? RBTS_REPORTS.plateBandPathOf(plate, bandPath) : null
        /* top.spanIn and bPath, both of which effectiveLoad has always used and
           this picker never did. On a singled bar rig the picker priced against
           the lifter's body width (17.25in) while the engine priced against the
           bar's attach span (26in), so the stretch printed on every landmark
           button -- and the "nothing sits above this reach" gate itself -- came
           from a reach the engine did not use. */
        const opts = RBTS_REPORTS.beltAttachOptions(
          band, getLocalBandGeom()[band.id] || null,
          RBTS_REPORTS.resolveGearDims(plate), !!doubled, BODY_MEASURE,
          lmKeys, top.spanIn, bPath)
        const setAttach = onAttachChange || (()=>{})
        /* CUSTOM, added 2026-08-03 in place of a MID-SHIN landmark: a Harambe
           belt fed through a rope or strap hangs at a VARIABLE height that no
           fixed landmark can express. Priced by beltAttachAt, the same
           arithmetic beltAttachOptions uses, so CUSTOM 28 and MID-THIGH 28 can
           never disagree about one rig. An empty landmark list no longer blocks
           the row — a typed height above the band's reach may still be riggable
           where no landmark is. */
        const isLm = opts.some(o => o.heightIn === attachHeightIn)
        const custom = (attachHeightIn != null && !isLm)
          ? RBTS_REPORTS.beltAttachAt(band, getLocalBandGeom()[band.id] || null,
              RBTS_REPORTS.resolveGearDims(plate), !!doubled, BODY_MEASURE, attachHeightIn,
              top.spanIn, bPath)
          : null
        const shown = opts.concat(custom ? [custom] : [])
        return (
          <div style={{marginTop:6}}>
            {/* "ATTACH AT" is BELT vocabulary and it leaked -- see the same
                comment in fitness_app.html. On a bar or handles nothing
                attaches to anything; one number is wanted either way, and it is
                how high the band's TOP END is off the floor at the hardest
                point of the rep. */}
            <div style={lbl}>{beltOn ? 'ATTACH AT' : 'HIGHEST POINT'}</div>
            <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginBottom:4}}>
              How high the band's TOP END is off the floor at the HARDEST point of the rep. Not where anything attaches -- on a bar or handles that is simply how high your hands are at the top. Measure it in the position you actually lift in: bent over, the bar is far lower than a standing landmark suggests.
            </div>
            {!opts.length && (() => {
              /* Two very different situations wore one message until
                 2026-08-14. A 20in band folded on a 25.625in path has NO reach
                 at all -- beltReach returns null -- and telling the user no
                 landmark sits above it sends them hunting for a taller
                 landmark that cannot exist. */
              const noReach = RBTS_REPORTS.beltReach(
                band, getLocalBandGeom()[band.id] || null,
                RBTS_REPORTS.resolveGearDims(plate), !!doubled,
                BODY_MEASURE, top.spanIn, bPath) == null
              return (
                <div style={{fontFamily:'monospace',fontSize:9,color:C.amber,marginBottom:4}}>
                  {noReach
                    ? "THIS BAND IS TOO SHORT TO BE RIGGED ON THIS PLATE BY THIS PATH — TRY A SHORTER BAND PATH, A LONGER BAND, OR SINGLE IT"
                    : "NO LANDMARK SITS ABOVE THIS BAND'S REACH — TYPE A CUSTOM HEIGHT"}
                </div>
              )
            })()}
            <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
              {opts.map(o => (
                <button key={o.k}
                  title={`${beltOn ? 'Belt hooks at' : "The band's top end is at"} ${o.heightIn} in off the floor — the band stretches `
                        + `${Math.round(o.stretchIn*10)/10} in (strain ${Math.round(o.strain*100)/100})`}
                  onClick={()=>setAttach(o.heightIn)}
                  style={{...btn(attachHeightIn === o.heightIn),fontSize:9,padding:'4px 8px'}}>
                  {o.label} {o.heightIn}&quot; · {Math.round(o.stretchIn*10)/10}&quot;
                  {o.belowRated ? ' !' : ''}{o.aboveRated ? ' ^' : ''}
                </button>
              ))}
              <span style={{display:'flex',alignItems:'center',gap:3,fontFamily:'monospace',
                fontSize:9,color:custom?C.readout:C.dimGray}}>
                CUSTOM
                <input type="number" step="0.25" min="0"
                  title={beltOn
                    ? "Floor-to-hook height, measured STANDING at the top of the rep — not where the band goes slack"
                    : "Floor to the band's top end at the HARDEST point of the rep — not where the band goes slack. On a bar or handles, how high your hands are at the top."}
                  value={customText != null ? customText
                        : (attachHeightIn != null && !isLm ? String(attachHeightIn) : '')}
                  onChange={e => {
                    setCustomText(e.target.value)
                    setAttach(e.target.value === '' ? undefined : Number(e.target.value))
                  }}
                  onBlur={() => setCustomText(null)}
                  style={{...inputStyle,width:56,fontSize:10,padding:'3px 5px'}}/>
                &quot;
                {custom && (
                  <span>· {Math.round(custom.stretchIn*10)/10}&quot;
                    {custom.belowRated ? ' !' : ''}{custom.aboveRated ? ' ^' : ''}</span>
                )}
              </span>
              {attachHeightIn != null && (
                <button title={derNow && attachHeightIn === derNow.heightIn
                  ? "Clear the attachment height — the load falls back to the vendor midpoint. Stays cleared while the strap stays where it is."
                  : "Clear the attachment height — the load falls back to the vendor midpoint"}
                  onClick={()=>{
                    /* Conditioned on what is ACTUALLY in the box, which is the
                       same branch the tooltip above uses. Marking the derivation
                       refused when the field held some OTHER height stranded it
                       blank -- see attachClearMarker. */
                    clearedDerRef.current = RBTS_REPORTS.attachClearMarker(
                      attachHeightIn, derNow ? derNow.heightIn : null)
                    setAttach(undefined)
                  }}
                  style={{...btn(false,C.dimGray),fontSize:9,padding:'4px 8px'}}>CLEAR</button>
              )}
            </div>
            {/* Shows its work rather than presenting a number from nowhere.
                Rendered only while the field STILL holds the derived value, so
                it vanishes the moment the user types over it — the line must
                never claim provenance for a figure it did not produce. */}
            {derNow && attachHeightIn === derNow.heightIn && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginTop:3}}>
                DERIVED: {derNow.landmarkLabel} {derNow.landmarkHeightIn}in − {(derNow.item.name||'').toUpperCase()} #{derNow.openingN} ({derNow.seriesIn}in)
              </div>
            )}
            {attachHeightIn != null && !isLm && !custom && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.amber,marginTop:3}}>
                THAT HEIGHT IS AT OR BELOW THE BAND&apos;S OWN REACH — THE BAND WOULD BE SLACK
              </div>
            )}
            {shown.some(o => o.belowRated) && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.textSec,marginTop:3}}>
                ! below the vendor&apos;s rated span — estimate only
              </div>
            )}
            {shown.some(o => o.aboveRated) && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.textSec,marginTop:3}}>
                ^ above the vendor&apos;s rated span — the linear fit understates real latex here
              </div>
            )}
          </div>
        )
      })()}
      {/* ── OPENING ─────────────────────────────────────────────────────────
          Adjustable gear: an item whose inline length is a CHOICE. The
          HeavyDutyBar X Straps carry seven numbered positions stamped on the
          strap, #1 FURTHEST from the hook and the longest, spanning 26.38in
          down to 3.94in — so no single recorded length describes them and
          leaving it blank would price 26 inches of strap as zero.

          Per EXERCISE, like ATTACH AT and for the same reason: the band and
          the fold change between sets, where you hooked the strap does not.

          Shown only when something adjustable is actually selected. With
          nothing chosen the engine degrades to RATED and names the item, so
          an unanswered picker is loud rather than silent. */}
      {(() => {
        const gearOf = id => byId[id]
        if (!RBTS_REPORTS.gearHasAdjustable(sel, gearOf)) return null
        const setOpening = onOpeningChange || (()=>{})
        return (
          <div style={{marginTop:6}}>
            {sel.map(id => {
              const g = byId[id]
              const opts = g ? RBTS_REPORTS.gearOpeningOptions(g) : []
              if (!opts.length) return null
              return (
                <div key={'op'+id}>
                  <div style={lbl}>{g.name.toUpperCase()} · OPENING</div>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                    {opts.map(o => (
                      <button key={o.n}
                        title={`Position ${o.n} — ${o.seriesIn} in (${o.seriesCm} cm) of inline length. Longer inline length means less band stretch, so a LIGHTER load.`}
                        onClick={()=>setOpening(o.n)}
                        style={{...btn(opening === o.n),fontSize:9,padding:'4px 8px'}}>
                        #{o.n} · {o.seriesIn}&quot;
                      </button>
                    ))}
                    {opening != null && (
                      <button title="Clear the opening — the load falls back to the vendor midpoint"
                        onClick={()=>setOpening(undefined)}
                        style={{...btn(false,C.dimGray),fontSize:9,padding:'4px 8px'}}>CLEAR</button>
                    )}
                  </div>
                </div>
              )
            })}
            {RBTS_REPORTS.gearAdjustableUnset(sel, gearOf, opening) && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.amber,marginTop:3}}>
                PICK THE POSITION YOU HOOKED — WITHOUT IT THE LOAD STAYS AT THE VENDOR MIDPOINT
              </div>
            )}
          </div>
        )
      })()}
      {/* ── BAND PATH ───────────────────────────────────────────────
          WHICH way the band is rigged on the footplate. A plate is not one
          number: the Clench takes the band lengthwise, widthwise, through one
          of its four outer slots, or between two of them — 25.625in down to
          2.75in of consumed band. Enough that a rig which is impossible one
          way is ordinary another, which is why the 2026-08-11 and 2026-08-14
          RDLs could not be logged: a 20in band folded is a 19.75in loop and
          cannot wrap that plate at all.

          Same row, same wording and same behaviour as fitness_app.html. The
          JSX is duplicated because the shared module is plain ES5 in a
          non-Babel script tag and cannot hold JSX; the PURE part is shared —
          plateBandPathOptions — so neither app builds its own path list. */}
      {(function(){
        if (!RBTS_REPORTS.plateBandPathOptions) return null
        const po = RBTS_REPORTS.plateBandPathOptions(sel, gearOf)
        if (!po) return null
        const setPath = onBandPathChange || (()=>{})
        const active = RBTS_REPORTS.plateBandPathOf(po.item, bandPath)
        return (
          <div style={{marginTop:6}}>
            <div style={lbl}>{(po.item.name||'').toUpperCase()} · BAND PATH</div>
            <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
              {po.paths.map(pth => (
                <button key={pth.k}
                  title={`${pth.l} — ${pth.consumedIn} in of band consumed by the plate `
                        + `(${pth.source}). Less consumed means the band reaches further, `
                        + `so LESS stretch and a LIGHTER load.`}
                  onClick={()=>setPath(pth.k)}
                  style={{...btn(active ? active.k === pth.k : false),fontSize:9,padding:'4px 8px'}}>
                  {pth.l} · {pth.consumedIn}&quot;{pth.source === 'measured' ? '' : ' ~'}
                </button>
              ))}
              {bandPath != null && (
                <button title="Clear the band path — the load falls back to this plate's ordinary lengthwise path"
                  onClick={()=>setPath(undefined)}
                  style={{...btn(false,C.dimGray),fontSize:9,padding:'4px 8px'}}>CLEAR</button>
              )}
            </div>
            {po.paths.length === 1 && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginTop:3}}>
                THIS PLATE TAKES THE BAND ONE WAY ONLY
              </div>
            )}
            {!active && bandPath != null && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.amber,marginTop:3}}>
                THIS PLATE DOES NOT OFFER THE RECORDED PATH — PICK ONE OR CLEAR IT
              </div>
            )}
            {po.paths.some(pth => pth.source !== 'measured') && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.textSec,marginTop:3}}>
                ~ computed from the plate&apos;s dimensions, not measured — cannot reach MEASURED
              </div>
            )}
          </div>
        )
      })()}
      {open && (
        <div style={{
          position:'absolute',zIndex:300,top:'100%',left:0,marginTop:4,
          background:C.bgPanel,border:`1px solid ${C.accentDim}`,borderRadius:6,
          boxShadow:'0 8px 32px rgba(0,0,0,0.75)',padding:10,
          width:'min(360px, calc(100vw - 48px))',
          maxHeight:320,overflow:'auto',
        }}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>EQUIPMENT FOR THIS EXERCISE</span>
            <button style={{...btn(false,C.green),fontSize:10,padding:'4px 10px'}}
              onClick={()=>setOpen(false)}>DONE</button>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:8}}>
            <button style={{...btn(tFilter==='All'),fontSize:9,padding:'2px 6px'}}
              onClick={()=>setTFilter('All')}>All</button>
            {GEAR_TYPES.map(t => (
              <button key={t} style={{...btn(tFilter===t),fontSize:9,padding:'2px 6px'}}
                onClick={()=>setTFilter(t)}>
                {GEAR_TYPE_LABELS[t]}{GEAR_TYPE_CAP[t]?` (max ${GEAR_TYPE_CAP[t]})`:''}
              </button>
            ))}
          </div>
          {all.length === 0 && (
            <div style={{fontFamily:'monospace',fontSize:11,color:C.dimGray,padding:'8px 4px'}}>
              No equipment in your inventory yet — add it in the GEAR tab
              (or tap ⤓ LOAD STARTER EQUIPMENT there).
            </div>
          )}
          {filtered.map(g => {
            const t = g.type || 'other'
            const cap = gearTypeCap(t)
            const isSel = sel.indexOf(g.id) >= 0
            const atCap = !isSel && cap !== Infinity && (typeCounts[t]||0) >= cap
            return (
              <div key={g.id}
                title={isSel ? 'Selected — tap to remove' : (atCap ? `Max ${cap} ${GEAR_TYPE_LABELS[t].toLowerCase()}${cap>1?'s':''} — tap one above to swap` : 'Tap to add')}
                onClick={()=>{ if (isSel || !atCap || cap===1) toggle(g.id) }}
                style={{
                  display:'flex',alignItems:'center',gap:8,padding:'5px 7px',
                  borderRadius:4,cursor:(atCap && cap!==1)?'not-allowed':'pointer',marginBottom:2,
                  opacity:(atCap && cap!==1)?0.4:1,
                  background:isSel ? `${C.accent}18` : 'transparent',
                  border:`1px solid ${isSel ? C.accent : 'transparent'}`,
                }}>
                <span style={pill(C.dimGray)}>{GEAR_TYPE_LABELS[t]}</span>
                <span style={{fontFamily:'monospace',fontSize:11,color:C.text,flex:1}}>{g.brand} {g.name}</span>
                {g.status==='inbound' && <span style={pill(C.amber)}>inbound</span>}
                {isSel && <span style={{background:C.accent,color:'#000',borderRadius:10,padding:'1px 6px',fontSize:9,fontWeight:'bold'}}>✓</span>}
              </div>
            )
          })}
          {filtered.length === 0 && all.length > 0 && (
            <div style={{fontFamily:'monospace',fontSize:11,color:C.dimGray,padding:'8px 4px'}}>
              No gear in this category
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LoggedExCard({ id, role, techKey, sets, onSetsChange, prevSets, progFlag, progSides, gearInv, gear, onGearChange, attachHeightIn, onAttachChange, opening, onOpeningChange, bandPath, onBandPathChange, loadStamp, entryDate, scheduledId, substituteCtx, onSubstitute }) {
  scheduledId = scheduledId || null
  substituteCtx = substituteCtx || null
  onSubstitute = onSubstitute || null
  const [showPick, setShowPick] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const name  = EXERCISE_NAMES[id] || `Exercise #${id}`
  const group = exGroup(id)
  const tech  = techKey ? (TECHNIQUES[techKey] || '').split(' — ')[0] : null

  function addSet() {
    const last = sets[sets.length-1]
    const lb = last ? (Array.isArray(last.segments) ? (((last.segments[0]||{}).bands)||[]) : (last.bands||[])) : []
    const lr = last ? (Array.isArray(last.segments) ? 0 : (last.reps||0)) : 0
    const n = {reps: lr, bands: [...lb]}
    /* Carry the fold with the stack it belongs to: a new set seeded from a
       doubled band that arrives marked SINGLED stamps a fraction of the real
       load, silently. */
    if (last && last.doubled) n.doubled = true
    // Auto-alternate sides: after a Left set the next defaults to Right.
    const ls = last ? setSide(last) : null
    if (ls === 'L') n.side = 'R'; else if (ls === 'R') n.side = 'L'
    onSetsChange([...sets, n])
  }
  function removeSet(i) { onSetsChange(sets.filter((_,idx)=>idx!==i)) }
  function updateSet(i, field, val) {
    onSetsChange(sets.map((s,idx) => idx===i ? {...s,[field]:val} : s))
  }
  // ── Phase 2: intensifier + segmented-set editing ──
  const usesSeg = (s) => { const k=setIntensifier(s); return !!(INTENS[k] && INTENS[k].usesSegments) }
  const segsOf  = (s) => Array.isArray(s.segments) ? s.segments : [{bands:(s.bands||[]).slice(), reps:s.reps||0}]
  function changeIntens(i, k) {
    onSetsChange(sets.map((ss,idx) => {
      if (idx!==i) return ss
      const n = {...ss}
      const wantSeg = !!(INTENS[k] && INTENS[k].usesSegments)
      if (k==='straight') {
        if (Array.isArray(n.segments)) { n.bands=(((n.segments[0]||{}).bands)||[]).slice(); n.reps=n.segments.reduce((a,g)=>a+(g.reps||0),0) }
        delete n.segments; delete n.intensifier; delete n.drop
      } else {
        n.intensifier=k; delete n.drop
        if (wantSeg && !Array.isArray(n.segments)) {
          n.segments=[{bands:(n.bands||[]).slice(), reps:n.reps||0}]; delete n.bands; delete n.reps
        } else if (!wantSeg && Array.isArray(n.segments)) {
          n.bands=(((n.segments[0]||{}).bands)||[]).slice(); n.reps=n.segments.reduce((a,g)=>a+(g.reps||0),0); delete n.segments
        }
      }
      return n
    }))
  }
  function updateSeg(i, segIdx, field, val) {
    onSetsChange(sets.map((ss,idx) => {
      if (idx!==i) return ss
      const n={...ss}; const segs=(n.segments||segsOf(ss)).map(g=>({...g}))
      segs[segIdx]={...segs[segIdx],[field]:val}; n.segments=segs; delete n.bands; delete n.reps; return n
    }))
  }
  function addSeg(i) {
    onSetsChange(sets.map((ss,idx) => {
      if (idx!==i) return ss
      const n={...ss}; const segs=(n.segments||segsOf(ss)).map(g=>({...g}))
      const last=segs[segs.length-1]||{bands:[],reps:0}
      segs.push({bands:(last.bands||[]).slice(), reps:0}); n.segments=segs; delete n.bands; delete n.reps; return n
    }))
  }
  function removeSeg(i, segIdx) {
    onSetsChange(sets.map((ss,idx) => {
      if (idx!==i) return ss
      const n={...ss}; const segs=(n.segments||segsOf(ss)).filter((_,gi)=>gi!==segIdx)
      n.segments=segs; delete n.bands; delete n.reps; return n
    }))
  }
  /* The set the ATTACH AT picker describes: the first one that actually names
     a band. The saved stamp uses the HEAVIEST set (bestSetLoad) — the same set
     whenever the stack doesn't change mid-exercise, which is the normal case.
     Returns {} rather than null so callers need no second guard. */
  function refSet() {
    for (let i=0;i<sets.length;i++) { if (setBandsOf(sets[i]).length) return sets[i] }
    return {}
  }
  /* The fold changes the load on BOTH paths since 2026-08-03, so the
     SINGLED/DOUBLED button shows on every set that names a band -- not only on
     a belt rig, which is how it was gated while the fold was a belt-only
     quantity. A fold with no band is meaningless, so an empty set stays clean.
     `beltRig` is still computed: it selects the tooltip wording. */
  const beltRig = (() => {
    const g = gear || []
    if (!g.length) return false
    const inv = {}; (gearInv || []).forEach(x => { inv[x.id] = x })
    const gearOf = (gid) => inv[gid]
    return !!RBTS_REPORTS.beltPlateOf(g, gearOf) && RBTS_REPORTS.beltBeltPresent(g, gearOf)
  })()

  return (
    <div style={{
      background:C.bgInput,borderRadius:6,padding:'10px 12px',
      border:`1px solid ${techKey ? C.amber+'55' : 'rgba(255,255,255,0.06)'}`,
      display:'flex',flexDirection:'column',gap:6,
    }}>
      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
        <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>#{id}</span>
        <span style={pill(group.color)}>{group.label}</span>
        {role && <span style={pill(C.readout)}>{role}</span>}
        {onSubstitute && (
          <button onClick={()=>setShowPick(!showPick)}
            title="Do a different exercise in this slot, today only"
            style={{...btn(showPick),fontSize:9,padding:'2px 8px',marginLeft:'auto'}}>
            {showPick ? 'CLOSE' : 'SUBSTITUTE'}
          </button>
        )}
      </div>
      <div style={{fontFamily:'monospace',fontSize:12,color:C.text,lineHeight:1.4}}>{name}</div>
      {scheduledId && (
        <div style={{fontFamily:'monospace',fontSize:9,color:C.amber,letterSpacing:'0.08em',
          display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <span>SUBSTITUTED FOR {EXERCISE_NAMES[scheduledId] || `#${scheduledId}`}</span>
          <button onClick={()=>{ onSubstitute(null); setShowPick(false); setShowAll(false) }}
            title="Put the scheduled exercise back"
            style={{...btn(false),fontSize:9,padding:'1px 7px'}}>REVERT</button>
        </div>
      )}
      {showPick && onSubstitute && substituteCtx && (() => {
        /* Candidates are always for the SCHEDULED exercise, never for whatever
           currently stands in for it -- otherwise a second swap re-keys against
           the wrong slot and drifts further from the program each time. */
        const base = scheduledId != null ? scheduledId : id
        const cand = RBTS_REPORTS.substituteCandidates(base, substituteCtx, { showAll })
        const nothing = !cand.sameGroupSameClass.length && !cand.sameGroup.length && !cand.other.length
        const row = exid => {
          const g = substituteCtx.groupOf(exid)
          return (
            <button key={exid}
              onClick={()=>{ onSubstitute(exid); setShowPick(false); setShowAll(false) }}
              style={{display:'flex',alignItems:'center',gap:6,width:'100%',
                background:C.bgPanel,border:`1px solid ${C.dimGray}55`,borderRadius:4,
                padding:'3px 6px',cursor:'pointer',textAlign:'left'}}>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.text,flex:1}}>
                {substituteCtx.nameOf(exid)}
              </span>
              <span style={pill(g ? g.color : C.dimGray)}>{g ? g.label : '?'}</span>
              <span style={pill(C.dimGray)}>{String(substituteCtx.classOf(exid)).toUpperCase()}</span>
            </button>
          )
        }
        const band = (label, ids) => ids.length ? (
          <div style={{marginTop:6}}>
            <span style={lbl}>{label}</span>
            <div style={{display:'flex',flexDirection:'column',gap:3,marginTop:3}}>{ids.map(row)}</div>
          </div>
        ) : null
        return (
          <div style={{border:`1px solid ${C.amber}55`,borderRadius:4,padding:8,
            maxHeight:260,overflowY:'auto'}}>
            <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,lineHeight:1.5}}>
              Today only. The program keeps prescribing {substituteCtx.nameOf(base)}.
            </div>
            {band('SAME GROUP, SAME TYPE', cand.sameGroupSameClass)}
            {band('SAME GROUP', cand.sameGroup)}
            {band('EVERYTHING ELSE', cand.other)}
            {nothing && (
              <div style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginTop:6}}>
                Nothing else shares this muscle group.
              </div>
            )}
            {!showAll && (
              <button onClick={()=>setShowAll(true)}
                style={{...btn(false),fontSize:9,padding:'2px 8px',marginTop:8}}>
                SHOW ALL EXERCISES
              </button>
            )}
          </div>
        )
      })()}
      {tech && (
        <div style={{fontSize:10,fontFamily:'monospace',color:C.amber,
          background:`${C.amber}18`,border:`1px solid ${C.amber}44`,
          borderRadius:4,padding:'2px 6px'}}>
          ⚡ {tech}
          {RBTS_REPORTS.techCautionOf(techKey) && (
            <div style={{marginTop:4,paddingTop:4,borderTop:`1px solid ${C.amber}33`,lineHeight:1.5}}>
              CAUTION — {RBTS_REPORTS.techCautionOf(techKey)}
            </div>
          )}
        </div>
      )}
      {/* Exercise-level caution. Always visible, never behind a tap: the point
          is that it is read before the set, not looked up after. Sourced from
          the canonical module so both apps carry identical wording. */}
      {RBTS_REPORTS.exCautionOf(id) && (
        <div style={{fontFamily:'monospace',fontSize:10,lineHeight:1.5,color:C.red,
          background:'rgba(239,68,68,0.10)',border:`1px solid ${C.red}55`,
          borderRadius:4,padding:'5px 8px'}}>
          CAUTION — {RBTS_REPORTS.exCautionOf(id)}
        </div>
      )}
      <WatchDemoButton id={id}/>
      {prevSets && prevSets.length > 0 && (
        <div style={{
          fontFamily:'monospace',fontSize:10,lineHeight:1.6,
          color: progFlag ? C.amber : C.textSec,
          background: (progFlag ? C.amber : C.accent)+'11',
          border:`1px solid ${progFlag ? C.amber+'55' : C.accentDim+'44'}`,
          borderRadius:4,padding:'5px 8px',
        }}>
          {progFlag
            ? <span style={{color:C.amber,fontWeight:700}}>READY TO PROGRESS{progSides
                ? ' ('+[progSides.hasL ? 'L '+(progSides.L?'✓':'–') : null,
                        progSides.hasR ? 'R '+(progSides.R?'✓':'–') : null]
                    .filter(Boolean).join(' · ')+')'
                : ''} — last: </span>
            : <span style={{color:C.dimGray}}>LAST: </span>
          }
          {prevSets.map((s,i) => {
            const bNames = (setBandsOf(s)).map(bid => {
              const b = BANDS.find(x=>x.id===bid)
              return b ? `${b.brand.split(' ')[0]} ${b.color} ${b.model} (${b.res}lbs)` : '?'
            }).join(' + ')
            return <span key={i}>{setRepsOf(s)}r{partialsSfx(s)}{setSide(s)?' '+setSide(s):''}{setIntensifier(s)!=='straight'?' ⚡':''} [{bNames||'no band'}]{i<prevSets.length-1?', ':''}</span>
          })}
        </div>
      )}
      <div style={{borderTop:'1px solid rgba(255,255,255,0.07)',paddingTop:8}}>
        <span style={{...lbl,marginBottom:2}}>LOG SETS</span>
        <div style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginBottom:6}}>
          TARGET {REP_RANGE[0]}–{REP_RANGE[1]} REPS/SET · ALL SETS ≥{PROG_TARGET_REPS} AT RIR ≤{RIR_TARGET} → MOVE UP A BAND
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:8}}>
          <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>GEAR</span>
          <GearPicker inv={gearInv} selected={gear||[]} onChange={onGearChange||(()=>{})} exId={id}
            bands={setBandsOf(refSet())} doubled={!!refSet().doubled}
            attachHeightIn={attachHeightIn} onAttachChange={onAttachChange||(()=>{})}
            opening={opening} onOpeningChange={onOpeningChange||(()=>{})}
            bandPath={bandPath} onBandPathChange={onBandPathChange||(()=>{})}/>
        </div>
        {sets.map((s,i) => {
          const seg = usesSeg(s)
          const segs = segsOf(s)
          const straight = isPlainSet(s)
          return (
            <div key={i} style={ straight
              ? {marginBottom:8,paddingBottom:2}
              : {border:`1px solid ${C.amber}33`,borderRadius:6,padding:'7px 8px',marginBottom:8,background:`${C.amber}08`} }>
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                <span style={{fontFamily:'monospace',fontSize:11,color:C.dimGray,minWidth:20,flexShrink:0}}>S{i+1}</span>
                <span onClick={()=>updateSet(i,'side', nextSide(setSide(s)) || undefined)}
                  title="Which side this set worked — tap to cycle: — bilateral · L left · R right"
                  style={{fontFamily:'monospace',fontSize:10,fontWeight:700,cursor:'pointer',userSelect:'none',
                    color: setSide(s) ? C.readout : C.dimGray,
                    border:`1px solid ${setSide(s) ? C.readout+'66' : 'rgba(255,255,255,0.12)'}`,
                    borderRadius:4,padding:'5px 7px',flexShrink:0,minWidth:12,textAlign:'center'}}>
                  {setSide(s) || '—'}
                </span>
                <select value={setIntensifier(s)} title="Intensifier used on this set"
                  onChange={e=>changeIntens(i,e.target.value)}
                  style={{background:C.bgInput,
                    color:straight?C.dimGray:C.amber,
                    border:`1px solid ${straight?'rgba(255,255,255,0.12)':C.amber+'66'}`,
                    borderRadius:4,padding:'6px 4px',fontSize:10,fontFamily:'monospace',flexShrink:0,maxWidth:150}}>
                  {INTENS_OPTS.map(k => <option key={k} value={k}>{k==='straight'?'— none —':intensLabel(k)}</option>)}
                </select>
                <div style={{display:'flex',alignItems:'center',gap:3,flexShrink:0}}>
                  <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>RIR</span>
                  <input type="number" min="0" max="9"
                    value={s.rir==null?'':s.rir} placeholder={String(DEFAULT_RIR)}
                    title="Reps in reserve for the whole set — how many more you could have done. Pre-filled with your profile target; change it if the set actually went differently."
                    onChange={e=>{const v=e.target.value; updateSet(i,'rir', v===''?undefined:Math.max(0,parseInt(v)||0))}}
                    style={{...inputStyle,width:34,textAlign:'center',padding:'6px 3px',fontSize:12}}/>
                </div>
                {(setHasAnyBand(s) || !!s.doubled) && (
                  <button
                    onClick={()=>updateSet(i,'doubled', s.doubled ? undefined : true)}
                    title={'DOUBLED = the whole stack is folded over on itself. This is a '
                      + 'SEPARATE axis from how many bands you logged: two of the same band '
                      + 'side by side is a count of 2 on the band tag, not a fold. Folding '
                      + 'halves the free length at the same range of motion, so it is a big '
                      + 'jump -- see the EFFECTIVE figure, not the band ratings.'
                      + (beltRig ? " On this belt rig it also halves the loop's rest length." : '')}
                    style={{...btn(!!s.doubled),fontSize:9,padding:'5px 7px',flexShrink:0}}>
                    {s.doubled ? 'DOUBLED' : 'SINGLED'}
                  </button>
                )}
                <span style={{flex:1}}></span>
                {sets.length > 1 && (
                  <button style={{...btn(false,C.red),fontSize:11,padding:'6px 10px',flexShrink:0}}
                    onClick={()=>removeSet(i)}>✕</button>
                )}
              </div>
              {seg ? (
                <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:6}}>
                  {segs.map((g,gi) => (
                    <div key={gi} style={{display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap'}}>
                      <span style={{fontFamily:'monospace',fontSize:10,color:C.amber,minWidth:30,paddingTop:9,flexShrink:0}}
                        title="Resistance phase / drop">▼{gi+1}</span>
                      <div style={{flex:1,minWidth:150}}>
                        <BandPicker selected={g.bands||[]} doubled={!!s.doubled} onChange={v=>updateSeg(i,gi,'bands',v)}/>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:2,flexShrink:0}}>
                        <button style={{...btn(false),padding:'6px 11px',fontSize:14}}
                          onClick={()=>updateSeg(i,gi,'reps',Math.max(0,(g.reps||0)-1))}>−</button>
                        <input type="number" min="0" max="999" value={g.reps||''} placeholder="0"
                          onChange={e=>updateSeg(i,gi,'reps',Math.max(0,parseInt(e.target.value)||0))}
                          style={{...inputStyle,width:46,textAlign:'center',padding:'6px 4px',fontSize:13}}/>
                        <button style={{...btn(false),padding:'6px 11px',fontSize:14}}
                          onClick={()=>updateSeg(i,gi,'reps',(g.reps||0)+1)}>+</button>
                        <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginLeft:2}}>reps</span>
                      </div>
                      {segs.length > 1 && (
                        <button style={{...btn(false,C.red),fontSize:11,padding:'6px 10px',flexShrink:0}}
                          onClick={()=>removeSeg(i,gi)}>✕</button>
                      )}
                    </div>
                  ))}
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <button style={{...btn(false,C.amber),fontSize:10,padding:'5px 10px'}}
                      onClick={()=>addSeg(i)}>+ PHASE / DROP</button>
                    <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>
                      {segs.reduce((a,g)=>a+(g.reps||0),0)} total reps · one RIR for the whole set
                    </span>
                    <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>+P</span>
                    <input type="number" min="0" max="99" value={s.partials==null?'':s.partials} placeholder="0"
                      title="Partial reps at the end of the whole set (blank = none)"
                      onChange={e=>{const v=e.target.value; updateSet(i,'partials', v===''?undefined:Math.max(0,parseInt(v)||0))}}
                      style={{...inputStyle,width:34,textAlign:'center',padding:'6px 3px',fontSize:12}}/>
                  </div>
                </div>
              ) : (
                <div style={{display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap',marginTop:6}}>
                  <div style={{flex:1,minWidth:160}}>
                    <BandPicker selected={s.bands||[]} doubled={!!s.doubled} onChange={v=>updateSet(i,'bands',v)}/>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:2,flexShrink:0}}>
                    <button style={{...btn(false),padding:'6px 11px',fontSize:14}}
                      onClick={()=>updateSet(i,'reps',Math.max(0,(s.reps||0)-1))}>−</button>
                    <input type="number" min="0" max="999" value={s.reps||''} placeholder="0"
                      onChange={e=>updateSet(i,'reps',Math.max(0,parseInt(e.target.value)||0))}
                      style={{...inputStyle,width:46,textAlign:'center',padding:'6px 4px',fontSize:13}}/>
                    <button style={{...btn(false),padding:'6px 11px',fontSize:14}}
                      onClick={()=>updateSet(i,'reps',(s.reps||0)+1)}>+</button>
                    <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginLeft:2}}>reps</span>
                    <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginLeft:6}}>+P</span>
                    <input type="number" min="0" max="99" value={s.partials==null?'':s.partials} placeholder="0"
                      title="Partial reps done after the full-ROM reps (blank = none)"
                      onChange={e=>{const v=e.target.value; updateSet(i,'partials', v===''?undefined:Math.max(0,parseInt(v)||0))}}
                      style={{...inputStyle,width:34,textAlign:'center',padding:'6px 3px',fontSize:12}}/>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <button style={{...btn(false,C.green),fontSize:11,padding:'6px 12px'}} onClick={addSet}>+ SET</button>
      </div>
      {(() => {
        // The card can hold sets on different bands (e.g. a lighter warm-up
        // set before the working sets). bestSetLoad picks the HEAVIEST set --
        // the same selection stampLoad uses to decide what this exercise's
        // load means at save time -- rather than merging bands across sets
        // into a stack nobody actually wore. Display only: stampLoad (called
        // at save) is the only thing that persists a `load` value.
        //
        // The attach height goes in as the fourth argument (a BARE NUMBER —
        // stampLoad's fourth is a MAP, effectiveLoad's is an options object)
        // or the card would show a RATED figure while the save stamped a
        // belt-path one, and the two would silently disagree.
        //
        // `id` goes in as the fifth argument (exId) -- bestSetLoad needs it to
        // resolve a per-exercise PLATE_GRIP_DEFAULT. Without it this live card
        // recomputed range-of-motion-blind while the saved stamp (stampLoad,
        // which always passes exId) did not, so the number on screen
        // mid-workout could silently disagree with what got saved.
        const e = RBTS_REPORTS.bestSetLoad(
          makeReportCtx({ log: [], gear: gearInv, myBands: [] }), sets, gear || [], attachHeightIn, id, opening, bandPath)
        if (!e || e.lb == null) return null
        // The chip is not decoration: RATED is a vendor midpoint at an
        // unstated stretch, MODELED is a curve fit evaluated at a gear-derived
        // stretch, and only MEASURED reflects real gauge readings. Showing a
        // number without this would invite reading a vendor guess as fact.
        const PROV_COLOR = { MEASURED: C.green, MODELED: '#7ecfff', RATED: C.dimGray }
        // The fold migration never rewrites a frozen stamp -- it only marks
        // `era: 'pre-fold'` on stamps whose bands it changed. The EFFECTIVE
        // readout above always recomputes under the CURRENT fold model, so a
        // migrated set can show a number that silently disagrees with what
        // was actually saved. Surface the stamp so that disagreement is
        // never invisible. Nothing here reads or writes the stamp otherwise.
        const preFoldLb = (loadStamp && loadStamp.era === 'pre-fold' && loadStamp.lb != null) ? loadStamp.lb : null
        // stampPredatesPlateGeom needs a gearOf lookup over the FULL inventory
        // (gearInv), not just this exercise's selected ids (gear).
        const invById = {}; (gearInv || []).forEach(g => { invById[g.id] = g })
        const gearOf = gid => invById[gid]
        return (
          <div>
            <div style={{display:'flex',alignItems:'baseline',gap:6,marginTop:4,flexWrap:'wrap'}}>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.textSec}}>
                EFFECTIVE {e.lb.toFixed(1)} lb
              </span>
              <span style={{...pill(PROV_COLOR[e.provenance] || C.dimGray), fontSize:9}}
                title={e.basis || ''}>
                {e.provenance}
              </span>
              {/* The stretch is shown beside the number on purpose: an
                  unauditable load is how `seriesIn: 40` survived for months.
                  `doubled` moved OUT of the belt-path branch on 2026-08-04,
                  matching fitness_app.html. The fold has changed the load on
                  both paths since 2026-08-03, so a non-belt doubled set was
                  showing a folded number with nothing on screen saying so --
                  and so were `below rated span` / `above rated span`. */}
              {(e.attachHeightIn != null || e.doubled) && (
                <span style={{fontFamily:'monospace',fontSize:9,color:C.textSec}}>
                  {e.attachHeightIn != null ? ` · ${Math.round(e.stretchIn*10)/10}" stretch` : ''}
                  {e.doubled ? ' · doubled' : ''}
                  {e.belowRated ? ' · below rated span' : ''}
                  {e.aboveRated ? ' · above rated span' : ''}
                </span>
              )}
            </div>
            {/* The figure is a PEAK, not an average across the rep -- the
                omission that let a perceived average across 20 reps get
                compared against a computed peak and read as an overshoot.
                romBlind marks a figure the reference-strain path computed
                with no knowledge of the actual range of motion (it holds
                path length at twice the band's rest length always -- see
                OPEN_load_model_limitations.md). */}
            <div style={{fontSize:9,color:C.dimGray}}>
              peak, at the hardest point of the rep
              {e.romBlind ? ' — computed without a range of motion' : ''}
            </div>
            {RBTS_REPORTS.stampPredatesPlateGeom(entryDate, gear, gearOf, id) && (
              <div style={{fontSize:9,color:C.amber}}>
                stamped before the plate-geometry fix
              </div>
            )}
            {preFoldLb != null && (
              <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginTop:2}}
                title="This set was logged when a folded band was recorded as two separate bands. The stamp is frozen at what the app believed that day; the figure above is what the current model computes.">
                stamped {preFoldLb.toFixed(1)} lb before the fold fix
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGED SESSION VIEW
// ─────────────────────────────────────────────────────────────────────────────
function LoggedSessionView({ prog, sKey, week, exercises, onExercisesChange, todayDate, log, focusLabel, gearInv, gear, onGearChange, attach, onAttachChange, opening, onOpeningChange, bandPath, onBandPathChange, subs, onSubsChange }) {
  /* Defaulted in the body, not the signature: several parity assertions match
     these signatures with [^}]*, which a `= {}` default silently breaks. */
  subs = subs || {}
  onSubsChange = onSubsChange || function(){}
  const session  = getSessionEx(prog, sKey)   // P3: native or derived
  const focus    = getSessionFocus(prog, sKey)
  const isDeload = isDeloadSession(prog, week, sKey)
  const techMap  = getTechMap(prog, week, sKey)

  const [showAdd, setShowAdd] = useState(false)
  const [addSrch, setAddSrch] = useState('')
  function getOrInit(id) { return exercises[id] || initSets(id, progDefaultSets(prog)) }
  function updateEx(id, sets) { onExercisesChange({...exercises, [id]:sets}) }
  function addEx(id) {
    const key = String(id)
    if (exercises && exercises[key]) { setShowAdd(false); setAddSrch(''); return }
    onExercisesChange({...exercises, [key]:initSets(id, progDefaultSets(prog))})
    setShowAdd(false); setAddSrch('')
  }
  function removeEx(id) {
    const next = {...exercises}; delete next[String(id)]; onExercisesChange(next)
    // Keep the per-exercise gear map scoped to exercises that are actually logged.
    if (gear && gear[String(id)] && onGearChange) {
      const g = {...gear}; delete g[String(id)]; onGearChange(g)
    }
    // Same for the belt attachment height — same shape, same lifecycle.
    if (attach && attach[String(id)] != null && onAttachChange) {
      const a = {...attach}; delete a[String(id)]; onAttachChange(a)
    }
    // And the adjustable-gear opening.
    if (opening && opening[String(id)] != null && onOpeningChange) {
      const o = {...opening}; delete o[String(id)]; onOpeningChange(o)
    }
    // And the footplate band path.
    if (bandPath && bandPath[String(id)] != null && onBandPathChange) {
      const b = {...bandPath}; delete b[String(id)]; onBandPathChange(b)
    }
  }
  function updateExGear(id, ids) {
    if (onGearChange) onGearChange({...(gear||{}), [String(id)]: ids})
  }
  /* Belt attachment height per exercise id — one value per exercise, not per
     set (the band and the doubling change set to set; where the belt hooks
     does not). undefined removes the key rather than storing a hole. */
  function updateAttach(id, h) {
    if (!onAttachChange) return
    const next = {...(attach||{})}
    if (h == null) delete next[String(id)]; else next[String(id)] = h
    onAttachChange(next)
  }
  /* Which stamped position an adjustable item is hooked at — same shape and
     lifecycle as the attach map above. */
  function updateOpening(id, n) {
    if (!onOpeningChange) return
    const next = {...(opening||{})}
    if (n == null) delete next[String(id)]; else next[String(id)] = n
    onOpeningChange(next)
  }
  /* The footplate band path, same shape. The guard is a non-empty STRING, not
     isFinite: a path key is a string and isFinite('len') is false, so copying
     the opening's guard would drop every path silently. */
  function updateBandPath(id, k) {
    if (!onBandPathChange) return
    const next = {...(bandPath||{})}
    if (typeof k !== 'string' || !k) delete next[String(id)]; else next[String(id)] = k
    onBandPathChange(next)
  }

  function getPrevSets(exerciseId) {
    const found = log
      .filter(e => e.exercises && e.exercises[exerciseId] && e.date < todayDate)
      .sort((a,b) => b.date.localeCompare(a.date))
    return found[0] ? found[0].exercises[exerciseId] : null
  }
  /* The frozen stamp for TODAY'S already-saved entry, keyed by exercise id --
     computed once per render, not once per card. `log` already arrives as a
     prop here, so there's no storage to reach for. Only an entry that was
     already saved (same date + session) carries one; a fresh, unsaved
     session has none, and LoggedExCard degrades that to "render nothing". */
  const savedLoad = (log.find(e => e && e.date === todayDate && e.session === sKey) || {}).load || {}
  /* Recording a substitution MOVES NOTHING: sets, gear, attach, opening and
     band path already logged against the scheduled exercise stay keyed to it,
     so REVERT brings it back intact. */
  function setSub(schedId, perfId) {
    const next = { ...subs }
    if (perfId == null || String(perfId) === String(schedId)) delete next[String(schedId)]
    else next[String(schedId)] = Number(perfId)
    onSubsChange(next)
  }
  /* The lookups substituteCandidates needs, built once per render. */
  const subCtx = {
    allExerciseIds: () => Object.keys(EXERCISE_NAMES).map(Number),
    groupOf: exid => exGroup(Number(exid)),
    classOf: exid => exClass(Number(exid)),
    nameOf:  exid => EXERCISE_NAMES[exid] || `Exercise #${exid}`,
  }
  function renderCard(slot, id, role) {
    /* schedId is what the PROGRAM prescribes; effId is what is actually being
       done. Everything downstream uses effId because it all describes the
       performed lift. Only the header uses schedId. */
    const schedId = Number(id)
    const effId = subs[String(schedId)] != null ? Number(subs[String(schedId)]) : schedId
    const prev = getPrevSets(String(effId))
    // Progression flag lives in RBTS_REPORTS.progressionState so the in-workout
    // card, the printed setup sheet and the HTML app all agree. Same rules:
    // double progression, RIR gate, independent L/R sides, deload entries and
    // drop sets excluded.
    // NOTE: this also FIXES a PWA-only bug. The previous inline version applied
    // PROG_TARGET_REPS to every exercise, so a time-based hold (plank, carry)
    // flagged READY at 12 seconds; the module applies the 30-second threshold to
    // those six ids, matching fitness_app.html.
    const ps = RBTS_REPORTS.progressionState(
      makeReportCtx({ log, gear: gearInv, myBands: [] }), effId, todayDate)
    const progSides = ps.sides
    const progFlag  = ps.ready
    const stalled   = ps.stalled
    return (
      <LoggedExCard key={slot} id={effId} role={role}
        techKey={techMap[slot]||null}
        sets={getOrInit(effId)} onSetsChange={s=>updateEx(effId,s)}
        prevSets={prev} progFlag={progFlag} progSides={progSides} stalled={stalled}
        gearInv={gearInv} gear={(gear||{})[String(effId)]||[]}
        onGearChange={ids=>updateExGear(effId,ids)}
        attachHeightIn={(attach||{})[String(effId)]}
        onAttachChange={h=>updateAttach(effId,h)}
        opening={(opening||{})[String(effId)]}
        bandPath={(bandPath||{})[String(effId)]}
        onBandPathChange={k=>updateBandPath(effId,k)}
        onOpeningChange={n=>updateOpening(effId,n)}
        entryDate={todayDate}
        loadStamp={savedLoad[String(effId)]}
        scheduledId={effId === schedId ? null : schedId}
        substituteCtx={subCtx}
        onSubstitute={newId => setSub(schedId, newId)}/>
    )
  }

  const prescribedIds = {}
  Object.values(session.primary).forEach(id => { prescribedIds[String(id)] = true })
  Object.values(session.accessories).forEach(id => { prescribedIds[String(id)] = true })
  /* A substitute's sets are keyed by the PERFORMED id, which is not one of the
     program's slots -- without this it renders TWICE, once in its slot and
     again under ADDED EXERCISES. Conditional on the SCHEDULED id being
     prescribed this session, so a stale key cannot suppress a real addition. */
  Object.keys(subs).forEach(schedId => {
    if (prescribedIds[schedId]) prescribedIds[String(subs[schedId])] = true
  })
  const extraIds = Object.keys(exercises||{}).filter(id => !prescribedIds[id])
  let srchResults = []
  if (addSrch.trim()) {
    const q = addSrch.toLowerCase()
    srchResults = Object.entries(EXERCISE_NAMES)
      .filter(e => String(e[1]).toLowerCase().indexOf(q) >= 0)
      .map(e => parseInt(e[0])).slice(0,12)
  }
  function renderExtra(id) {
    const prev = getPrevSets(String(id))
    return (
      <div key={'x'+id} style={{position:'relative'}}>
        <button onClick={()=>removeEx(id)} title="Remove exercise"
          style={{position:'absolute',top:4,right:4,zIndex:2,background:C.bgPanel,
            color:C.amber,border:`1px solid ${C.amber}66`,borderRadius:4,
            fontSize:11,lineHeight:1,cursor:'pointer',padding:'2px 6px'}}>✕</button>
        <LoggedExCard id={id} role={'added'} techKey={null}
          sets={getOrInit(id)} onSetsChange={s=>updateEx(id,s)}
          prevSets={prev} progFlag={false}
          gearInv={gearInv} gear={(gear||{})[String(id)]||[]}
          onGearChange={ids=>updateExGear(id,ids)}
          attachHeightIn={(attach||{})[String(id)]}
          onAttachChange={h=>updateAttach(id,h)}
          opening={(opening||{})[String(id)]}
          bandPath={(bandPath||{})[String(id)]}
          onBandPathChange={k=>updateBandPath(id,k)}
          onOpeningChange={n=>updateOpening(id,n)}
          entryDate={todayDate}
          loadStamp={savedLoad[String(id)]}/>
      </div>
    )
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <span style={{fontFamily:'monospace',fontSize:22,fontWeight:700,
          color:focus.color,textShadow:`0 0 12px ${focus.color}66`}}>{sKey}</span>
        <span style={{fontFamily:'monospace',fontSize:13,color:focus.color,
          letterSpacing:'0.12em'}}>{focus.label}</span>
        {focusLabel && <span style={pill(C.readout)}>FOCUS: {String(focusLabel).toUpperCase()}</span>}
        {isDeload && <span style={pill(C.deload)}>DELOAD 50%</span>}
      </div>
      <div>
        <span style={lbl}>PRIMARY</span>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {Object.entries(session.primary).map(([slot,id]) => renderCard(slot,id,SLOT_LABELS[slot]))}
        </div>
      </div>
      <div>
        <span style={lbl}>ACCESSORIES</span>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
          {orderSlotsByFocus(session.accessories, focusMuscleOf(focusLabel)).map(([slot,id]) => renderCard(slot,id,null))}
        </div>
      </div>
      {extraIds.length > 0 && (
        <div>
          <span style={lbl}>ADDED EXERCISES</span>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
            {extraIds.map(id => renderExtra(id))}
          </div>
        </div>
      )}
      <div>
        <button style={{...btn(showAdd,C.green),fontSize:9,padding:'3px 10px'}}
          onClick={()=>setShowAdd(v=>!v)}>+ ADD EXERCISE TO THIS SESSION</button>
        {showAdd && (
          <div style={{background:C.bgInput,borderRadius:6,padding:10,marginTop:8,border:`1px solid ${C.accentDim}`}}>
            <input value={addSrch} onChange={e=>setAddSrch(e.target.value)}
              placeholder="Search by name, muscle group..."
              style={{...inputStyle,width:'100%',marginBottom:6,boxSizing:'border-box'}}/>
            <div style={{maxHeight:200,overflow:'auto'}}>
              {srchResults.map(id => {
                const grp = exGroup(id)
                const already = !!(exercises && exercises[String(id)])
                return (
                  <div key={id} onClick={()=>addEx(id)}
                    style={{display:'flex',alignItems:'center',gap:8,padding:'5px 7px',
                      borderRadius:4,cursor:'pointer',marginBottom:2,
                      background:already?`${C.accent}18`:'transparent',
                      border:`1px solid ${already?C.accent+'44':'transparent'}`}}>
                    <span style={pill(grp.color)}>{grp.label}</span>
                    <span style={{fontFamily:'monospace',fontSize:11,color:C.text,flex:1}}>#{id} {EXERCISE_NAMES[id]||id}</span>
                    {already
                      ? <span style={{color:C.green,fontSize:10}}>✓ added</span>
                      : <span style={{color:C.dimGray,fontSize:10}}>tap to add</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {isDeload && (
        <div style={{...widget,border:'1px solid rgba(168,85,247,0.3)'}}>
          <span style={lbl}>DELOAD PROTOCOL</span>
          <p style={{fontFamily:'monospace',fontSize:12,color:C.textSec,margin:0,lineHeight:1.7}}>
            {deloadProtocolText(prog)}
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STRENGTH MONITOR — estimated-load + volume tracking
// ─────────────────────────────────────────────────────────────────────────────
let _BAND_RES = null, _BAND_RES_N = -1
// ── Reports: ctx seam + print / markdown / clipboard output ───────────────
// Mirrors fitness_app.html's plumbing. Data arrives as arguments because the
// PWA holds log / gear / myBands in App state rather than reading localStorage.
function makeReportCtx({ log, gear, myBands }) {
  const gearList = gear || []
  const bands = myBands || []
  return {
    log: log || [],
    programs: PROGRAMS,
    // Profile-driven progression targets, NOT the module's fallbacks.
    progressReps: PROG_TARGET_REPS,
    rirTarget: RIR_TARGET,
    /* "standard" (weekly set landmarks apply) | "hit" (one set to failure —
       landmarks withheld, balance judged on prescribed share). Mirrors
       fitness_app.html; set there, read here. */
    volumeModel: TRAINING_STYLE.volumeModel,
    bandOf: (id) => BANDS.find(b => b.id === id) || null,
    gearOf: (id) => gearList.find(g => g.id === id) || null,
    /* Band calibration -- rest length and Tension Master readings. Without
       this the load model silently falls back to the catalog's NOMINAL loop
       length, so every stretch figure is wrong by however much the band
       differs from its advertised size. Mirrors fitness_app.html. */
    bandGeomOf: (id) => getLocalBandGeom()[id] || null,
    /* Body landmarks for the belt/footplate band path. Without these,
       effectiveLoad degrades every belt exercise to RATED and says why --
       it never guesses a hip height. Mirrors fitness_app.html; set there,
       read here. */
    body: BODY_MEASURE,
    nameOf: (id) => EXERCISE_NAMES[id] || ('#' + id),
    groupOf: (id) => exGroup(Number(id)),
    classOf: (id) => exClass(Number(id)),
    sessionExOf: getSessionEx,
    techMapOf: getTechMap,
    // TECHNIQUES maps key -> one long description STRING, not an object with a
    // .name. Take the part before the em dash as a short label.
    techLabelOf: (k) => {
      const d = TECHNIQUES[k]
      if (typeof d === 'string' && d.length) {
        const cut = d.split(/\s+[\u2014-]\s+/)[0]
        if (cut && cut.length < 40) return cut
      }
      return String(k).replace(/^\d+_/, '').replace(/_/g, ' ')
    },
    intensLabelOf: (k) => (INTENS[k] && INTENS[k].label) || k,
    orderSlots: (obj, focusLabel) => orderSlotsByFocus(obj, focusMuscleOf(focusLabel)),
    initSetsOf: (id) => initSets(id).map(x => (x.side ? { side: x.side } : {})),
    suggestOf: (bandIds) => suggestProgressionPWA(bandIds, bands),
    // the PWA has no sessionDisplay; dayName is the equivalent and is imported
    sessionLabelOf: (p, sKey) => dayName(p, sKey),
    deloadOf: (e) => {
      const p = PROGRAMS.find(x => x.id === e.programId)
      return p ? isDeloadSession(p, e.week, e.session) : e.week === 6
    },
    splitDaysOf: progSplitDays,
    blockWorkoutsOf: progBlockWorkouts,
    progOf: (id) => PROGRAMS.find(p => p.id === id) || null,
  }
}

// Smallest concrete next step: stack the lightest owned band, or step up within
// the same brand+length family. Mirrors fitness_app.html's suggestProgression,
// which does not exist in the PWA.
const bandLabel = (b) => `${b.brand.split(' ')[0]} ${b.color}${b.model ? ' ' + b.model : ''}`

/* Next stack to try, ranked toward a +10% step.
   Delegates to RBTS_REPORTS.stackSuggestions — the BandStack engine already
   written for Rails, C and the static /bands page, verified byte-identical to
   the Rails implementation. The previous logic here ("next band up in the same
   brand+length family, or add the lightest band you own") was a MEDIAN +43%
   step across the catalog. Doubling is deliberately not offered: the 2x model
   holds at matched percentage elongation, not at real ROM. */
function suggestProgressionPWA(lastBands, myBands) {
  if (!lastBands || lastBands.length === 0) return null
  const curBands = lastBands.map(id => BANDS.find(b => b.id === id)).filter(Boolean)
  if (!curBands.length) return null

  let owned = myBands.length ? BANDS.filter(b => myBands.includes(b.id)) : BANDS
  if (!owned.length) owned = BANDS
  // Bands only stack when their loop lengths match.
  const pool = owned.filter(b => b.lengthIn === curBands[0].lengthIn)
  if (!pool.length) return null

  const picks = RBTS_REPORTS.stackSuggestions(curBands, pool)
  if (!picks.length) return null

  const curIds = new Set(curBands.map(b => b.id))
  const describe = (p) => {
    const added = p.bands.filter(b => !curIds.has(b.id))
    const kept = p.bands.filter(b => curIds.has(b.id))
    let txt
    if (p.bands.length === 1) txt = `swap to ${bandLabel(p.bands[0])}`
    else if (added.length && kept.length === curBands.length) txt = `add ${added.map(bandLabel).join(' + ')}`
    else txt = `use ${p.bands.map(bandLabel).join(' + ')}`
    return {
      text: `${txt} (${p.min}–${p.max} lbs)`,
      pct: p.pct == null ? null : Math.round(p.pct),
      inWindow: p.inWindow,
      ids: p.bands.map(b => b.id),
    }
  }
  const options = picks.map(describe)
  return {
    best: options[0],
    options,
    // Back-compat with the previous shape for existing call sites.
    add: options[0] ? options[0].text : null,
    swap: options[1] ? options[1].text : null,
  }
}

function printDoc(doc) {
  let el = document.getElementById('rbts-print-root')
  if (!el) {
    el = document.createElement('div')
    el.id = 'rbts-print-root'
    document.body.appendChild(el)
  }
  el.innerHTML = RBTS_REPORTS.renderPrintHTML(doc)
  const cleanup = () => { el.innerHTML = ''; window.removeEventListener('afterprint', cleanup) }
  window.addEventListener('afterprint', cleanup)
  window.print()
}

function downloadMD(doc, filename) {
  const md = RBTS_REPORTS.renderMarkdown(doc)
  try {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) { alert('Could not save the file: ' + e.message) }
}

// The reliable path on an installed iOS PWA, where window.print() is a no-op.
function copyMD(doc) {
  const md = RBTS_REPORTS.renderMarkdown(doc)
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = md; document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy') } catch { /* nothing else to try */ }
    document.body.removeChild(ta)
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(md).then(
      () => alert('Markdown copied to the clipboard.'),
      () => { fallback(); alert('Markdown copied to the clipboard.') })
  } else { fallback(); alert('Markdown copied to the clipboard.') }
}

// doc and name are FUNCTIONS, evaluated on click, so nothing is built until the
// user actually asks for output.
function ReportButtons({ label = 'PRINT', doc, name }) {
  const small = { padding: '6px 14px', fontSize: 10 }
  const build = () => {
    try { return doc() }
    catch (e) { alert('Could not build the report: ' + e.message); return null }
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      <button style={{ ...btn(false, C.accent), ...small }}
        onClick={() => { const d = build(); if (d) printDoc(d) }}>{label}</button>
      <button style={{ ...btn(false, C.green), ...small }}
        onClick={() => { const d = build(); if (d) downloadMD(d, name()) }}>SAVE .md</button>
      <button style={{ ...btn(false, '#7ecfff'), ...small }}
        onClick={() => { const d = build(); if (d) copyMD(d) }}>COPY .md</button>
    </span>
  )
}

/* Estimated load per band id.
   Delegates to the canonical RBTS_REPORTS.bandMid instead of re-parsing the
   range locally. The old private parser stripped "+" and "<" but NOT "~", so a
   "~5-20" HeavyDutyBar Travel band lost its min to parseFloat NaN and fell
   through the single-value branch to its MAX - the STRENGTH readout disagreed
   with ANALYZE by 43-60% on the same workout. Cache keyed on BANDS.length so a
   catalog that grows at runtime cannot leave entries resolving to 0. */
function bandResById(id) {
  const all = (typeof BANDS !== 'undefined') ? BANDS : []
  if (!_BAND_RES || _BAND_RES_N !== all.length) {
    _BAND_RES = {}
    _BAND_RES_N = all.length
    all.forEach(b => { _BAND_RES[b.id] = RBTS_REPORTS.bandMid(b) })
  }
  return _BAND_RES[id] || 0
}
function setLoad(set) { return (set.bands || []).reduce((a,id) => a + bandResById(id), 0) }
function entryStats(entry) {
  let vol=0, reps=0, top=0, sets=0
  Object.keys(entry.exercises || {}).forEach(exId => {
    (entry.exercises[exId] || []).forEach(st => {
      const l = setTopLoad(st)              // segment-aware: max phase resistance
      vol += setVol(st); reps += setRepsOf(st); sets++
      if (l > top) top = l
    })
  })
  return { volume:vol, reps:reps, topLoad:top, sets:sets }
}
function fmtNum(n) { n = Math.round(n||0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function fmtPct(p) { if (p == null || !isFinite(p)) return '—'; return (p>=0?'+':'') + p.toFixed(0) + '%' }

// ── ANALYZE TAB ───────────────────────────────────────────────────────────
// Narrative progress analysis. STRENGTH stays the raw-numbers dashboard; this
// is the interpretation layer. Every figure comes from RBTS_REPORTS.analyze, so
// this view, the printed report, and the HTML app cannot disagree.
const ANALYZE_WINDOWS = [
  { key:'block', label:'CURRENT BLOCK' },
  { key:'30',    label:'30 DAYS' },
  { key:'90',    label:'90 DAYS' },
  { key:'365',   label:'1 YEAR' },
  { key:'all',   label:'ALL TIME' },
]
const VERDICT_COLOR = {
  READY: C.green, GROWING: C.green, STALLED: C.amber,
  DECLINING: C.red, NEAR: C.readout, HOLDING: C.dimGray,
  EX_DORMANT: C.deload,
}
const BALANCE_COLOR = { UNDER: C.amber, OVER: C.readout, OK: C.green,
                        EXEMPT: C.dimGray, NONE: C.dimGray }
const SEVERITY_COLOR = { 1:C.red, 2:C.red, 3:C.amber, 4:C.amber, 5:C.green, 6:C.dimGray }

function AnalyzeTab({ log, gearInv, myBands, settings }) {
  const [win, setWin] = useState('90')
  const prog = PROGRAMS[Number(settings?.progIdx) || 0] || PROGRAMS[0]

  const res = useMemo(() => {
    try {
      return RBTS_REPORTS.analyze(
        makeReportCtx({ log, gear: gearInv, myBands }), { window: win, prog })
    } catch (e) { return { error: e.message } }
  }, [win, log, gearInv, myBands, settings])

  if (res.error) return (
    <div style={{...widget, border:'1px solid '+C.red}}>
      <span style={{fontFamily:'monospace',fontSize:12,color:C.red}}>
        Could not analyze the log: {res.error}
      </span>
    </div>
  )

  const R2 = RBTS_REPORTS
  const doc = () => R2.buildAnalysisDoc(res)
  const docName = () => `analysis_${localISO()}_${win}.md`

  const toolbar = (
    <div style={{...widget, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center'}}>
      <span style={{...lbl, marginBottom:0, marginRight:6}}>WINDOW</span>
      {ANALYZE_WINDOWS.map(w => (
        <button key={w.key} style={{...btn(win===w.key), fontSize:10, padding:'5px 10px'}}
          onClick={() => setWin(w.key)}>{w.label}</button>
      ))}
      <span style={{marginLeft:'auto'}}>
        <ReportButtons label="PRINT ANALYSIS" doc={doc} name={docName}/>
      </span>
    </div>
  )

  if (!res.totals.sessions) return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toolbar}
      <div style={{...widget, textAlign:'center', padding:40}}>
        <span style={{fontFamily:'monospace',fontSize:13,color:C.dimGray}}>
          No sessions logged in this window. Log a workout on the TODAY tab and
          the analysis will fill in.
        </span>
      </div>
    </div>
  )

  const statCard = (label, value, sub, color) => (
    <div style={{...widget, flex:'1 1 150px', minWidth:150}}>
      <span style={lbl}>{label}</span>
      <div style={{...readoutStyle, color: color || C.text}}>{value}</div>
      {sub ? <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>{sub}</span> : null}
    </div>
  )
  const volSub = res.deltas.volume == null ? null
    : `${R2.fmtDelta(res.deltas.volume)} vs previous period`
  const volColor = res.deltas.volume == null ? C.text
    : (res.deltas.volume >= 0 ? C.green : C.amber)
  const prCount = res.exercises.filter(r => r.isPR).length

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {toolbar}

      <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
        {statCard('SESSIONS', res.totals.sessions, res.window.label)}
        {statCard('SETS', R2.fmtNum(res.totals.sets))}
        {statCard('VOLUME', R2.fmtNum(res.totals.volume), volSub, volColor)}
        {statCard('PRs', prCount, 'this window', prCount ? C.green : C.dimGray)}
      </div>

      {/* Recommendations lead: the actionable part belongs at the top on screen. */}
      <div style={widget}>
        <span style={lbl}>RECOMMENDATIONS</span>
        {res.recommendations.length === 0 ? (
          <div style={{fontFamily:'monospace',fontSize:11,color:C.green}}>
            Nothing needs attention in this window.
          </div>
        ) : res.recommendations.map((r,i) => (
          <div key={i} style={{display:'flex',gap:8,alignItems:'baseline',
            padding:'5px 0',borderBottom:'1px solid '+C.bgInput}}>
            <span style={{...pill(SEVERITY_COLOR[r.severity]||C.dimGray), fontSize:9, flexShrink:0}}>
              {r.code}
            </span>
            <span style={{fontFamily:'monospace',fontSize:11,color:C.text,lineHeight:1.5}}>
              {r.text}
            </span>
          </div>
        ))}
      </div>

      <div style={widget}>
        <span style={lbl}>BY MUSCLE GROUP</span>
        {res.groups.map(g => (
          <div key={g.label} style={{display:'flex',gap:8,alignItems:'center',
            padding:'4px 0',flexWrap:'wrap'}}>
            <span style={{fontFamily:'monospace',fontSize:11,color:C.text,width:100,flexShrink:0}}>
              {g.label}
            </span>
            <span style={{fontFamily:'monospace',fontSize:10,color:C.accent,letterSpacing:'-0.05em'}}>
              {R2.barText(g.share, 20)}
            </span>
            <span style={{fontFamily:'monospace',fontSize:10,color:C.readout,width:44,textAlign:'right'}}>
              {Math.round(g.share)}%
            </span>
            <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>
              {g.sets} sets · {g.weeklySets.toFixed(1)}/wk{g.landmark != null ? ` of ${g.landmark}` : ''}
            </span>
            {g.balance !== 'OK' && g.balance !== 'EXEMPT' && g.balance !== 'NONE' && (
              <span style={{...pill(BALANCE_COLOR[g.balance]), fontSize:9}}>{g.balance}</span>
            )}
            {(g.neglect === 'NEGLECTED' || g.neglect === 'DORMANT') && (
              <span style={{...pill(C.red), fontSize:9}}>{g.neglect}</span>
            )}
            <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginLeft:'auto'}}>
              {g.daysSince == null ? 'never' : `${g.daysSince}d ago`}
            </span>
          </div>
        ))}
      </div>

      <div style={widget}>
        <span style={lbl}>BY EXERCISE</span>
        {res.exercises.map(r => (
          <div key={r.id} style={{padding:'6px 0',borderBottom:'1px solid '+C.bgInput}}>
            <div style={{display:'flex',gap:8,alignItems:'baseline',flexWrap:'wrap'}}>
              <span style={{...pill(exGroup(Number(r.id)).color), fontSize:9}}>{r.group}</span>
              <span style={{fontFamily:'monospace',fontSize:12,color:C.text}}>{r.name}</span>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>
                {r.n}× · {R2.fmtNum(r.firstTop)}→{R2.fmtNum(r.lastTop)} lb · {R2.fmtDelta(r.deltaPct)}
              </span>
              {r.isPR && <span style={{...pill(C.green), fontSize:9}}>PR</span>}
              <span style={{...pill(VERDICT_COLOR[r.verdict.code]||C.dimGray), fontSize:9, marginLeft:'auto'}}>
                {r.verdict.code}
              </span>
            </div>
            <div style={{fontFamily:'monospace',fontSize:10,color:C.textSec,marginTop:3,lineHeight:1.5}}>
              {r.verdict.text}
            </div>
          </div>
        ))}
      </div>

      {res.blocks.length > 0 && (
        <div style={widget}>
          <span style={lbl}>BY PROGRAM BLOCK</span>
          {res.blocks.map((b,i) => (
            <div key={i} style={{display:'flex',gap:10,alignItems:'baseline',
              padding:'5px 0',flexWrap:'wrap',borderBottom:'1px solid '+C.bgInput}}>
              <span style={{fontFamily:'monospace',fontSize:11,color:C.readout}}>
                P{b.programId} {b.name}
              </span>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>
                {b.from} → {b.to}
              </span>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.text}}>
                {b.logged}/{b.prescribed == null ? '?' : b.prescribed} sessions
                {b.adherence != null ? ` (${Math.round(b.adherence)}%)` : ''}
              </span>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.textSec}}>
                {R2.fmtNum(b.volPerSession)} vol/session
              </span>
              {b.vsPrev && b.vsPrev.volPerSession != null && (
                <span style={{fontFamily:'monospace',fontSize:10,
                  color: b.vsPrev.volPerSession >= 0 ? C.green : C.amber}}>
                  {R2.fmtDelta(b.vsPrev.volPerSession)} vs previous
                </span>
              )}
            </div>
          ))}
          <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginTop:8,lineHeight:1.5}}>
            {res.notes[1]}
          </div>
        </div>
      )}

      {res.unlogged.length > 0 && (
        <div style={widget}>
          <span style={lbl}>PRESCRIBED BUT UNLOGGED</span>
          <div style={{fontFamily:'monospace',fontSize:10,color:C.amber,lineHeight:1.7}}>
            {res.unlogged.map(u => `${u.name} (${u.group})`).join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}

function StrengthTab({ log }) {
  const [win, setWin] = useState('30')
  const data = (log || []).slice().sort((a,b) => a.date.localeCompare(b.date))

  if (data.length === 0) {
    return (
      <div style={{...widget,textAlign:'center',padding:40}}>
        <span style={{fontFamily:'monospace',fontSize:13,color:C.dimGray}}>
          No workouts logged yet. Log a session on the Today tab and your strength trends will appear here.
        </span>
      </div>
    )
  }

  const WINDOWS = [
    { key:'last', label:'SINCE LAST', days:0 },
    { key:'7',    label:'7 DAYS',     days:7 },
    { key:'30',   label:'30 DAYS',    days:30 },
    { key:'90',   label:'90 DAYS',    days:90 },
    { key:'365',  label:'1 YEAR',     days:365 },
    { key:'all',  label:'ALL TIME',   days:-1 },
  ]
  const cfg = WINDOWS.find(w => w.key === win) || WINDOWS[2]
  const daysAgoISO = n => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-n); return localISO(d) }
  const latestDate = data[data.length-1].date

  let winEntries, prevEntries = null
  if (cfg.key === 'all') { winEntries = data.slice() }
  else if (cfg.key === 'last') { winEntries = data.filter(e => e.date === latestDate) }
  else {
    const cut = daysAgoISO(cfg.days), prevCut = daysAgoISO(cfg.days*2)
    winEntries = data.filter(e => e.date >= cut)
    prevEntries = data.filter(e => e.date >= prevCut && e.date < cut)
  }

  const agg = entries => {
    let v=0,r=0,top=0,sN=0
    entries.forEach(e => { const st=entryStats(e); v+=st.volume; r+=st.reps; sN+=st.sets; if(st.topLoad>top) top=st.topLoad })
    return { volume:v, reps:r, top:top, sets:sN, sessions:entries.length }
  }
  const A = agg(winEntries)
  const P = prevEntries ? agg(prevEntries) : null
  const pct = (cur,prev) => (prev == null || prev === 0) ? null : ((cur-prev)/prev)*100
  const volDelta = P ? pct(A.volume, P.volume) : null
  const repDelta = P ? pct(A.reps, P.reps) : null

  const allBest = {}
  data.forEach(e => Object.keys(e.exercises||{}).forEach(exId =>
    (e.exercises[exId]||[]).forEach(st => { const l=setTopLoad(st); if(!allBest[exId]||l>allBest[exId]) allBest[exId]=l })))

  const exMap = {}
  winEntries.forEach(e => Object.keys(e.exercises||{}).forEach(exId => {
    let top=0
    ;(e.exercises[exId]||[]).forEach(st => { const l=setTopLoad(st); if(l>top) top=l })
    if(!exMap[exId]) exMap[exId]=[]
    exMap[exId].push({ date:e.date, top:top })
  }))
  let exRows = Object.keys(exMap).map(exId => {
    const arr = exMap[exId].sort((a,b)=>a.date.localeCompare(b.date))
    const first = arr[0], last = arr[arr.length-1]
    return {
      id:exId, name:EXERCISE_NAMES[exId]||('#'+exId), n:arr.length,
      startLoad:first.top, lastLoad:last.top,
      delta: first.top ? ((last.top-first.top)/first.top)*100 : null,
      best: allBest[exId]||0, isPR: last.top>0 && last.top>=(allBest[exId]||0),
    }
  }).sort((a,b) => b.n-a.n || b.lastLoad-a.lastLoad)

  if (cfg.key === 'last') {
    exRows.forEach(r => {
      let prevTop = null
      for (let i=data.length-1; i>=0; i--) {
        const e = data[i]
        if (e.date >= latestDate) continue
        if (e.exercises && e.exercises[r.id]) {
          let tt=0; (e.exercises[r.id]||[]).forEach(st => { const l=setTopLoad(st); if(l>tt) tt=l }); prevTop=tt; break
        }
      }
      if (prevTop != null) { r.startLoad = prevTop; r.delta = prevTop ? ((r.lastLoad-prevTop)/prevTop)*100 : null }
      else { r.delta = null }
    })
  }

  const series = winEntries.map(e => ({ date:e.date, vol:entryStats(e).volume }))
  const maxVol = series.reduce((m,x) => Math.max(m,x.vol), 0) || 1
  const deltaColor = volDelta == null ? C.dimGray : (volDelta >= 0 ? C.green : C.amber)
  const card = (label, value, sub, color) => (
    <div style={{...widget,flex:'1 1 140px',minWidth:140}}>
      <span style={lbl}>{label}</span>
      <div style={{...readoutStyle,color:color||C.text}}>{value}</div>
      {sub ? <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>{sub}</span> : null}
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{...widget,display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
        <span style={{...lbl,marginBottom:0,marginRight:6}}>WINDOW</span>
        {WINDOWS.map(w => (
          <button key={w.key} style={{...btn(win===w.key, win===w.key?C.accent:undefined),fontSize:10,padding:'5px 10px'}}
            onClick={()=>setWin(w.key)}>{w.label}</button>
        ))}
      </div>

      <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
        {card('WORKOUTS', String(A.sessions), A.sets+' sets logged', C.accent)}
        {card('EST. VOLUME', fmtNum(A.volume), 'lb·reps (estimated)', C.text)}
        {card('TOTAL REPS', fmtNum(A.reps), A.sessions?('~'+fmtNum(A.reps/A.sessions)+' / workout'):'', C.text)}
        {card('BEST SET LOAD', fmtNum(A.top)+' lb', 'heaviest est. band load', C.green)}
      </div>

      {P ? (
        <div style={{...widget,display:'flex',flexWrap:'wrap',gap:18,alignItems:'center'}}>
          <span style={lbl}>VS PREVIOUS {cfg.label}</span>
          <span style={{fontFamily:'monospace',fontSize:13,color:deltaColor,fontWeight:700}}>VOLUME {fmtPct(volDelta)}</span>
          <span style={{fontFamily:'monospace',fontSize:13,color:(repDelta==null?C.dimGray:(repDelta>=0?C.green:C.amber))}}>REPS {fmtPct(repDelta)}</span>
          <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>prior: {P.sessions} workouts · {fmtNum(P.volume)} vol</span>
        </div>
      ) : null}

      {series.length > 0 ? (
        <div style={widget}>
          <span style={lbl}>VOLUME PER WORKOUT</span>
          <div style={{display:'flex',alignItems:'flex-end',gap:3,height:90,marginTop:6}}>
            {series.map((sx,i) => {
              const h = Math.max(3, Math.round((sx.vol/maxVol)*84))
              return <div key={i} title={sx.date+' · '+fmtNum(sx.vol)+' vol'}
                style={{flex:'1 1 0',minWidth:4,maxWidth:22,height:h,background:C.accent,
                  opacity:0.4+0.6*(sx.vol/maxVol),borderRadius:'2px 2px 0 0'}}/>
            })}
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
            <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>{series[0].date}</span>
            <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>{series[series.length-1].date}</span>
          </div>
        </div>
      ) : null}

      <div style={widget}>
        <span style={lbl}>EXERCISE PROGRESSION {cfg.key==='last' ? '(LATEST WORKOUT)' : '(WITHIN WINDOW)'}</span>
        <div style={{overflowX:'auto',marginTop:6}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontFamily:'monospace',fontSize:11}}>
            <thead>
              <tr style={{color:C.dimGray,textAlign:'left'}}>
                <th style={{padding:'4px 6px'}}>EXERCISE</th>
                <th style={{padding:'4px 6px'}}>×</th>
                <th style={{padding:'4px 6px'}}>START</th>
                <th style={{padding:'4px 6px'}}>LATEST</th>
                <th style={{padding:'4px 6px'}}>Δ LOAD</th>
                <th style={{padding:'4px 6px'}}>BEST</th>
              </tr>
            </thead>
            <tbody>
              {exRows.map(r => (
                <tr key={r.id} style={{borderTop:'1px solid rgba(255,255,255,0.06)',color:C.textSec}}>
                  <td style={{padding:'4px 6px',color:C.text}}>{r.name} {r.isPR ? <span style={pill(C.green)}>PR</span> : null}</td>
                  <td style={{padding:'4px 6px'}}>{r.n}</td>
                  <td style={{padding:'4px 6px'}}>{fmtNum(r.startLoad)}</td>
                  <td style={{padding:'4px 6px'}}>{fmtNum(r.lastLoad)}</td>
                  <td style={{padding:'4px 6px',color:(r.delta==null?C.dimGray:(r.delta>=0?C.green:C.amber))}}>{fmtPct(r.delta)}</td>
                  <td style={{padding:'4px 6px',color:C.green}}>{fmtNum(r.best)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,display:'block',marginTop:8}}>
          Load = estimated band resistance (midpoint of each band's range; doubled/stacked bands summed). Volume = load × reps. Estimates for trend tracking, not exact poundage.
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM BUILDER (minimal) — author split + length + deload policy + exercises.
// Saves to rbts_customPrograms (merged into PROGRAMS at load). v1 puts every
// picked exercise into that day's accessories; technique editor is omitted.
// ─────────────────────────────────────────────────────────────────────────────
function ProgramBuilder({ onSaved, onCancel }) {
  const SP = RBTS_PHASE1?.SPLITS || {}
  const splitIds = Object.keys(SP)
  const [name, setName] = useState('')
  const [splitId, setSplitId] = useState(splitIds.includes('upper_lower') ? 'upper_lower' : (splitIds[0] || 'body_part_5'))
  const [lengthWeeks, setLengthWeeks] = useState(6)
  const [every, setEvery] = useState(6)
  const [style, setStyle] = useState('intensity')
  const [scope, setScope] = useState('week')
  const [picks, setPicks] = useState({})
  const [activeDay, setActiveDay] = useState(0)
  const [exSearch, setExSearch] = useState('')
  const [exGrp, setExGrp] = useState('All')        // muscle-group filter for the picker
  const [techs, setTechs] = useState({})        // { workingWeek: [{day, exId, technique, primary}] }
  const [issues, setIssues] = useState(null)    // validation results awaiting confirm

  const days = (SP[splitId] && SP[splitId].days) || ['C','D','E','F','G']
  const dayKey = days[activeDay] || days[0]
  const fieldLbl = { fontFamily:'monospace', fontSize:10, color:C.textSec, letterSpacing:'0.08em', display:'flex', flexDirection:'column', gap:3 }
  const techKeys = Object.keys(TECHNIQUES)
  const lenN = Math.max(2, Number(lengthWeeks) || 6)
  const evN = Math.max(0, Number(every) || 0)
  const isDload = w => evN >= 1 && w <= lenN && w % evN === 0
  const workingWeeks = []
  for (let _w = 1; _w <= lenN; _w++) if (!isDload(_w)) workingWeeks.push(_w)
  const mutTech = (wk, fn) => setTechs(prev => {
    const arr = (prev[wk] || []).slice(); fn(arr)
    return { ...prev, [wk]: arr }
  })
  const addTech = wk => mutTech(wk, a => a.push({ day:days[0], exId:'', technique:'none', primary:false }))
  const rmTech  = (wk,i) => mutTech(wk, a => a.splice(i,1))
  const setTech = (wk,i,field,val) => mutTech(wk, a => { a[i] = { ...a[i], [field]:val } })

  const toggleEx = (day, id) => setPicks(prev => {
    const cur = (prev[day] || []).slice()
    const i = cur.indexOf(id)
    if (i >= 0) cur.splice(i, 1); else cur.push(id)
    return { ...prev, [day]: cur }
  })
  const dayLbl = d => (SP[splitId] && SP[splitId].dayLabels && SP[splitId].dayLabels[d]) || String(d).toUpperCase()
  const buildProgram = () => {
    // Day's exercises = union of the day picker + every weekly-plan row naming
    // that day. Sessions are static per day (exercises show every week); only
    // techniques vary by week.
    const priSet = {}, accSet = {}
    days.forEach(d => { priSet[d] = new Set(); accSet[d] = new Set(picks[d] || []) })
    workingWeeks.forEach(wk => (techs[wk] || []).forEach(e => {
      if (e && e.exId !== '' && accSet[e.day]) {
        if (e.primary) priSet[e.day].add(Number(e.exId))
        else           accSet[e.day].add(Number(e.exId))
      }
    }))
    const sessions = {}
    days.forEach(d => {
      const pri = {}, acc = {}
      ;[...priSet[d]].sort((a,b) => EX_CLASS_RANK[exClass(a)] - EX_CLASS_RANK[exClass(b)])  // compound → iso
        .forEach(id => { pri['ex'+id] = id })
      ;[...accSet[d]].forEach(id => { if (!priSet[d].has(id)) acc['ex'+id] = id })
      sessions[d] = { primary:pri, accessories:acc }
    })
    const techniques = {}
    workingWeeks.forEach(wk => {
      const list = (techs[wk] || []).filter(e =>
        e && e.exId !== '' && e.technique && e.technique !== 'none'
      ).map(e => ({ session:e.day, slot:'ex'+e.exId, technique:e.technique }))
      if (list.length) techniques['week'+wk] = list
    })
    return {
      id: 'c' + Date.now(), custom: true,
      name: name.trim() || ('Custom ' + ((SP[splitId] && SP[splitId].label) || splitId)),
      splitId, lengthWeeks: lenN,
      deloadPolicy: { every: evN, style, scope },
      sessions, techniques,
    }
  }
  // Validate against the CLAUDE.md rules. Limits are PER WORKOUT (a week+day
  // occurrence), not per week. iso/compound *type* isn't checkable (no per-
  // exercise classification in the runtime) — only the focus-group size is.
  const validateProgram = (prog) => {
    const out = []
    days.forEach(d => {
      const s = prog.sessions[d]
      const prims = Object.values(s.primary)
      const na = Object.keys(s.accessories).length
      if (prims.length + na === 0) out.push({ level:'error', msg:'Day ' + dayLbl(d) + ' has no exercises.' })
      prims.forEach(id => {
        if (exClass(id) === 'other')
          out.push({ level:'error', msg:(EXERCISE_NAMES[id] || ('#'+id)) + ' is a mobility/stretch/carry move — not a primary lift (' + dayLbl(d) + ').' })
      })
      const iso = prims.filter(id => exClass(id) === 'iso').length
      const comp = prims.filter(id => exClass(id) === 'comp').length
      if (prims.length === 1) {
        out.push({ level:'warn', msg:'Day ' + dayLbl(d) + ' primary has 1 lift — a focus group is one isolation + 1–2 compounds.' })
      } else if (prims.length >= 2) {
        if (iso === 0)  out.push({ level:'warn', msg:'Day ' + dayLbl(d) + ' primary has no isolation lift — lead with one isolation.' })
        if (iso > 1)    out.push({ level:'warn', msg:'Day ' + dayLbl(d) + ' primary has ' + iso + ' isolation lifts — use just one.' })
        if (comp === 0) out.push({ level:'warn', msg:'Day ' + dayLbl(d) + ' primary has no compound lift — pair the isolation with 1–2 compounds.' })
        if (comp > 2)   out.push({ level:'warn', msg:'Day ' + dayLbl(d) + ' primary has ' + comp + ' compounds — max 2 (iso/comp/comp triplet).' })
      }
    })
    workingWeeks.forEach(wk => {
      const byDay = {}
      ;(techs[wk] || []).forEach(e => {
        if (e && e.exId !== '' && e.technique && e.technique !== 'none')
          (byDay[e.day] = byDay[e.day] || []).push(e)
      })
      Object.keys(byDay).forEach(d => {
        const rows = byDay[d]
        if (rows.length > 2) out.push({ level:'warn', msg:'Wk ' + wk + ' ' + dayLbl(d) + ' workout has ' + rows.length + ' high-intensity techniques — max 2 per workout.' })
        const exs = rows.map(r => r.exId)
        if (new Set(exs).size < exs.length) out.push({ level:'warn', msg:'Wk ' + wk + ' ' + dayLbl(d) + ' stacks 2 techniques on the same exercise — use different exercises.' })
      })
    })
    const exDays = {}
    days.forEach(d => {
      Object.values(prog.sessions[d].primary).concat(Object.values(prog.sessions[d].accessories)).forEach(id => {
        (exDays[id] = exDays[id] || []).push(d)
      })
    })
    Object.keys(exDays).forEach(id => {
      if (exDays[id].length > 1) out.push({ level:'warn', msg:(EXERCISE_NAMES[id] || ('#'+id)) + ' is used on multiple days (' + exDays[id].map(dayLbl).join(', ') + ').' })
    })
    return out
  }
  const save = (force) => {
    const prog = buildProgram()
    const found = validateProgram(prog)
    if (found.length && !force) { setIssues({ prog, list: found }); return }
    saveCustomProgram(prog)
    onSaved()
  }
  const canSave = days.some(d => (picks[d] || []).length > 0) ||
    workingWeeks.some(wk => (techs[wk] || []).some(e => e.exId !== ''))
  const allExOpts = Object.keys(EXERCISE_NAMES).map(Number)
  const exIds = Object.keys(EXERCISE_NAMES).map(Number).filter(id => {
    const nameOk = !exSearch || (EXERCISE_NAMES[id] || '').toLowerCase().includes(exSearch.toLowerCase())
    const grpOk  = exGrp === 'All' || exGroup(id).label === exGrp
    return nameOk && grpOk
  })

  return (
    <div style={{...widget, border:'1px solid '+C.accentDim, display:'flex', flexDirection:'column', gap:8}}>
      <span style={lbl}>NEW PROGRAM</span>
      <input style={inputStyle} placeholder="Program name" value={name} onChange={e=>setName(e.target.value)} />
      <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
        <label style={fieldLbl}>SPLIT
          <select style={{...inputStyle,width:170}} value={splitId}
            onChange={e=>{setSplitId(e.target.value); setPicks({}); setActiveDay(0)}}>
            {splitIds.map(s=><option key={s} value={s}>{(SP[s] && SP[s].label) || s}</option>)}
          </select>
        </label>
        <label style={fieldLbl}>LENGTH (weeks)
          <input type="number" min="2" max="16" style={{...inputStyle,width:80}}
            value={lengthWeeks} onChange={e=>setLengthWeeks(e.target.value)} />
        </label>
      </div>
      <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
        <label style={fieldLbl}>DELOAD EVERY (0=never)
          <input type="number" min="0" max="16" style={{...inputStyle,width:80}}
            value={every} onChange={e=>setEvery(e.target.value)} />
        </label>
        <label style={fieldLbl}>STYLE
          <select style={{...inputStyle,width:120}} value={style} onChange={e=>setStyle(e.target.value)}>
            <option value="intensity">intensity</option>
            <option value="volume">volume</option>
            <option value="rest">rest</option>
          </select>
        </label>
        <label style={fieldLbl}>SCOPE
          <select style={{...inputStyle,width:110}} value={scope} onChange={e=>setScope(e.target.value)}>
            <option value="week">week</option>
            <option value="session">session</option>
          </select>
        </label>
      </div>
      <span style={lbl}>EXERCISES PER DAY</span>
      <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,lineHeight:1.5}}>
        Pick what you do on each day. These repeat every week — your split rotates
        the days automatically (e.g. Upper, Lower, Upper, Lower across your schedule).
      </span>
      <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
        {days.map((d,i)=>(
          <button key={d} style={btn(activeDay===i)} onClick={()=>setActiveDay(i)}>
            {((SP[splitId] && SP[splitId].dayLabels && SP[splitId].dayLabels[d]) || d)} ({(picks[d]||[]).length})
          </button>
        ))}
      </div>
      {/* Muscle-group filter — names don't always reveal the primary muscle. */}
      <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
        {ALL_GROUPS.map(g => (
          <button key={g} style={{...btn(exGrp===g), fontSize:10, padding:'4px 8px'}}
            onClick={()=>setExGrp(g)}>{g}</button>
        ))}
      </div>
      <input style={inputStyle} placeholder={'Search exercises for '+dayKey+'…'} value={exSearch}
        onChange={e=>setExSearch(e.target.value)} />
      <div style={{maxHeight:200, overflowY:'auto', border:'1px solid '+C.bgInput, borderRadius:4}}>
        {exIds.length === 0 &&
          <div style={{padding:'6px 8px',fontFamily:'monospace',fontSize:10,color:C.dimGray}}>
            No exercises match — try a different group or clear the search.
          </div>}
        {exIds.map(id => {
          const on = (picks[dayKey] || []).includes(id)
          const grp = exGroup(id)
          return (
            <div key={id} onClick={()=>toggleEx(dayKey, id)}
              style={{padding:'4px 8px', fontFamily:'monospace', fontSize:11, cursor:'pointer',
                display:'flex', justifyContent:'space-between', alignItems:'center', gap:8,
                color: on ? '#000' : C.textSec, background: on ? C.accent : 'transparent',
                borderBottom:'1px solid '+C.bgInput}}>
              <span>{on ? '✓ ' : '  '}#{id} {EXERCISE_NAMES[id]}</span>
              <span style={{fontSize:9, color: on ? '#000' : grp.color, opacity: on ? 0.7 : 1,
                whiteSpace:'nowrap'}}>{grp.label}</span>
            </div>
          )
        })}
      </div>

      <span style={lbl}>TECHNIQUES BY WEEK — optional intensifiers (drop sets, rest-pause…)</span>
      <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,lineHeight:1.5}}>
        Optional. Your exercises (above) stay the same every week — this only layers a
        high-intensity technique onto a specific lift on a specific week of the block,
        and lets you mark a lift PRI (primary). Leave it empty for a plain program.
      </span>
      <div style={{display:'flex', flexDirection:'column', gap:8}}>
        {workingWeeks.map(wk => {
          const rows = techs[wk] || []
          return (
            <div key={wk} style={{border:'1px solid '+C.bgInput, borderRadius:4, padding:'6px 8px'}}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                <span style={{fontFamily:'monospace', fontSize:11, color:C.textSec}}>WEEK {wk} · {rows.length}/12</span>
                {rows.length < 12 &&
                  <button style={{...btn(false),fontSize:10,padding:'3px 8px'}} onClick={()=>addTech(wk)}>+ exercise</button>}
              </div>
              {rows.map((r,i) => (
                <div key={i} style={{display:'flex', gap:4, flexWrap:'wrap', marginBottom:3}}>
                  <select style={{...inputStyle,width:90,fontSize:10}} value={r.day}
                    onChange={e=>setTech(wk,i,'day',e.target.value)}>
                    {days.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                  <select style={{...inputStyle,width:160,fontSize:10}} value={r.exId}
                    onChange={e=>setTech(wk,i,'exId',e.target.value)}>
                    <option value="">— exercise —</option>
                    {allExOpts.map(id=><option key={id} value={id}>#{id} {EXERCISE_NAMES[id]}</option>)}
                  </select>
                  <select style={{...inputStyle,width:150,fontSize:10}} value={r.technique}
                    onChange={e=>setTech(wk,i,'technique',e.target.value)}>
                    <option value="none">none</option>
                    {techKeys.map(k=><option key={k} value={k}>{k}</option>)}
                  </select>
                  <button title="Mark as a primary (main) lift for this day"
                    style={{...btn(!!r.primary,C.amber),fontSize:10,padding:'3px 8px'}}
                    onClick={()=>setTech(wk,i,'primary',!r.primary)}>PRI</button>
                  <button style={{...btn(false,C.red),fontSize:10,padding:'3px 8px'}} onClick={()=>rmTech(wk,i)}>✕</button>
                </div>
              ))}
              {rows.length === 0 &&
                <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>no exercises</span>}
            </div>
          )
        })}
      </div>

      {issues &&
        <div style={{border:'1px solid '+C.amber, borderRadius:4, padding:'8px 10px'}}>
          <span style={lbl}>VALIDATION — {issues.list.length} item(s)</span>
          {issues.list.map((it,i) => (
            <div key={i} style={{fontFamily:'monospace', fontSize:11, marginTop:2,
              color: it.level === 'error' ? C.red : C.amber}}>
              {it.level === 'error' ? '✕ ' : '⚠ '}{it.msg}
            </div>
          ))}
          <div style={{display:'flex', gap:8, marginTop:8}}>
            <button style={{...btn(false,C.green),fontSize:11}}
              onClick={()=>{ saveCustomProgram(issues.prog); onSaved() }}>SAVE ANYWAY</button>
            <button style={{...btn(false),fontSize:11}} onClick={()=>setIssues(null)}>BACK TO EDIT</button>
          </div>
        </div>}

      <div style={{display:'flex', gap:8}}>
        <button disabled={!canSave}
          style={{...btn(false,C.green), ...(canSave?{}:{opacity:0.4,cursor:'not-allowed'})}}
          onClick={()=>save(false)}>SAVE PROGRAM</button>
        <button style={btn(false)} onClick={onCancel}>CANCEL</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAMS TAB
// ─────────────────────────────────────────────────────────────────────────────
function ProgramsTab({ onProgramsChanged }) {
  const [pi, setPi]     = useState(0)
  const [week, setWeek] = useState(1)
  const [sKey, setSKey] = useState('C')
  const [building, setBuilding] = useState(false)
  const [, setVer] = useState(0)
  const safePi = Math.min(pi, PROGRAMS.length - 1)
  const prog            = PROGRAMS[safePi] || PROGRAMS[0]
  const isDeload        = isDeloadSession(prog, week, sKey)
  const removeCustom = () => {
    if (!prog.custom) return
    deleteCustomProgram(prog.id)
    /* The tombstone is what makes the deletion PROPAGATE. Without it the other
       device still holds the program, the union puts it back, and deleting is
       an operation that silently undoes itself. */
    setCustomProgramTombstones({ ...getCustomProgramTombstones(), [String(prog.id)]: Date.now() })
    onProgramsChanged && onProgramsChanged()
    setPi(0); setWeek(1); setSKey(progSplitDays(PROGRAMS[0])[0]); setVer(v=>v+1)
  }
  if (building) {
    return <ProgramBuilder onCancel={()=>setBuilding(false)}
      onSaved={()=>{ setBuilding(false); const i = PROGRAMS.length-1
        onProgramsChanged && onProgramsChanged()
        setPi(i); setWeek(1); setSKey(progSplitDays(PROGRAMS[i])[0]); setVer(v=>v+1) }} />
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={widget}>
        <span style={lbl}>BROWSE PROGRAMS — {PROGRAMS.length} BLOCKS</span>
        <span style={{fontFamily:'monospace',fontSize:10,color:C.textSec,display:'block',marginBottom:6}}>
          Reference + builder. To change your active program, use Today → SCHEDULE SETTINGS
        </span>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
          {PROGRAMS.map((p,i) => (
            <button key={p.id} style={btn(i===safePi, p.custom?C.deload:undefined)}
              onClick={()=>{setPi(i);setWeek(1);setSKey(progSplitDays(PROGRAMS[i])[0]);}}>
              {p.custom ? ('★'+PROGRAMS.slice(0,i+1).filter(x=>x.custom).length) : 'P'+p.id}</button>
          ))}
          <button style={{...btn(false,C.green),fontWeight:700}} onClick={()=>setBuilding(true)}>+ NEW</button>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <span style={{fontFamily:'monospace',fontSize:15,color:C.readout,
            textShadow:`0 0 8px ${C.accentGlow}`,letterSpacing:'0.06em'}}>
            {prog.custom ? '★ ' : 'PROGRAM '+prog.id+' — '}{prog.name.toUpperCase()}
          </span>
          {prog.custom &&
            <button style={{...btn(false,C.red),fontSize:10,padding:'5px 10px'}}
              onClick={removeCustom}>DELETE</button>}
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div style={widget}>
          <span style={lbl}>WEEK</span>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {Array.from({length:progLengthWeeks(prog)},(_,i)=>i+1).map(w => {
              const dl = isDeloadWeek(prog, w)
              return <button key={w} style={btn(week===w, dl?C.deload:undefined)}
                onClick={()=>setWeek(w)}>{dl?w+' DL':w}</button>
            })}
          </div>
          <div style={{marginTop:10}}>
            {isDeload
              ? <span style={{fontFamily:'monospace',fontSize:11,color:C.deload}}>
                  {deloadProtocolText(prog)}
                </span>
              : <>
                  {RBTS_REPORTS.progProtocol(prog) && (
                    <div style={{marginBottom:8}}>
                      {/* Indexed WITHOUT `?.` deliberately, unlike the scheduled row
                          below. progProtocol only ever returns a key that is in
                          TECH_KEYS, and test_program_invariants.cjs asserts TECH_KEYS
                          equals both apps' TECHNIQUES maps exactly -- so a miss here is
                          a SOURCE state that fails a suite, never a runtime state.
                          Optional chaining would turn that caught failure into a
                          silently blank pill. */}
                      <span style={pill(C.amber)}>
                        PROTOCOL: {TECHNIQUES[RBTS_REPORTS.progProtocol(prog)].split(' — ')[0]}
                      </span>
                      <div style={{fontFamily:'monospace',fontSize:11,color:C.text,marginTop:4}}>
                        Applies to EVERY exercise, every working week.
                      </div>
                      <div style={{fontFamily:'monospace',fontSize:11,color:C.dimGray,marginTop:2}}>
                        {TECHNIQUES[RBTS_REPORTS.progProtocol(prog)]}
                      </div>
                      {RBTS_REPORTS.techCautionOf(RBTS_REPORTS.progProtocol(prog)) && (
                        <div style={{fontFamily:'monospace',fontSize:11,color:C.amber,marginTop:4}}>
                          CAUTION — {RBTS_REPORTS.techCautionOf(RBTS_REPORTS.progProtocol(prog))}
                        </div>
                      )}
                    </div>
                  )}
                  <span style={lbl}>WEEK {week} INTENSIFIERS (AS SCHEDULED)</span>
                  {getWeekTechniques(prog, week).map((t,i) => (
                    <div key={i} style={{fontFamily:'monospace',fontSize:11,color:C.amber,marginBottom:2}}>
                      ⚡ {t.session}-{SLOT_LABELS[t.slot]??t.slot}:{' '}
                      <span style={{color:C.text}}>{TECHNIQUES[t.technique]?.split(' — ')[0]}</span>
                    </div>
                  ))}
                  {getWeekTechniques(prog, week).length===0 &&
                    !RBTS_REPORTS.progProtocol(prog) &&
                    <div style={{fontFamily:'monospace',fontSize:11,color:C.dimGray}}>
                      No intensifiers land this week
                    </div>}
                </>
            }
          </div>
        </div>

        <div style={widget}>
          <span style={lbl}>SESSION</span>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {progSplitDays(prog).map(s => (
              <button key={s} style={btn(sKey===s,getSessionFocus(prog,s).color)}
                onClick={()=>setSKey(s)}>{dayName(prog,s)}</button>
            ))}
          </div>
          <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:3}}>
            {progSplitDays(prog).map(k => {
              const v = getSessionFocus(prog,k);
              return (
                <div key={k} style={{fontFamily:'monospace',fontSize:10,color:k===sKey?v.color:C.dimGray}}>
                  {dayName(prog,k)} — {v.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={widget}><SessionView prog={prog} sKey={sKey} week={week}/></div>

      {/* Safety card — content from RBTS_REPORTS.SAFETY_DOC, shared with
          fitness_app.html so the two cannot drift. */}
      <details style={{...widget, borderColor:`${C.amber}55`}}>
        <summary style={{fontFamily:'monospace',fontSize:11,color:C.amber,
          letterSpacing:'0.1em',textTransform:'uppercase',cursor:'pointer',userSelect:'none'}}>
          {RBTS_REPORTS.SAFETY_DOC.title}
        </summary>
        <div style={{marginTop:10,fontFamily:'monospace',fontSize:11,color:C.textSec,lineHeight:1.8}}>
          {RBTS_REPORTS.SAFETY_DOC.sections.map((sec, si) => (
            <div key={si}>
              <div style={{color:C.text,letterSpacing:'0.08em',marginTop:si?10:4}}>{sec.heading}</div>
              {sec.items.map((it, ii) => (
                <div key={ii}>
                  {it[0] ? <b style={{color:C.text}}>{it[0]}</b> : null}{it[0] ? ' ' : null}{it[1]}
                </div>
              ))}
            </div>
          ))}
          <div style={{marginTop:12,paddingTop:8,borderTop:`1px solid ${C.amber}33`,
            color:C.amber,lineHeight:1.6}}>
            {RBTS_REPORTS.SAFETY_DOC.disclaimer}
          </div>
        </div>
      </details>

      <details style={widget}>
        <summary style={{fontFamily:'monospace',fontSize:11,color:C.textSec,
          letterSpacing:'0.1em',textTransform:'uppercase',cursor:'pointer',userSelect:'none'}}>
          ▸ HIGH-INTENSITY TECHNIQUES REFERENCE
        </summary>
        <div style={{marginTop:12,display:'grid',
          gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:8}}>
          {Object.entries(TECHNIQUES).map(([key,desc]) => {
            const [name,detail] = desc.split(' — ')
            return (
              <div key={key} style={{background:C.bgInput,borderRadius:6,
                padding:'8px 12px',border:`1px solid ${C.amber}33`}}>
                <div style={{fontFamily:'monospace',fontSize:11,color:C.amber,marginBottom:3}}>{name}</div>
                <div style={{fontFamily:'monospace',fontSize:10,color:C.textSec}}>{detail}</div>
              </div>
            )
          })}
        </div>
      </details>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LIBRARY TAB
// ─────────────────────────────────────────────────────────────────────────────
// Parse a timestamp typed as seconds ("117") OR mm:ss ("1:57") OR h:mm:ss.
// Returns a number of seconds, or undefined for blank/invalid input.
function parseTs(v) {
  v = String(v == null ? '' : v).trim()
  if (!v) return undefined
  if (v.indexOf(':') < 0) { const n = parseInt(v,10); return isNaN(n) ? undefined : n }
  let s = 0
  v.split(':').forEach(p => { s = s*60 + (parseInt(p,10)||0) })
  return s
}

// "+ ADD EXERCISE" form (Library tab). Calls onAdd({name,group,cls,url?,start?,end?})
// then onDone to close. Group/class are stored explicitly (IDs ≥1000 sit
// outside the ID-range group table). Video is optional; start/end accept mm:ss.
function AddExerciseForm({ onAdd, onDone }) {
  const [name, setName]   = useState('')
  const [grp, setGrp]     = useState('CHEST')
  const [cls, setCls]     = useState('iso')
  const [url, setUrl]     = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd]     = useState('')
  const [err, setErr]     = useState('')
  const groups = ALL_GROUPS.filter(g => g !== 'All')
  const field = (label, node) => (
    <label style={{display:'flex',flexDirection:'column',gap:4}}>
      <span style={lbl}>{label}</span>{node}
    </label>
  )
  function save() {
    const nm = name.trim()
    if (!nm) { setErr('Name is required.'); return }
    const u = url.trim()
    if ((start.trim() || end.trim()) && !u) { setErr('Add a video URL to use timestamps.'); return }
    onAdd({
      name: nm, group: grp, cls,
      url: u || undefined,
      start: u ? parseTs(start) : undefined,
      end:   u ? parseTs(end)   : undefined,
    })
    onDone()
  }
  return (
    <div style={{background:C.bgInput,borderRadius:6,padding:14,
      border:`1px solid ${C.accentDim}`,display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',flexWrap:'wrap',gap:12}}>
        {field('EXERCISE NAME',
          <input value={name} onChange={e=>setName(e.target.value)}
            placeholder="e.g. Pec Crossover" style={{...inputStyle,width:240}}/>)}
        {field('MUSCLE GROUP',
          <select value={grp} onChange={e=>setGrp(e.target.value)} style={{...inputStyle,width:150}}>
            {groups.map(g=><option key={g} value={g}>{g}</option>)}
          </select>)}
        {field('TYPE',
          <select value={cls} onChange={e=>setCls(e.target.value)} style={{...inputStyle,width:150}}>
            <option value="iso">Isolation</option>
            <option value="comp">Compound</option>
            <option value="other">Other / mobility</option>
          </select>)}
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:12,alignItems:'flex-end'}}>
        {field('VIDEO URL (optional)',
          <input value={url} onChange={e=>setUrl(e.target.value)}
            placeholder="youtube.com/watch?v=… or /shorts/…" style={{...inputStyle,width:300}}/>)}
        {field('START (mm:ss)',
          <input value={start} onChange={e=>setStart(e.target.value)}
            placeholder="1:57" style={{...inputStyle,width:90}}/>)}
        {field('END (mm:ss)',
          <input value={end} onChange={e=>setEnd(e.target.value)}
            placeholder="2:42" style={{...inputStyle,width:90}}/>)}
      </div>
      {err && <div style={{fontFamily:'monospace',fontSize:11,color:C.amber}}>{err}</div>}
      <div style={{display:'flex',gap:8}}>
        <button style={btn(true,C.green)} onClick={save}>SAVE EXERCISE</button>
        <button style={btn(false)} onClick={onDone}>CANCEL</button>
      </div>
    </div>
  )
}

function LibraryTab({ customEx, onAddEx, onDeleteEx }) {
  const [search, setSearch] = useState('')
  const [group, setGroup]   = useState('All')
  const [vidOnly, setVid]   = useState(false)
  const [adding, setAdding] = useState(false)   // add-exercise form open?
  const totalVerified       = Object.keys(VIDEOS).length

  const allEx = useMemo(() =>
    Object.entries(EXERCISE_NAMES).map(([id,name]) => ({
      id:Number(id), name, group:exGroup(Number(id)), url:VIDEOS[Number(id)]??null,
      custom:Number(id)>=1000,
    })).sort((a,b)=>a.id-b.id), [customEx])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allEx.filter(ex => {
      if (group !== 'All' && ex.group.label !== group) return false
      if (vidOnly && !ex.url) return false
      if (q && !ex.name.toLowerCase().includes(q) && !String(ex.id).includes(q)) return false
      return true
    })
  }, [allEx, search, group, vidOnly])

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{...widget,display:'flex',gap:28,flexWrap:'wrap',alignItems:'center'}}>
        {[['TOTAL EXERCISES',allEx.length,C.readout],['VIDEOS VERIFIED',totalVerified,C.green],
          ['PENDING',allEx.length-totalVerified,C.amber],['SHOWING',filtered.length,C.text]].map(([label,val,color]) => (
          <div key={label}>
            <span style={lbl}>{label}</span>
            <span style={{...readoutStyle,color}}>{val}</span>
          </div>
        ))}
      </div>
      <div style={{...widget,display:'flex',flexDirection:'column',gap:10}}>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="SEARCH BY NAME OR #"
            style={{...inputStyle,width:220,letterSpacing:'0.04em'}}/>
          <button style={btn(vidOnly,C.green)} onClick={()=>setVid(!vidOnly)}>▶ WITH VIDEO ONLY</button>
          <button style={btn(adding,C.accent)} onClick={()=>setAdding(a=>!a)}>
            {adding ? '✕ CANCEL' : '+ ADD EXERCISE'}
          </button>
        </div>
        {adding && (
          <AddExerciseForm onAdd={onAddEx} onDone={()=>setAdding(false)}/>
        )}
        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
          {ALL_GROUPS.map(g => (
            <button key={g} style={{...btn(group===g,
              g==='All'?C.accent:(allEx.find(e=>e.group.label===g)?.group.color??C.accent)),
              fontSize:9,padding:'3px 7px'}}
              onClick={()=>setGroup(g)}>{g}</button>
          ))}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))',gap:8}}>
        {filtered.map(ex => (
          <div key={ex.id} style={{background:C.bgWidget,borderRadius:8,padding:'10px 12px',
            border:`1px solid ${ex.group.color}33`,display:'flex',flexDirection:'column',gap:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:6}}>
              <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>
                #{ex.id}{ex.custom ? ' ★' : ''}
              </span>
              <span style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={pill(ex.group.color)}>{ex.group.label}</span>
                {ex.custom && (
                  <button title="Delete custom exercise"
                    style={{background:'none',border:'none',color:C.dimGray,cursor:'pointer',
                      fontFamily:'monospace',fontSize:11,padding:0,lineHeight:1}}
                    onClick={()=>{ if (confirm(`Delete "${ex.name}" (#${ex.id})? Logged history keeps the id but will show it as a number.`)) onDeleteEx(ex.id) }}>✕</button>
                )}
              </span>
            </div>
            <div style={{fontFamily:'monospace',fontSize:12,color:C.text,lineHeight:1.4,flex:1}}>{ex.name}</div>
            <WatchDemoButton id={ex.id}/>
          </div>
        ))}
      </div>
      {filtered.length===0 && (
        <div style={{fontFamily:'monospace',fontSize:13,color:C.dimGray,textAlign:'center',padding:40}}>
          NO EXERCISES MATCH FILTER
        </div>
      )}
    </div>
  )
}

/* stampLoad now lives in rbts_reports.js, beside effectiveLoad -- one copy
   shared with fitness_app.html instead of two hand-synced ~25-line copies.
   Call site below passes ctx explicitly (RBTS_REPORTS.stampLoad(exercises,
   gearMap, ctx)); the module touches no DOM, no localStorage, no app globals. */

/* The exercise ids a session prescribes, flat. Mirrors fitness_app.html's
   helper of the same name; used only to filter standing substitutions down to
   the slots that exist today. */
function sessionPrescribedIds(prog, sKey) {
  if (!prog) return []
  const s = getSessionEx(prog, sKey)
  if (!s) return []
  return [...Object.values(s.primary || {}), ...Object.values(s.accessories || {})]
}

// ─────────────────────────────────────────────────────────────────────────────
// TODAY TAB
// ─────────────────────────────────────────────────────────────────────────────
function TodayTab({ user, log, onSaveEntry, settings, onChangeSettings, gearInv }) {
  // Phase 2: settings live in App (synced per account). Read from props; change
  // via onChangeSettings, which persists locally and to Firestore (last-write-wins).
  const startDate = settings.startDate, sched = settings.schedule, pi = settings.progIdx
  const setStartDate = v => onChangeSettings({ startDate: v })
  const setSched     = v => onChangeSettings({ schedule:  v })
  const setPi        = v => onChangeSettings({ progIdx:   v })
  const splitSel     = settings.splitId || ''               // P6: synced split override
  const setSplitSel  = v => onChangeSettings({ splitId: v })
  const [exLogs, setExLogs]       = useState({})
  const [gearLogs, setGearLogs]   = useState({})   // per-exercise equipment {exId: [gearItemId,...]}
  const [attachLogs, setAttachLogs] = useState({}) // per-exercise belt attach height {exId: heightIn}
  const [openingLogs, setOpeningLogs] = useState({}) // per-exercise adjustable-gear position {exId: n}
  const [bandPathLogs, setBandPathLogs] = useState({}) // per-exercise footplate band path {exId: k}
  /* { scheduledExId: performedExId } -- which prescribed exercise was swapped
     for which, this session only. The ONE map keyed by the scheduled exercise;
     every other per-exercise map is keyed by the performed id. */
  const [subsLogs, setSubsLogs] = useState({})
  const [saved, setSaved]         = useState(false)

  const info       = useMemo(() => calcToday(startDate, sched, Number(pi)), [startDate, sched, pi, splitSel])
  const todayISO   = localISO()
  const todayStr   = new Date().toLocaleDateString('en-US',
    {weekday:'long',month:'long',day:'numeric'}).toUpperCase()
  const focusColor = getSessionFocus(info.prog, info.session).color

  useEffect(() => {
    if (info.isWk) {
      const existing = log.find(e => e.date === todayISO && e.session === info.session)
      setExLogs(existing?.exercises ?? {})
      setGearLogs(existing?.gear ?? {})
      /* Restore the belt attachment heights too, or reopening today's saved
         workout comes back with the picker blank and the next save stamps
         RATED over a belt-path figure. */
      setAttachLogs(existing?.attach ?? {})
      setOpeningLogs(existing?.opening ?? {})
      /* bandPath was MISSING here until 2026-08-20 -- the same defect the
         comment above describes for attach, left behind when the band-path
         model landed. Reopening today's saved workout came back with the path
         blank, and the next save re-stamped without it, silently repricing the
         entry off the plate's default path. */
      setBandPathLogs(existing?.bandPath ?? {})
      /* And the substitution, or reopening a saved session shows the SCHEDULED
         exercise sitting above sets that were logged against the substitute.

         THE FRESH BRANCH IS THE ONLY ONE THAT SEEDS A STANDING SUBSTITUTION.
         `existing` present with no `subs` still yields {} -- an entry saved
         before this feature recorded no substitution, and that is a fact about
         it rather than a gap to fill. This app has no draft mechanism, so
         "fresh" is simply "no existing entry".

         It APPLIES standing subs and never creates one: there is no profile
         editor here, matching rirTarget, defaultSets, volumeModel and the body
         measurements. */
      setSubsLogs(existing
        ? (existing.subs ?? {})
        : RBTS_REPORTS.standingSubsFor(
            (_ACTIVE_PROFILE && _ACTIVE_PROFILE.standingSubs) || {},
            sessionPrescribedIds(info.prog, info.session),
            EXERCISE_NAMES))
      setSaved(!!(existing?.completedAt))
    }
  }, [info.session, todayISO, log])

  function handleSave() {
    const cleanEx = cleanExercises(exLogs)
    if (Object.keys(cleanEx).length === 0) {
      alert('No exercise data logged yet. Enter at least one set with reps or bands.')
      return
    }
    // Gear rides along per exercise — keep only exercises that survived
    // cleaning, and drop empty selections.
    const cleanGear = {}
    Object.keys(cleanEx).forEach(id => {
      const g = (gearLogs||{})[id]
      if (Array.isArray(g) && g.length) cleanGear[id] = g
    })
    /* The belt attachment height, scoped the same way: an exercise with no
       logged sets carries no height, and a non-finite value is dropped rather
       than persisted. BOTH guards -- isFinite(null) === true is exactly the
       trap that once stored a half-entered reading as a fake 0-lb point. */
    const cleanAttach = {}
    Object.keys(cleanEx).forEach(id => {
      const h = (attachLogs||{})[id]
      if (h != null && isFinite(h)) cleanAttach[id] = h
    })
    /* The adjustable-gear opening, scoped and guarded identically. */
    const cleanOpening = {}
    Object.keys(cleanEx).forEach(id => {
      const n = (openingLogs||{})[id]
      if (n != null && isFinite(n)) cleanOpening[id] = n
    })
    /* The footplate band path, scoped identically. The guard is a non-empty
       STRING, not isFinite: a path key is a string and isFinite('len') is
       false, so copying the opening's guard would drop every one of them. */
    const cleanBandPath = {}
    Object.keys(cleanEx).forEach(id => {
      const k = (bandPathLogs||{})[id]
      if (typeof k === 'string' && k) cleanBandPath[id] = k
    })
    /* The substitution map, scoped by the exercise it points AT rather than by
       its own key -- the PERFORMED exercise is the one that must have real
       sets. A self-referential entry is REVERT's resting state, not a
       substitution, and is dropped. */
    const cleanSubs = {}
    Object.keys(subsLogs||{}).forEach(schedId => {
      const perf = subsLogs[schedId]
      if (perf == null || String(perf) === String(schedId)) return
      if (cleanEx[String(perf)]) cleanSubs[String(schedId)] = Number(perf)
    })
    const entry = {
      date:todayISO, programId:info.prog.id, week:info.week,
      session:info.session, workoutNum:info.num,
      splitId:effSplitId(info.prog),          // P4: which split produced this key
      schemaVersion:2,
      exercises:cleanEx, gear:cleanGear, attach: cleanAttach, opening: cleanOpening,
      bandPath: cleanBandPath,
      subs: cleanSubs,
      completedAt:new Date().toISOString(),
    }
    /* Stamp AFTER cleaning so the load reflects exactly the sets being saved.
       Pure local computation, so it works offline -- which is the point, since
       training away from home is the whole reason this exists.
       Fourth argument is a MAP keyed by exercise id (bestSetLoad's fourth is a
       bare number, effectiveLoad's is an options object -- three deliberately
       different shapes). */
    const load = RBTS_REPORTS.stampLoad(cleanEx, cleanGear,
                           makeReportCtx({ log, gear: gearInv, myBands: [] }), cleanAttach,
                           cleanOpening, cleanBandPath)
    if (load) entry.load = load
    onSaveEntry(entry)
    setSaved(true)
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {!user && (
        <div style={{...widget,border:`1px solid ${C.amber}55`,background:`${C.amber}08`,
          display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <span style={{fontFamily:'monospace',fontSize:11,color:C.amber}}>
            ⚠ Sign in with Google to sync workouts across all devices
          </span>
        </div>
      )}
      <div style={{...widget,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
        <div>
          <span style={lbl}>TODAY</span>
          <div style={{fontFamily:'monospace',fontSize:16,color:C.readout}}>{todayStr}</div>
        </div>
        <span style={{...pill(info.isWk ? C.green : C.dimGray),fontSize:12,padding:'4px 14px'}}>
          {info.isWk ? 'WORKOUT DAY' : 'REST DAY'}
        </span>
        {/* Setup sheet: on a workout day this is today's session; on a rest day
            it is the NEXT scheduled one with its real date, so the sheet can be
            printed the night before. */}
        <ReportButtons label="PRINT SETUP SHEET"
          doc={() => {
            const d = info.isWk ? todayISO : localISO(info.nextDate)
            return RBTS_REPORTS.buildSetupDoc(
              makeReportCtx({ log, gear: gearInv, myBands: [] }),
              { date: d, prog: info.prog, sKey: info.session, week: info.week,
                workoutNum: info.isWk ? info.num : null,
                focusLabel: info.focus || null, isDeload: !!info.isDeload })
          }}
          name={() => {
            const d = info.isWk ? todayISO : localISO(info.nextDate)
            return `setup_${d}_P${info.prog.id}_${info.session}.md`
          }}/>
      </div>

      <details style={widget}>
        <summary style={{fontFamily:'monospace',fontSize:11,color:C.textSec,
          letterSpacing:'0.1em',textTransform:'uppercase',cursor:'pointer',userSelect:'none'}}>
          SCHEDULE SETTINGS
        </summary>
        <div style={{marginTop:12,display:'flex',flexWrap:'wrap',gap:20}}>
          <div>
            <span style={lbl}>START DATE</span>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={inputStyle}/>
          </div>
          <div>
            <span style={lbl}>SCHEDULE</span>
            <ScheduleChooser sched={sched} setSched={setSched}
              prog={PROGRAMS[Number(pi)]||PROGRAMS[0]} startDate={startDate}/>
          </div>
          <div>
            <span style={lbl}>SPLIT</span>
            <SplitChooser split={splitSel} setSplit={setSplitSel}
              prog={PROGRAMS[Number(pi)]||PROGRAMS[0]}/>
          </div>
          <div>
            <span style={lbl}>PROGRAM</span>
            <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
              {PROGRAMS.map((p,i) => (
                <button key={p.id} style={{...btn(Number(pi)===i),fontSize:10,padding:'3px 7px'}}
                  onClick={()=>setPi(i)}>P{p.id}</button>
              ))}
            </div>
          </div>
        </div>
      </details>

      {info.isWk ? (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div style={{...widget,display:'flex',gap:28,flexWrap:'wrap',alignItems:'center'}}>
            <div><span style={lbl}>WORKOUT</span><span style={readoutStyle}>#{info.num}</span></div>
            <div><span style={lbl}>SESSION</span>
              <span style={{fontFamily:'monospace',fontSize:22,fontWeight:700,color:focusColor}}>{info.session}</span>
            </div>
            <div><span style={lbl}>WEEK</span>
              <span style={{...readoutStyle,color:info.isDeload?C.deload:C.readout}}>
                {info.week}{info.isDeload?' DELOAD':''}
              </span>
            </div>
            <div><span style={lbl}>FOCUS</span>
              <span style={{fontFamily:'monospace',fontSize:13,color:focusColor}}>
                {getSessionFocus(info.prog, info.session).label}
                {info.focus ? ' · ' + String(info.focus).toUpperCase() : ''}
              </span>
            </div>
            <div><span style={lbl}>PROGRAM</span>
              <span style={{fontFamily:'monospace',fontSize:12,color:C.textSec}}>
                P{info.prog.id} {info.prog.name.toUpperCase()}
              </span>
            </div>
          </div>
          <div style={widget}>
            <LoggedSessionView
              prog={info.prog} sKey={info.session} week={info.week}
              focusLabel={info.focus}
              exercises={exLogs}
              onExercisesChange={ex=>{setExLogs(ex);setSaved(false);}}
              gearInv={gearInv} gear={gearLogs}
              onGearChange={g=>{setGearLogs(g);setSaved(false);}}
              attach={attachLogs}
              opening={openingLogs}
              bandPath={bandPathLogs}
              onBandPathChange={b=>{setBandPathLogs(b); setSaved(false)}}
              subs={subsLogs}
              onSubsChange={sb=>{setSubsLogs(sb); setSaved(false)}}
              onOpeningChange={o=>{setOpeningLogs(o); setSaved(false)}}
              onAttachChange={a=>{setAttachLogs(a);setSaved(false);}}
              todayDate={todayISO} log={log}/>
          </div>
          <div style={{...widget,display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
            <button style={{...btn(saved,saved?C.green:C.accent),padding:'8px 28px',fontSize:12}}
              onClick={handleSave}>
              {saved ? 'WORKOUT SAVED' : 'SAVE WORKOUT'}
            </button>
            <span style={{fontFamily:'monospace',fontSize:11,color:saved?C.green:C.dimGray}}>
              {saved ? 'Saved — check History tab to review'
                     : 'Log sets and bands above, then save when done'}
            </span>
          </div>
        </div>
      ) : (
        <div style={{...widget,textAlign:'center',padding:40}}>
          <div style={{fontFamily:'monospace',fontSize:22,color:C.dimGray,marginBottom:12}}>REST DAY</div>
          <div style={{fontFamily:'monospace',fontSize:11,color:C.textSec,marginBottom:24}}>
            Recovery is part of the program.
          </div>
          <div style={{display:'flex',justifyContent:'center',gap:32,flexWrap:'wrap'}}>
            <div>
              <span style={lbl}>NEXT WORKOUT</span>
              <span style={{...readoutStyle,fontSize:14}}>
                {info.nextDate.toLocaleDateString('en-US',
                  {weekday:'long',month:'short',day:'numeric'}).toUpperCase()}
              </span>
            </div>
            <div>
              <span style={lbl}>SESSION</span>
              <span style={{fontFamily:'monospace',fontSize:14,color:focusColor}}>
                {dayShort(info.session)} {getSessionFocus(info.prog,info.session).label}
              </span>
            </div>
            <div>
              <span style={lbl}>WEEK</span>
              <span style={{...readoutStyle,fontSize:14}}>
                {info.week}{info.isDeload?' DELOAD':''}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY TAB
// ─────────────────────────────────────────────────────────────────────────────
// ── Editable past-session card — correct bands/reps/sets logged earlier ──
function HistoryEntryEditor({ entry, onSave, onDelete, onDone, gearInv, log }) {
  const [ex, setEx] = useState(() => JSON.parse(JSON.stringify(entry.exercises || {})))
  const [gr, setGr] = useState(() => JSON.parse(JSON.stringify(entry.gear || {})))
  /* Belt attachment heights, seeded from the entry. Without its own state the
     editor would re-stamp every belt exercise as RATED on any edit — the
     heights would still sit in the entry (they ride in via the spread below)
     while the load beside them said something else. */
  const [at, setAt] = useState(() => JSON.parse(JSON.stringify(entry.attach || {})))
  /* The adjustable-gear opening, seeded from the entry for the same reason:
     without its own state an edit would re-stamp every strap exercise as the
     degraded RATED while the opening still sat in the entry beside it. */
  const [op, setOp] = useState(() => JSON.parse(JSON.stringify(entry.opening || {})))
  /* The footplate band path, seeded from the entry for the same reason the
     opening is: re-opening a workout must not silently drop a choice that is
     already priced into its stamp. */
  const [bp, setBp] = useState(() => JSON.parse(JSON.stringify(entry.bandPath || {})))

  const mapSet = (id, i, fn) => setEx(prev => {
    const n = { ...prev }
    n[id] = (n[id] || []).map((s, idx) => idx === i ? fn({ ...s }) : s)
    return n
  })
  /* DELETE on undefined rather than assigning it. Clearing RIR, cycling side
     back to bilateral, or untoggling DOUBLED all pass undefined, and unlike
     TodayTab this editor hands `ex` straight to the entry without going
     through cleanExercises -- so an assigned undefined would ride into the
     Firestore write, which rejects it. (stripUndefined on the write path is
     the backstop; this keeps the in-memory entry honest too.) */
  const updateSet = (id, i, field, val) => mapSet(id, i, c => {
    if (val === undefined) delete c[field]; else c[field] = val
    return c
  })
  const addSet = (id) => setEx(prev => {
    const n = { ...prev }; const arr = (n[id] || []).slice(); const last = arr[arr.length - 1]
    const lb = last ? (Array.isArray(last.segments) ? (((last.segments[0]||{}).bands)||[]) : (last.bands||[])) : []
    const lr = last ? (Array.isArray(last.segments) ? 0 : (last.reps||0)) : 0
    const ns = { reps: lr, bands: lb.slice() }
    // The fold belongs to the stack being copied — see LoggedExCard.addSet.
    if (last && last.doubled) ns.doubled = true
    const lside = last ? setSide(last) : null
    if (lside === 'L') ns.side = 'R'; else if (lside === 'R') ns.side = 'L'
    arr.push(ns); n[id] = arr; return n
  })
  const removeSet = (id, i) => setEx(prev => { const n = { ...prev }; n[id] = (n[id] || []).filter((_, idx) => idx !== i); return n })
  const removeEx = (id) => {
    setEx(prev => { const n = { ...prev }; delete n[id]; return n })
    setGr(prev => { const n = { ...prev }; delete n[id]; return n })
    setAt(prev => { const n = { ...prev }; delete n[id]; return n })
  }
  const updateAttach = (id, h) => setAt(prev => {
    const n = { ...prev }
    if (h == null) delete n[id]; else n[id] = h
    return n
  })
  /* Same helper LoggedExCard uses, per exercise: the first set naming a band
     drives the ATTACH AT preview. `beltRigOf` no longer gates the per-set
     SINGLED/DOUBLED toggle -- the fold changes the load on BOTH paths since
     2026-08-03 -- it only selects the tooltip wording, same role as `beltRig`
     in LoggedExCard. */
  const refSetOf = (id) => {
    const arr = ex[id] || []
    for (let i = 0; i < arr.length; i++) { if (setBandsOf(arr[i]).length) return arr[i] }
    return {}
  }
  const beltRigOf = (id) => {
    const g = gr[id] || []
    if (!g.length) return false
    const inv = {}; (gearInv || []).forEach(x => { inv[x.id] = x })
    const gearOf = (gid) => inv[gid]
    return !!RBTS_REPORTS.beltPlateOf(g, gearOf) && RBTS_REPORTS.beltBeltPresent(g, gearOf)
  }
  // ── Phase-aware editing (mirrors LoggedExCard so ✎ EDIT handles segmented/intensifier/RIR sets) ──
  const usesSeg = (s) => { const k=setIntensifier(s); return !!(INTENS[k] && INTENS[k].usesSegments) }
  const segsOf  = (s) => Array.isArray(s.segments) ? s.segments : [{bands:(s.bands||[]).slice(), reps:s.reps||0}]
  const changeIntens = (id, i, k) => mapSet(id, i, n => {
    const wantSeg = !!(INTENS[k] && INTENS[k].usesSegments)
    if (k==='straight') {
      if (Array.isArray(n.segments)) { n.bands=(((n.segments[0]||{}).bands)||[]).slice(); n.reps=n.segments.reduce((a,g)=>a+(g.reps||0),0) }
      delete n.segments; delete n.intensifier; delete n.drop
    } else {
      n.intensifier=k; delete n.drop
      if (wantSeg && !Array.isArray(n.segments)) { n.segments=[{bands:(n.bands||[]).slice(), reps:n.reps||0}]; delete n.bands; delete n.reps }
      else if (!wantSeg && Array.isArray(n.segments)) { n.bands=(((n.segments[0]||{}).bands)||[]).slice(); n.reps=n.segments.reduce((a,g)=>a+(g.reps||0),0); delete n.segments }
    }
    return n
  })
  const updateSeg = (id, i, segIdx, field, val) => mapSet(id, i, n => {
    const segs=(n.segments||segsOf(n)).map(g=>({...g})); segs[segIdx]={...segs[segIdx],[field]:val}; n.segments=segs; delete n.bands; delete n.reps; return n
  })
  const addSeg = (id, i) => mapSet(id, i, n => {
    const segs=(n.segments||segsOf(n)).map(g=>({...g})); const last=segs[segs.length-1]||{bands:[],reps:0}; segs.push({bands:(last.bands||[]).slice(), reps:0}); n.segments=segs; delete n.bands; delete n.reps; return n
  })
  const removeSeg = (id, i, segIdx) => mapSet(id, i, n => {
    const segs=(n.segments||segsOf(n)).filter((_,gi)=>gi!==segIdx); n.segments=segs; delete n.bands; delete n.reps; return n
  })

  function save() {
    // Keep gear scoped to exercises still in the session; drop empty selections.
    const cleanGear = {}
    Object.keys(ex).forEach(id => {
      const g = gr[id]
      if (Array.isArray(g) && g.length) cleanGear[id] = g
    })
    /* Attachment heights, scoped the same way and guarded the same way. An
       exercise removed in this edit must not keep its height alive in the
       saved entry. */
    const cleanAttach = {}
    Object.keys(ex).forEach(id => {
      const h = at[id]
      if (h != null && isFinite(h)) cleanAttach[id] = h
    })
    /* The adjustable-gear opening, scoped identically. */
    const cleanOpening = {}
    Object.keys(ex).forEach(id => {
      const n = op[id]
      if (n != null && isFinite(n)) cleanOpening[id] = n
    })
    /* The footplate band path, scoped identically. The guard is a non-empty
       STRING, not isFinite: a path key is a string and isFinite('len') is
       false, so copying the opening's guard would drop every one of them. */
    const cleanBandPath = {}
    Object.keys(ex).forEach(id => {
      const k = bp[id]
      if (typeof k === 'string' && k) cleanBandPath[id] = k
    })
    /* Re-stamp load from the sets actually being saved. The freeze-at-save
       rule exists so a later band re-measurement can't rewrite what a past
       workout meant -- it does not apply here, because the user is
       rewriting this entry right now, so there is no earlier truth being
       protected, only a stale one that would contradict the new sets. If
       the new sets can no longer produce a stamp (e.g. every band was
       removed), drop `load` instead of leaving the old value behind. */
    const loadStamp = RBTS_REPORTS.stampLoad(ex, cleanGear,
                           makeReportCtx({ log, gear: gearInv, myBands: [] }), cleanAttach,
                           cleanOpening, cleanBandPath)
    const updated = RBTS_REPORTS.applyLoadStamp(
      { ...entry, exercises: ex, gear: cleanGear, attach: cleanAttach,
        opening: cleanOpening, bandPath: cleanBandPath,
        editedAt: new Date().toISOString() },
      loadStamp)
    onSave(updated)
    onDone(true)
  }
  function deleteSession() {
    if (!window.confirm(`Delete this entire logged session (${entry.date} ${entry.session})? This cannot be undone.`)) return
    onDelete(entry)
    onDone(true)
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div style={{fontFamily:'monospace',fontSize:10,color:C.amber}}>
        ⚡ EDITING — set an intensifier (drop, M-Set…) per set to log phases (▼1, ▼2) + RIR; adjust bands/reps; then SAVE CHANGES.
      </div>
      {Object.keys(ex).length===0 && (
        <div style={{fontFamily:'monospace',fontSize:11,color:C.dimGray}}>
          No exercises left in this session — use DELETE SESSION to remove it entirely.
        </div>
      )}
      {Object.entries(ex).map(([id,sets]) => (
        <div key={id} style={{background:C.bgInput,borderRadius:5,padding:'8px 10px'}}>
          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
            <span style={{fontFamily:'monospace',fontSize:11,color:C.text,flex:1}}>
              <span style={{color:C.dimGray}}>#{id} </span>{EXERCISE_NAMES[id]||id}
            </span>
            <button onClick={()=>removeEx(id)} title="Remove this exercise from the session"
              style={{...btn(false,C.red),fontSize:10,padding:'3px 8px'}}>REMOVE EX</button>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:6}}>
            <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>GEAR</span>
            <GearPicker inv={gearInv} selected={gr[id]||[]} exId={id}
              onChange={ids=>setGr(prev=>({...prev,[id]:ids}))}
              bands={setBandsOf(refSetOf(id))} doubled={!!refSetOf(id).doubled}
              attachHeightIn={at[id]} onAttachChange={h=>updateAttach(id,h)}
              opening={op[id]}
              onOpeningChange={n=>setOp(prev=>{const x={...prev}; if(n==null) delete x[id]; else x[id]=n; return x})}
              bandPath={bp[id]}
              onBandPathChange={k=>setBp(prev=>{const x={...prev};
                /* Non-empty STRING, not isFinite -- a path key is a string. */
                if (typeof k !== 'string' || !k) delete x[id]; else x[id]=k; return x})}/>
          </div>
          {(sets||[]).map((s,i) => {
            const seg=usesSeg(s); const segs=segsOf(s); const straight=isPlainSet(s)
            return (
              <div key={i} style={ straight
                ? {marginBottom:8,paddingBottom:2}
                : {border:`1px solid ${C.amber}33`,borderRadius:6,padding:'7px 8px',marginBottom:8,background:`${C.amber}08`} }>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <span style={{fontFamily:'monospace',fontSize:11,color:C.dimGray,minWidth:20,flexShrink:0}}>S{i+1}</span>
                  <span onClick={()=>updateSet(id,i,'side', nextSide(setSide(s)) || undefined)}
                    title="Which side this set worked — tap to cycle: — bilateral · L left · R right"
                    style={{fontFamily:'monospace',fontSize:10,fontWeight:700,cursor:'pointer',userSelect:'none',
                      color: setSide(s) ? C.readout : C.dimGray,
                      border:`1px solid ${setSide(s) ? C.readout+'66' : 'rgba(255,255,255,0.12)'}`,
                      borderRadius:4,padding:'5px 7px',flexShrink:0,minWidth:12,textAlign:'center'}}>
                    {setSide(s) || '—'}
                  </span>
                  <select value={setIntensifier(s)} title="Intensifier used on this set"
                    onChange={e=>changeIntens(id,i,e.target.value)}
                    style={{background:C.bgInput,
                      color:straight?C.dimGray:C.amber,
                      border:`1px solid ${straight?'rgba(255,255,255,0.12)':C.amber+'66'}`,
                      borderRadius:4,padding:'6px 4px',fontSize:10,fontFamily:'monospace',flexShrink:0,maxWidth:150}}>
                    {INTENS_OPTS.map(k => <option key={k} value={k}>{k==='straight'?'— none —':intensLabel(k)}</option>)}
                  </select>
                  <div style={{display:'flex',alignItems:'center',gap:3,flexShrink:0}}>
                    <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>RIR</span>
                    <input type="number" min="0" max="9"
                      value={s.rir==null?'':s.rir} placeholder={String(DEFAULT_RIR)}
                      title="Reps in reserve for the whole set (blank = your default)"
                      onChange={e=>{const v=e.target.value; updateSet(id,i,'rir', v===''?undefined:Math.max(0,parseInt(v)||0))}}
                      style={{...inputStyle,width:34,textAlign:'center',padding:'6px 3px',fontSize:12}}/>
                  </div>
                  {(setHasAnyBand(s) || !!s.doubled) && (
                    <button
                      onClick={()=>updateSet(id,i,'doubled', s.doubled ? undefined : true)}
                      title={'DOUBLED = the whole stack is folded over on itself. This is a '
                        + 'SEPARATE axis from how many bands you logged: two of the same band '
                        + 'side by side is a count of 2 on the band tag, not a fold. Folding '
                        + 'halves the free length at the same range of motion, so it is a big '
                        + 'jump -- see the EFFECTIVE figure, not the band ratings.'
                        + (beltRigOf(id) ? " On this belt rig it also halves the loop's rest length." : '')}
                      style={{...btn(!!s.doubled),fontSize:9,padding:'5px 7px',flexShrink:0}}>
                      {s.doubled ? 'DOUBLED' : 'SINGLED'}
                    </button>
                  )}
                  <span style={{flex:1}}></span>
                  {sets.length>1 && (
                    <button style={{...btn(false,C.red),fontSize:11,padding:'6px 10px',flexShrink:0}}
                      onClick={()=>removeSet(id,i)}>✕</button>
                  )}
                </div>
                {seg ? (
                  <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:6}}>
                    {segs.map((g,gi) => (
                      <div key={gi} style={{display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap'}}>
                        <span style={{fontFamily:'monospace',fontSize:10,color:C.amber,minWidth:30,paddingTop:9,flexShrink:0}} title="Resistance phase / drop">▼{gi+1}</span>
                        <div style={{flex:1,minWidth:150}}>
                          <BandPicker selected={g.bands||[]} doubled={!!s.doubled} onChange={v=>updateSeg(id,i,gi,'bands',v)}/>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:2,flexShrink:0}}>
                          <button style={{...btn(false),padding:'6px 11px',fontSize:14}} onClick={()=>updateSeg(id,i,gi,'reps',Math.max(0,(g.reps||0)-1))}>−</button>
                          <input type="number" min="0" max="999" value={g.reps||''} placeholder="0"
                            onChange={e=>updateSeg(id,i,gi,'reps',Math.max(0,parseInt(e.target.value)||0))}
                            style={{...inputStyle,width:46,textAlign:'center',padding:'6px 4px',fontSize:13}}/>
                          <button style={{...btn(false),padding:'6px 11px',fontSize:14}} onClick={()=>updateSeg(id,i,gi,'reps',(g.reps||0)+1)}>+</button>
                          <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginLeft:2}}>reps</span>
                        </div>
                        {segs.length>1 && (
                          <button style={{...btn(false,C.red),fontSize:11,padding:'6px 10px',flexShrink:0}} onClick={()=>removeSeg(id,i,gi)}>✕</button>
                        )}
                      </div>
                    ))}
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <button style={{...btn(false,C.amber),fontSize:10,padding:'5px 10px'}} onClick={()=>addSeg(id,i)}>+ PHASE / DROP</button>
                      <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>{segs.reduce((a,g)=>a+(g.reps||0),0)} total reps · one RIR for the whole set</span>
                      <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>+P</span>
                      <input type="number" min="0" max="99" value={s.partials==null?'':s.partials} placeholder="0"
                        title="Partial reps at the end of the whole set (blank = none)"
                        onChange={e=>{const v=e.target.value; updateSet(id,i,'partials', v===''?undefined:Math.max(0,parseInt(v)||0))}}
                        style={{...inputStyle,width:34,textAlign:'center',padding:'6px 3px',fontSize:12}}/>
                    </div>
                  </div>
                ) : (
                  <div style={{display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap',marginTop:6}}>
                    <div style={{flex:1,minWidth:160}}>
                      <BandPicker selected={s.bands||[]} doubled={!!s.doubled} onChange={v=>updateSet(id,i,'bands',v)}/>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:2,flexShrink:0}}>
                      <button style={{...btn(false),padding:'6px 11px',fontSize:14}} onClick={()=>updateSet(id,i,'reps',Math.max(0,(s.reps||0)-1))}>−</button>
                      <input type="number" min="0" max="999" value={s.reps||''} placeholder="0"
                        onChange={e=>updateSet(id,i,'reps',Math.max(0,parseInt(e.target.value)||0))}
                        style={{...inputStyle,width:46,textAlign:'center',padding:'6px 4px',fontSize:13}}/>
                      <button style={{...btn(false),padding:'6px 11px',fontSize:14}} onClick={()=>updateSet(id,i,'reps',(s.reps||0)+1)}>+</button>
                      <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginLeft:2}}>reps</span>
                      <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginLeft:6}}>+P</span>
                      <input type="number" min="0" max="99" value={s.partials==null?'':s.partials} placeholder="0"
                        title="Partial reps done after the full-ROM reps (blank = none)"
                        onChange={e=>{const v=e.target.value; updateSet(id,i,'partials', v===''?undefined:Math.max(0,parseInt(v)||0))}}
                        style={{...inputStyle,width:34,textAlign:'center',padding:'6px 3px',fontSize:12}}/>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          <button style={{...btn(false,C.green),fontSize:11,padding:'6px 12px'}}
            onClick={()=>addSet(id)}>+ SET</button>
        </div>
      ))}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <button style={{...btn(true,C.green),padding:'6px 18px',fontSize:11}} onClick={save}>SAVE CHANGES</button>
        <button style={{...btn(false),padding:'6px 18px',fontSize:11}} onClick={()=>onDone(false)}>CANCEL</button>
        <button style={{...btn(false,C.red),padding:'6px 18px',fontSize:11,marginLeft:'auto'}} onClick={deleteSession}>DELETE SESSION</button>
      </div>
    </div>
  )
}

function HistoryTab({ log, onMergeImport, onImportCustomEx, onSaveEntry, onDeleteEntry, gearInv, myBands, onImportInventory, invLoaded, user, onProgramsChanged }) {
  const uid = user ? user.uid : null
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate]     = useState(() => localISO())
  const [editKey, setEditKey]   = useState(null)

  const entries = useMemo(() =>
    log
      .filter(e => (!fromDate||e.date>=fromDate) && (!toDate||e.date<=toDate))
      .sort((a,b) => b.date.localeCompare(a.date)),
    [log, fromDate, toDate])

  function exportCSV() {
    const header = ['Date','Day','Program','Week','Session','Workout',
      'Exercise ID','Exercise Name','Set','Side','Reps','Partials',
      'Band 1','Band 1 Res','Band 2','Band 2 Res','Band 3','Band 3 Res']
    const rows = [header]
    entries.forEach(e => {
      const dayName = new Date(e.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long'})
      Object.entries(e.exercises||{}).forEach(([exId,sets]) => {
        ;(sets||[]).forEach((s,si) => {
          const bands = s.bands||[]
          const getBand = i => {
            const b = BANDS.find(x=>x.id===bands[i])
            return b ? [`${b.brand} ${b.color} ${b.model} ${b.lengthIn}in`, b.res] : ['','']
          }
          const b1=getBand(0),b2=getBand(1),b3=getBand(2)
          rows.push([e.date,dayName,e.programId||'',e.week||'',e.session,e.workoutNum||'',
            exId,EXERCISE_NAMES[exId]||exId,si+1,setSide(s)||'',s.reps||0,s.partials||'',
            b1[0],b1[1],b2[0],b2[1],b3[0],b3[1]])
        })
      })
    })
    if (rows.length===1) { alert('No logged sets in this date range.'); return }
    const csv = rows.map(r=>r.map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv)
    a.download = `workout_log_${fromDate||'all'}_to_${toDate||'all'}.csv`
    a.click()
  }

  function exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      rbts_log: log,
      rbts_customExercises: getLocalCustomEx(),   // definitions travel with the log
      /* A GLOBAL key that reached NO backup of any kind until 2026-08-07 --
         not Firestore, not either app's export. Each app held its own copy on
         its own origin, so clearing site data or iOS evicting PWA storage
         destroyed the program builder's output with nothing to restore from,
         and re-entering it by hand in both apps was the symptom.

         Unconditional, unlike the omit-when-empty fields above: an empty
         array here is harmless because the MERGE path is additive and never
         clears. (rbts_customBands and rbts_hiddenBrands are deliberately
         absent -- this app has no custom-band form and no brand manager, so
         exporting them would write keys nothing here ever reads.) */
      rbts_customPrograms: getCustomPrograms(),
      rbts_owner: (() => { try { return localStorage.getItem('rbts_owner') || '' }
                           catch { return '' } })(),
      // Inventory only once it has actually loaded — an export taken during the
      // initial cloud sync would otherwise carry empty arrays, which import as
      // a deliberate inventory wipe on another device.
      ...(invLoaded ? { rbts_gear: gearInv || [], rbts_myBands: myBands || [] } : {}),
      /* Measurements are expensive to produce and exist only where they were
         entered — the two apps do not share an origin, so without these the
         gear geometry and band calibration would have to be typed twice.
         Omitted entirely when empty, so an export from a device that has none
         cannot read as a deliberate wipe on import. */
      ...(Object.keys(getLocalBandGeom()).length ? { rbts_bandGeom: getLocalBandGeom() } : {}),
      ...(getLocalBodyweight().length ? { rbts_bodyweight: getLocalBodyweight() } : {}),
      /* The PROFILE carries rirTarget, defaultSets, volumeModel and splitId,
         which live nowhere else. The PWA has no editor for them, so this file
         is the ONLY way a training-style change made in the HTML app reaches
         the PWA — and without it the two apps quietly disagree about how many
         sets to seed and whether volume landmarks apply. Same omit-when-empty
         rule as above, so an export from a device with no profile cannot read
         as a deliberate wipe. Mirrors fitness_app.html. */
      ...(getLocalProfiles().length
            ? { rbts_profiles: getLocalProfiles(),
                rbts_activeProfile: localStorage.getItem('rbts_activeProfile') || '' }
            : {}),
    }
    const a = document.createElement('a')
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2))
    a.download = `rbts_backup_${new Date().toISOString().slice(0,10)}.json`
    a.click()
  }

  function mergeFile(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      try {
        const state = JSON.parse(ev.target.result)
        const fileOwner = (state && typeof state.rbts_owner === 'string') ? state.rbts_owner : ''
        let myOwner = ''
        try { myOwner = localStorage.getItem('rbts_owner') || '' } catch {}
        const verdict = RBTS_REPORTS.ownerMatches(fileOwner, myOwner)
        if (verdict === 'mismatch') {
          alert('This backup belongs to ' + fileOwner.toUpperCase() + '.\n' +
                'Your log belongs to ' + myOwner.toUpperCase() + '.\n\n' +
                'MERGE IMPORT is for your own devices. Merging another person\'s ' +
                'sessions into your log would mix their training into your ' +
                'history and your analyzer figures.\n\nNothing was changed.')
          return
        }
        /* THE ONLY MESSAGE OF THE THREE THAT IS DELIBERATELY *NOT* IDENTICAL TO
           fitness_app.html's. This app has no TRAINING STYLE panel, and typing
           a name in the HTML app would not help either: that writes ownerName
           into rbts_profiles on a DIFFERENT ORIGIN, while this app reads
           localStorage['rbts_owner'], which only signing in writes. So
           `unknown-mine` here means exactly "signed out", and the HTML app's
           wording would be wrong 100% of the time it fired. */
        if (verdict === 'unknown-mine') {
          alert('This backup belongs to ' + fileOwner.toUpperCase() + '.\n\n' +
                'This device has no owner set, so I cannot tell whether that is ' +
                'you.\n\nSign in with your Google account to set it, then try ' +
                'the merge again.\n\nNothing was changed.')
          return
        }
        const incoming = Array.isArray(state.rbts_log) ? state.rbts_log
                       : (Array.isArray(state) ? state : null)
        // Custom exercise definitions (from the HTML app or another PWA device)
        // ride along in the same backup file — merge them first so imported log
        // entries referencing ids ≥1000 (or 216/217) resolve to names.
        const customs = Array.isArray(state && state.rbts_customExercises) ? state.rbts_customExercises : []
        const addedEx = customs.length && onImportCustomEx ? onImportCustomEx(customs) : 0
        /* Custom PROGRAMS merge by id, file wins — additive, so nothing this
           device authored can be lost. PROGRAMS is read at module load, so a
           reload is needed before a newly arrived program appears in the
           picker; same posture as the profile below. */
        const mergedProgs = mergeCustomPrograms(state && state.rbts_customPrograms)
        /* An imported program has to reach the cloud too, or it lives on this
           device only and the next reconcile from another device merges it
           away as absent. */
        if (mergedProgs && onProgramsChanged) onProgramsChanged()
        // Inventory (gear + MY BANDS) is independent of the log merge.
        const invMsg = onImportInventory ? await onImportInventory(state) : ''
        /* Measurements ride along too — the two apps do not share an origin,
           so this file is the only way gear geometry and band calibration
           reach the other one. Only ever applied when the file actually
           carries them, so an older backup cannot wipe newer measuring.
           saveLocalBandGeom stamps updatedAt and, when signed in, pushes to
           Firestore (best-effort) — same as an in-app edit in BandCalibration. */
        let measMsg = ''
        /* PER FIELD, file wins on what it carries. This was a wholesale
           replace until 2026-08-10: a file naming 25 bands left rbts_bandGeom
           holding exactly those 25 keys, so every other band lost its entire
           entry -- rest length, width, thickness, the measured[] force curve
           and the note. saveLocalBandGeom then pushed that truncated map to
           Firestore, so the loss propagated to the other device rather than
           staying here. Nothing on screen would have reported it: a band with
           no geometry reads exactly like one that was never measured. */
        if (state && state.rbts_bandGeom && typeof state.rbts_bandGeom === 'object') {
          const bg = RBTS_REPORTS.mergeBandGeom(getLocalBandGeom(), state.rbts_bandGeom)
          saveLocalBandGeom(bg.map, uid)
          measMsg += ` Band calibration: ${bg.added} new, ${bg.updated} updated.`
        }
        if (Array.isArray(state && state.rbts_bodyweight) && state.rbts_bodyweight.length) {
          saveLocalBodyweight(state.rbts_bodyweight)
          measMsg += ` ${state.rbts_bodyweight.length} bodyweight entries.`
        }
        /* Profile: only ever restored from a file that actually carries one, so
           an older backup cannot wipe it. TRAINING_STYLE is read at module load,
           so say plainly that a reload is needed rather than leaving the app
           running on the old profile. Mirrors fitness_app.html. saveLocalProfiles
           stamps updatedAt and pushes to Firestore when signed in, same as
           saveLocalBandGeom above; rbts_activeProfile is a device-local pointer
           (which profile is active here), not part of the synced document. */
        if (Array.isArray(state && state.rbts_profiles) && state.rbts_profiles.length) {
          try {
            saveLocalProfiles(state.rbts_profiles, uid)
            if (state.rbts_activeProfile) localStorage.setItem('rbts_activeProfile', state.rbts_activeProfile)
            measMsg += ' Profile restored (RIR, set seeding, volume model, split) — RELOAD for it to take effect.'
          } catch { /* storage full: the rest of the import still stands */ }
        }
        if (!incoming) {
          if (customs.length || invMsg || measMsg || mergedProgs) {
            alert('No rbts_log in file.' +
              (customs.length ? ` Imported ${customs.length} custom exercise definition(s) (${addedEx} new).` : '') +
              invMsg + measMsg)
            return
          }
          alert('Invalid file — expected an rbts_log array.'); return
        }
        /* The clash list must be computed from the SAME copy the merge is
           applied to. handleMergeImport applies against localStorage; `log` is
           React state, and if the two ever disagree (a failed write, a render
           mid-sync) the dialog would describe something other than what
           happens. fitness_app.html reads getLog() for both. */
        const split = RBTS_REPORTS.splitLogMerge(logBase(log), incoming)
        let policy = 'mine'
        if (split.clashes.length) {
          const lines = split.clashes.slice(0, 12).map(c =>
            `   ${c.key}  (${Object.keys(c.mine.exercises || {}).length} exercises here, ` +
            `${Object.keys(c.theirs.exercises || {}).length} in the file)`).join('\n')
          const more = split.clashes.length > 12
                     ? `\n   ...and ${split.clashes.length - 12} more` : ''
          if (!window.confirm(`Merging ${incoming.length} session(s).\n\n` +
                `${split.fresh.length} are new and will be added.\n\n` +
                `${split.clashes.length} already exist in your log:\n${lines}${more}` +
                '\n\nOK to decide what happens to those, or Cancel to abandon ' +
                'the whole merge.')) {
            /* "Nothing was changed" was FALSE. By the time this dialog runs the
               inventory has been replaced wholesale and the custom exercises,
               programs and band calibration have all been merged. Cancelling
               abandons the LOG merge and nothing else. This whole item exists
               because an alert misdescribed what a merge did to the log; the
               same sentence one layer out is the same defect. */
            alert('Log merge cancelled. Your log is unchanged.' + invMsg +
                  '\n\nAnything else this file carried -- custom exercises, ' +
                  'programs, band calibration -- was already merged before ' +
                  'this point.')
            return
          }
          policy = window.confirm(`Use the FILE'S version of those ` +
                `${split.clashes.length} session(s)?\n\n` +
                'OK  = use the file\'s (replaces them)\n' +
                `Cancel = keep mine (the ${split.fresh.length} ` +
                'new session(s) still merge)\n\n' +
                'Nothing is removed either way.') ? 'file' : 'mine'
        }
        const res = await onMergeImport(incoming, policy)
        /* A storage failure reports itself instead of dressing up as a merge
           of zero sessions. `result` is initialised to zeroes and is only
           filled inside the try block, so without this the alert read
           "Added 0 session(s), kept 0 of yours" on a full quota -- while React
           state HAD merged, so the screen disagreed with the message. */
        if (res && res.stored === false) {
          alert('Could not save the merged log on this device — storage is ' +
                'probably full.\n\nWhat you see on screen has merged, but it ' +
                'will be lost on reload. Nothing was sent to the cloud.' +
                invMsg + measMsg)
          return
        }
        alert(`Added ${res ? res.added : '?'} session(s), ` +
          (policy === 'file' ? `replaced ${res ? res.replaced : '?'}`
                             : `kept ${res ? res.kept : '?'} of yours`) + '.' +
          ((verdict === 'unknown-file' || verdict === 'unknown-both')
             ? '\n\nNOTE: this file carries no owner name, so I could not check ' +
               'whose log it is.' : '') +
          (customs.length ? ` Custom exercises: ${customs.length} in file, ${addedEx} new.` : '') +
          (mergedProgs ? ` Custom programs: ${mergedProgs.length} total — RELOAD to see them.` : '') +
          (res && res.synced ? ' Synced to the cloud.' : ' Saved locally (sign in to sync).') +
          invMsg + measMsg)
      } catch (err) { alert('Could not read file: ' + err.message) }
    }
    reader.readAsText(file); e.target.value = ''
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{...widget,display:'flex',flexWrap:'wrap',gap:16,alignItems:'flex-end'}}>
        <div>
          <span style={lbl}>FROM</span>
          <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={inputStyle}/>
        </div>
        <div>
          <span style={lbl}>TO</span>
          <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={inputStyle}/>
        </div>
        <div><span style={lbl}>SESSIONS</span><span style={readoutStyle}>{entries.length}</span></div>
        <button style={{...btn(false,C.green),padding:'6px 18px',fontSize:11}} onClick={exportCSV}>EXPORT CSV</button>
        <button style={{...btn(false,'#7ecfff'),padding:'6px 18px',fontSize:11}} onClick={exportJSON}>EXPORT JSON</button>
        {/* Prints exactly what the FROM/TO filter shows: `entries` is the same
            memo the cards below render from. */}
        <ReportButtons label="PRINT RANGE"
          doc={() => RBTS_REPORTS.buildHistoryDoc(
            makeReportCtx({ log, gear: gearInv, myBands }),
            { entries, fromDate, toDate, single: false })}
          name={() => `history_${fromDate || 'all'}_to_${toDate || 'all'}.md`}/>
        <label style={{...btn(false,C.green),padding:'6px 18px',fontSize:11,cursor:'pointer'}}
          title="Add or replace sessions by date — syncs to the cloud when signed in">
          MERGE IMPORT
          <input type="file" accept=".json" style={{display:'none'}} onChange={mergeFile}/>
        </label>
      </div>

      {entries.length===0 ? (
        <div style={{...widget,textAlign:'center',padding:40}}>
          <div style={{fontFamily:'monospace',color:C.dimGray}}>No entries in this date range.</div>
          <div style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginTop:8}}>
            Log a workout on the Today tab and hit Save Workout.
          </div>
        </div>
      ) : entries.map(e => {
        const focusCol = getSessionFocus(PROGRAMS.find(p=>p.id===e.programId),e.session)?.color ?? C.accent
        const exCount  = Object.keys(e.exercises||{}).length
        const setCount = Object.values(e.exercises||{}).reduce((n,s)=>n+(s?s.length:0),0)
        const entKey    = e.date+'|'+e.session
        const isEditing = editKey===entKey
        return (
          <div key={e.date+e.session} style={widget}>
            <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:12,flexWrap:'wrap'}}>
              <span style={{fontFamily:'monospace',fontSize:15,color:C.readout}}>{e.date}</span>
              <span style={{...pill(focusCol),fontSize:11,padding:'3px 10px'}}>
                {dayShort(e.session)} {getSessionFocus(PROGRAMS.find(p=>p.id===e.programId),e.session)?.label ?? ''}
              </span>
              <span style={{fontFamily:'monospace',fontSize:11,color:C.textSec}}>
                P{e.programId} Wk{e.week} #{e.workoutNum||'?'}
              </span>
              <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>
                {exCount} exercises {setCount} sets
              </span>
              {e.completedAt && (
                <span style={{fontFamily:'monospace',fontSize:10,color:C.green,marginLeft:'auto'}}>
                  {new Date(e.completedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
                </span>
              )}
              <button style={{...btn(isEditing,C.amber),fontSize:10,padding:'3px 12px',marginLeft:e.completedAt?0:'auto'}}
                onClick={()=>setEditKey(isEditing?null:entKey)}>
                {isEditing ? '▾ EDITING' : '✎ EDIT'}
              </button>
              <ReportButtons label="PRINT"
                doc={() => RBTS_REPORTS.buildHistoryDoc(
                  makeReportCtx({ log, gear: gearInv, myBands }),
                  { entries: [e], single: true })}
                name={() => `session_${e.date}_${e.session}.md`}/>
            </div>
            {isEditing ? (
              <HistoryEntryEditor entry={e} onSave={onSaveEntry} onDelete={onDeleteEntry}
                onDone={()=>setEditKey(null)} gearInv={gearInv} log={log}/>
            ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:6}}>
              {(() => {
              /* PERFORMED id -> SCHEDULED id, built once per entry rather than
                 per exercise: a session has a handful of substitutions and a
                 per-exercise rebuild is quadratic across a multi-year log. */
              const subBack = {}
              Object.keys(e.subs||{}).forEach(schedId => {
                subBack[String(e.subs[schedId])] = Number(schedId)
              })
              return Object.entries(e.exercises||{}).map(([exId,sets]) => (
                <div key={exId} style={{background:C.bgInput,borderRadius:5,padding:'7px 10px'}}>
                  <div style={{fontFamily:'monospace',fontSize:11,color:C.text,marginBottom:5}}>
                    <span style={{color:C.dimGray}}>#{exId} </span>{EXERCISE_NAMES[exId]||exId}
                  </div>
                  {subBack[String(exId)] != null && (
                    <div style={{fontFamily:'monospace',fontSize:9,color:C.amber,
                      letterSpacing:'0.08em',marginTop:-2,marginBottom:5}}>
                      SUBSTITUTED FOR {EXERCISE_NAMES[subBack[String(exId)]] || `#${subBack[String(exId)]}`}
                    </div>
                  )}
                  {e.gear && Array.isArray(e.gear[exId]) && e.gear[exId].length > 0 && (
                    <div style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,marginBottom:4}}>
                      ⚙ {e.gear[exId].map(gid => {
                        const g = (gearInv||[]).find(x=>x.id===gid)
                        return g ? `${g.brand} ${g.name}` : null
                      }).filter(Boolean).join(' + ') || '(gear no longer in inventory)'}
                    </div>
                  )}
                  {(sets||[]).map((s,i) => {
                    const nameBands=(arr)=>(arr||[]).map(bid=>{
                      const b=BANDS.find(x=>x.id===bid)
                      return b?`${b.brand.split(' ')[0]} ${b.color} (${b.res}lbs)`:bid
                    }).join(' + ')
                    const reps=setRepsOf(s); const intens=setIntensifier(s)
                    const segs=Array.isArray(s.segments)?s.segments:null
                    return (
                      <div key={i} style={{marginBottom:segs?4:2}}>
                        <div style={{fontFamily:'monospace',fontSize:10,color:C.textSec}}>
                          <span style={{color:C.dimGray}}>S{i+1} </span>
                          <span style={{color:reps>=PROG_REPS?C.green:C.text}}>{reps}r{partialsSfx(s)}{setSide(s)?' '+setSide(s):''}</span>
                          {intens!=='straight' && <span style={{color:C.amber}}> ⚡{intensLabel(intens)}</span>}
                          {!segs && nameBands(setBandsOf(s)) && <span style={{color:C.dimGray}}> {nameBands(setBandsOf(s))}</span>}
                        </div>
                        {segs && segs.map((g,j) => (
                          <div key={j} style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,paddingLeft:18}}>
                            <span style={{color:C.amber}}>{j===0?'└':'·'} </span>
                            <span style={{color:C.textSec}}>{g.reps||0}r</span>
                            {nameBands(g.bands) && <span> {nameBands(g.bands)}</span>}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              ))
              })()}
            </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* Gear dimensions -- the numbers that decide how hard a band actually pulls.
   Ported from fitness_app.html. A value the user types IS the measurement, so
   it sets source/verified AND userEdited, which pins it against any future
   GEAR_DIMS revision. Reads through resolveGearDims so an item that arrived
   from Firestore with no stored dims still shows the table's figures. */
function GearDims({ it, onChange }) {
  const [open, setOpen] = useState(false)
  const d = RBTS_REPORTS.resolveGearDims(it) || {}
  const fields = RBTS_REPORTS.gearDimFieldsFor(it.type)
  const src = RBTS_REPORTS.gearDimSource({ dims: d })
  const SRC_COLOR = { measured: C.green, vendor: '#7ecfff', estimated: C.amber, none: C.dimGray }
  const SRC_LABEL = { measured: 'MEASURED', vendor: 'VENDOR', estimated: 'ESTIMATE', none: 'NO DIMS' }

  function setField(k, raw) {
    /* A value the user typed is measured by definition -- and userEdited pins
       it, so a later GEAR_DIMS revision can never overwrite their number.
       Shared with fitness_app.html via applyGearDimEdit in rbts_reports.js. */
    const next = RBTS_REPORTS.applyGearDimEdit(d, k, raw)
    onChange({ ...it, dims: next })
  }

  if (!fields.length) return null
  return (
    <div style={{paddingLeft:26}}>
      <span onClick={() => setOpen(!open)}
        title="Dimensions that change how hard the band actually pulls"
        style={{...pill(SRC_COLOR[src]), cursor:'pointer', fontSize:9}}>
        {open ? '▾' : '▸'} DIMS · {SRC_LABEL[src]}
      </span>
      {open && (
        <div style={{marginTop:6,padding:'8px 10px',background:C.bgInput,borderRadius:4,
          border:`1px solid ${C.accentDim}55`}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:8}}>
            {fields.map(f => (
              <div key={f.k} style={{display:'flex',flexDirection:'column',gap:2}}>
                <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>
                  {f.l.toUpperCase()}{f.hint ? ` · ${f.hint}` : ''}
                </span>
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <input type="number" step="0.125" min="0"
                    value={d[f.k] == null ? '' : d[f.k]}
                    onChange={e => setField(f.k, e.target.value)}
                    style={{...inputStyle, width:70, fontSize:12, padding:'4px 6px'}}/>
                  <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>in</span>
                </div>
              </div>
            ))}
          </div>
          {d.note && (
            <div style={{marginTop:6,fontFamily:'monospace',fontSize:9,color:C.amber,lineHeight:1.5}}>
              {d.note}
            </div>
          )}
          <div style={{marginTop:6,fontFamily:'monospace',fontSize:9,color:C.dimGray,lineHeight:1.5}}>
            {src === 'measured'
              ? 'You measured these. The load model may treat them as real.'
              : src === 'vendor'
                ? 'Published by the vendor but not confirmed on your unit. Overwrite with a tape measure when you can.'
                : 'An estimate, not a measurement. Measure it and type the number here.'}
          </div>
        </div>
      )}
    </div>
  )
}

/* Band calibration -- rest length and Tension Master readings, the physical
   measurements the effective-load model needs (see CLAUDE.md "Effective Load
   Model"). Without a real rest length the model falls back to the catalog's
   nominal loop length, and every stretch figure is wrong by however much the
   band actually differs from its advertised size.

   Ported from fitness_app.html's BandCalibration. The parsing/validation --
   what a typed rest length means, how one Tension Master reading gets added,
   edited or cleared, and the "fewer than 2 readings never claims MEASURED"
   floor -- all live once in rbts_reports.js (applyBandRestLengthEdit /
   applyBandMeasuredPointEdit / bandCalibrationLabel) so both apps share
   exactly the same behaviour instead of a hand-duplicated inline copy; this
   component only renders and wires up state.

   rbts_bandGeom works the same signed in or signed out -- writes always go
   to localStorage first (saveLocalBandGeom below never touches the network)
   and, since Task 6, also sync to users/{uid}/meta/bandGeom when signed in
   (best-effort; a rejected cloud write never blocks or undoes the local
   save). Before Task 6 this was local-only and round-tripped only through a
   backup export/import; that path still works unchanged for signed-out use
   and for carrying calibration between the two apps, which do not share an
   origin. */
function BandCalibration({ myBands, user }) {
  const [open, setOpen] = useState(false)
  const [geom, setGeom] = useState(() => getLocalBandGeom())
  const pool = myBands.length ? BANDS.filter(b => myBands.indexOf(b.id) >= 0) : []
  const uid = user ? user.uid : null

  /* `geom` is what this panel RENDERS; it is never what an edit is computed
     from. Both setters rebuild the whole map, and they read it through
     getLocalBandGeom at the moment of the edit (bandGeomRestEdit /
     bandGeomPointEdit take the reader, not a map, so a snapshot cannot be
     passed by accident). The sign-in reconcile writes localStorage without
     touching component state, and it runs last in a long serial await chain
     — so on a cold start there is a window in which adopted calibration is
     in storage and not in this component. Computing an edit from `geom`
     there wrote the pre-adopt map back over every other band, locally and
     to Firestore. */
  function setRest(id, raw) {
    const next = RBTS_REPORTS.bandGeomRestEdit(getLocalBandGeom, id, raw)
    saveLocalBandGeom(next, uid)
    setGeom(next)
  }
  function setPoint(id, i, field, raw) {
    const next = RBTS_REPORTS.bandGeomPointEdit(getLocalBandGeom, id, i, field, raw)
    saveLocalBandGeom(next, uid)
    setGeom(next)
  }
  /* ...and re-read on sign-in/out so the panel SHOWS adopted calibration
     rather than the values it happened to mount with. The data itself is
     safe without this (the setters read fresh); this is so the numbers on
     screen are the numbers in storage. */
  useEffect(() => { setGeom(getLocalBandGeom()) }, [uid])

  return (
    <div style={widget}>
      {/* Re-read on OPEN as well as on sign-in: the uid effect fires when the
          user object changes, which is before the async reconcile that may
          adopt remote calibration has finished. Opening the panel is the
          deliberate action that follows, so it is the reliable moment to
          show what is actually in storage. */}
      <div onClick={() => { if (!open) setGeom(getLocalBandGeom()); setOpen(!open) }}
        style={{cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
        <span style={lbl}>BAND CALIBRATION</span>
        <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray}}>
          {open ? '▾' : '▸'} {pool.length ? `${pool.length} bands in MY BANDS` : 'set MY BANDS first'}
        </span>
      </div>
      {open && (
        <div style={{marginTop:10}}>
          <div style={{fontFamily:'monospace',fontSize:10,color:C.textSec,lineHeight:1.6,marginBottom:10}}>
            Rest length is the loop laid flat with the slack just taken out, inside tip to
            tip — a "41 inch" band often is not 41 inches, and every stretch figure
            depends on it. The three readings are Tension Master measurements: stretch the
            band so the distance between the bearing points is a length you have measured,
            read the gauge, record both. Two readings are enough to replace the assumed
            curve with a real one; three is better. Leave it all blank and the app keeps
            using the vendor's rated range, reported as MODELED rather than MEASURED.
          </div>
          {!pool.length && (
            <div style={{fontFamily:'monospace',fontSize:11,color:C.amber}}>
              Nothing to calibrate yet — pick the bands you own in MY BANDS.
            </div>
          )}
          {pool.map(b => {
            const g = geom[b.id] || {}
            const pts = g.measured || []
            const status = RBTS_REPORTS.bandCalibrationLabel(pts)
            return (
              <div key={b.id} style={{padding:'8px 0',borderTop:`1px solid ${C.accentDim}`}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:6}}>
                  <span style={{fontFamily:'monospace',fontSize:11,color:C.text,minWidth:170}}>
                    {bandLabel(b)} <span style={{color:C.dimGray}}>{b.lengthIn}" · {b.res}</span>
                  </span>
                  <span style={{...pill(status === 'MEASURED' ? C.green : C.dimGray),fontSize:9}}>
                    {status}
                  </span>
                </div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
                  <div style={{display:'flex',flexDirection:'column',gap:2}}>
                    <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>REST LENGTH</span>
                    <input type="number" step="0.125" min="0"
                      value={g.restLengthIn == null ? '' : g.restLengthIn}
                      placeholder={String(b.lengthIn)}
                      onChange={e => setRest(b.id, e.target.value)}
                      style={{...inputStyle, width:66, fontSize:12, padding:'4px 6px'}}/>
                  </div>
                  {[0,1,2].map(i => {
                    const p = pts[i] || {}
                    return (
                      <div key={i} style={{display:'flex',flexDirection:'column',gap:2}}>
                        <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>
                          READING {i+1} — STRETCH / LB
                        </span>
                        <div style={{display:'flex',gap:3,alignItems:'center'}}>
                          <input type="number" step="0.25" min="0"
                            value={p.stretchIn == null ? '' : p.stretchIn}
                            onChange={e => setPoint(b.id, i, 'stretchIn', e.target.value)}
                            style={{...inputStyle, width:56, fontSize:12, padding:'4px 6px'}}/>
                          <span style={{color:C.dimGray,fontSize:10}}>/</span>
                          <input type="number" step="0.5" min="0"
                            value={p.lb == null ? '' : p.lb}
                            onChange={e => setPoint(b.id, i, 'lb', e.target.value)}
                            style={{...inputStyle, width:56, fontSize:12, padding:'4px 6px'}}/>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GEAR TAB
// ─────────────────────────────────────────────────────────────────────────────
// Editable equipment inventory + MY BANDS. Controlled by App (Firestore-synced
// when signed in, localStorage when signed out) via props.
function GearTab({ gear, myBands, onSaveGear, onRemoveGear, onSetMyBands, onRestoreGear, user }) {
  const [open, setOpen]   = useState({})
  const isOpen   = k => !!open[k]
  const toggle   = k => setOpen(o => ({ ...o, [k]: !o[k] }))
  const openBrand = k => setOpen(o => ({ ...o, [k]: true }))

  // group equipment by brand
  const gByBrand = {}
  gear.forEach(it => { (gByBrand[it.brand] = gByBrand[it.brand] || []).push(it) })
  const gBrands = Object.keys(gByBrand).sort()

  // group owned bands by brand
  const owned = BANDS.filter(b => myBands.indexOf(b.id) >= 0)
  const bByBrand = {}
  owned.forEach(b => { (bByBrand[b.brand] = bByBrand[b.brand] || []).push(b) })
  const bBrands = Object.keys(bByBrand).sort()

  // Per-band count = duplicate ids in MY BANDS. Some exercises (wide anchored
  // chest flies, X squats, …) need two IDENTICAL bands or the load is unbalanced,
  // so the same id may appear up to BAND_QTY_MAX times. Default 1.
  const BAND_QTY_MAX = 5
  const bandCnt = {}
  myBands.forEach(id => { bandCnt[id] = (bandCnt[id]||0)+1 })
  let totalUnits = 0
  owned.forEach(b => { totalUnits += bandCnt[b.id]||1 })
  function bumpBand(id, d) {
    const cnt = bandCnt[id]||0
    if (d > 0) { if (cnt >= BAND_QTY_MAX) return; onSetMyBands([...myBands, id]) }
    else if (cnt > 1) {
      const idx = myBands.indexOf(id); if (idx < 0) return
      const next = myBands.slice(); next.splice(idx, 1); onSetMyBands(next)
    }
  }

  // add-gear form
  const [addingGear, setAddingGear] = useState(false)
  const [gf, setGf] = useState({ brand:'', newBrand:'', name:'', qty:1, status:'owned', type:'other' })
  const gfSet = (k, v) => setGf(p => ({ ...p, [k]: v }))
  /* Picking a catalog NAME also sets the TYPE, because the type is not a
     cosmetic tag: it caps how many of that kind the workout GEAR picker
     accepts (1 bar, 1 footplate, 2 handles) and decides which branch of
     gearPathDelta prices the item. A footplate left on the default "other"
     falls through to the catch-all branch, which reads a thickness as an
     elevation and doubles it -- the Foam Block defect, through the door of a
     dropdown nobody changed. Typing a name the catalog does not know leaves
     whatever type is already selected. */
  function gfSetName(v) {
    setGf(p => {
      const n = { ...p, name: v }
      const brand = (p.brand === '__new__' ? p.newBrand : p.brand).trim()
      const hit = RBTS_REPORTS.gearCatalogItem(brand, v.trim())
      if (hit) n.type = hit.type
      return n
    })
  }
  const gCatalog = RBTS_REPORTS.gearCatalog()
  /* Catalog brands UNION the brands already in the inventory, so the dropdown
     keeps offering a brand the user typed themselves. Before 2026-08-24 this
     list was the inventory brands ALONE -- empty on a fresh install, which is
     every install since the seed was emptied on 2026-08-21. */
  const gFormBrands = (() => {
    const out = gCatalog.map(g => g.brand)
    gBrands.forEach(b => { if (out.indexOf(b) < 0) out.push(b) })
    return out.sort()
  })()
  const gCatalogNames = (() => {
    const brand = (gf.brand === '__new__' ? gf.newBrand : gf.brand).trim()
    const hit = gCatalog.find(g => g.brand === brand)
    return hit ? hit.items : []
  })()
  function addGearItem() {
    const brand = (gf.brand === '__new__' ? gf.newBrand : gf.brand).trim()
    const name  = gf.name.trim()
    if (!brand || !name) return
    onSaveGear({ id:`g${Date.now()}`, brand, name,
      qty:Math.max(1, parseInt(gf.qty,10)||1), status:gf.status, note:'',
      type:gf.type||inferGearType(name) })
    setGf({ brand:'', newBrand:'', name:'', qty:1, status:'owned', type:'other' })
    setAddingGear(false); openBrand('gear:'+brand)
  }

  // add-band form
  const [addingBand, setAddingBand] = useState(false)
  const allBandBrands = []
  BANDS.forEach(b => { if (allBandBrands.indexOf(b.brand) < 0) allBandBrands.push(b.brand) })
  allBandBrands.sort()
  const [bf, setBf] = useState({ brand: allBandBrands[0] || '', bandId:'' })
  const bfChoices = BANDS.filter(b => b.brand === bf.brand && (bandCnt[b.id]||0) < BAND_QTY_MAX)
    .sort((a,b) => a.lengthIn - b.lengthIn || RBTS_REPORTS.bandMid(a) - RBTS_REPORTS.bandMid(b))
  function addBandSel() {
    if (!bf.bandId) return
    const br = (BANDS.find(b => b.id === bf.bandId) || {}).brand
    if ((bandCnt[bf.bandId]||0) < BAND_QTY_MAX) onSetMyBands([...myBands, bf.bandId])
    setBf({ brand: bf.brand, bandId:'' }); setAddingBand(false)
    if (br) openBrand('band:'+br)
  }

  const SC = { owned:C.green, inbound:C.amber }
  const brandHeader = (key, name, right) => (
    <div onClick={() => toggle(key)}
      style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',
        padding:'8px 10px',background:C.bgInput,borderRadius:5}}>
      <span style={{color:C.accent,fontFamily:'monospace',fontSize:12,width:12}}>{isOpen(key)?'▾':'▸'}</span>
      <span style={{color:C.text,fontWeight:700,fontSize:12,letterSpacing:'0.06em',
        textTransform:'uppercase',flex:1}}>{name}</span>
      {right}
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:18}}>
      <div style={widget}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <span style={lbl}>MY BANDS{owned.length?' · '+owned.length:''}{totalUnits>owned.length?' ('+totalUnits+' PCS)':''}</span>
          <button style={{...btn(addingBand),fontSize:10,padding:'4px 10px'}}
            onClick={() => setAddingBand(!addingBand)}>{addingBand?'✕ CANCEL':'+ ADD BAND'}</button>
        </div>
        {addingBand && (
          <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center',
            marginBottom:12,padding:10,background:C.bgInput,borderRadius:5}}>
            <select value={bf.brand} onChange={e => setBf({brand:e.target.value,bandId:''})}
              style={{...inputStyle,minWidth:130}}>
              {allBandBrands.map(br => <option key={br} value={br}>{br}</option>)}
            </select>
            <select value={bf.bandId} onChange={e => setBf({...bf,bandId:e.target.value})}
              style={{...inputStyle,minWidth:210}}>
              <option value="">— select band —</option>
              {bfChoices.map(b => (
                <option key={b.id} value={b.id}>{b.color+' '+b.model+' · '+b.lengthIn+'" · '+b.res+(b.resKg?' lb / '+b.resKg+' kg':'')+((bandCnt[b.id]||0)>0?' · owned ×'+bandCnt[b.id]:'')}</option>
              ))}
            </select>
            <button style={{...btn(true,C.green),fontSize:11}} onClick={addBandSel}>ADD</button>
            {bfChoices.length===0 && <span style={{fontSize:10,color:C.dimGray}}>all {bf.brand} bands owned at max ×{BAND_QTY_MAX}</span>}
          </div>
        )}
        {bBrands.length===0 ? (
          <span style={{fontFamily:'monospace',fontSize:12,color:C.dimGray}}>
            No bands marked yet. Use + ADD BAND to start your list.
          </span>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {bBrands.map(br => {
              const key = 'band:'+br; const list = bByBrand[br]
              return (
                <div key={key}>
                  {brandHeader(key, br, (() => { let u = 0; list.forEach(b => { u += bandCnt[b.id]||1 })
                    return <span style={pill(C.amber)}>{u>list.length ? list.length+' ('+u+')' : list.length}</span> })())}
                  {isOpen(key) && (
                    <div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'8px 6px 2px 24px'}}>
                      {list.slice().sort((a,b) => a.lengthIn-b.lengthIn || RBTS_REPORTS.bandMid(a)-RBTS_REPORTS.bandMid(b)).map(b => {
                        const hex = COLOR_HEX[b.color] || '#888'
                        return (
                          <span key={b.id} style={{display:'inline-flex',alignItems:'center',gap:6,
                            background:C.bgWidget,border:'1px solid '+C.dimGray,borderRadius:4,
                            padding:'4px 8px',fontFamily:'monospace',fontSize:11,color:C.text}}>
                            <span style={{width:9,height:9,borderRadius:'50%',background:hex,
                              border:'1px solid rgba(255,255,255,0.3)',flexShrink:0}}/>
                            {b.color} {b.model}
                            <span style={{color:C.dimGray}}>{b.lengthIn}"</span>
                            <span style={{color:C.readout+'cc'}}>{b.res}{b.resKg ? ' / '+b.resKg+'kg' : ''}</span>
                            <span style={{display:'inline-flex',alignItems:'center',gap:2,marginLeft:2}}>
                              <span onClick={() => bumpBand(b.id,-1)}
                                title="One fewer of this band"
                                style={{cursor:(bandCnt[b.id]||1)>1?'pointer':'default',fontWeight:700,padding:'0 3px',
                                  color:(bandCnt[b.id]||1)>1?C.accent:C.dimGray+'66'}}>−</span>
                              <span title="How many of this exact band you own"
                                style={{fontSize:10,color:(bandCnt[b.id]||1)>1?C.amber:C.dimGray}}>×{bandCnt[b.id]||1}</span>
                              <span onClick={() => bumpBand(b.id,1)}
                                title={'One more of this band (max '+BAND_QTY_MAX+')'}
                                style={{cursor:(bandCnt[b.id]||1)<BAND_QTY_MAX?'pointer':'default',fontWeight:700,padding:'0 3px',
                                  color:(bandCnt[b.id]||1)<BAND_QTY_MAX?C.accent:C.dimGray+'66'}}>+</span>
                            </span>
                            <span onClick={() => onSetMyBands(myBands.filter(x => x !== b.id))}
                              title="Remove from My Bands (all copies)"
                              style={{cursor:'pointer',color:C.red,fontWeight:700,marginLeft:2}}>✕</span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <BandCalibration myBands={myBands} user={user}/>
      <div style={widget}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <span style={lbl}>EQUIPMENT{gear.length?' · '+gear.length:''}</span>
          <button style={{...btn(addingGear),fontSize:10,padding:'4px 10px'}}
            onClick={() => setAddingGear(!addingGear)}>{addingGear?'✕ CANCEL':'+ ADD GEAR'}</button>
        </div>
        {addingGear && (
          <div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center',
            marginBottom:12,padding:10,background:C.bgInput,borderRadius:5}}>
            <select value={gf.brand} onChange={e => gfSet('brand',e.target.value)}
              title="The catalog brands carry measured dimensions. Pick one if your item is on it — the spelling has to match exactly for the app to find the measurements."
              style={{...inputStyle,minWidth:130}}>
              <option value="">— brand —</option>
              {gFormBrands.map(br => <option key={br} value={br}>{br}</option>)}
              <option value="__new__">+ New brand…</option>
            </select>
            {gf.brand==='__new__' && (
              <input value={gf.newBrand} placeholder="new brand"
                onChange={e => gfSet('newBrand',e.target.value)}
                style={{...inputStyle,minWidth:120}}/>
            )}
            {/* A datalist, not a select: the catalog is a strong SUGGESTION,
                never a restriction. Picking an entry spells brand|name exactly
                as GEAR_DIMS is keyed and brings its measurements with it;
                anything else can still be typed straight in. */}
            <input value={gf.name} placeholder="item name" list="gear-catalog-names"
              title={gCatalogNames.length
                ? 'Pick from the list to get this item’s measured dimensions, or type your own.'
                : 'Type the item name.'}
              onChange={e => gfSetName(e.target.value)}
              style={{...inputStyle,minWidth:150}}/>
            <datalist id="gear-catalog-names">
              {gCatalogNames.map(it => <option key={it.name} value={it.name}/>)}
            </datalist>
            <input type="number" min="1" value={gf.qty}
              onChange={e => gfSet('qty',e.target.value)}
              style={{...inputStyle,width:60}}/>
            <select value={gf.status} onChange={e => gfSet('status',e.target.value)}
              style={{...inputStyle,minWidth:100}}>
              <option value="owned">Owned</option>
              <option value="inbound">Inbound</option>
            </select>
            <select value={gf.type} title="Used to cap selections in the workout GEAR picker (1 bar, 1 footplate, up to 2 handles/anchors)"
              onChange={e => gfSet('type',e.target.value)}
              style={{...inputStyle,minWidth:110}}>
              {GEAR_TYPES.map(t => <option key={t} value={t}>{GEAR_TYPE_LABELS[t]}</option>)}
            </select>
            <button style={{...btn(true,C.green),fontSize:11}} onClick={addGearItem}>ADD</button>
          </div>
        )}
        {gBrands.length===0 ? (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <span style={{fontFamily:'monospace',fontSize:12,color:C.dimGray}}>
              No equipment yet. Use + ADD GEAR to start your inventory{onRestoreGear?', or load the full starter set below.':'.'}
            </span>
            {onRestoreGear && (
              <button style={{...btn(false,C.green),fontSize:11,padding:'7px 14px',alignSelf:'flex-start'}}
                onClick={onRestoreGear}>⤓ LOAD STARTER EQUIPMENT</button>
            )}
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {gBrands.map(br => {
              const key = 'gear:'+br; const list = gByBrand[br]
              const ownedN   = list.filter(i => i.status==='owned').length
              const inboundN = list.filter(i => i.status==='inbound').length
              return (
                <div key={key}>
                  {brandHeader(key, br,
                    <span style={{display:'flex',gap:6,alignItems:'center'}}>
                      <span style={pill(C.green)}>{ownedN}</span>
                      {inboundN>0 && <span style={pill(C.amber)}>{inboundN} in</span>}
                    </span>)}
                  {isOpen(key) && (
                    <div style={{display:'flex',flexDirection:'column',gap:4,padding:'8px 6px 2px 24px'}}>
                      {list.map(it => (
                        <div key={it.id} style={{display:'flex',flexDirection:'column',gap:4}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,
                            padding:'6px 8px',background:C.bgWidget,borderRadius:4}}>
                            <span title="Toggle owned / inbound"
                              onClick={() => onSaveGear({...it, status: it.status==='owned'?'inbound':'owned'})}
                              style={{width:10,height:10,borderRadius:'50%',background:SC[it.status]||C.dimGray,
                                flexShrink:0,cursor:'pointer',border:'1px solid rgba(255,255,255,0.25)'}}/>
                            <span style={{fontFamily:'monospace',fontSize:12,color:C.text,flex:1}}>
                              {it.qty>1?it.qty+'× ':''}{it.name}
                              {it.note?<span style={{color:C.dimGray,fontSize:10}}> ({it.note})</span>:null}
                            </span>
                            <span title="Equipment type — drives the in-workout GEAR picker's selection caps. Tap to change if the guess is wrong."
                              onClick={() => {
                                const i = GEAR_TYPES.indexOf(it.type||'other')
                                onSaveGear({...it, type: GEAR_TYPES[(i+1)%GEAR_TYPES.length]})
                              }}
                              style={{...pill(C.dimGray),cursor:'pointer',userSelect:'none'}}>
                              {GEAR_TYPE_LABELS[it.type||'other']}
                            </span>
                            {it.status==='inbound' && <span style={pill(C.amber)}>inbound</span>}
                            <span onClick={() => onRemoveGear(it.id)}
                              title="Remove item"
                              style={{cursor:'pointer',color:C.red,fontWeight:700}}>✕</span>
                          </div>
                          <GearDims it={it} onChange={onSaveGear}/>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]                 = useState('today')
  const [user, setUser]               = useState(null)
  const [log, setLog]                 = useState([])
  /* THE LOG'S BASE COPY, for callbacks that must not re-identify on every
     log change. `rbts_log` being ABSENT while `log` holds the full history is
     a NORMAL state on a signed-in device, not a corrupt one: the sign-in path
     calls setLog(mig.entries) unconditionally but only calls writeLogVerified
     when the fold migration TOUCHED something, which it does not once the
     cloud entries are already migrated -- i.e. on every device now. (Do not
     name that condition in prose here: a parity assertion counts its
     occurrences in this file.) Only handleSaveEntry
     maintains the key, incrementally, when a workout is logged HERE. So a
     fresh install that signs in and merges a file has React state full and
     localStorage empty, and anything that treats the missing key as "no
     sessions" is reasoning from a blank slate that is not blank. */
  const logRef = useRef([])
  useEffect(() => { logRef.current = log }, [log])
  const [gear, setGear]               = useState([])
  const [myBands, setMyBands]         = useState([])
  const [settings, setSettings]       = useState(() => getLocalSettings())
  const [customEx, setCustomEx]       = useState(() => getLocalCustomEx())
  /* Set when a cloud adopt found the SELECTED program gone -- deleted on
     another device. The index falls back to 0, and this is what stops that
     being silent: a workout quietly derived from a different program is the
     class of wrong answer this project keeps rooting out. */
  const [programLostNotice, setProgramLostNotice] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [logLoading, setLogLoading]   = useState(false)
  const [invLoaded, setInvLoaded]     = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setInvLoaded(false)   // re-gate export until this session's inventory loads
      setUser(u)
      /* WHO THIS LOG BELONGS TO, free from the account -- no typing, and the
         same value on every device this person signs in on. displayName is
         already used for the header chip; the email local part is a fallback
         for an account that has none.

         DELIBERATELY NOT CLEARED ON SIGN-OUT. The write is guarded (`if (who)`),
         so signing out leaves the last known owner in place rather than blanking
         it. That is the safer of the two: an owner-less device resolves
         `unknown-mine`, which REFUSES any file that names an owner -- so
         clearing would mean signing out on your phone and no longer being able
         to merge your own desktop export. A remembered name can only ever make
         the gate stricter, never looser: it cannot turn a mismatch into a match.
         (An earlier version of this comment claimed it WAS cleared. It never
         was; the comment was wrong, not the code.) */
      try {
        const who = u ? ((u.displayName || '').trim()
                         || (u.email || '').split('@')[0] || '') : ''
        if (who) localStorage.setItem('rbts_owner', who)
      } catch { /* storage full or blocked: the merge simply cannot owner-check */ }
      setAuthLoading(false)
      if (u) {
        setLogLoading(true)
        try {
          // Reconcile localStorage ↔ Firestore by last-write-wins (entryTs):
          // push any local entry that is NEW or NEWER than its Firestore copy.
          // This lets a merge-imported / edited correction (freshly stamped
          // updatedAt) overwrite a stale cloud copy of the same date, instead of
          // being silently skipped just because the date already existed.
          const local = JSON.parse(localStorage.getItem('rbts_log') || '[]')
          if (local.length > 0) {
            const existing = await loadLogFromFirestore(u.uid)
            const fsByKey = new Map(existing.map(e => [`${e.date}_${e.session}`, e]))
            const toSync = local.filter(e => {
              const fs = fsByKey.get(`${e.date}_${e.session}`)
              return !fs || entryTs(e) > entryTs(fs)
            })
            try {
              await Promise.all(toSync.map(e => saveEntryToFirestore(u.uid, e)))
            } catch (e) {
              logCloudWriteFailure('sign-in push', toSync.map(x => x.date), e)
              /* Rethrow so control flow is UNCHANGED: the outer catch still
                 skips the cloud load below, and a local entry that failed to
                 push is not displaced by an older cloud copy. */
              throw e
            }
          }
          const entries = await loadLogFromFirestore(u.uid)
          const cloudFoldFlag = `rbts_foldMigration_cloud_${u.uid}`
          const mig = migrateFoldOnce(entries, cloudFoldFlag)
          if (mig.touchedDates.length) {
            // touchedDates, not changedDates: an entry that gained only the
            // foldMigrated marker must reach Firestore too, or the next
            // device to sign in re-migrates it.
            const touched = mig.entries.filter(e => mig.touchedDates.includes(e.date))
            try {
              await Promise.all(touched.map(e => saveEntryToFirestore(u.uid, e)))
              // Verified write. Throwing here lands in the catch below, which
              // sets NEITHER flag -- the same discipline as a partial cloud write.
              if (!writeLogVerified(mig.entries)) throw new Error('rbts_log write did not verify')
              localStorage.setItem(cloudFoldFlag, FOLD_CUTOFF)
              /* Mark the LOCAL flag too, not just cloud. This is safe (not just
                 convenient): 'rbts_log' was just overwritten, above, with
                 mig.entries, which has passed through migrateFoldOnce by
                 construction. The sign-in push a few lines up either succeeds
                 or throws and aborts this whole try before reaching here, so
                 there is no path where 'rbts_log' ends up holding anything
                 else. Setting the local flag here just skips a redundant,
                 no-op re-scan on the next sign-out instead of leaving it to
                 happen once more. */
              localStorage.setItem('rbts_foldMigration', FOLD_CUTOFF)
            } catch (err) {
              /* Do NOT set either flag. A partial cloud write, or a local
                 write that did not verify, must be retried on the next
                 sign-in, not recorded as done. */
              logCloudWriteFailure('fold migration', mig.touchedDates, err)
            }
          }
          setLog(mig.entries)
        } catch (e) { console.error('Error loading log:', e) }
        // Gear: backfill local → Firestore when empty, then load
        try {
          let fsGear = await loadGearFromFirestore(u.uid)
          if (fsGear.length === 0) {
            const localGear = getLocalGear()   // seeds defaults if nothing stored
            await Promise.all(localGear.map(g => saveGearItemToFirestore(u.uid, g)))
            fsGear = localGear
          }
          setGear(withGearTypes(fsGear))
        } catch (e) { console.error('Error loading gear:', e); setGear(withGearTypes(getLocalGear())) }
        // My bands: backfill local → Firestore when absent, then load
        try {
          let fsBands = await loadMyBandsFromFirestore(u.uid)
          if (fsBands === null) {
            const localBands = getLocalMyBands()
            await saveMyBandsToFirestore(u.uid, localBands)
            fsBands = localBands
          }
          setMyBands(fsBands)
        } catch (e) { console.error('Error loading my bands:', e); setMyBands(getLocalMyBands()) }
        setInvLoaded(true)
        /* Custom programs — union by id with tombstones (metaReconcile.js).
           DELIBERATELY BEFORE the settings reconcile below: rbts_progIdx is a
           bare array INDEX into PROGRAMS and custom programs sit at that
           array's tail, so a progIdx arriving from the cloud must land against
           a PROGRAMS that already reflects the cloud's program list. Running
           settings first points the index at this device's old tail. */
        try {
          const remote = unwrapCustomPrograms(await loadCustomProgramsFromFirestore(u.uid))
          const local  = { data: { list: getCustomPrograms(),
                                   tombstones: getCustomProgramTombstones() },
                           updatedAt: localCustomProgramsUpdatedAt() }
          const decision = reconcileCustomPrograms(local, remote)
          if (decision.action !== 'noop') {
            /* Capture the ACTIVE program's identity before the rebuild, and
               restore it after. Without this an adopt reorders the tail and
               today's workout silently comes from a different program. */
            const before = PROGRAMS.slice()
            const beforeIdx = Number(getLocalSettings().progIdx) || 0
            if (decision.action !== 'push-local') {
              setCustomPrograms(decision.data.list)
              setCustomProgramTombstones(decision.data.tombstones)
            }
            stampCustomPrograms(decision.updatedAt)
            /* 'merged' means the result matches NEITHER side, so it has to be
               written locally AND pushed -- adopting without pushing would
               leave the other device permanently missing a program. */
            if (decision.action === 'push-local' || decision.action === 'merged') {
              await saveCustomProgramsToFirestore(u.uid,
                { data: decision.data, updatedAt: decision.updatedAt })
            }
            const r = resolveProgIdx(before, PROGRAMS, beforeIdx)
            if (r.lost && beforeIdx !== 0) setProgramLostNotice(true)
            if (r.idx !== beforeIdx) persistSettings({ ...getLocalSettings(), progIdx: r.idx }, null)
          }
        } catch (e) { console.error('Custom program sync failed:', e) }
        // Settings (start date / schedule / program): last-write-wins vs cloud.
        try {
          const localS = getLocalSettings()
          const fsS    = await loadSettingsFromFirestore(u.uid)
          if (!fsS) {
            // First sign-in for this account → seed cloud from local settings.
            const seed = { ...localS, updatedAt: localS.updatedAt || Date.now() }
            await saveSettingsToFirestore(u.uid, seed)
            persistSettings(seed, null); setSettings(seed)
          } else if ((localS.updatedAt || 0) > (fsS.updatedAt || 0)) {
            // Local edited more recently → push to cloud.
            await saveSettingsToFirestore(u.uid, localS); setSettings(localS)
          } else {
            // Cloud is newer (or same) → adopt it locally.
            persistSettings(fsS, null); setSettings(fsS)
          }
        } catch (e) { console.error('Error loading settings:', e) }
        // Custom exercises: last-write-wins vs cloud (same pattern as settings).
        try {
          const localList = getLocalCustomEx()
          const localTs   = getLocalCustomExTs()
          const fsDoc     = await loadCustomExFromFirestore(u.uid)
          if (!fsDoc) {
            // First sign-in for this account → seed cloud from local.
            const ts = localTs || Date.now()
            await saveCustomExToFirestore(u.uid, { list: localList, updatedAt: ts })
            saveLocalCustomExTs(ts)
            setCustomEx(localList)
          } else if (localTs > (fsDoc.updatedAt || 0)) {
            await saveCustomExToFirestore(u.uid, { list: localList, updatedAt: localTs })
            setCustomEx(localList)
          } else {
            const cloudList = fsDoc.list || []
            applyCustomExList(localList, cloudList)
            saveLocalCustomEx(cloudList); saveLocalCustomExTs(fsDoc.updatedAt || 0)
            setCustomEx(cloudList)
          }
        } catch (e) { console.error('Error loading custom exercises:', e) }
        // Band calibration: whole-document last-write-wins via reconcileMeta
        // (metaReconcile.js). unwrapMeta reads a legacy (unwrapped) document
        // as updatedAt 0, so it can never look newer than this device's real
        // measurements and discard them on first sync — see that module's
        // header comment for the full reasoning and its test file for the
        // behavioural proof.
        try {
          const remote = unwrapMeta(await loadBandGeomFromFirestore(u.uid))
          const local  = { data: getLocalBandGeom(), updatedAt: localBandGeomUpdatedAt() }
          const decision = reconcileBandGeom(local, remote)
          if (decision.action === 'adopt-remote') {
            localStorage.setItem(BAND_GEOM_KEY, JSON.stringify(decision.data))
            localStorage.setItem(BAND_GEOM_TS_KEY, String(decision.updatedAt))
          } else if (decision.action === 'push-local') {
            localStorage.setItem(BAND_GEOM_TS_KEY, String(decision.updatedAt))
            await saveBandGeomToFirestore(u.uid, { data: decision.data, updatedAt: decision.updatedAt })
          }
        } catch (e) { console.error('Band calibration sync failed:', e) }
        // Profile (RIR target, set seeding, volume model, split): the same
        // whole-document rule as band calibration with ONE difference, which
        // reconcileProfiles owns and documents — an unstamped local profile
        // is treated as empty, because phase1.migrateToProfiles manufactures
        // one at module load on any device that has none. Without that, a
        // fresh install pushed a machine-generated default over every other
        // device's real profile.
        try {
          const remote = unwrapMeta(await loadProfileFromFirestore(u.uid))
          const local  = { data: getLocalProfiles(), updatedAt: localProfilesUpdatedAt() }
          const decision = reconcileProfiles(local, remote)
          if (decision.action === 'adopt-remote') {
            localStorage.setItem('rbts_profiles', JSON.stringify(decision.data))
            localStorage.setItem(PROFILES_TS_KEY, String(decision.updatedAt))
          } else if (decision.action === 'push-local') {
            localStorage.setItem(PROFILES_TS_KEY, String(decision.updatedAt))
            await saveProfileToFirestore(u.uid, { data: decision.data, updatedAt: decision.updatedAt })
          }
        } catch (e) { console.error('Profile sync failed:', e) }
        setLogLoading(false)
      } else {
        try {
          const local = JSON.parse(localStorage.getItem('rbts_log') || '[]')
          const mig = migrateFoldOnce(local, 'rbts_foldMigration')
          if (mig.touchedDates.length) {
            // Write failed or did not verify (quota, private mode, a store
            // that truncates rather than throwing) -- do NOT set the flag: a
            // flag set over an unwritten log would strand the old encoding
            // forever with nothing reporting it.
            if (writeLogVerified(mig.entries)) {
              try { localStorage.setItem('rbts_foldMigration', FOLD_CUTOFF) } catch { /* retry next load */ }
            } else {
              console.error('[fold migration] localStorage write failed or did not verify, will retry next load')
            }
          }
          setLog(mig.entries)
        } catch { setLog([]) }
        setGear(withGearTypes(getLocalGear()))
        setMyBands(getLocalMyBands())
        setInvLoaded(true)
        setSettings(getLocalSettings())
        setCustomEx(getLocalCustomEx())
      }
    })
    return unsub
  }, [])

  async function handleSignIn() {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) { console.error(e) }
  }

  async function handleSignOut() {
    await signOut(auth)
    setUser(null)
    try {
      const local = JSON.parse(localStorage.getItem('rbts_log')||'[]')
      const mig = migrateFoldOnce(local, 'rbts_foldMigration')
      if (mig.touchedDates.length) {
        if (writeLogVerified(mig.entries)) {
          try { localStorage.setItem('rbts_foldMigration', FOLD_CUTOFF) } catch { /* retry next load */ }
        } else {
          console.error('[fold migration] localStorage write failed or did not verify, will retry next load')
        }
      }
      setLog(mig.entries)
    } catch { setLog([]) }
    setGear(withGearTypes(getLocalGear()))
    setMyBands(getLocalMyBands())
    setSettings(getLocalSettings())
    setCustomEx(getLocalCustomEx())
  }

  const handleSaveEntry = useCallback(async (entry) => {
    // Stamp updatedAt so this write wins last-write-wins reconciliation later.
    entry = { ...entry, updatedAt: Date.now() }
    setLog(prev => {
      const idx = prev.findIndex(e => e.date===entry.date && e.session===entry.session)
      if (idx >= 0) { const next=[...prev]; next[idx]=entry; return next }
      return [...prev, entry]
    })
    // Keep localStorage in sync in BOTH cases so signed-out/signed-in reconcile
    // always sees the latest copy.
    try {
      const local = JSON.parse(localStorage.getItem('rbts_log')||'[]')
      const idx   = local.findIndex(e=>e.date===entry.date&&e.session===entry.session)
      if (idx>=0) local[idx]=entry; else local.push(entry)
      localStorage.setItem('rbts_log', JSON.stringify(local))
    } catch {}
    if (user) {
      try { await saveEntryToFirestore(user.uid, entry) }
      catch (e) { logCloudWriteFailure('save', entry.date, e) }
    }
  }, [user])

  const handleMergeImport = useCallback(async (incoming, policy) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return { added:0, replaced:0, kept:0, synced:false }
    // Stamp every imported entry with a fresh updatedAt so it authoritatively
    // overwrites any stale Firestore copy of the same date on the next sign-in
    // reconcile (this is what was previously dropping re-imported corrections).
    const now = Date.now()
    incoming = incoming.map(e => ({ ...e, updatedAt: now }))
    // A backup written before 2026-08-04 carries the duplicate-id fold
    // encoding. Run the migration UNCONDITIONALLY (flagKey null): a flag says
    // this device has migrated ITS log, which tells you nothing about a file
    // written weeks ago, and without this an import re-introduces the old
    // encoding permanently. Already-migrated entries carry foldMigrated and
    // are skipped.
    incoming = migrateFoldOnce(incoming, null).entries
    /* Keyed on date + session -- the entry's REAL identity, and the Firestore
       document id. The old rule dropped by DATE alone.
       THE deleteDoc LOOP IS GONE, not conditioned: a replacement is a setDoc
       over the same `${date}_${session}` document, which overwrites in place,
       so no path needs a delete. That loop hard-removed a signed-in user's
       sessions from the cloud, in the app with no undo of any kind. */
    let result = { added: 0, replaced: 0, kept: 0 }
    /* WHAT REACHES THE CLOUD IS DECIDED BEFORE THE LOCAL WRITE. Under policy
       "mine" only the FRESH entries were stored, and splitting against an
       ALREADY-MERGED log finds none of them -- every incoming key is present by
       then -- so this pushed NOTHING and still reported "Synced to the cloud".
       "mine" is not an edge case: it is the policy whenever there are zero
       clashes, i.e. the ordinary merge of a desktop export onto a phone. */
    /* NULL until decided, never a hopeful default. `let write = incoming`
       before a block that may throw means a storage failure silently pushes
       EVERY incoming entry -- overriding a KEEP MINE the user chose, in the
       one branch where localStorage was never written either, so the cloud and
       the device end up disagreeing outright. Undecided means DO NOT PUSH. */
    let write = null
    let stored = false
    /* `result` is assigned OUTSIDE the state updater. React may defer or
       double-invoke an updater, so a side effect inside one is not a place to
       compute a number the caller then reports to the user. */
    setLog(prev => RBTS_REPORTS.applyLogMerge(prev, incoming, policy).merged)
    try {
      /* The SAME base the clash dialog split against -- logBase, not an
         absent-key-means-empty read. See logBase. */
      const local = logBase(logRef.current)
      write = policy === 'file'
        ? incoming
        : RBTS_REPORTS.splitLogMerge(local, incoming).fresh
      const r = RBTS_REPORTS.applyLogMerge(local, incoming, policy)
      localStorage.setItem('rbts_log', JSON.stringify(r.merged))
      result = { added: r.added, replaced: r.replaced, kept: r.kept }
      stored = true
    } catch {}
    let synced = false
    if (user && write) {
      try {
        await Promise.all(write.map(e => saveEntryToFirestore(user.uid, e)))
        synced = true
      } catch (err) { logCloudWriteFailure('merge import', incoming.map(e => e.date), err) }
    }
    return { added: result.added, replaced: result.replaced, kept: result.kept,
             synced, stored }
  }, [user])

  const handleDeleteEntry = useCallback(async (entry) => {
    setLog(prev => prev.filter(e => !(e.date===entry.date && e.session===entry.session)))
    if (user) {
      try { await deleteDoc(doc(db,'users',user.uid,'workouts',`${entry.date}_${entry.session}`)) }
      catch (e) { console.error('Delete failed:', e) }
    } else {
      try {
        const local = JSON.parse(localStorage.getItem('rbts_log')||'[]')
        localStorage.setItem('rbts_log', JSON.stringify(
          local.filter(e => !(e.date===entry.date && e.session===entry.session))))
      } catch {}
    }
  }, [user])

  // Gear: add or update one item (status toggle reuses this with a new status)
  const handleSaveGear = useCallback(async (item) => {
    const idx  = gear.findIndex(g => g.id === item.id)
    const next = idx >= 0 ? gear.map(g => g.id === item.id ? item : g) : [...gear, item]
    setGear(next)
    if (user) { try { await saveGearItemToFirestore(user.uid, item) } catch (e) { console.error('Save gear failed:', e) } }
    else saveLocalGear(next)
  }, [user, gear])

  const handleRemoveGear = useCallback(async (id) => {
    const next = gear.filter(g => g.id !== id)
    setGear(next)
    if (user) { try { await deleteGearItemFromFirestore(user.uid, id) } catch (e) { console.error('Remove gear failed:', e) } }
    else saveLocalGear(next)
  }, [user, gear])

  // One-time recovery: rebuild the full inventory from the bundled GEAR master
  // list and persist it (cloud when signed in, else local). Offered only when
  // gear is empty so it never silently re-seeds an account that has its own gear.
  const handleRestoreGear = useCallback(async () => {
    const items = flattenGearSeed(GEAR)
    setGear(items)
    if (user) { try { await Promise.all(items.map(g => saveGearItemToFirestore(user.uid, g))) } catch (e) { console.error('Restore gear failed:', e) } }
    else saveLocalGear(items)
  }, [user])

  // Backup-file inventory (gear + MY BANDS): file wins wholesale, behind one
  // confirm. Returns a fragment for the import alert ('' = no inventory in file).
  const handleImportInventory = useCallback(async (state) => {
    const inv = extractInventory(state)
    if (!inv.gearPresent && !inv.bandsPresent) return ''
    const parts = [], cur = []
    if (inv.gearPresent)  { parts.push(`${inv.gear.length} gear item(s)`);    cur.push(`${gear.length} gear item(s)`) }
    if (inv.bandsPresent) { parts.push(`${inv.myBands.length} band unit(s)`); cur.push(`${myBands.length} band unit(s)`) }
    if (!window.confirm(`File contains ${parts.join(' and ')}. This will REPLACE this device's current inventory (${cur.join(', ')}). Continue?`))
      return ' Inventory: skipped.'
    const done = []
    if (inv.gearPresent) {
      const items = withGearTypes(inv.gear)
      setGear(items)
      let cloudOk = true
      if (user) {
        try {
          const existing = await loadGearFromFirestore(user.uid)
          await Promise.all(existing.map(g => deleteGearItemFromFirestore(user.uid, g.id)))
          await Promise.all(items.map(g => saveGearItemToFirestore(user.uid, g)))
        } catch (e) { cloudOk = false; console.error('Import gear failed:', e) }
      }
      saveLocalGear(items)
      done.push(cloudOk ? `gear replaced (${items.length})`
                        : `gear cloud sync FAILED — check connection and re-import`)
    }
    if (inv.bandsPresent) {
      setMyBands(inv.myBands)
      let cloudOk = true
      if (user) { try { await saveMyBandsToFirestore(user.uid, inv.myBands) } catch (e) { cloudOk = false; console.error('Import my bands failed:', e) } }
      saveLocalMyBands(inv.myBands)
      done.push(cloudOk ? `MY BANDS replaced (${inv.myBands.length})`
                        : `MY BANDS cloud sync FAILED — check connection and re-import`)
    }
    return ` Inventory: ${done.join(', ')}.`
  }, [user, gear, myBands])

  const handleSetMyBands = useCallback(async (next) => {
    setMyBands(next)
    if (user) { try { await saveMyBandsToFirestore(user.uid, next) } catch (e) { console.error('Save my bands failed:', e) } }
    else saveLocalMyBands(next)
  }, [user])

  // Custom exercises: persist a new list locally (+ cloud when signed in),
  // stamping updatedAt for last-write-wins reconciliation.
  const persistCustomEx = useCallback((next) => {
    const ts = Date.now()
    saveLocalCustomEx(next); saveLocalCustomExTs(ts)
    if (user) saveCustomExToFirestore(user.uid, { list: next, updatedAt: ts })
      .catch(e => console.error('Save custom exercises failed:', e))
  }, [user])

  /* Authoring or deleting a custom program: stamp locally, then push
     best-effort. Signed out, the stamp alone is enough -- the next sign-in
     reconcile sees a local list newer than the cloud's and pushes it. */
  const handleProgramsChanged = useCallback(() => {
    pushCustomPrograms(user?.uid)
  }, [user])

  const handleAddCustomEx = useCallback((ex) => {
    const item = { ...ex, id: nextCustomExId(customEx), custom: true }
    const next = [...customEx, item]
    registerCustomEx(item)
    persistCustomEx(next)
    setCustomEx(next)
    return item
  }, [customEx, persistCustomEx])

  const handleDeleteCustomEx = useCallback((id) => {
    const next = customEx.filter(e => Number(e.id) !== Number(id))
    unregisterCustomEx(id)
    persistCustomEx(next)
    setCustomEx(next)
  }, [customEx, persistCustomEx])

  // Merge-imported definitions (from the HTML app's EXPORT JSON): union by id,
  // import wins on conflict. Returns how many were new.
  const handleImportCustomEx = useCallback((incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return 0
    const prev = getLocalCustomEx()
    const byId = new Map(prev.map(e => [Number(e.id), e]))
    let added = 0
    incoming.forEach(e => {
      if (!e || e.id == null || !e.name) return
      if (!byId.has(Number(e.id))) added++
      byId.set(Number(e.id), { ...e, id: Number(e.id), custom: true })
    })
    const next = [...byId.values()].sort((a,b) => a.id - b.id)
    applyCustomExList(prev, next)
    persistCustomEx(next)
    setCustomEx(next)
    return added
  }, [persistCustomEx])

  // Settings change: merge the patch, stamp updatedAt, persist locally + to cloud.
  const handleChangeSettings = useCallback((patch) => {
    setSettings(prev => {
      const next = { ...prev, ...patch, updatedAt: Date.now() }
      persistSettings(next, user ? user.uid : null)
      return next
    })
  }, [user])

  function tabStyle(active) {
    return {
      background: active ? `${C.accent}18` : 'transparent',
      borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
      color: active ? C.accent : C.textSec,
      padding:'10px 20px', cursor:'pointer', fontFamily:'monospace',
      fontSize:12, letterSpacing:'0.12em', textTransform:'uppercase',
      border:'none', outline:'none', transition:'all 0.15s',
    }
  }

  if (authLoading) return (
    <div style={{background:C.bgDeep,minHeight:'100vh',display:'flex',alignItems:'center',
      justifyContent:'center',fontFamily:'monospace',color:C.readout,fontSize:18}}>
      LOADING…
    </div>
  )

  return (
    <div style={{background:C.bgDeep,minHeight:'100vh',fontFamily:'monospace',color:C.text}}>
      {/* Header */}
      <div style={{background:C.bgPanel,borderBottom:`1px solid ${C.accentDim}`,
        boxShadow:`0 2px 20px ${C.accentGlow}`,padding:'12px 20px',
        display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:C.readout,letterSpacing:'0.08em'}}>
            RESISTANCE BAND TRAINING SYSTEM
          </div>
          <div style={{fontSize:9,color:C.textSec,letterSpacing:'0.15em',marginTop:2}}>
            12 PROGRAMS  215 EXERCISES  LOOP BANDS ONLY
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:20,alignItems:'center',flexWrap:'wrap'}}>
          {[['PROGRAMS','12'],['WEEKS','72'],['EXERCISES','215']].map(([label,val]) => (
            <div key={label} style={{textAlign:'center'}}>
              <div style={lbl}>{label}</div>
              <div style={readoutStyle}>{val}</div>
            </div>
          ))}
          <div style={{marginLeft:8}}>
            {user ? (
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontFamily:'monospace',fontSize:10,color:C.green}}>
                  ● {user.displayName?.split(' ')[0] || 'Signed in'}
                </span>
                <button style={{...btn(false,C.dimGray),fontSize:9,padding:'2px 8px'}}
                  onClick={handleSignOut}>SIGN OUT</button>
              </div>
            ) : (
              <button style={{...btn(false,C.accent),fontSize:10,padding:'5px 12px'}}
                onClick={handleSignIn}>SIGN IN WITH GOOGLE</button>
            )}
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{background:C.bgPanel,borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex'}}>
        {['today','history','strength','analyze','programs','library','gear'].map(t => (
          <button key={t} style={tabStyle(tab===t)} onClick={()=>setTab(t)}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:16,maxWidth:1200,margin:'0 auto'}}>
        {logLoading && (
          <div style={{fontFamily:'monospace',fontSize:11,color:C.textSec,marginBottom:12,textAlign:'center'}}>
            Syncing workouts from cloud…
          </div>
        )}
        {programLostNotice && (
          <div style={{fontFamily:'monospace',fontSize:11,color:C.amber,marginBottom:12,
            padding:'8px 12px',border:`1px solid ${C.amber}55`,borderRadius:4,
            display:'flex',alignItems:'center',gap:10}}>
            <span style={{flex:1}}>
              THE PROGRAM YOU HAD SELECTED WAS DELETED ON ANOTHER DEVICE — SWITCHED TO THE FIRST PROGRAM.
              CHECK THE PROGRAMS TAB BEFORE YOU TRAIN.
            </span>
            <button onClick={()=>setProgramLostNotice(false)}
              style={{...btn(false,C.amber),fontSize:9,padding:'3px 8px'}}>DISMISS</button>
          </div>
        )}
        {tab==='today'    && <TodayTab user={user} log={log} onSaveEntry={handleSaveEntry} settings={settings} onChangeSettings={handleChangeSettings} gearInv={gear}/>}
        {tab==='history'  && <HistoryTab log={log} onMergeImport={handleMergeImport} onImportCustomEx={handleImportCustomEx} onSaveEntry={handleSaveEntry} onDeleteEntry={handleDeleteEntry} gearInv={gear} myBands={myBands} onImportInventory={handleImportInventory} invLoaded={invLoaded} user={user} onProgramsChanged={handleProgramsChanged}/>}
        {tab==='strength' && <StrengthTab log={log}/>}
        {tab==='analyze'  && <AnalyzeTab log={log} gearInv={gear} myBands={myBands} settings={settings}/>}
        {tab==='programs' && <ProgramsTab onProgramsChanged={handleProgramsChanged}/>}
        {tab==='library'  && <LibraryTab customEx={customEx} onAddEx={handleAddCustomEx} onDeleteEx={handleDeleteCustomEx}/>}
        {tab==='gear'     && <GearTab gear={gear} myBands={myBands} onSaveGear={handleSaveGear} onRemoveGear={handleRemoveGear} onSetMyBands={handleSetMyBands} onRestoreGear={handleRestoreGear} user={user}/>}
      </div>
    </div>
  )
}
