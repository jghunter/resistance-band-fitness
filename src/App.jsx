import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { collection, doc, setDoc, deleteDoc, getDoc, getDocs, query, orderBy } from 'firebase/firestore'
import { db, auth, googleProvider } from './firebase'
import {
  C, EXERCISE_NAMES, TECHNIQUES, VIDEOS, PROGRAMS,
  SESSION_FOCUS, getSessionFocus, SLOT_LABELS, exGroup, ALL_GROUPS,
  BANDS, COLOR_HEX, BAND_BRANDS, GEAR,
  calcToday, PROG_REPS,
  getTechMap, getWeekTechniques,
} from './data'
import RBTS_PHASE1 from './phase1.js'

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
const _ACTIVE_PROFILE = (() => { try {
  const ps = JSON.parse(localStorage.getItem('rbts_profiles') || '[]')
  const ap = localStorage.getItem('rbts_activeProfile') || 'greg'
  return ps.find(x => x.id === ap) || null
} catch { return null } })()
const PROG_TARGET_REPS = (_ACTIVE_PROFILE && typeof _ACTIVE_PROFILE.progressReps === 'number') ? _ACTIVE_PROFILE.progressReps : PROG_REPS
const RIR_TARGET = (_ACTIVE_PROFILE && typeof _ACTIVE_PROFILE.rirTarget === 'number') ? _ACTIVE_PROFILE.rirTarget : DEFAULT_RIR
const REP_RANGE = (_ACTIVE_PROFILE && Array.isArray(_ACTIVE_PROFILE.repTarget) && _ACTIVE_PROFILE.repTarget.length === 2) ? _ACTIVE_PROFILE.repTarget : [8, PROG_TARGET_REPS]
const setRepsOf  = (s) => (s && Array.isArray(s.segments)) ? s.segments.reduce((a,g)=>a+(g.reps||0),0) : ((s && s.reps) || 0)
const setBandsOf = (s) => (s && Array.isArray(s.segments)) ? (((s.segments[0]||{}).bands) || []) : ((s && s.bands) || [])
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

async function saveEntryToFirestore(uid, entry) {
  const docId = `${entry.date}_${entry.session}`
  await setDoc(doc(db, 'users', uid, 'workouts', docId), entry)
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

// ── Local (signed-out) gear + my-bands storage; gear seeds once from GEAR ──
const GEAR_KEY = 'rbts_gear'
function flattenGearSeed(seed) {
  const out = []; let n = 0; const t = Date.now()
  seed.forEach(g => (g.items || []).forEach(it => {
    out.push({ id:`g${t}_${n++}`, brand:g.brand, name:it.name, qty:it.qty || 1,
      status:(it.status === 'preorder' ? 'inbound' : (it.status || 'owned')), note:it.note || '' })
  }))
  return out
}
function getLocalGear() {
  try { const raw = localStorage.getItem(GEAR_KEY); if (raw) return JSON.parse(raw) } catch {}
  const seeded = flattenGearSeed(GEAR)
  try { localStorage.setItem(GEAR_KEY, JSON.stringify(seeded)) } catch {}
  return seeded
}
function saveLocalGear(items) { try { localStorage.setItem(GEAR_KEY, JSON.stringify(items)) } catch {} }
function getLocalMyBands() { try { return JSON.parse(localStorage.getItem('rbts_myBands') || '[]') } catch { return [] } }
function saveLocalMyBands(ids) { try { localStorage.setItem('rbts_myBands', JSON.stringify(ids)) } catch {} }

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function resolveVideo(id) {
  const v = VIDEOS[id]
  if (!v) return null
  if (typeof v === 'string') return { url:v, embedUrl:null }
  const m = v.url.match(/[?&]v=([^&]+)/)
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
  const session  = prog.sessions[sKey]
  const focus    = getSessionFocus(prog, sKey)
  const isDeload = week === 6
  const techMap  = getTechMap(prog, week, sKey)
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <span style={{fontFamily:'monospace',fontSize:22,fontWeight:700,
          color:focus.color,textShadow:`0 0 12px ${focus.color}66`}}>{sKey}</span>
        <span style={{fontFamily:'monospace',fontSize:13,color:focus.color,
          letterSpacing:'0.12em'}}>{focus.label}</span>
        {isDeload && <span style={pill(C.deload)}>DELOAD ≤50%</span>}
        {!isDeload && Object.keys(techMap).length > 0 &&
          <span style={pill(C.amber)}>{Object.keys(techMap).length} TECHNIQUE{Object.keys(techMap).length>1?'S':''}</span>}
      </div>
      <div>
        <span style={lbl}>PRIMARY — ISOLATION + COMPOUND</span>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {Object.entries(session.primary).map(([slot,id]) => (
            <ExCard key={slot} id={id} role={SLOT_LABELS[slot]} techKey={techMap[slot]??null}/>
          ))}
        </div>
      </div>
      <div>
        <span style={lbl}>ACCESSORIES</span>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))',gap:8}}>
          {Object.entries(session.accessories).map(([slot,id]) => (
            <ExCard key={slot} id={id} techKey={techMap[slot]??null}/>
          ))}
        </div>
      </div>
      {isDeload && (
        <div style={{...widget,border:'1px solid rgba(168,85,247,0.3)',boxShadow:'0 0 12px rgba(168,85,247,0.15)'}}>
          <span style={lbl}>DELOAD PROTOCOL</span>
          <p style={{fontFamily:'monospace',fontSize:12,color:C.textSec,margin:0,lineHeight:1.7}}>
            All exercises at ≤50% of normal resistance. Focus on movement quality and recovery.
            No high-intensity techniques this week.
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BAND PICKER
// ─────────────────────────────────────────────────────────────────────────────
function BandPicker({ selected, onChange }) {
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
                     b.model.toLowerCase().includes(q) || b.res.includes(q)
      return true
    })
  }, [search, bFilter])

  // Stack model: distinct bands, all same length; doubling is all-or-nothing.
  // RULES: stacked bands must be the same length; doubling applies to the whole
  // stack (each band looped over -> x2), never one band without the others.
  const counts = {}; const distinct = []
  selected.forEach(id => { if (counts[id]==null){counts[id]=0;distinct.push(id)} counts[id]++ })
  const stackBand0 = distinct.length ? BANDS.find(x=>x.id===distinct[0]) : null
  const stackLen = stackBand0 ? stackBand0.lengthIn : null
  const isDoubled = distinct.length>0 && distinct.every(id => counts[id] >= 2)
  const rebuildStack = (ids, doubled) => { const out=[]; ids.forEach(id => { out.push(id); if(doubled) out.push(id) }); return out }
  const addBand = (id) => {
    const b = BANDS.find(x=>x.id===id); if(!b) return
    if (distinct.indexOf(id) >= 0) return
    if (stackLen != null && b.lengthIn !== stackLen) return
    onChange(rebuildStack([...distinct, id], isDoubled))
  }
  const removeBandId = (id) => {
    const nd = distinct.filter(x => x !== id)
    onChange(rebuildStack(nd, nd.length ? isDoubled : false))
  }
  const toggleDouble = () => { if (distinct.length) onChange(rebuildStack(distinct, !isDoubled)) }

  return (
    <div ref={pickerRef} style={{position:'relative'}}>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,alignItems:'center'}}>
        {distinct.map(id => {
          const b = BANDS.find(x => x.id === id)
          if (!b) return null
          const hex = COLOR_HEX[b.color] || '#888'
          const cnt = counts[id]
          return (
            <span key={id} style={{
              background:hex+'22',border:`1px solid ${hex}66`,borderRadius:4,
              padding:'2px 7px',fontFamily:'monospace',fontSize:9,color:C.text,
              display:'flex',alignItems:'center',gap:4,
            }}>
              <span style={{width:8,height:8,borderRadius:'50%',background:hex,flexShrink:0}}/>
              {b.brand.split(' ')[0]} {b.color} {b.model}
              {cnt > 1
                ? <span style={{background:C.amber+'33',border:`1px solid ${C.amber}66`,borderRadius:3,padding:'0 4px',color:C.amber,fontWeight:700,fontSize:9}}>×{cnt}</span>
                : <span style={{color:C.dimGray}}> {b.res}</span>}
              <span onClick={() => removeBandId(id)}
                style={{cursor:'pointer',color:C.dimGray,fontSize:12,lineHeight:1}}>x</span>
            </span>
          )
        })}
        {selected.length > 0 && (
          <button title="Double the whole stack — every band looped over (≈2× resistance). All bands double together, never one alone."
            style={{...btn(isDoubled,C.amber),fontSize:9,padding:'2px 8px'}}
            onClick={toggleDouble}>
            {isDoubled ? '×2 DOUBLED' : 'DOUBLE ×2'}
          </button>
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
              <div key={b.id} onClick={() => { if(cnt>0){removeBandId(b.id)} else if(!lenMismatch){addBand(b.id)} }}
                title={cnt>0 ? 'Selected — tap to remove' : (lenMismatch ? `Different length (${b.lengthIn}") — stack only bands of ${stackLen}"` : 'Tap to add')}
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
                  {b.res} lbs
                </span>
                <span style={{fontFamily:'monospace',fontSize:9,color:lenMismatch?C.amber:C.dimGray,flexShrink:0}}>
                  {b.lengthIn}"{lenMismatch?' ≠':''}
                </span>
                {cnt>0 && <span title="Tap row to remove" style={{background:C.accent,color:'#000',borderRadius:10,padding:'1px 6px',fontSize:9,fontWeight:'bold'}}>×{cnt} ✕</span>}
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
function LoggedExCard({ id, role, techKey, sets, onSetsChange, prevSets, progFlag }) {
  const name  = EXERCISE_NAMES[id] || `Exercise #${id}`
  const group = exGroup(id)
  const tech  = techKey ? (TECHNIQUES[techKey] || '').split(' — ')[0] : null

  function addSet() {
    const last = sets[sets.length-1]
    const lb = last ? (Array.isArray(last.segments) ? (((last.segments[0]||{}).bands)||[]) : (last.bands||[])) : []
    const lr = last ? (Array.isArray(last.segments) ? 0 : (last.reps||0)) : 0
    onSetsChange([...sets, {reps: lr, bands: [...lb]}])
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
      </div>
      <div style={{fontFamily:'monospace',fontSize:12,color:C.text,lineHeight:1.4}}>{name}</div>
      {tech && (
        <div style={{fontSize:10,fontFamily:'monospace',color:C.amber,
          background:`${C.amber}18`,border:`1px solid ${C.amber}44`,
          borderRadius:4,padding:'2px 6px'}}>⚡ {tech}</div>
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
            ? <span style={{color:C.amber,fontWeight:700}}>READY TO PROGRESS — last: </span>
            : <span style={{color:C.dimGray}}>LAST: </span>
          }
          {prevSets.map((s,i) => {
            const bNames = (setBandsOf(s)).map(bid => {
              const b = BANDS.find(x=>x.id===bid)
              return b ? `${b.brand.split(' ')[0]} ${b.color} ${b.model} (${b.res}lbs)` : '?'
            }).join(' + ')
            return <span key={i}>{setRepsOf(s)}r{setIntensifier(s)!=='straight'?' ⚡':''} [{bNames||'no band'}]{i<prevSets.length-1?', ':''}</span>
          })}
        </div>
      )}
      <div style={{borderTop:'1px solid rgba(255,255,255,0.07)',paddingTop:8}}>
        <span style={{...lbl,marginBottom:2}}>LOG SETS</span>
        <div style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginBottom:6}}>
          TARGET {REP_RANGE[0]}–{REP_RANGE[1]} REPS/SET · ALL SETS ≥{PROG_TARGET_REPS} AT RIR ≤{RIR_TARGET} → MOVE UP A BAND
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
                    title="Reps in reserve for the whole set (blank = your default)"
                    onChange={e=>{const v=e.target.value; updateSet(i,'rir', v===''?undefined:Math.max(0,parseInt(v)||0))}}
                    style={{...inputStyle,width:34,textAlign:'center',padding:'6px 3px',fontSize:12}}/>
                </div>
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
                        <BandPicker selected={g.bands||[]} onChange={v=>updateSeg(i,gi,'bands',v)}/>
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
                  </div>
                </div>
              ) : (
                <div style={{display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap',marginTop:6}}>
                  <div style={{flex:1,minWidth:160}}>
                    <BandPicker selected={s.bands||[]} onChange={v=>updateSet(i,'bands',v)}/>
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
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <button style={{...btn(false,C.green),fontSize:11,padding:'6px 12px'}} onClick={addSet}>+ SET</button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGED SESSION VIEW
// ─────────────────────────────────────────────────────────────────────────────
function LoggedSessionView({ prog, sKey, week, exercises, onExercisesChange, todayDate, log }) {
  const session  = prog.sessions[sKey]
  const focus    = getSessionFocus(prog, sKey)
  const isDeload = week === 6
  const techMap  = getTechMap(prog, week, sKey)

  const [showAdd, setShowAdd] = useState(false)
  const [addSrch, setAddSrch] = useState('')
  function getOrInit(id) { return exercises[id] || [{reps:0,bands:[]}] }
  function updateEx(id, sets) { onExercisesChange({...exercises, [id]:sets}) }
  function addEx(id) {
    const key = String(id)
    if (exercises && exercises[key]) { setShowAdd(false); setAddSrch(''); return }
    onExercisesChange({...exercises, [key]:[{reps:0,bands:[]}]})
    setShowAdd(false); setAddSrch('')
  }
  function removeEx(id) {
    const next = {...exercises}; delete next[String(id)]; onExercisesChange(next)
  }

  function getPrevSets(exerciseId) {
    const found = log
      .filter(e => e.exercises && e.exercises[exerciseId] && e.date < todayDate)
      .sort((a,b) => b.date.localeCompare(a.date))
    return found[0] ? found[0].exercises[exerciseId] : null
  }
  // Progression flag source: skip week-6 deload entries (junk data) and drop sets
  function getPrevWorkingSets(exerciseId) {
    const found = log
      .filter(e => e.exercises && e.exercises[exerciseId] && e.date < todayDate && e.week !== 6)
      .sort((a,b) => b.date.localeCompare(a.date))
    return found[0] ? found[0].exercises[exerciseId] : null
  }

  function renderCard(slot, id, role) {
    const prev     = getPrevSets(String(id))
    // Progression flag: ignore week-6 deload entries, and only count plain
    // (straight) sets — intensifier/drop sets end at low reps by design.
    const working  = (getPrevWorkingSets(String(id)) || []).filter(isPlainSet)
    // Phase 3: double-progression, RIR-gated. Need every plain set at/above the
    // profile rep target AND logged RIR at/under target (actually near failure)
    // before recommending more load; high RIR ⇒ reps left ⇒ push reps first.
    const repsHit  = working.length > 0 && working.every(s => (s.reps||0) >= PROG_TARGET_REPS)
    const rirVals  = working.map(s => s.rir).filter(v => v != null)
    const rirOk    = rirVals.length === 0 ? true : Math.max(...rirVals) <= RIR_TARGET
    const progFlag = repsHit && rirOk
    return (
      <LoggedExCard key={slot} id={id} role={role}
        techKey={techMap[slot]||null}
        sets={getOrInit(id)} onSetsChange={s=>updateEx(id,s)}
        prevSets={prev} progFlag={progFlag}/>
    )
  }

  const prescribedIds = {}
  Object.values(session.primary).forEach(id => { prescribedIds[String(id)] = true })
  Object.values(session.accessories).forEach(id => { prescribedIds[String(id)] = true })
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
          prevSets={prev} progFlag={false}/>
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
          {Object.entries(session.accessories).map(([slot,id]) => renderCard(slot,id,null))}
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
            All exercises at 50% or less of normal resistance. Focus on movement quality and recovery.
          </p>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STRENGTH MONITOR — estimated-load + volume tracking
// ─────────────────────────────────────────────────────────────────────────────
function bandResMid(res) {
  if (res == null) return 0
  const str = String(res).replace(/\+/g,'').replace(/</g,'').trim()
  const parts = str.split('-').map(x => parseFloat(x)).filter(n => !isNaN(n))
  if (parts.length === 0) return 0
  if (parts.length === 1) return parts[0]
  return (parts[0] + parts[1]) / 2
}
let _BAND_RES = null
function bandResById(id) {
  if (!_BAND_RES) { _BAND_RES = {}; BANDS.forEach(b => { _BAND_RES[b.id] = bandResMid(b.res) }) }
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
// PROGRAMS TAB
// ─────────────────────────────────────────────────────────────────────────────
function ProgramsTab() {
  const [pi, setPi]     = useState(0)
  const [week, setWeek] = useState(1)
  const [sKey, setSKey] = useState('C')
  const prog            = PROGRAMS[pi]
  const isDeload        = week === 6

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={widget}>
        <span style={lbl}>BROWSE PROGRAMS — 24 × 6-WEEK BLOCKS (~3 YEARS)</span>
        <span style={{fontFamily:'monospace',fontSize:10,color:C.textSec,display:'block',marginBottom:6}}>
          Reference only — to change your active program, use Today → SCHEDULE SETTINGS
        </span>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
          {PROGRAMS.map((p,i) => (
            <button key={p.id} style={btn(i===pi)}
              onClick={()=>{setPi(i);setWeek(1);setSKey('C');}}>P{p.id}</button>
          ))}
        </div>
        <span style={{fontFamily:'monospace',fontSize:15,color:C.readout,
          textShadow:`0 0 8px ${C.accentGlow}`,letterSpacing:'0.06em'}}>
          PROGRAM {prog.id} — {prog.name.toUpperCase()}
        </span>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <div style={widget}>
          <span style={lbl}>WEEK</span>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {[1,2,3,4,5].map(w => (
              <button key={w} style={btn(week===w)} onClick={()=>setWeek(w)}>{w}</button>
            ))}
            <button style={btn(week===6,C.deload)} onClick={()=>setWeek(6)}>6 DELOAD</button>
          </div>
          <div style={{marginTop:10}}>
            {isDeload
              ? <span style={{fontFamily:'monospace',fontSize:11,color:C.deload}}>
                  Recovery week — ≤50% intensity — no techniques
                </span>
              : <>
                  <span style={lbl}>WEEK {week} TECHNIQUES (AS SCHEDULED)</span>
                  {getWeekTechniques(prog, week).map((t,i) => (
                    <div key={i} style={{fontFamily:'monospace',fontSize:11,color:C.amber,marginBottom:2}}>
                      ⚡ {t.session}-{SLOT_LABELS[t.slot]??t.slot}:{' '}
                      <span style={{color:C.text}}>{TECHNIQUES[t.technique]?.split(' — ')[0]}</span>
                    </div>
                  ))}
                </>
            }
          </div>
        </div>

        <div style={widget}>
          <span style={lbl}>SESSION</span>
          <div style={{display:'flex',gap:6}}>
            {['C','D','E','F','G'].map(s => (
              <button key={s} style={btn(sKey===s,getSessionFocus(prog,s).color)}
                onClick={()=>setSKey(s)}>{s}</button>
            ))}
          </div>
          <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:3}}>
            {['C','D','E','F','G'].map(k => {
              const v = getSessionFocus(prog,k);
              return (
                <div key={k} style={{fontFamily:'monospace',fontSize:10,color:k===sKey?v.color:C.dimGray}}>
                  {k} — {v.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={widget}><SessionView prog={prog} sKey={sKey} week={week}/></div>

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
function LibraryTab() {
  const [search, setSearch] = useState('')
  const [group, setGroup]   = useState('All')
  const [vidOnly, setVid]   = useState(false)
  const totalVerified       = Object.keys(VIDEOS).length

  const allEx = useMemo(() =>
    Object.entries(EXERCISE_NAMES).map(([id,name]) => ({
      id:Number(id), name, group:exGroup(Number(id)), url:VIDEOS[Number(id)]??null,
    })), [])

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
        </div>
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
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>#{ex.id}</span>
              <span style={pill(ex.group.color)}>{ex.group.label}</span>
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

// ─────────────────────────────────────────────────────────────────────────────
// TODAY TAB
// ─────────────────────────────────────────────────────────────────────────────
function TodayTab({ user, log, onSaveEntry }) {
  const [startDate, setStartDate] = useLS(apk('startDate'), '2026-06-01')
  const [sched, setSched]         = useLS(apk('schedule'), 'MWF')
  const [pi, setPi]               = useLS(apk('progIdx'), 0)
  const [exLogs, setExLogs]       = useState({})
  const [saved, setSaved]         = useState(false)

  const info       = useMemo(() => calcToday(startDate, sched, Number(pi)), [startDate, sched, pi])
  const todayISO   = localISO()
  const todayStr   = new Date().toLocaleDateString('en-US',
    {weekday:'long',month:'long',day:'numeric'}).toUpperCase()
  const focusColor = getSessionFocus(info.prog, info.session).color

  useEffect(() => {
    if (info.isWk) {
      const existing = log.find(e => e.date === todayISO && e.session === info.session)
      setExLogs(existing?.exercises ?? {})
      setSaved(!!(existing?.completedAt))
    }
  }, [info.session, todayISO, log])

  function handleSave() {
    const cleanEx = cleanExercises(exLogs)
    if (Object.keys(cleanEx).length === 0) {
      alert('No exercise data logged yet. Enter at least one set with reps or bands.')
      return
    }
    const entry = {
      date:todayISO, programId:info.prog.id, week:info.week,
      session:info.session, workoutNum:info.num,
      schemaVersion:2,
      exercises:cleanEx, completedAt:new Date().toISOString(),
    }
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
            <div style={{display:'flex',gap:6}}>
              {['MWF','TTS'].map(s => (
                <button key={s} style={btn(sched===s)} onClick={()=>setSched(s)}>
                  {s==='MWF'?'Mon/Wed/Fri':'Tue/Thu/Sat'}
                </button>
              ))}
            </div>
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
              <span style={{...readoutStyle,color:info.week===6?C.deload:C.readout}}>
                {info.week}{info.week===6?' DELOAD':''}
              </span>
            </div>
            <div><span style={lbl}>FOCUS</span>
              <span style={{fontFamily:'monospace',fontSize:13,color:focusColor}}>
                {getSessionFocus(info.prog, info.session).label}
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
              exercises={exLogs}
              onExercisesChange={ex=>{setExLogs(ex);setSaved(false);}}
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
                {info.session} {getSessionFocus(info.prog,info.session).label}
              </span>
            </div>
            <div>
              <span style={lbl}>WEEK</span>
              <span style={{...readoutStyle,fontSize:14}}>
                {info.week}{info.week===6?' DELOAD':''}
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
function HistoryEntryEditor({ entry, onSave, onDelete, onDone }) {
  const [ex, setEx] = useState(() => JSON.parse(JSON.stringify(entry.exercises || {})))

  const mapSet = (id, i, fn) => setEx(prev => {
    const n = { ...prev }
    n[id] = (n[id] || []).map((s, idx) => idx === i ? fn({ ...s }) : s)
    return n
  })
  const updateSet = (id, i, field, val) => mapSet(id, i, c => { c[field] = val; return c })
  const addSet = (id) => setEx(prev => {
    const n = { ...prev }; const arr = (n[id] || []).slice(); const last = arr[arr.length - 1]
    const lb = last ? (Array.isArray(last.segments) ? (((last.segments[0]||{}).bands)||[]) : (last.bands||[])) : []
    const lr = last ? (Array.isArray(last.segments) ? 0 : (last.reps||0)) : 0
    arr.push({ reps: lr, bands: lb.slice() }); n[id] = arr; return n
  })
  const removeSet = (id, i) => setEx(prev => { const n = { ...prev }; n[id] = (n[id] || []).filter((_, idx) => idx !== i); return n })
  const removeEx = (id) => setEx(prev => { const n = { ...prev }; delete n[id]; return n })
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
    onSave({ ...entry, exercises: ex, editedAt: new Date().toISOString() })
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
          {(sets||[]).map((s,i) => {
            const seg=usesSeg(s); const segs=segsOf(s); const straight=isPlainSet(s)
            return (
              <div key={i} style={ straight
                ? {marginBottom:8,paddingBottom:2}
                : {border:`1px solid ${C.amber}33`,borderRadius:6,padding:'7px 8px',marginBottom:8,background:`${C.amber}08`} }>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <span style={{fontFamily:'monospace',fontSize:11,color:C.dimGray,minWidth:20,flexShrink:0}}>S{i+1}</span>
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
                          <BandPicker selected={g.bands||[]} onChange={v=>updateSeg(id,i,gi,'bands',v)}/>
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
                    </div>
                  </div>
                ) : (
                  <div style={{display:'flex',alignItems:'flex-start',gap:6,flexWrap:'wrap',marginTop:6}}>
                    <div style={{flex:1,minWidth:160}}>
                      <BandPicker selected={s.bands||[]} onChange={v=>updateSet(id,i,'bands',v)}/>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:2,flexShrink:0}}>
                      <button style={{...btn(false),padding:'6px 11px',fontSize:14}} onClick={()=>updateSet(id,i,'reps',Math.max(0,(s.reps||0)-1))}>−</button>
                      <input type="number" min="0" max="999" value={s.reps||''} placeholder="0"
                        onChange={e=>updateSet(id,i,'reps',Math.max(0,parseInt(e.target.value)||0))}
                        style={{...inputStyle,width:46,textAlign:'center',padding:'6px 4px',fontSize:13}}/>
                      <button style={{...btn(false),padding:'6px 11px',fontSize:14}} onClick={()=>updateSet(id,i,'reps',(s.reps||0)+1)}>+</button>
                      <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,marginLeft:2}}>reps</span>
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

function HistoryTab({ log, onMergeImport, onSaveEntry, onDeleteEntry }) {
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
      'Exercise ID','Exercise Name','Set','Reps',
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
            exId,EXERCISE_NAMES[exId]||exId,si+1,s.reps||0,
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
    const data = { exportedAt: new Date().toISOString(), rbts_log: log }
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
        const incoming = Array.isArray(state.rbts_log) ? state.rbts_log
                       : (Array.isArray(state) ? state : null)
        if (!incoming) { alert('Invalid file — expected an rbts_log array.'); return }
        const res = await onMergeImport(incoming)
        alert(`Merged ${incoming.length} session(s) across ${res ? res.dates : '?'} date(s).` +
          (res && res.synced ? ' Synced to the cloud.' : ' Saved locally (sign in to sync).'))
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
                {e.session} {getSessionFocus(PROGRAMS.find(p=>p.id===e.programId),e.session)?.label ?? ''}
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
            </div>
            {isEditing ? (
              <HistoryEntryEditor entry={e} onSave={onSaveEntry} onDelete={onDeleteEntry}
                onDone={()=>setEditKey(null)}/>
            ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:6}}>
              {Object.entries(e.exercises||{}).map(([exId,sets]) => (
                <div key={exId} style={{background:C.bgInput,borderRadius:5,padding:'7px 10px'}}>
                  <div style={{fontFamily:'monospace',fontSize:11,color:C.text,marginBottom:5}}>
                    <span style={{color:C.dimGray}}>#{exId} </span>{EXERCISE_NAMES[exId]||exId}
                  </div>
                  {(sets||[]).map((s,i) => {
                    const bNames=(setBandsOf(s)).map(bid=>{
                      const b=BANDS.find(x=>x.id===bid)
                      return b?`${b.brand.split(' ')[0]} ${b.color} (${b.res}lbs)`:bid
                    }).join(' + ')
                    const reps=setRepsOf(s); const intens=setIntensifier(s)
                    return (
                      <div key={i} style={{fontFamily:'monospace',fontSize:10,color:C.textSec,marginBottom:2}}>
                        <span style={{color:C.dimGray}}>S{i+1} </span>
                        <span style={{color:reps>=PROG_REPS?C.green:C.text}}>{reps}r</span>
                        {intens!=='straight' && <span style={{color:C.amber}}> ⚡{intensLabel(intens)}</span>}
                        {bNames && <span style={{color:C.dimGray}}> {bNames}</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GEAR TAB
// ─────────────────────────────────────────────────────────────────────────────
// Editable equipment inventory + MY BANDS. Controlled by App (Firestore-synced
// when signed in, localStorage when signed out) via props.
function GearTab({ gear, myBands, onSaveGear, onRemoveGear, onSetMyBands }) {
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

  // add-gear form
  const [addingGear, setAddingGear] = useState(false)
  const [gf, setGf] = useState({ brand:'', newBrand:'', name:'', qty:1, status:'owned' })
  const gfSet = (k, v) => setGf(p => ({ ...p, [k]: v }))
  function addGearItem() {
    const brand = (gf.brand === '__new__' ? gf.newBrand : gf.brand).trim()
    const name  = gf.name.trim()
    if (!brand || !name) return
    onSaveGear({ id:`g${Date.now()}`, brand, name,
      qty:Math.max(1, parseInt(gf.qty,10)||1), status:gf.status, note:'' })
    setGf({ brand:'', newBrand:'', name:'', qty:1, status:'owned' })
    setAddingGear(false); openBrand('gear:'+brand)
  }

  // add-band form
  const [addingBand, setAddingBand] = useState(false)
  const allBandBrands = []
  BANDS.forEach(b => { if (allBandBrands.indexOf(b.brand) < 0) allBandBrands.push(b.brand) })
  allBandBrands.sort()
  const [bf, setBf] = useState({ brand: allBandBrands[0] || '', bandId:'' })
  const bfChoices = BANDS.filter(b => b.brand === bf.brand && myBands.indexOf(b.id) < 0)
    .sort((a,b) => a.lengthIn - b.lengthIn || bandResMid(a.res) - bandResMid(b.res))
  function addBandSel() {
    if (!bf.bandId) return
    const br = (BANDS.find(b => b.id === bf.bandId) || {}).brand
    if (myBands.indexOf(bf.bandId) < 0) onSetMyBands([...myBands, bf.bandId])
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
          <span style={lbl}>MY BANDS{owned.length?' · '+owned.length:''}</span>
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
                <option key={b.id} value={b.id}>{b.color+' '+b.model+' · '+b.lengthIn+'" · '+b.res}</option>
              ))}
            </select>
            <button style={{...btn(true,C.green),fontSize:11}} onClick={addBandSel}>ADD</button>
            {bfChoices.length===0 && <span style={{fontSize:10,color:C.dimGray}}>all {bf.brand} bands already owned</span>}
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
                  {brandHeader(key, br, <span style={pill(C.amber)}>{list.length}</span>)}
                  {isOpen(key) && (
                    <div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'8px 6px 2px 24px'}}>
                      {list.slice().sort((a,b) => a.lengthIn-b.lengthIn || bandResMid(a.res)-bandResMid(b.res)).map(b => {
                        const hex = COLOR_HEX[b.color] || '#888'
                        return (
                          <span key={b.id} style={{display:'inline-flex',alignItems:'center',gap:6,
                            background:C.bgWidget,border:'1px solid '+C.dimGray,borderRadius:4,
                            padding:'4px 8px',fontFamily:'monospace',fontSize:11,color:C.text}}>
                            <span style={{width:9,height:9,borderRadius:'50%',background:hex,
                              border:'1px solid rgba(255,255,255,0.3)',flexShrink:0}}/>
                            {b.color} {b.model}
                            <span style={{color:C.dimGray}}>{b.lengthIn}"</span>
                            <span style={{color:C.readout+'cc'}}>{b.res}</span>
                            <span onClick={() => onSetMyBands(myBands.filter(x => x !== b.id))}
                              title="Remove from My Bands"
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
              style={{...inputStyle,minWidth:130}}>
              <option value="">— brand —</option>
              {gBrands.map(br => <option key={br} value={br}>{br}</option>)}
              <option value="__new__">+ New brand…</option>
            </select>
            {gf.brand==='__new__' && (
              <input value={gf.newBrand} placeholder="new brand"
                onChange={e => gfSet('newBrand',e.target.value)}
                style={{...inputStyle,minWidth:120}}/>
            )}
            <input value={gf.name} placeholder="item name"
              onChange={e => gfSet('name',e.target.value)}
              style={{...inputStyle,minWidth:150}}/>
            <input type="number" min="1" value={gf.qty}
              onChange={e => gfSet('qty',e.target.value)}
              style={{...inputStyle,width:60}}/>
            <select value={gf.status} onChange={e => gfSet('status',e.target.value)}
              style={{...inputStyle,minWidth:100}}>
              <option value="owned">Owned</option>
              <option value="inbound">Inbound</option>
            </select>
            <button style={{...btn(true,C.green),fontSize:11}} onClick={addGearItem}>ADD</button>
          </div>
        )}
        {gBrands.length===0 ? (
          <span style={{fontFamily:'monospace',fontSize:12,color:C.dimGray}}>
            No equipment yet. Use + ADD GEAR to start your inventory.
          </span>
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
                        <div key={it.id} style={{display:'flex',alignItems:'center',gap:8,
                          padding:'6px 8px',background:C.bgWidget,borderRadius:4}}>
                          <span title="Toggle owned / inbound"
                            onClick={() => onSaveGear({...it, status: it.status==='owned'?'inbound':'owned'})}
                            style={{width:10,height:10,borderRadius:'50%',background:SC[it.status]||C.dimGray,
                              flexShrink:0,cursor:'pointer',border:'1px solid rgba(255,255,255,0.25)'}}/>
                          <span style={{fontFamily:'monospace',fontSize:12,color:C.text,flex:1}}>
                            {it.qty>1?it.qty+'× ':''}{it.name}
                            {it.note?<span style={{color:C.dimGray,fontSize:10}}> ({it.note})</span>:null}
                          </span>
                          {it.status==='inbound' && <span style={pill(C.amber)}>inbound</span>}
                          <span onClick={() => onRemoveGear(it.id)}
                            title="Remove item"
                            style={{cursor:'pointer',color:C.red,fontWeight:700}}>✕</span>
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
  const [gear, setGear]               = useState([])
  const [myBands, setMyBands]         = useState([])
  const [authLoading, setAuthLoading] = useState(true)
  const [logLoading, setLogLoading]   = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      setAuthLoading(false)
      if (u) {
        setLogLoading(true)
        try {
          // Backfill: push any localStorage entries to Firestore that aren't there yet
          const local = JSON.parse(localStorage.getItem('rbts_log') || '[]')
          if (local.length > 0) {
            const existing = await loadLogFromFirestore(u.uid)
            const existingKeys = new Set(existing.map(e => `${e.date}_${e.session}`))
            const toSync = local.filter(e => !existingKeys.has(`${e.date}_${e.session}`))
            await Promise.all(toSync.map(e => saveEntryToFirestore(u.uid, e)))
          }
          const entries = await loadLogFromFirestore(u.uid)
          setLog(entries)
        } catch (e) { console.error('Error loading log:', e) }
        // Gear: backfill local → Firestore when empty, then load
        try {
          let fsGear = await loadGearFromFirestore(u.uid)
          if (fsGear.length === 0) {
            const localGear = getLocalGear()   // seeds defaults if nothing stored
            await Promise.all(localGear.map(g => saveGearItemToFirestore(u.uid, g)))
            fsGear = localGear
          }
          setGear(fsGear)
        } catch (e) { console.error('Error loading gear:', e); setGear(getLocalGear()) }
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
        setLogLoading(false)
      } else {
        try {
          const local = JSON.parse(localStorage.getItem('rbts_log') || '[]')
          setLog(local)
        } catch { setLog([]) }
        setGear(getLocalGear())
        setMyBands(getLocalMyBands())
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
    try { setLog(JSON.parse(localStorage.getItem('rbts_log')||'[]')) } catch { setLog([]) }
    setGear(getLocalGear())
    setMyBands(getLocalMyBands())
  }

  const handleSaveEntry = useCallback(async (entry) => {
    setLog(prev => {
      const idx = prev.findIndex(e => e.date===entry.date && e.session===entry.session)
      if (idx >= 0) { const next=[...prev]; next[idx]=entry; return next }
      return [...prev, entry]
    })
    if (user) {
      try { await saveEntryToFirestore(user.uid, entry) }
      catch (e) { console.error('Save failed:', e) }
    } else {
      try {
        const local = JSON.parse(localStorage.getItem('rbts_log')||'[]')
        const idx   = local.findIndex(e=>e.date===entry.date&&e.session===entry.session)
        if (idx>=0) local[idx]=entry; else local.push(entry)
        localStorage.setItem('rbts_log', JSON.stringify(local))
      } catch {}
    }
  }, [user])

  const handleMergeImport = useCallback(async (incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return { added:0, dates:0, synced:false }
    const dropDates = new Set(incoming.map(e => e.date))
    setLog(prev => {
      const kept = prev.filter(e => !dropDates.has(e.date))
      return kept.concat(incoming).sort((a,b) => a.date.localeCompare(b.date))
    })
    let synced = false
    if (user) {
      try {
        const existing = await loadLogFromFirestore(user.uid)
        const toDelete = existing.filter(e => dropDates.has(e.date))
        await Promise.all(toDelete.map(e => deleteDoc(doc(db,'users',user.uid,'workouts',`${e.date}_${e.session}`))))
        await Promise.all(incoming.map(e => saveEntryToFirestore(user.uid, e)))
        synced = true
      } catch (err) { console.error('Merge import failed:', err) }
    } else {
      try {
        const local = JSON.parse(localStorage.getItem('rbts_log') || '[]')
        const kept  = local.filter(e => !dropDates.has(e.date))
        localStorage.setItem('rbts_log', JSON.stringify(kept.concat(incoming).sort((a,b)=>a.date.localeCompare(b.date))))
      } catch {}
    }
    return { added: incoming.length, dates: dropDates.size, synced }
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

  const handleSetMyBands = useCallback(async (next) => {
    setMyBands(next)
    if (user) { try { await saveMyBandsToFirestore(user.uid, next) } catch (e) { console.error('Save my bands failed:', e) } }
    else saveLocalMyBands(next)
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
        {['today','history','strength','programs','library','gear'].map(t => (
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
        {tab==='today'    && <TodayTab user={user} log={log} onSaveEntry={handleSaveEntry}/>}
        {tab==='history'  && <HistoryTab log={log} onMergeImport={handleMergeImport} onSaveEntry={handleSaveEntry} onDeleteEntry={handleDeleteEntry}/>}
        {tab==='strength' && <StrengthTab log={log}/>}
        {tab==='programs' && <ProgramsTab/>}
        {tab==='library'  && <LibraryTab/>}
        {tab==='gear'     && <GearTab gear={gear} myBands={myBands} onSaveGear={handleSaveGear} onRemoveGear={handleRemoveGear} onSetMyBands={handleSetMyBands}/>}
      </div>
    </div>
  )
}
