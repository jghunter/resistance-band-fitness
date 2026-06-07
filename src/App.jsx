import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { collection, doc, setDoc, getDocs, query, orderBy } from 'firebase/firestore'
import { db, auth, googleProvider } from './firebase'
import {
  C, EXERCISE_NAMES, TECHNIQUES, VIDEOS, PROGRAMS,
  SESSION_FOCUS, getSessionFocus, SLOT_LABELS, exGroup, ALL_GROUPS,
  BANDS, COLOR_HEX, BAND_BRANDS, GEAR,
  calcToday, PROG_REPS,
} from './data'

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
  const techMap  = {}
  if (!isDeload) {
    (prog.techniques[`week${week}`] || []).forEach(({session:s,slot,technique}) => {
      if (s === sKey) techMap[slot] = technique
    })
  }
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

  return (
    <div ref={pickerRef} style={{position:'relative'}}>
      <div style={{display:'flex',flexWrap:'wrap',gap:4,alignItems:'center'}}>
        {selected.map((id, idx) => {
          const b = BANDS.find(x => x.id === id)
          if (!b) return null
          const hex = COLOR_HEX[b.color] || '#888'
          return (
            <span key={idx} style={{
              background:hex+'22',border:`1px solid ${hex}66`,borderRadius:4,
              padding:'2px 7px',fontFamily:'monospace',fontSize:9,color:C.text,
              display:'flex',alignItems:'center',gap:4,
            }}>
              <span style={{width:8,height:8,borderRadius:'50%',background:hex,flexShrink:0}}/>
              {b.brand.split(' ')[0]} {b.color} {b.model} {b.res}lbs
              <span onClick={() => onChange(selected.filter((_,i)=>i!==idx))}
                style={{cursor:'pointer',color:C.dimGray,fontSize:12,lineHeight:1}}>x</span>
            </span>
          )
        })}
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
            const cnt = selected.filter(x=>x===b.id).length
            return (
              <div key={b.id} onClick={()=>onChange([...selected,b.id])} style={{
                display:'flex',alignItems:'center',gap:8,padding:'5px 7px',
                borderRadius:4,cursor:'pointer',marginBottom:2,
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
                <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray,flexShrink:0}}>
                  {b.lengthIn}"
                </span>
                {cnt>0 && <span style={{background:C.accent,color:'#000',borderRadius:10,padding:'1px 6px',fontSize:9,fontWeight:'bold'}}>×{cnt}</span>}
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
    onSetsChange([...sets, {reps: last ? last.reps : 0, bands: last ? [...last.bands] : []}])
  }
  function removeSet(i) { onSetsChange(sets.filter((_,idx)=>idx!==i)) }
  function updateSet(i, field, val) {
    onSetsChange(sets.map((s,idx) => idx===i ? {...s,[field]:val} : s))
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
            const bNames = (s.bands||[]).map(bid => {
              const b = BANDS.find(x=>x.id===bid)
              return b ? `${b.brand.split(' ')[0]} ${b.color} ${b.model} (${b.res}lbs)` : '?'
            }).join(' + ')
            return <span key={i}>{s.reps}r [{bNames||'no band'}]{i<prevSets.length-1?', ':''}</span>
          })}
        </div>
      )}
      <div style={{borderTop:'1px solid rgba(255,255,255,0.07)',paddingTop:8}}>
        <span style={{...lbl,marginBottom:6}}>LOG SETS</span>
        {sets.map((s,i) => (
          <div key={i} style={{display:'flex',alignItems:'flex-start',gap:6,marginBottom:8}}>
            <span style={{fontFamily:'monospace',fontSize:10,color:C.dimGray,
              minWidth:18,paddingTop:6,flexShrink:0}}>S{i+1}</span>
            <div style={{flex:1,minWidth:0}}>
              <BandPicker selected={s.bands||[]} onChange={v=>updateSet(i,'bands',v)}/>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
              <input type="number" min="0" max="99"
                value={s.reps||''}
                placeholder="0"
                onChange={e=>updateSet(i,'reps',Math.max(0,parseInt(e.target.value)||0))}
                style={{...inputStyle,width:50,textAlign:'center',padding:'4px 6px'}}/>
              <span style={{fontFamily:'monospace',fontSize:9,color:C.dimGray}}>reps</span>
            </div>
            {sets.length > 1 && (
              <button style={{...btn(false,C.red),fontSize:9,padding:'2px 6px',flexShrink:0}}
                onClick={()=>removeSet(i)}>x</button>
            )}
          </div>
        ))}
        <button style={{...btn(false,C.green),fontSize:9,padding:'3px 9px'}} onClick={addSet}>+ SET</button>
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
  const techMap  = {}
  if (!isDeload) {
    (prog.techniques[`week${week}`]||[]).forEach(t => {
      if (t.session === sKey) techMap[t.slot] = t.technique
    })
  }

  function getOrInit(id) { return exercises[id] || [{reps:0,bands:[]}] }
  function updateEx(id, sets) { onExercisesChange({...exercises, [id]:sets}) }

  function getPrevSets(exerciseId) {
    const found = log
      .filter(e => e.exercises && e.exercises[exerciseId] && e.date < todayDate)
      .sort((a,b) => b.date.localeCompare(a.date))
    return found[0] ? found[0].exercises[exerciseId] : null
  }

  function renderCard(slot, id, role) {
    const prev     = getPrevSets(String(id))
    const progFlag = prev ? prev.every(s => (s.reps||0) >= PROG_REPS) : false
    return (
      <LoggedExCard key={slot} id={id} role={role}
        techKey={techMap[slot]||null}
        sets={getOrInit(id)} onSetsChange={s=>updateEx(id,s)}
        prevSets={prev} progFlag={progFlag}/>
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
        <span style={lbl}>SELECT PROGRAM — 12 × 6-WEEK BLOCKS (~1 YEAR)</span>
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
                  <span style={lbl}>WEEK {week} TECHNIQUES</span>
                  {(prog.techniques[`week${week}`]||[]).map((t,i) => (
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
  const [startDate, setStartDate] = useLS('rbts_startDate', '2026-06-01')
  const [sched, setSched]         = useLS('rbts_schedule', 'MWF')
  const [pi, setPi]               = useLS('rbts_progIdx', 0)
  const [exLogs, setExLogs]       = useState({})
  const [saved, setSaved]         = useState(false)

  const info       = useMemo(() => calcToday(startDate, sched, Number(pi)), [startDate, sched, pi])
  const todayISO   = new Date().toISOString().split('T')[0]
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
    const entry = {
      date:todayISO, programId:info.prog.id, week:info.week,
      session:info.session, workoutNum:info.num,
      exercises:exLogs, completedAt:new Date().toISOString(),
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
function HistoryTab({ log }) {
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate]     = useState(() => new Date().toISOString().split('T')[0])

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
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:6}}>
              {Object.entries(e.exercises||{}).map(([exId,sets]) => (
                <div key={exId} style={{background:C.bgInput,borderRadius:5,padding:'7px 10px'}}>
                  <div style={{fontFamily:'monospace',fontSize:11,color:C.text,marginBottom:5}}>
                    <span style={{color:C.dimGray}}>#{exId} </span>{EXERCISE_NAMES[exId]||exId}
                  </div>
                  {(sets||[]).map((s,i) => {
                    const bNames=(s.bands||[]).map(bid=>{
                      const b=BANDS.find(x=>x.id===bid)
                      return b?`${b.brand.split(' ')[0]} ${b.color} (${b.res}lbs)`:bid
                    }).join(' + ')
                    return (
                      <div key={i} style={{fontFamily:'monospace',fontSize:10,color:C.textSec,marginBottom:2}}>
                        <span style={{color:C.dimGray}}>S{i+1} </span>
                        <span style={{color:(s.reps||0)>=PROG_REPS?C.green:C.text}}>{s.reps||0}r</span>
                        {bNames && <span style={{color:C.dimGray}}> {bNames}</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GEAR TAB
// ─────────────────────────────────────────────────────────────────────────────
function GearTab() {
  const statusColors = { owned:'#00ff99', preorder:'#ffaa00' }
  return (
    <div>
      <div style={{fontSize:11,color:'#aaa',letterSpacing:'0.12em',marginBottom:16,textTransform:'uppercase'}}>
        Equipment Inventory
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14}}>
        {GEAR.map(brand => {
          const ownedCount    = brand.items.filter(i=>i.status==='owned').length
          const preorderCount = brand.items.filter(i=>i.status==='preorder').length
          return (
            <div key={brand.brand} style={{background:'#1a1f2e',border:'1px solid #2a3050',borderRadius:8,padding:14}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <div style={{color:'#7ecfff',fontWeight:700,fontSize:13,letterSpacing:'0.08em',textTransform:'uppercase'}}>
                  {brand.brand}
                </div>
                <div style={{display:'flex',gap:8}}>
                  <span style={{fontSize:10,color:'#00ff99',background:'rgba(0,255,153,0.08)',padding:'2px 7px',borderRadius:4}}>
                    {ownedCount} owned
                  </span>
                  {preorderCount > 0 && (
                    <span style={{fontSize:10,color:'#ffaa00',background:'rgba(255,170,0,0.08)',padding:'2px 7px',borderRadius:4}}>
                      {preorderCount} inbound
                    </span>
                  )}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {brand.items.map((item,i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                    padding:'6px 8px',background:'rgba(255,255,255,0.03)',borderRadius:4}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:6,height:6,borderRadius:'50%',
                        background:statusColors[item.status]||'#aaa',flexShrink:0}}/>
                      <span style={{fontSize:12,color:'#dde'}}>
                        {item.qty>1?`${item.qty}× `:''}{item.name}
                        {item.note && <span style={{color:'#888',fontSize:10}}> ({item.note})</span>}
                      </span>
                    </div>
                    {item.status==='preorder' && (
                      <span style={{fontSize:9,color:'#ffaa00',letterSpacing:'0.1em',textTransform:'uppercase'}}>
                        pre-order
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{marginTop:20,padding:12,background:'#1a1f2e',border:'1px solid #2a3050',
        borderRadius:8,fontSize:11,color:'#888'}}>
        <span style={{color:'#7ecfff',letterSpacing:'0.08em'}}>TOTAL — </span>
        {GEAR.reduce((s,b)=>s+b.items.filter(i=>i.status==='owned').length,0)} items owned
        {' · '}
        {GEAR.reduce((s,b)=>s+b.items.filter(i=>i.status==='preorder').length,0)} pre-orders inbound
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
  const [authLoading, setAuthLoading] = useState(true)
  const [logLoading, setLogLoading]   = useState(false)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      setAuthLoading(false)
      if (u) {
        setLogLoading(true)
        try {
          const entries = await loadLogFromFirestore(u.uid)
          setLog(entries)
        } catch (e) { console.error('Error loading log:', e) }
        setLogLoading(false)
      } else {
        try {
          const local = JSON.parse(localStorage.getItem('rbts_log') || '[]')
          setLog(local)
        } catch { setLog([]) }
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
        {['today','history','programs','library','gear'].map(t => (
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
        {tab==='history'  && <HistoryTab log={log}/>}
        {tab==='programs' && <ProgramsTab/>}
        {tab==='library'  && <LibraryTab/>}
        {tab==='gear'     && <GearTab/>}
      </div>
    </div>
  )
}
