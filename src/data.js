// ─────────────────────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────────────────────
export const C = {
  bgDeep:"#050810", bgPanel:"#0a0f1e", bgWidget:"#0d1b2a", bgInput:"#111827",
  accent:"#00d4ff", accentDim:"rgba(0,212,255,0.4)", accentGlow:"rgba(0,212,255,0.25)",
  amber:"#f59e0b", red:"#ef4444", green:"#22c55e", dimGray:"#4b5563",
  text:"#e2e8f0", textSec:"#94a3b8", readout:"#00d4ff", deload:"#a855f7",
};

// ─────────────────────────────────────────────────────────────────────────────
// EXERCISE NAMES  (1–215)
// ─────────────────────────────────────────────────────────────────────────────
export const EXERCISE_NAMES = {
  1:"Standing Band Chest Press", 2:"Floor Band Press", 3:"Incline Band Chest Press",
  4:"Decline Band Chest Press", 5:"Single-Arm Band Chest Press", 6:"Banded Push-Up",
  7:"Archer Push-Up", 8:"Pike Push-Up with Band", 9:"Standing Band Chest Fly (Mid)",
  10:"Low-to-High Chest Fly", 11:"High-to-Low Chest Fly", 12:"Single-Arm Fly",
  13:"Band Pullover", 14:"Close-Grip Band Press", 15:"Wide-Grip Band Press",
  16:"Band Squeeze Press", 17:"Banded Dip", 18:"Svend Press with Band",
  19:"Band-Resisted Bench Press", 20:"1.5-Rep Band Press",
  21:"Standing Band Row", 22:"Seated Band Row", 23:"Bent-Over Band Row",
  24:"Single-Arm Band Row", 25:"Wide-Grip Band Row", 26:"Close-Grip Band Row",
  27:"Meadows Row", 28:"Band Lat Pulldown", 29:"Single-Arm Band Pulldown",
  30:"Straight-Arm Band Pulldown", 31:"Banded Pull-Up Assist",
  32:"Band-Resisted Pull-Up", 33:"Band Face Pull", 34:"Band Pull-Apart",
  35:"Overhead Band Pull-Apart", 36:"Y-T-W-L Raise", 37:"Band Romanian Deadlift",
  38:"Band Good Morning", 39:"Band Reverse Fly", 40:"Band Shrug",
  41:"Band Shrug with Hold", 42:"Superman with Band",
  43:"Standing Band Overhead Press", 44:"Single-Arm Overhead Press",
  45:"Arnold Press with Band", 46:"Push Press with Band", 47:"Band Front Raise",
  48:"Band Lateral Raise", 49:"Leaning Lateral Raise", 50:"Band Scaption Raise",
  51:"Band Rear Delt Fly", 52:"Band Cuban Press", 53:"Band External Rotation",
  54:"Band Internal Rotation", 55:"Band 90/90 Shoulder ER", 56:"Band Upright Row",
  57:"Band W-Raise", 58:"Band Prone I-Raise",
  59:"Kneeling Band Crunch", 60:"Standing Band Crunch", 61:"Banded Reverse Crunch",
  62:"Banded Leg Raise", 63:"Pallof Press", 64:"Pallof Press with Rotation",
  65:"Pallof Press Overhead", 66:"Woodchop (High-to-Low)",
  67:"Reverse Woodchop (Low-to-High)", 68:"Horizontal Woodchop",
  69:"Banded Dead Bug", 70:"Banded Bicycle Crunch", 71:"Banded Plank",
  72:"Banded Side Plank", 73:"Russian Twist with Band",
  74:"Tall-Kneeling Band Rotation", 75:"Banded Ab Rollout",
  76:"Banded Mountain Climber", 77:"Standing Band Lift (Low-to-High)",
  78:"Glute Bridge", 79:"Banded Hip Thrust", 80:"Single-Leg Hip Thrust",
  81:"Frog Pump", 82:"Glute Bridge March", 83:"Donkey Kick",
  84:"Donkey Kick + Pulse", 85:"Fire Hydrant", 86:"Clamshell",
  87:"Lateral Band Walk", 88:"Forward Band Walk", 89:"Monster Walk",
  90:"X-Band Walk", 91:"Standing Hip Abduction", 92:"Glute Kickback",
  93:"Curtsy Lunge", 94:"Pull-Through", 95:"Seated Hip Abduction", 96:"Hip Circle",
  97:"Band Squat", 98:"Front Squat (Band)", 99:"Goblet Squat with Band",
  100:"Sumo Squat with Band", 101:"Narrow-Stance Band Squat",
  102:"Bulgarian Split Squat", 103:"Reverse Lunge", 104:"Forward Lunge",
  105:"Walking Lunge", 106:"Lateral Lunge", 107:"Curtsy Lunge (Quads)",
  108:"Step-Up with Band", 109:"Sissy Squat with Band",
  110:"Terminal Knee Extension (TKE)", 111:"Spanish Squat",
  112:"Wall Sit with Band", 113:"Cyclist Squat (Heels Elevated)",
  114:"Box Squat with Band", 115:"Jump Squat with Band", 116:"Hack Squat with Band",
  117:"Romanian Deadlift (Band RDL)", 118:"Single-Leg RDL",
  119:"Stiff-Leg Deadlift", 120:"B-Stance RDL", 121:"Lying Leg Curl",
  122:"Seated Leg Curl", 123:"Standing Leg Curl", 124:"Nordic Curl (Band Assisted)",
  125:"Hip Hinge Pull-Through", 126:"Banded Reverse Hyper",
  127:"Good Morning", 128:"Snatch-Grip RDL",
  129:"Standing Bicep Curl", 130:"Alternating Curl", 131:"Hammer Curl",
  132:"Alternating Hammer Curl", 133:"Concentration Curl", 134:"Reverse Curl",
  135:"Drag Curl", 136:"Incline Curl", 137:"Preacher-Style Curl",
  138:"Zottman Curl", 139:"21s", 140:"Waiter's Curl",
  141:"Cross-Body Curl", 142:"Supinated Straight-Bar Curl", 143:"Spider Curl",
  144:"Triceps Pushdown", 145:"Overhead Triceps Extension",
  146:"Single-Arm Overhead Extension", 147:"Triceps Kickback",
  148:"Band Skull Crusher", 149:"Close-Grip Band Press (Triceps)",
  150:"Band Dip", 151:"Reverse-Grip Pushdown", 152:"Single-Arm Pushdown",
  153:"Diamond Push-Up with Band", 154:"Cross-Body Triceps Extension",
  155:"Tate Press with Band", 156:"JM Press with Band",
  157:"Wrist Curl", 158:"Reverse Wrist Curl", 159:"Radial Deviation",
  160:"Ulnar Deviation", 161:"Wrist Pronation", 162:"Wrist Supination",
  163:"Finger Extension", 164:"Grip Crush",
  165:"Reverse Curl (Forearm Focus)", 166:"Band Farmer's Carry Hold",
  167:"Standing Calf Raise", 168:"Seated Calf Raise", 169:"Single-Leg Calf Raise",
  170:"Donkey Calf Raise", 171:"Eccentric Calf Raise", 172:"Tibialis Raise",
  173:"Bent-Knee Calf Raise", 174:"Explosive Calf Raise",
  175:"Calf Raise with Band Assist", 176:"Seated Tibialis Raise",
  177:"Neck Flexion", 178:"Neck Extension",
  179:"Lateral Neck Flexion (Left)", 180:"Lateral Neck Flexion (Right)",
  181:"Isometric Neck Flexion Hold", 182:"Isometric Neck Extension Hold",
  183:"Chin Tuck (Neck Retraction)", 184:"Isometric Lateral Hold",
  185:"Band Deadlift", 186:"Band RDL to Row", 187:"Band Thruster",
  188:"Band Clean Pull", 189:"Band Snatch Pull", 190:"Band Swing",
  191:"Band Farmer's Carry", 192:"Band Zercher Carry",
  193:"Band Overhead Carry", 194:"Band Bear Hug Carry",
  195:"Band Push Press", 196:"Band Squat to Row",
  197:"Band Lunge to Curl", 198:"Band Halo", 199:"Band Around-the-World",
  200:"Band Woodchop Lunge", 201:"Band Deadlift + Shrug", 202:"Band Power Clean",
  203:"Hip Flexor Stretch (Band)", 204:"Hip Internal Rotation Mob",
  205:"Hip External Rotation Mob", 206:"Ankle Dorsiflexion Mob",
  207:"Shoulder Capsule Stretch", 208:"Lat Stretch with Band",
  209:"Thoracic Extension Mob", 210:"Hamstring Floss",
  211:"Quad Stretch Assist", 212:"Banded Good Morning (Stretch)",
  213:"Overhead Shoulder Mob", 214:"Wrist Flexor Stretch",
  215:"Wrist Extensor Stretch",
};

// ─────────────────────────────────────────────────────────────────────────────
// HIGH-INTENSITY TECHNIQUES
// ─────────────────────────────────────────────────────────────────────────────
// MMF = momentary muscle failure: the point where you can't do another clean rep.
export const TECHNIQUES = {
  "1_quarter_reps":       "1¼ Reps — do one full rep using the full range of motion, then add a quarter rep at the top (peak contraction), then lower slowly back to the start. The full rep plus the quarter rep counts as just 1 rep.",
  "super_slow":           "Super Slow — take 5 seconds to lift (concentric, the muscle-shortening phase) and 5 seconds to lower (eccentric, the muscle-lengthening phase). The lowering phase is often extended to 10 seconds.",
  "negative_accentuated": "Negative Accentuated — lift fast (explode up), then lower slowly, taking 6–8 seconds on the way down (the eccentric phase).",
  "forced_reps":          "Forced Reps — after reaching failure, get 1–2 extra reps using a little momentum, help from a spotter, or assistance from your non-working arm or leg.",
  "drop_set":             "Drop Set — after reaching momentary muscle failure (MMF: you can't do another clean rep), quickly switch to a lighter band and keep going until you hit failure again.",
  "rest_pause":           "Rest-Pause — after hitting failure, pause 10–12 seconds, then squeeze out 3–4 more reps.",
  "partials":             "Partials — after hitting MMF at full range of motion, keep going with shorter reps until you hit MMF at a smaller range. You can step down through several ranges: full ROM, then 3/4, then 1/2, then 1/4.",
  "isometric_hold":       "Isometric Hold — hold and squeeze for 3–4 seconds at the peak of every rep.",
  "pre_exhaustion":       "Pre-Exhaustion — do an isolation exercise, then immediately do a compound exercise for the same muscle. Examples: flys then bench press · leg extensions then squats · pullovers then rows.",
  "mechanical_drop_set":  "Mechanical Drop Set — after reaching MMF, change your body position or switch to an easier variation of the movement and keep going. Examples: flys then presses (isolation to compound) · incline push-ups then regular push-ups (hard angle to easier angle) · wide grip then a closer, more natural grip.",
  "m_set":                "M-Set — go to full range of motion, ease back 1/5 of the way, return to full ROM. Ease back 2/5, return to full ROM. Then 3/5 and return, then 4/5 and return, then ease back all the way to the start. All of that together is 1 M-Set. Tempo: 2 seconds up, 5–6 seconds down on each partial.",
  "30_10_30":             "30-10-30 — 12 reps total: the FIRST rep is a 30-second super-slow negative (lowering), then 10 normal full reps, then the LAST rep is another 30-second super-slow negative.",
};

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO URLS
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// VIDEOS — URL format: plain string  OR  {url, start, end (in seconds), label}
//   Plain string:  opens YouTube at start (or at 0 if no timestamp yet)
//   Object:        "▶ WATCH DEMO" opens an embedded modal starting at `start`,
//                  ending at `end`, showing only the relevant exercise section.
//
//   Example:  149: {url:"https://www.youtube.com/watch?v=ABCD1234", start:45, end:90}
//
//   To add timestamps: run the /watch skill on the video URL locally, note the
//   chapter start/end for this exercise, then update to the object format.
// ─────────────────────────────────────────────────────────────────────────────
export const VIDEOS = {
  1: {url:"https://www.youtube.com/watch?v=6-86jEAXA08", start:0, end:53},
  2:"https://www.youtube.com/watch?v=h1uU13KkCXw",
  3: {url:"https://www.youtube.com/watch?v=DdV5EVJBae4", start:105, end:235},
  4: {url:"https://www.youtube.com/watch?v=91Jatv286xs", start:40, end:46},
  5: {url:"https://www.youtube.com/watch?v=baGx6pqU6S0", start:40, end:125},
  6: {url:"https://www.youtube.com/watch?v=7usDIUnlfNw", start:297, end:430},
  7:"https://www.youtube.com/watch?v=r4sRk3_JxWc",
  8: {url:"https://www.youtube.com/shorts/vlrLizvlZvk", start:18, end:40},
  9:"https://www.youtube.com/watch?v=Z6ly4c3YC6o",
  10: {url:"https://www.youtube.com/watch?v=N0uLm6RT9zg", start:34, end:58},
  11:"https://www.youtube.com/watch?v=Qp0kFogluvw",
  12: {url:"https://www.youtube.com/watch?v=-Xk7FJd51gI", start:0, end:217},
  13: {url:"https://www.youtube.com/watch?v=I3b8FyV9vZQ", start:47, end:126},
  14: {url:"https://www.youtube.com/watch?v=Q-lnd6SWR5A", start:382, end:414},
  15:"https://www.youtube.com/watch?v=Q-lnd6SWR5A",
  16: {url:"https://www.youtube.com/shorts/ZwRX_f1ZvxI", start:0, end:34},
  17: {url:"https://www.youtube.com/watch?v=mx5UJjeGdVs", start:458, end:543},
  18:"https://www.youtube.com/watch?v=0J2gScVrAA4",
  19: {url:"https://www.youtube.com/watch?v=j7_5RxYIXPc", start:30, end:302},
  20:"https://www.youtube.com/watch?v=0J2gScVrAA4",
  21:"https://www.youtube.com/watch?v=46LmoouvP34",
  22: {url:"https://www.youtube.com/watch?v=eOKwM5nHzj4", start:7, end:52},
  23: {url:"https://www.youtube.com/watch?v=Y3H17rshgZE", start:2, end:47},
  24: {url:"https://www.youtube.com/watch?v=OvPHAdtKtHk", start:20, end:215},
  25: {url:"https://www.youtube.com/watch?v=44d-eYe8QBs", start:59, end:122},
  26:{url:"https://www.youtube.com/watch?v=46LmoouvP34", start:256, end:335},
  27:"https://www.youtube.com/watch?v=Z1DrxG0nSOU",
  28: {url:"https://www.youtube.com/watch?v=84D8bVJWB3s", start:33, end:143},
  29: {url:"https://www.youtube.com/watch?v=aHgtwja2Xlc", start:41, end:58},
  30: {url:"https://www.youtube.com/watch?v=suDvuvet9zU", start:22, end:106},
  31: {url:"https://www.youtube.com/shorts/XxV8q2Qxhrc", start:58, end:133},
  32:"https://www.youtube.com/watch?v=46LmoouvP34",
  33:{url:"https://www.youtube.com/watch?v=AlTGQrDOd98", start:0, end:24},
  34:{url:"https://www.youtube.com/watch?v=3OYSIWaJJk4", start:29, end:55},
  35:{url:"https://www.youtube.com/watch?v=tzYip9kdVUU", start:3, end:49},
  36:"https://www.youtube.com/watch?v=46LmoouvP34",
  37:{url:"https://www.youtube.com/watch?v=NaKsZos0bIY", start:5, end:87},
  38:{url:"https://www.youtube.com/watch?v=_V0WOAL0_k0", start:114, end:222},
  39:"https://www.youtube.com/watch?v=cyihFNmsq-A",
  40:{url:"https://www.youtube.com/watch?v=JcgLXCqSpKQ", start:28, end:211},
  41:"https://www.youtube.com/watch?v=5dJbeSf0_Vk",
  42:{url:"https://www.youtube.com/watch?v=-wD7ThUxUn8", start:32, end:47},
  43: {url:"https://www.youtube.com/watch?v=zGs04z2jIrk", start:5, end:28},
  44:{url:"https://www.youtube.com/watch?v=iOeMmW3_l3s", start:475, end:518},
  45:"https://www.youtube.com/watch?v=iOeMmW3_l3s",
  46:"https://www.youtube.com/watch?v=iOeMmW3_l3s",
  47: {url:"https://www.youtube.com/watch?v=NtaPROZOcmM", start:319, end:347},
  48: {url:"https://www.youtube.com/watch?v=gfEyrmxbCbw", start:29, end:59},
  49:"https://www.youtube.com/watch?v=oHCxtt6g7UA",
  50:"https://www.youtube.com/watch?v=NtaPROZOcmM",
  51:"https://www.youtube.com/watch?v=cyihFNmsq-A",
  52:"https://www.youtube.com/watch?v=NtaPROZOcmM",
  53: {url:"https://www.youtube.com/watch?v=0IOLRTdvzSM", start:46, end:100},
  54: {url:"https://www.youtube.com/watch?v=0IOLRTdvzSM", start:24, end:45},
  55: {url:"https://www.youtube.com/watch?v=ybNV36DoRfY", start:0, end:30},
  56: {url:"https://www.youtube.com/watch?v=bLxb3w0c74w", start:28, end:56},
  57:"https://www.youtube.com/watch?v=NtaPROZOcmM",
  58:"https://www.youtube.com/watch?v=NtaPROZOcmM",
  59:"https://www.youtube.com/watch?v=6ffBlaBBWmA",
  60:"https://www.youtube.com/watch?v=6ffBlaBBWmA",
  61: {url:"https://www.youtube.com/watch?v=6ffBlaBBWmA", start:414, end:487},
  62: {url:"https://www.youtube.com/watch?v=6ffBlaBBWmA", start:598, end:602},
  63:"https://www.youtube.com/watch?v=_2xWmYNnFS8",
  64:"https://www.youtube.com/watch?v=C_lfM3v9HOc",
  65:"https://www.youtube.com/watch?v=C_lfM3v9HOc",
  66: {url:"https://www.youtube.com/watch?v=ooP1Zq6lq5Y", start:126, end:220},
  67:"https://www.youtube.com/watch?v=kPugGvTvl1A",
  68: {url:"https://www.youtube.com/watch?v=2LrjmwFDCFI", start:56, end:104},
  69: {url:"https://www.youtube.com/watch?v=R4cYlVkcp7w", start:100, end:123},
  70:"https://www.youtube.com/watch?v=6ffBlaBBWmA",
  71: {url:"https://www.youtube.com/watch?v=R4cYlVkcp7w", start:123, end:132},
  72: {url:"https://www.youtube.com/watch?v=R4cYlVkcp7w", start:212, end:229},
  73:"https://www.youtube.com/watch?v=hXwBHRANfXU",
  74:"https://www.youtube.com/watch?v=nmMiarKvP1c",
  75:"https://www.youtube.com/watch?v=6ffBlaBBWmA",
  76:"https://www.youtube.com/watch?v=6ffBlaBBWmA",
  77:"https://www.youtube.com/watch?v=kPugGvTvl1A",
  78:"https://www.youtube.com/watch?v=91uayvdKAQY",
  79:"https://www.youtube.com/watch?v=3vUbYrbym9w",
  80:"https://www.youtube.com/watch?v=w-XRg2eNop4",
  81:"https://www.youtube.com/watch?v=fSiblzK6qS8",
  82:"https://www.youtube.com/watch?v=pzc2AxiyK58",
  83:"https://www.youtube.com/watch?v=zQjbnGXlwH0",
  84:"https://www.youtube.com/watch?v=MpecjmHOVBE",
  85:"https://www.youtube.com/watch?v=k6WI1adIiHM",
  86:"https://www.youtube.com/watch?v=vQhSO8XUULQ",
  87:"https://www.youtube.com/watch?v=ReT_5fnUe6k",
  88:"https://www.youtube.com/watch?v=5DQnW7Cb-1k",
  89:"https://www.youtube.com/watch?v=hE4UsbLMjC8",
  90:"https://www.youtube.com/watch?v=aIKA1PgGA7A",
  91:"https://www.youtube.com/watch?v=CRpDEFu-a9c",
  92:"https://www.youtube.com/watch?v=ELn6SFBMYF8",
  93:"https://www.youtube.com/watch?v=GAoewy0uyUY",
  94:"https://www.youtube.com/watch?v=NO-NevrDrjE",
  95:"https://www.youtube.com/watch?v=BqZIR0PvxxU",
  96:"https://www.youtube.com/watch?v=OvJMG4_nMFc",
  97:"https://www.youtube.com/watch?v=D-SD9mGJ3Ok",
  98:"https://www.youtube.com/watch?v=5K-KlUlPo40",
  99:"https://www.youtube.com/watch?v=W3sp_uGF9XA",
  100:"https://www.youtube.com/watch?v=MGCrywJaOH4",
  101:"https://www.youtube.com/watch?v=HBn-h1bbrV4",
  102:"https://www.youtube.com/watch?v=Wl0tJmZ1ulo",
  103:"https://www.youtube.com/watch?v=SGiQFWDegho",
  104:"https://www.youtube.com/watch?v=W0Q4lt4p1jk",
  105:"https://www.youtube.com/watch?v=oFcIGfPz-dA",
  106:"https://www.youtube.com/watch?v=bd8bc-9DVug",
  107:"https://www.youtube.com/watch?v=GAoewy0uyUY",
  108:"https://www.youtube.com/watch?v=OheKQKfX6hQ",
  109:"https://www.youtube.com/watch?v=vKiut5Q8dAc",
  110:"https://www.youtube.com/watch?v=7xG3MeoLjC0",
  111:"https://www.youtube.com/watch?v=o-ZB93Obc6E",
  112:"https://www.youtube.com/watch?v=0Zl_-ZdOCyQ",
  113:"https://www.youtube.com/watch?v=1x8oxhb0D4E",
  114:"https://www.youtube.com/watch?v=jz47v0Uj1cY",
  115:"https://www.youtube.com/watch?v=v-9qVIOcGCE",
  116:"https://www.youtube.com/watch?v=jz47v0Uj1cY",
  117:"https://www.youtube.com/watch?v=NaKsZos0bIY",
  118:"https://www.youtube.com/watch?v=mxBMZKMBa1o",
  119:"https://www.youtube.com/watch?v=Us5G_UZkNNk",
  120:"https://www.youtube.com/watch?v=NJO5I_ds8vs",
  121:"https://www.youtube.com/watch?v=-YGPKH3rxA4",
  122:"https://www.youtube.com/watch?v=gc8bR85DC2k",
  123:"https://www.youtube.com/watch?v=-dwKh9QzoKc",
  124:"https://www.youtube.com/watch?v=wwZmfFB9vrA",
  125:"https://www.youtube.com/watch?v=NO-NevrDrjE",
  126:"https://www.youtube.com/watch?v=tBxxWNtEW7c",
  127:"https://www.youtube.com/watch?v=_V0WOAL0_k0",
  128:"https://www.youtube.com/watch?v=NaKsZos0bIY",
  129:"https://www.youtube.com/watch?v=PXLF19Oqe3M",
  130:"https://www.youtube.com/watch?v=2QAy7DfDmgA",
  131:"https://www.youtube.com/watch?v=KIqRZEF_Aqg",
  132:"https://www.youtube.com/watch?v=l6OlwHmll3w",
  133:"https://www.youtube.com/watch?v=uej9usJAIUw",
  134:"https://www.youtube.com/watch?v=FVCmVLwRNe0",
  135:"https://www.youtube.com/watch?v=c9sY_1EXyvk",
  136:"https://www.youtube.com/watch?v=FVCmVLwRNe0",
  137:"https://www.youtube.com/watch?v=x9QWH_1AbP8",
  138:"https://www.youtube.com/watch?v=oXAMW-LNX_Q",
  139:"https://www.youtube.com/watch?v=ro1zBaXaOMg",
  140:"https://www.youtube.com/watch?v=U7p90HpfpQQ",
  141:"https://www.youtube.com/watch?v=b_lGhdrvac4",
  142:"https://www.youtube.com/watch?v=PXLF19Oqe3M",
  143:"https://www.youtube.com/watch?v=FVCmVLwRNe0",
  144:"https://www.youtube.com/watch?v=qjPN6ElNqpc",
  145:"https://www.youtube.com/watch?v=Yi_zNoIsNcc",
  146:"https://www.youtube.com/watch?v=a5rUdCeTtSE",
  147:"https://www.youtube.com/watch?v=RGqznhXhtJE",
  148:"https://www.youtube.com/watch?v=uutP0eBt51I",
  150:"https://www.youtube.com/watch?v=rj6EE7ybnlE",
  151:"https://www.youtube.com/watch?v=Y3CDzx-oj3k",
  152:"https://www.youtube.com/watch?v=tcxMByxhaqo",
  153:"https://www.youtube.com/watch?v=8cTohcawjCM",
  154:"https://www.youtube.com/watch?v=gDQTxEBP_ww",
  155:"https://www.youtube.com/watch?v=FX7AIEkqkNk",
  156:"https://www.youtube.com/watch?v=NWEKKTJEo8s",
  157:"https://www.youtube.com/watch?v=Z64A_Q2aG3U",
  158:"https://www.youtube.com/watch?v=xyHLejrielo",
  159:"https://www.youtube.com/watch?v=5YNRp21YXw0",
  160:"https://www.youtube.com/watch?v=5YNRp21YXw0",
  161:"https://www.youtube.com/watch?v=yFsmmyJ9TmM",
  162:"https://www.youtube.com/watch?v=yFsmmyJ9TmM",
  163:"https://www.youtube.com/watch?v=wugNi3uEFUs",
  164:"https://www.youtube.com/watch?v=wugNi3uEFUs",
  165:"https://www.youtube.com/watch?v=xyHLejrielo",
  166:"https://www.youtube.com/watch?v=Z1DrxG0nSOU",
  167:"https://www.youtube.com/watch?v=t3IXE5JFPvI",
  168:"https://www.youtube.com/watch?v=jkH3WP_a_8E",
  169:"https://www.youtube.com/watch?v=6FONB2sSNQA",
  170:"https://www.youtube.com/watch?v=Iw2UhAot1gA",
  171:"https://www.youtube.com/watch?v=d2GgSoHvIXo",
  172:"https://www.youtube.com/watch?v=i0LN4UcCHUc",
  173:"https://www.youtube.com/watch?v=qXCtsKexOvQ",
  174:"https://www.youtube.com/watch?v=ZVas-oC00EA",
  175:"https://www.youtube.com/watch?v=-c39P9V64tU",
  176:"https://www.youtube.com/watch?v=i0LN4UcCHUc",
  177:"https://www.youtube.com/watch?v=PsBmNkba9yI",
  178:"https://www.youtube.com/watch?v=eskCgvDgu6w",
  179:"https://www.youtube.com/watch?v=1EG7z_qsYNY",
  180:"https://www.youtube.com/watch?v=1EG7z_qsYNY",
  181:"https://www.youtube.com/watch?v=LqJSszVWabw",
  182:"https://www.youtube.com/watch?v=LqJSszVWabw",
  183:"https://www.youtube.com/watch?v=JkTnzMJpgt4",
  184:"https://www.youtube.com/watch?v=LqJSszVWabw",
  185:"https://www.youtube.com/watch?v=nHqSuHb8WUI",
  186:"https://www.youtube.com/watch?v=KSugyYxzIjg",
  187:"https://www.youtube.com/watch?v=5nL_knb1X1o",
  188:"https://www.youtube.com/watch?v=KSugyYxzIjg",
  189:"https://www.youtube.com/watch?v=KSugyYxzIjg",
  190:"https://www.youtube.com/watch?v=O7dLcHXOQ1c",
  191:"https://www.youtube.com/watch?v=Q-Zrg1bkGCs",
  192:"https://www.youtube.com/watch?v=KSugyYxzIjg",
  193:"https://www.youtube.com/watch?v=KSugyYxzIjg",
  194:"https://www.youtube.com/watch?v=KSugyYxzIjg",
  195:"https://www.youtube.com/watch?v=sFdrokvKN0I",
  196:"https://www.youtube.com/watch?v=jo9ZaKSd_Ow",
  197:"https://www.youtube.com/watch?v=jMa4TmV7QDk",
  198:"https://www.youtube.com/watch?v=f9RqwamykDI",
  199:"https://www.youtube.com/watch?v=L94uwhyOTkQ",
  200:"https://www.youtube.com/watch?v=d7XYZYxQuVM",
  201:"https://www.youtube.com/watch?v=NaKsZos0bIY",
  202:"https://www.youtube.com/watch?v=EuKX-ST2Akw",
  203:"https://www.youtube.com/watch?v=g1sOD9TYrLY",
  204:"https://www.youtube.com/watch?v=-jCfRGIq7QI",
  205:"https://www.youtube.com/watch?v=oGJKC-q5WmY",
  206:"https://www.youtube.com/watch?v=jI1WkcXZde4",
  207:"https://www.youtube.com/watch?v=nYuAB_OCFxQ",
  208:"https://www.youtube.com/watch?v=e8MCkqSb9yY",
  209:"https://www.youtube.com/watch?v=sMTwXMlu6RY",
  210:"https://www.youtube.com/watch?v=IwS1vywdFFI",
  211:"https://www.youtube.com/watch?v=nVlcr_AEOag",
  212:"https://www.youtube.com/watch?v=_V0WOAL0_k0",
  213:"https://www.youtube.com/watch?v=7p-Ma0eksaY",
  214:"https://www.youtube.com/watch?v=I9lvT_fJQIM",
  215:"https://www.youtube.com/watch?v=c2JIMZpTtoA",
};

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAMS
// ─────────────────────────────────────────────────────────────────────────────
const t = (session, slot, technique) => ({ session, slot, technique });

export const PROGRAMS = [
  { id:1, name:"Foundation",
    sessions:{
      C:{primary:{chestIso:9,chestComp:1},accessories:{back:34,triceps:147,biceps:131,forearms:157,neck:177,calves:167,coreFront:59, glutes: 78}},
      D:{primary:{backIso:28,backComp:21},accessories:{chest:6,triceps:148,biceps:133,forearms:158,neck:178,calves:168,coreBack:42, hams: 117}},
      E:{primary:{triIso:144,triComp:149},accessories:{chest:3,back:33,biceps:130,forearms:163,neck:179,calves:169,coreSides:72}},
      F:{primary:{biIso:129,biComp:134},accessories:{chest:11,back:25,triceps:152,forearms:164,neck:180,calves:170,core:63, shoulders: 43}},
      G:{primary:{coreIso:62,coreComp:64},accessories:{chest:2,back:39,triceps:145,biceps:136,forearms:165,neck:181,calves:171, quads: 97}},
    },
    techniques:{
      week1:[t("C","chestComp","1_quarter_reps"),t("D","backComp","negative_accentuated")],
      week2:[t("E","triIso","super_slow"),t("F","biComp","drop_set")],
      week3:[t("G","coreIso","isometric_hold"),t("C","chestIso","rest_pause")],
      week4:[t("D","backIso","partials"),t("E","triComp","forced_reps")],
      week5:[t("F","biIso","mechanical_drop_set"),t("G","coreComp","pre_exhaustion")],
    },
  },
  { id:2, name:"Low-to-High",
    sessions:{
      C:{primary:{chestIso:10,chestComp:2},accessories:{back:33,triceps:148,biceps:133,forearms:158,neck:178,calves:168,coreFront:60, glutes: 79}},
      D:{primary:{backIso:29,backComp:22},accessories:{chest:7,triceps:151,biceps:130,forearms:159,neck:179,calves:169,coreBack:71, hams: 118}},
      E:{primary:{triIso:145,triComp:150},accessories:{chest:4,back:34,biceps:132,forearms:164,neck:180,calves:170,coreSides:66}},
      F:{primary:{biIso:130,biComp:135},accessories:{chest:12,back:26,triceps:154,forearms:165,neck:181,calves:171,core:65, shoulders: 44}},
      G:{primary:{coreIso:61,coreComp:64},accessories:{chest:5,back:40,triceps:146,biceps:137,forearms:166,neck:182,calves:172, quads: 98}},
    },
    techniques:{
      week1:[t("C","chestIso","super_slow"),t("D","backComp","drop_set")],
      week2:[t("E","triComp","negative_accentuated"),t("F","biIso","isometric_hold")],
      week3:[t("G","coreComp","1_quarter_reps"),t("C","chestComp","rest_pause")],
      week4:[t("D","backIso","forced_reps"),t("E","triIso","partials")],
      week5:[t("F","biComp","pre_exhaustion"),t("G","coreIso","mechanical_drop_set")],
    },
  },
  { id:3, name:"High-to-Low",
    sessions:{
      C:{primary:{chestIso:11,chestComp:3},accessories:{back:22,triceps:151,biceps:132,forearms:159,neck:179,calves:169,coreFront:61, glutes: 80}},
      D:{primary:{backIso:30,backComp:23},accessories:{chest:5,triceps:152,biceps:134,forearms:160,neck:180,calves:170,coreBack:75, hams: 119}},
      E:{primary:{triIso:146,triComp:153},accessories:{chest:8,back:35,biceps:129,forearms:161,neck:181,calves:171,coreSides:67}},
      F:{primary:{biIso:131,biComp:138},accessories:{chest:13,back:27,triceps:155,forearms:162,neck:182,calves:172,core:69, shoulders: 45}},
      G:{primary:{coreIso:75,coreComp:65},accessories:{chest:6,back:41,triceps:149,biceps:138,forearms:157,neck:183,calves:173, quads: 99}},
    },
    techniques:{
      week1:[t("D","backIso","isometric_hold"),t("E","triComp","1_quarter_reps")],
      week2:[t("F","biIso","super_slow"),t("G","coreComp","forced_reps")],
      week3:[t("C","chestComp","drop_set"),t("D","backComp","partials")],
      week4:[t("E","triIso","rest_pause"),t("F","biComp","mechanical_drop_set")],
      week5:[t("G","coreIso","negative_accentuated"),t("C","chestIso","pre_exhaustion")],
    },
  },
  { id:4, name:"Single-Arm Focus",
    sessions:{
      C:{primary:{chestIso:12,chestComp:4},accessories:{back:21,triceps:152,biceps:133,forearms:160,neck:180,calves:170,coreFront:62, glutes: 81}},
      D:{primary:{backIso:33,backComp:24},accessories:{chest:8,triceps:154,biceps:132,forearms:161,neck:181,calves:171,coreBack:69, hams: 120}},
      E:{primary:{triIso:147,triComp:149},accessories:{chest:6,back:28,biceps:135,forearms:162,neck:182,calves:172,coreSides:68}},
      F:{primary:{biIso:132,biComp:139},accessories:{chest:14,back:23,triceps:156,forearms:163,neck:183,calves:173,core:70, shoulders: 46}},
      G:{primary:{coreIso:59,coreComp:66},accessories:{chest:9,back:29,triceps:150,biceps:140,forearms:164,neck:184,calves:174, quads: 100}},
    },
    techniques:{
      week1:[t("E","triIso","partials"),t("F","biComp","1_quarter_reps")],
      week2:[t("G","coreComp","super_slow"),t("C","chestComp","isometric_hold")],
      week3:[t("D","backComp","rest_pause"),t("E","triComp","drop_set")],
      week4:[t("F","biIso","negative_accentuated"),t("G","coreIso","forced_reps")],
      week5:[t("C","chestIso","mechanical_drop_set"),t("D","backIso","pre_exhaustion")],
    },
  },
  { id:5, name:"Overhead Emphasis",
    sessions:{
      C:{primary:{chestIso:13,chestComp:5},accessories:{back:39,triceps:154,biceps:131,forearms:161,neck:181,calves:171,coreFront:69, glutes: 82}},
      D:{primary:{backIso:34,backComp:25},accessories:{chest:14,triceps:155,biceps:131,forearms:162,neck:182,calves:172,coreBack:76, hams: 121}},
      E:{primary:{triIso:148,triComp:150},accessories:{chest:1,back:36,biceps:133,forearms:163,neck:183,calves:173,coreSides:74}},
      F:{primary:{biIso:133,biComp:142},accessories:{chest:15,back:31,triceps:144,forearms:164,neck:184,calves:174,core:73, shoulders: 47}},
      G:{primary:{coreIso:71,coreComp:67},accessories:{chest:10,back:42,triceps:148,biceps:141,forearms:165,neck:177,calves:175, quads: 101}},
    },
    techniques:{
      week1:[t("F","biIso","forced_reps"),t("G","coreComp","partials")],
      week2:[t("C","chestIso","1_quarter_reps"),t("D","backComp","super_slow")],
      week3:[t("E","triIso","mechanical_drop_set"),t("F","biComp","rest_pause")],
      week4:[t("G","coreIso","isometric_hold"),t("C","chestComp","drop_set")],
      week5:[t("D","backIso","negative_accentuated"),t("E","triComp","pre_exhaustion")],
    },
  },
  { id:6, name:"Squeeze & Contract",
    sessions:{
      C:{primary:{chestIso:16,chestComp:6},accessories:{back:28,triceps:155,biceps:129,forearms:162,neck:182,calves:172,coreFront:70, glutes: 83}},
      D:{primary:{backIso:35,backComp:26},accessories:{chest:15,triceps:156,biceps:136,forearms:163,neck:183,calves:173,coreBack:73, hams: 122}},
      E:{primary:{triIso:151,triComp:153},accessories:{chest:2,back:37,biceps:134,forearms:164,neck:184,calves:174,coreSides:77}},
      F:{primary:{biIso:136,biComp:134},accessories:{chest:16,back:32,triceps:147,forearms:165,neck:177,calves:175,core:76, shoulders: 48}},
      G:{primary:{coreIso:72,coreComp:68},accessories:{chest:11,back:30,triceps:145,biceps:129,forearms:166,neck:178,calves:176, quads: 102}},
    },
    techniques:{
      week1:[t("G","coreIso","pre_exhaustion"),t("C","chestComp","mechanical_drop_set")],
      week2:[t("D","backIso","1_quarter_reps"),t("E","triIso","drop_set")],
      week3:[t("F","biIso","forced_reps"),t("G","coreComp","super_slow")],
      week4:[t("C","chestIso","isometric_hold"),t("D","backComp","rest_pause")],
      week5:[t("E","triComp","negative_accentuated"),t("F","biComp","partials")],
    },
  },
  { id:7, name:"Unilateral Drive",
    sessions:{
      C:{primary:{chestIso:18,chestComp:7},accessories:{back:25,triceps:156,biceps:130,forearms:163,neck:183,calves:173,coreFront:71, glutes: 84}},
      D:{primary:{backIso:39,backComp:27},accessories:{chest:17,triceps:144,biceps:137,forearms:164,neck:184,calves:174,coreBack:74, hams: 123}},
      E:{primary:{triIso:152,triComp:149},accessories:{chest:9,back:38,biceps:140,forearms:165,neck:177,calves:175,coreSides:63}},
      F:{primary:{biIso:137,biComp:135},accessories:{chest:17,back:22,triceps:148,forearms:166,neck:178,calves:176,core:77, shoulders: 49}},
      G:{primary:{coreIso:62,coreComp:69},accessories:{chest:12,back:33,triceps:150,biceps:142,forearms:157,neck:179,calves:167, quads: 103}},
    },
    techniques:{
      week1:[t("C","chestComp","drop_set"),t("D","backIso","super_slow")],
      week2:[t("E","triIso","1_quarter_reps"),t("F","biIso","negative_accentuated")],
      week3:[t("G","coreComp","rest_pause"),t("C","chestIso","forced_reps")],
      week4:[t("D","backComp","mechanical_drop_set"),t("E","triComp","isometric_hold")],
      week5:[t("F","biComp","partials"),t("G","coreIso","pre_exhaustion")],
    },
  },
  { id:8, name:"Tempo & Control",
    sessions:{
      C:{primary:{chestIso:9,chestComp:8},accessories:{back:35,triceps:144,biceps:131,forearms:164,neck:184,calves:174,coreFront:76, glutes: 85}},
      D:{primary:{backIso:40,backComp:31},accessories:{chest:19,triceps:147,biceps:131,forearms:165,neck:177,calves:175,coreBack:42, hams: 124}},
      E:{primary:{triIso:154,triComp:150},accessories:{chest:10,back:21,biceps:143,forearms:166,neck:178,calves:176,coreSides:64}},
      F:{primary:{biIso:140,biComp:138},accessories:{chest:18,back:34,triceps:146,forearms:157,neck:179,calves:167,core:59, shoulders: 50}},
      G:{primary:{coreIso:60,coreComp:70},accessories:{chest:13,back:26,triceps:153,biceps:129,forearms:158,neck:180,calves:168, quads: 104}},
    },
    techniques:{
      week1:[t("E","triComp","super_slow"),t("F","biComp","1_quarter_reps")],
      week2:[t("G","coreIso","drop_set"),t("C","chestIso","isometric_hold")],
      week3:[t("D","backComp","forced_reps"),t("E","triIso","partials")],
      week4:[t("F","biIso","pre_exhaustion"),t("G","coreComp","negative_accentuated")],
      week5:[t("C","chestComp","rest_pause"),t("D","backIso","mechanical_drop_set")],
    },
  },
  { id:9, name:"Rotation & Reach",
    sessions:{
      C:{primary:{chestIso:10,chestComp:14},accessories:{back:26,triceps:145,biceps:130,forearms:165,neck:177,calves:175,coreFront:60, glutes: 86}},
      D:{primary:{backIso:41,backComp:32},accessories:{chest:20,triceps:148,biceps:130,forearms:166,neck:178,calves:176,coreBack:69, hams: 125}},
      E:{primary:{triIso:155,triComp:153},accessories:{chest:11,back:22,biceps:141,forearms:157,neck:179,calves:167,coreSides:65}},
      F:{primary:{biIso:141,biComp:139},accessories:{chest:19,back:35,triceps:149,forearms:158,neck:180,calves:168,core:61, shoulders: 52}},
      G:{primary:{coreIso:61,coreComp:73},accessories:{chest:1,back:27,triceps:155,biceps:135,forearms:159,neck:181,calves:169, quads: 105}},
    },
    techniques:{
      week1:[t("F","biIso","rest_pause"),t("G","coreComp","partials")],
      week2:[t("C","chestComp","pre_exhaustion"),t("D","backIso","1_quarter_reps")],
      week3:[t("E","triIso","super_slow"),t("F","biComp","forced_reps")],
      week4:[t("G","coreIso","drop_set"),t("C","chestIso","negative_accentuated")],
      week5:[t("D","backComp","isometric_hold"),t("E","triComp","mechanical_drop_set")],
    },
  },
  { id:10, name:"Full-Range Strength",
    sessions:{
      C:{primary:{chestIso:11,chestComp:15},accessories:{back:24,triceps:146,biceps:131,forearms:166,neck:178,calves:176,coreFront:61, glutes: 87}},
      D:{primary:{backIso:42,backComp:36},accessories:{chest:1,triceps:149,biceps:129,forearms:157,neck:179,calves:167,coreBack:75, hams: 126}},
      E:{primary:{triIso:156,triComp:149},accessories:{chest:12,back:23,biceps:142,forearms:158,neck:180,calves:168,coreSides:72}},
      F:{primary:{biIso:143,biComp:142},accessories:{chest:20,back:36,triceps:151,forearms:159,neck:181,calves:169,core:62, shoulders: 53}},
      G:{primary:{coreIso:62,coreComp:74},accessories:{chest:2,back:28,triceps:156,biceps:136,forearms:160,neck:182,calves:170, quads: 106}},
    },
    techniques:{
      week1:[t("G","coreComp","negative_accentuated"),t("C","chestIso","partials")],
      week2:[t("D","backComp","pre_exhaustion"),t("E","triComp","drop_set")],
      week3:[t("F","biComp","super_slow"),t("G","coreIso","rest_pause")],
      week4:[t("C","chestComp","forced_reps"),t("D","backIso","isometric_hold")],
      week5:[t("E","triIso","1_quarter_reps"),t("F","biIso","mechanical_drop_set")],
    },
  },
  { id:11, name:"Stretch & Contract",
    sessions:{
      C:{primary:{chestIso:12,chestComp:17},accessories:{back:27,triceps:147,biceps:130,forearms:157,neck:179,calves:167,coreFront:62, glutes: 88}},
      D:{primary:{backIso:28,backComp:37},accessories:{chest:2,triceps:150,biceps:141,forearms:158,neck:180,calves:168,coreBack:76, hams: 127}},
      E:{primary:{triIso:144,triComp:150},accessories:{chest:13,back:24,biceps:143,forearms:159,neck:181,calves:169,coreSides:73}},
      F:{primary:{biIso:129,biComp:134},accessories:{chest:3,back:29,triceps:152,forearms:160,neck:182,calves:170,core:71, shoulders: 56}},
      G:{primary:{coreIso:59,coreComp:76},accessories:{chest:4,back:37,triceps:145,biceps:137,forearms:161,neck:183,calves:171, quads: 107}},
    },
    techniques:{
      week1:[t("C","chestComp","isometric_hold"),t("D","backIso","drop_set")],
      week2:[t("E","triIso","mechanical_drop_set"),t("F","biComp","super_slow")],
      week3:[t("G","coreIso","1_quarter_reps"),t("C","chestIso","forced_reps")],
      week4:[t("D","backComp","partials"),t("E","triComp","rest_pause")],
      week5:[t("F","biIso","pre_exhaustion"),t("G","coreComp","negative_accentuated")],
    },
  },
  { id:12, name:"Peak Intensity",
    sessions:{
      C:{primary:{chestIso:13,chestComp:19},accessories:{back:29,triceps:148,biceps:133,forearms:158,neck:180,calves:168,coreFront:69, glutes: 89}},
      D:{primary:{backIso:30,backComp:38},accessories:{chest:3,triceps:151,biceps:143,forearms:159,neck:181,calves:169,coreBack:42, hams: 128}},
      E:{primary:{triIso:145,triComp:153},accessories:{chest:14,back:40,biceps:139,forearms:160,neck:182,calves:170,coreSides:64}},
      F:{primary:{biIso:130,biComp:135},accessories:{chest:4,back:41,triceps:154,forearms:161,neck:183,calves:171,core:75, shoulders: 57}},
      G:{primary:{coreIso:71,coreComp:77},accessories:{chest:15,back:38,triceps:146,biceps:134,forearms:162,neck:184,calves:172, quads: 108}},
    },
    techniques:{
      week1:[t("D","backComp","1_quarter_reps"),t("E","triIso","pre_exhaustion")],
      week2:[t("F","biComp","negative_accentuated"),t("G","coreComp","isometric_hold")],
      week3:[t("C","chestIso","super_slow"),t("D","backIso","forced_reps")],
      week4:[t("E","triComp","drop_set"),t("F","biIso","rest_pause")],
      week5:[t("G","coreIso","mechanical_drop_set"),t("C","chestComp","partials")],
    },
  },
  // PROGRAM 13 — Z: Nautilus Beginner
  // ──────────────────────────────────────────────────────────
  // Key: Straight arm pullover, Bench press, Bent-over row,
  //      Overhead press, Biceps curl, Leg curl, Leg press
  {
    id: 13,
    name: "Program 13 — Beginner",
    sessions: {
      C: {
        primary:     { chestIso: 13,  chestComp: 19 },
        accessories: { back: 43, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 59 }
      },
      D: {
        primary:     { backIso: 28,  backComp: 23  },
        accessories: { chest: 3, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 144, triComp: 150 },
        accessories: { chest: 6, back: 34, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 134  },
        accessories: { chest: 11, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { legIso: 121, legComp: 97 },
        accessories: { quads: 110, back: 37, triceps: 145, biceps: 136, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [13, 19, 23, 28, 144, 129, 157, 177]
    },
    techniques: {
      week1: [ t("C","chestComp","1_quarter_reps"),       t("D","backComp","negative_accentuated") ],
      week2: [ t("E","triIso","super_slow"),               t("F","biComp","drop_set")               ],
      week3: [ t("G","legIso","isometric_hold"),          t("C","chestIso","rest_pause")           ],
      week4: [ t("D","backIso","partials"),                t("E","triComp","forced_reps")           ],
      week5: [ t("F","biIso","mechanical_drop_set"),       t("G","legComp","pre_exhaustion")       ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 14 — Y: Nautilus Expanded Beginner
  // ──────────────────────────────────────────────────────────
  // Key: Leg curl/ext/press, Pullover, Bench press, Bent-over row,
  //      Overhead press, Biceps curl, Triceps extension, Wrist curl,
  //      Standing calf raise, Trunk curl
  {
    id: 14,
    name: "Program 14 — Expanded Beginner",
    sessions: {
      C: {
        primary:     { chestIso: 9,   chestComp: 2  },
        accessories: { back: 43, triceps: 148, biceps: 132, forearms: 157, neck: 178, calves: 167, coreFront: 60 }
      },
      D: {
        primary:     { backIso: 30,  backComp: 21  },
        accessories: { chest: 4, triceps: 144, biceps: 133, forearms: 158, neck: 179, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 145, triComp: 149 },
        accessories: { chest: 7, back: 35, biceps: 130, forearms: 159, neck: 180, calves: 169, coreSides: 66 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 142  },
        accessories: { chest: 12, back: 27, triceps: 151, forearms: 160, neck: 181, calves: 170, core: 64 }
      },
      G: {
        primary:     { legIso: 122, legComp: 116 },
        accessories: { quads: 110, core: 61, triceps: 146, biceps: 135, forearms: 165, neck: 182, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [9, 2, 21, 145, 129, 157, 178, 167]
    },
    techniques: {
      week1: [ t("D","backIso","super_slow"),              t("E","triComp","1_quarter_reps")        ],
      week2: [ t("F","biIso","drop_set"),                  t("G","legComp","isometric_hold")       ],
      week3: [ t("C","chestIso","negative_accentuated"),   t("D","backComp","rest_pause")           ],
      week4: [ t("E","triIso","pre_exhaustion"),           t("F","biComp","partials")               ],
      week5: [ t("G","legIso","forced_reps"),             t("C","chestComp","mechanical_drop_set") ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 15 — X: Full-Body Power
  // ──────────────────────────────────────────────────────────
  // Key: Chest press, Split squat (L/R), Bent-over row, Deadlift,
  //      Triceps press, Biceps curl, Calf raise, Overhead press
  {
    id: 15,
    name: "Program 15 — Full-Body Power",
    sessionFocus: {
      C:{label:"FULL BODY", color:"#a78bfa"},
      D:{label:"FULL BODY", color:"#a78bfa"},
      E:{label:"FULL BODY", color:"#a78bfa"},
      F:{label:"FULL BODY", color:"#a78bfa"},
      G:{label:"FULL BODY", color:"#a78bfa"},
    },
    sessions: {
      C: {
        primary:     { chestIso: 10,  chestComp: 1  },
        accessories: { back: 44, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 59 }
      },
      D: {
        primary:     { hinge: 185, backComp: 23  },
        accessories: { chest: 3, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 144, triComp: 149 },
        accessories: { chest: 6, back: 34, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 134  },
        accessories: { chest: 11, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { legIso: 121, legComp: 102 },
        accessories: { chest: 2, back: 37, triceps: 145, biceps: 135, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [10, 1, 23, 144, 129, 157, 177, 167]
    },
    techniques: {
      week1: [ t("E","triIso","forced_reps"),              t("F","biIso","super_slow")              ],
      week2: [ t("G","legIso","1_quarter_reps"),          t("C","chestComp","isometric_hold")      ],
      week3: [ t("D","backComp","drop_set"),               t("E","triComp","rest_pause")            ],
      week4: [ t("F","biComp","negative_accentuated"),     t("G","legComp","partials")             ],
      week5: [ t("C","chestIso","mechanical_drop_set"),    t("D","hinge","pre_exhaustion")        ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 16 — W: Classic Compound
  // ──────────────────────────────────────────────────────────
  // Key: Leg curl/ext/press, Calf raise, Bench press, Bent-over row,
  //      Lateral raise, Shoulder shrug, Bent arm fly, Triceps ext,
  //      Biceps curl, Trunk curl
  {
    id: 16,
    name: "Program 16 — Classic Compound",
    sessions: {
      C: {
        primary:     { chestIso: 10,  chestComp: 14 },
        accessories: { shoulders: 48, triceps: 147, biceps: 132, forearms: 157, neck: 177, calves: 167, coreFront: 59 }
      },
      D: {
        primary:     { backIso: 29,  backComp: 25  },
        accessories: { back: 40, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 146, triComp: 150 },
        accessories: { chest: 6, back: 34, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 139  },
        accessories: { chest: 11, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { legIso: 123, legComp: 99  },
        accessories: { quads: 110, core: 60, triceps: 145, biceps: 135, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [10, 14, 25, 146, 129, 157, 177, 167]
    },
    techniques: {
      week1: [ t("F","biComp","rest_pause"),               t("G","legIso","1_quarter_reps")        ],
      week2: [ t("C","chestIso","drop_set"),               t("D","backIso","super_slow")            ],
      week3: [ t("E","triComp","mechanical_drop_set"),     t("F","biIso","negative_accentuated")    ],
      week4: [ t("G","legComp","pre_exhaustion"),         t("C","chestComp","forced_reps")         ],
      week5: [ t("D","backComp","isometric_hold"),         t("E","triIso","partials")               ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 17 — V: Posterior Chain Focus
  // ──────────────────────────────────────────────────────────
  // Key: Leg extension, Stiff-leg deadlift, Calf raise, Bent arm
  //      pullover, Incline bench press, Pulldown, Bent-over raise,
  //      Triceps extension, Negative chin-up, Negative dip,
  //      Side bend, Reverse trunk curl
  {
    id: 17,
    name: "Program 17 — Posterior Chain",
    sessions: {
      C: {
        primary:     { chestIso: 13,  chestComp: 3  },
        accessories: { back: 34, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 60 }
      },
      D: {
        primary:     { backIso: 29,  backComp: 119 },
        accessories: { chest: 39, triceps: 144, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 61 }
      },
      E: {
        primary:     { triIso: 148, triComp: 150 },
        accessories: { lats: 31, back: 35, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 132,  biComp: 142  },
        accessories: { chest: 8, back: 22, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 64 }
      },
      G: {
        primary:     { legIso: 109, legComp: 97  },
        accessories: { chest: 2, back: 37, triceps: 145, biceps: 136, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [13, 3, 29, 148, 132, 157, 177, 167]
    },
    techniques: {
      week1: [ t("G","legComp","1_quarter_reps"),         t("C","chestIso","super_slow")           ],
      week2: [ t("D","backIso","isometric_hold"),          t("E","triIso","drop_set")               ],
      week3: [ t("F","biIso","partials"),                  t("G","legIso","rest_pause")            ],
      week4: [ t("C","chestComp","negative_accentuated"),  t("D","backComp","mechanical_drop_set")  ],
      week5: [ t("E","triComp","pre_exhaustion"),          t("F","biComp","forced_reps")            ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 18 — U: Balanced Full-Body
  // ──────────────────────────────────────────────────────────
  // Key: Squat, Calf raise (standing + seated), Leg extension/curl,
  //      Prone back raise / Stiff-leg deadlift, Pulldown, Front raise,
  //      Lateral raise / Bent arm fly, Biceps curl / Triceps ext,
  //      Bench press / Bent-over row, Four-way neck
  {
    id: 18,
    name: "Program 18 — Balanced Full-Body",
    sessionFocus: {
      C:{label:"FULL BODY", color:"#a78bfa"},
      D:{label:"FULL BODY", color:"#a78bfa"},
      E:{label:"FULL BODY", color:"#a78bfa"},
      F:{label:"FULL BODY", color:"#a78bfa"},
      G:{label:"FULL BODY", color:"#a78bfa"},
    },
    sessions: {
      C: {
        primary:     { chestIso: 11,  chestComp: 19 },
        accessories: { shoulders: 47, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 59 }
      },
      D: {
        primary:     { backIso: 28,  backComp: 119 },
        accessories: { shoulders: 48, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 145, triComp: 150 },
        accessories: { chest: 6, back: 35, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 134  },
        accessories: { lats: 23, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { legIso: 110, legComp: 97  },
        accessories: { hams: 121, back: 37, triceps: 146, biceps: 135, forearms: 165, neck: 184, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [11, 19, 28, 145, 129, 157, 177, 167]
    },
    techniques: {
      week1: [ t("C","chestIso","isometric_hold"),         t("D","backComp","1_quarter_reps")       ],
      week2: [ t("E","triComp","super_slow"),              t("F","biIso","partials")                ],
      week3: [ t("G","legIso","drop_set"),                t("C","chestComp","rest_pause")          ],
      week4: [ t("D","backIso","pre_exhaustion"),          t("E","triIso","negative_accentuated")   ],
      week5: [ t("F","biComp","mechanical_drop_set"),      t("G","legComp","forced_reps")          ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 19 — T: Negative Emphasis
  // ──────────────────────────────────────────────────────────
  // Key: Leg extension, Leg press, Calf raise, Stiff-leg deadlift,
  //      Straight arm pullover, Bench press / Overhead press,
  //      Negative chin-up, Negative dip
  {
    id: 19,
    name: "Program 19 — Negative Emphasis",
    sessions: {
      C: {
        primary:     { chestIso: 13,  chestComp: 2  },
        accessories: { back: 34, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 59 }
      },
      D: {
        primary:     { backIso: 30,  backComp: 31  },
        accessories: { chest: 43, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 144, triComp: 150 },
        accessories: { chest: 6, back: 35, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 142  },
        accessories: { chest: 11, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { hinge: 119, legComp: 97  },
        accessories: { quads: 110, back: 37, triceps: 145, biceps: 135, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [13, 2, 30, 144, 129, 157, 177, 167]
    },
    techniques: {
      week1: [ t("D","backIso","partials"),                t("E","triComp","1_quarter_reps")        ],
      week2: [ t("F","biComp","super_slow"),               t("G","legComp","negative_accentuated") ],
      week3: [ t("C","chestComp","isometric_hold"),        t("D","backComp","drop_set")             ],
      week4: [ t("E","triIso","mechanical_drop_set"),      t("F","biIso","rest_pause")              ],
      week5: [ t("G","hinge","pre_exhaustion"),          t("C","chestIso","forced_reps")          ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 20 — S: Superset Pairs
  // ──────────────────────────────────────────────────────────
  // Key: Leg curl / Leg extension, Squat, Calf raise,
  //      Bench press / Negative dip, Negative chin-up / Biceps curl,
  //      Lateral raise / Bent arm fly, Overhead press / Triceps ext,
  //      Trunk curl / Reverse trunk curl
  {
    id: 20,
    name: "Program 20 — Superset Pairs",
    sessions: {
      C: {
        primary:     { chestIso: 9,   chestComp: 19 },
        accessories: { shoulders: 48, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 59 }
      },
      D: {
        primary:     { backIso: 28,  backComp: 31  },
        accessories: { chest: 43, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 61 }
      },
      E: {
        primary:     { triIso: 145, triComp: 150 },
        accessories: { chest: 6, back: 34, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 134  },
        accessories: { chest: 11, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { legIso: 121, legComp: 97  },
        accessories: { quads: 110, core: 60, triceps: 146, biceps: 135, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [9, 19, 28, 145, 129, 157, 177, 167]
    },
    techniques: {
      week1: [ t("E","triIso","super_slow"),               t("F","biComp","1_quarter_reps")         ],
      week2: [ t("G","legComp","drop_set"),               t("C","chestComp","isometric_hold")      ],
      week3: [ t("D","backIso","negative_accentuated"),    t("E","triComp","partials")              ],
      week4: [ t("F","biIso","rest_pause"),                t("G","legIso","mechanical_drop_set")   ],
      week5: [ t("C","chestIso","pre_exhaustion"),         t("D","backComp","forced_reps")          ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 21 — R: Strength Essentials
  // ──────────────────────────────────────────────────────────
  // Key: Stiff-leg deadlift, Leg extension, Leg curl,
  //      Straight arm pullover, Biceps curl, Triceps pushdown,
  //      Reverse curl
  {
    id: 21,
    name: "Program 21 — Strength Essentials",
    sessions: {
      C: {
        primary:     { chestIso: 13,  chestComp: 5  },
        accessories: { back: 34, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 60 }
      },
      D: {
        primary:     { backIso: 29,  backComp: 119 },
        accessories: { chest: 3, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 144, triComp: 149 },
        accessories: { chest: 6, back: 35, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 68 }
      },
      F: {
        primary:     { biIso: 129,  biComp: 134  },
        accessories: { chest: 11, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { legIso: 121, legComp: 115 },
        accessories: { chest: 2, back: 37, triceps: 145, biceps: 135, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [13, 5, 29, 144, 129, 157, 177, 167]
    },
    techniques: {
      week1: [ t("F","biIso","1_quarter_reps"),            t("G","legComp","super_slow")           ],
      week2: [ t("C","chestComp","partials"),              t("D","backIso","drop_set")              ],
      week3: [ t("E","triIso","rest_pause"),               t("F","biComp","isometric_hold")         ],
      week4: [ t("G","legIso","negative_accentuated"),    t("C","chestIso","mechanical_drop_set")  ],
      week5: [ t("D","backComp","pre_exhaustion"),         t("E","triComp","forced_reps")           ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 22 — Q: Minimalist Strength
  // ──────────────────────────────────────────────────────────
  // Key: Squat, Calf raise, Lateral raise, Negative chin-up,
  //      Negative dip, Shoulder shrug, Trunk curl
  {
    id: 22,
    name: "Program 22 — Minimalist Strength",
    sessions: {
      C: {
        primary:     { chestIso: 12,  chestComp: 1  },
        accessories: { back: 48, triceps: 147, biceps: 131, forearms: 157, neck: 177, calves: 167, coreFront: 59 }
      },
      D: {
        primary:     { backIso: 28,  backComp: 31  },
        accessories: { back: 40, triceps: 148, biceps: 133, forearms: 158, neck: 178, calves: 168, coreBack: 42 }
      },
      E: {
        primary:     { triIso: 144, triComp: 150 },
        accessories: { chest: 6, back: 34, biceps: 130, forearms: 159, neck: 179, calves: 169, coreSides: 72 }
      },
      F: {
        primary:     { biIso: 132,  biComp: 139  },
        accessories: { chest: 11, back: 26, triceps: 152, forearms: 160, neck: 180, calves: 170, core: 63 }
      },
      G: {
        primary:     { coreIso: 60,  legComp: 97  },
        accessories: { chest: 2, back: 37, triceps: 145, biceps: 135, forearms: 165, neck: 181, calves: 171 }
      },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [12, 1, 28, 144, 132, 157, 177, 167]
    },
    techniques: {
      week1: [ t("G","coreIso","1_quarter_reps"),          t("C","chestIso","super_slow")           ],
      week2: [ t("D","backComp","isometric_hold"),         t("E","triIso","drop_set")               ],
      week3: [ t("F","biIso","negative_accentuated"),      t("G","legComp","rest_pause")           ],
      week4: [ t("C","chestComp","forced_reps"),           t("D","backIso","mechanical_drop_set")   ],
      week5: [ t("E","triComp","partials"),                t("F","biComp","pre_exhaustion")         ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 23 — Big Five (Body by Science)
  // Full-body HIT: Chest Press, Lat Pulldown, Bent-Over Row,
  // Band Squat, Overhead Press — all sessions identical.
  {
    id: 23,
    name: "Program 23 — Big Five (Body by Science)",
    sessionFocus: {
      C:{label:"FULL BODY", color:"#a78bfa"},
      D:{label:"FULL BODY", color:"#a78bfa"},
      E:{label:"FULL BODY", color:"#a78bfa"},
      F:{label:"FULL BODY", color:"#a78bfa"},
      G:{label:"FULL BODY", color:"#a78bfa"},
    },
    sessions: {
      C: { primary:{chestComp:1,backComp:28}, accessories:{back:23,legComp:97,shoulderComp:43} },
      D: { primary:{chestComp:1,backComp:28}, accessories:{back:23,legComp:97,shoulderComp:43} },
      E: { primary:{chestComp:1,backComp:28}, accessories:{back:23,legComp:97,shoulderComp:43} },
      F: { primary:{chestComp:1,backComp:28}, accessories:{back:23,legComp:97,shoulderComp:43} },
      G: { primary:{chestComp:1,backComp:28}, accessories:{back:23,legComp:97,shoulderComp:43} },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [1, 28, 23, 97, 43]
    },
    techniques: {
      week1: [ t("C","chestComp","m_set"),               t("D","backComp","super_slow")           ],
      week2: [ t("E","legComp","1_quarter_reps"),         t("F","back","drop_set")                ],
      week3: [ t("G","shoulderComp","rest_pause"),        t("C","backComp","negative_accentuated") ],
      week4: [ t("D","chestComp","isometric_hold"),       t("E","back","mechanical_drop_set")     ],
      week5: [ t("F","legComp","pre_exhaustion"),         t("G","shoulderComp","forced_reps")     ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 24 — 30-10-30 (Ellington Darden)
  // Full-body HIT: Band Squat, Front Squat, Chest Press,
  // Overhead Press, Bent-Over Row, Biceps Curl — all sessions identical.
  // Protocol: 30s super-slow negative → 10 full reps → 30s super-slow negative.
  {
    id: 24,
    name: "Program 24 — 30-10-30 (Ellington Darden)",
    sessionFocus: {
      C:{label:"FULL BODY", color:"#a78bfa"},
      D:{label:"FULL BODY", color:"#a78bfa"},
      E:{label:"FULL BODY", color:"#a78bfa"},
      F:{label:"FULL BODY", color:"#a78bfa"},
      G:{label:"FULL BODY", color:"#a78bfa"},
    },
    sessions: {
      C: { primary:{chestComp:1,backComp:23}, accessories:{legComp:97,legIso:98,shoulderComp:43,biceps:129} },
      D: { primary:{chestComp:1,backComp:23}, accessories:{legComp:97,legIso:98,shoulderComp:43,biceps:129} },
      E: { primary:{chestComp:1,backComp:23}, accessories:{legComp:97,legIso:98,shoulderComp:43,biceps:129} },
      F: { primary:{chestComp:1,backComp:23}, accessories:{legComp:97,legIso:98,shoulderComp:43,biceps:129} },
      G: { primary:{chestComp:1,backComp:23}, accessories:{legComp:97,legIso:98,shoulderComp:43,biceps:129} },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [1, 23, 97, 98, 43, 129]
    },
    techniques: {
      week1: [ t("C","chestComp","30_10_30"),    t("D","backComp","30_10_30")      ],
      week2: [ t("E","legComp","30_10_30"),       t("F","legIso","30_10_30")       ],
      week3: [ t("G","shoulderComp","30_10_30"),  t("C","biceps","30_10_30")       ],
      week4: [ t("D","chestComp","30_10_30"),     t("E","backComp","30_10_30")     ],
      week5: [ t("F","legComp","30_10_30"),       t("G","shoulderComp","30_10_30") ],
    },
  },

  // ──────────────────────────────────────────────────────────
  // PROGRAM 25 — Original X (Full Body) — Greg's original X routine.
  // Chest Press, Split Squat (L/R), Bent-Over Row, Deadlift, Triceps
  // Press, Drag Curl, Calf Raise, Overhead Press. Same full-body
  // workout every session (all sessions identical, like Big Five).
  // ──────────────────────────────────────────────────────────
  {
    id: 25,
    name: "Program 25 — Original X (Full Body)",
    sessionFocus: {
      C:{label:"FULL BODY", color:"#22d3ee"},
      D:{label:"FULL BODY", color:"#22d3ee"},
      E:{label:"FULL BODY", color:"#22d3ee"},
      F:{label:"FULL BODY", color:"#22d3ee"},
      G:{label:"FULL BODY", color:"#22d3ee"},
    },
    sessions: {
      C: { primary:{chestComp:1,hinge:185}, accessories:{legComp:102,backComp:23,shoulderComp:43,triceps:149,biceps:135,calves:167} },
      D: { primary:{chestComp:1,hinge:185}, accessories:{legComp:102,backComp:23,shoulderComp:43,triceps:149,biceps:135,calves:167} },
      E: { primary:{chestComp:1,hinge:185}, accessories:{legComp:102,backComp:23,shoulderComp:43,triceps:149,biceps:135,calves:167} },
      F: { primary:{chestComp:1,hinge:185}, accessories:{legComp:102,backComp:23,shoulderComp:43,triceps:149,biceps:135,calves:167} },
      G: { primary:{chestComp:1,hinge:185}, accessories:{legComp:102,backComp:23,shoulderComp:43,triceps:149,biceps:135,calves:167} },
    },
    deload: {
      note: "Week 6 — 3 sessions at ≤50% intensity. No high-intensity techniques.",
      exercises: [1, 185, 102, 23, 43, 149, 135, 167]
    },
    techniques: {
      week1: [ t("C","chestComp","super_slow"),        t("D","hinge","rest_pause")            ],
      week2: [ t("E","backComp","drop_set"),           t("F","shoulderComp","1_quarter_reps") ],
      week3: [ t("G","legComp","rest_pause"),          t("C","triceps","forced_reps")         ],
      week4: [ t("D","biceps","negative_accentuated"), t("E","calves","partials")             ],
      week5: [ t("F","chestComp","mechanical_drop_set"),t("G","hinge","pre_exhaustion")       ],
    },
  },

];

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP HELPERS
// ─────────────────────────────────────────────────────────────────────────────
export const SESSION_FOCUS = {
  C:{label:"CHEST DAY",   color:"#00d4ff"},
  D:{label:"BACK DAY",    color:"#22c55e"},
  E:{label:"TRICEPS DAY", color:"#f59e0b"},
  F:{label:"BICEPS DAY",  color:"#f97316"},
  G:{label:"CORE + LEGS DAY",    color:"#ec4899"},
};
export function getSessionFocus(prog, sKey) {
  return (prog && prog.sessionFocus && prog.sessionFocus[sKey])
    ? prog.sessionFocus[sKey]
    : (SESSION_FOCUS[sKey] || {label:sKey, color:"#00d4ff"});
}

export const SLOT_LABELS = {
  chestIso:"Chest ISO", chestComp:"Chest CMP",
  backIso:"Back ISO",   backComp:"Back CMP",
  triIso:"Tri ISO",     triComp:"Tri CMP",
  biIso:"Bi ISO",       biComp:"Bi ISO-2",
  coreIso:"Core ISO",   coreComp:"Core CMP",
  back:"Back", chest:"Chest", triceps:"Triceps", biceps:"Biceps",
  forearms:"Forearms", neck:"Neck", calves:"Calves",
  coreFront:"Core Front", coreBack:"Core Back",
  coreSides:"Core Sides", core:"Core",
  legComp:"Legs CMP", legIso:"Legs ISO", shoulderComp:"Shoulders CMP",
  hinge:"Hinge CMP",
  quads:"Quads",
  hams:"Hamstrings",
  glutes:"Glutes",
  shoulders:"Shoulders",
  lats:"Lats",
};

export const exGroup = (id) => {
  if (id<=20)  return {label:"CHEST",     color:"#00d4ff"};
  if (id<=42)  return {label:"BACK",      color:"#22c55e"};
  if (id<=58)  return {label:"SHOULDERS", color:"#60a5fa"};
  if (id<=77)  return {label:"CORE",      color:"#ec4899"};
  if (id<=96)  return {label:"GLUTES",    color:"#c084fc"};
  if (id<=116) return {label:"QUADS",     color:"#f97316"};
  if (id<=128) return {label:"HAMSTRINGS",color:"#fb923c"};
  if (id<=143) return {label:"BICEPS",    color:"#4ade80"};
  if (id<=156) return {label:"TRICEPS",   color:"#f59e0b"};
  if (id<=166) return {label:"FOREARMS",  color:"#94a3b8"};
  if (id<=176) return {label:"CALVES",    color:"#38bdf8"};
  if (id<=184) return {label:"NECK",      color:"#f87171"};
  if (id<=202) return {label:"FULL BODY", color:"#00d4ff"};
  return              {label:"MOBILITY",  color:"#86efac"};
};

export const ALL_GROUPS = ["All","CHEST","BACK","SHOULDERS","CORE","GLUTES","QUADS",
  "HAMSTRINGS","BICEPS","TRICEPS","FOREARMS","CALVES","NECK","FULL BODY","MOBILITY"];

// ─────────────────────────────────────────────────────────────────────────────
// BANDS — 103 bands, 6 brands
// ─────────────────────────────────────────────────────────────────────────────
export const BANDS = [
  {id:"b0",  brand:"Serious Steel",color:"Orange",    model:"#0",        lengthIn:12,res:"2-15"},
  {id:"b1",  brand:"Serious Steel",color:"Purple",    model:"#1",        lengthIn:12,res:"5-35"},
  {id:"b2",  brand:"Serious Steel",color:"Red",       model:"#2",        lengthIn:12,res:"10-50"},
  {id:"b3",  brand:"Serious Steel",color:"Blue",      model:"#3",        lengthIn:12,res:"25-80"},
  {id:"b4",  brand:"Serious Steel",color:"Green",     model:"#4",        lengthIn:12,res:"50-120"},
  {id:"b5",  brand:"Serious Steel",color:"Purple",    model:"#1",        lengthIn:20,res:"10-25"},
  {id:"b6",  brand:"Serious Steel",color:"Red",       model:"#2",        lengthIn:20,res:"15-40"},
  {id:"b7",  brand:"Serious Steel",color:"Blue",      model:"#3",        lengthIn:20,res:"20-50"},
  {id:"b8",  brand:"Serious Steel",color:"Green",     model:"#4",        lengthIn:20,res:"40-100"},
  {id:"b9",  brand:"Serious Steel",color:"Black",     model:"#5",        lengthIn:20,res:"55-140"},
  {id:"b10", brand:"Serious Steel",color:"Orange",    model:"#0",        lengthIn:32,res:"2-15"},
  {id:"b11", brand:"Serious Steel",color:"Purple",    model:"#1",        lengthIn:32,res:"5-35"},
  {id:"b12", brand:"Serious Steel",color:"Red",       model:"#2",        lengthIn:32,res:"10-50"},
  {id:"b13", brand:"Serious Steel",color:"Blue",      model:"#3",        lengthIn:32,res:"25-80"},
  {id:"b14", brand:"Serious Steel",color:"Green",     model:"#4",        lengthIn:32,res:"50-120"},
  {id:"b15", brand:"Serious Steel",color:"Black",     model:"#5",        lengthIn:32,res:"60-150"},
  {id:"b16", brand:"Serious Steel",color:"Yellow",    model:"#6",        lengthIn:32,res:"80-200"},
  {id:"b17", brand:"Serious Steel",color:"Gray",      model:"#6.5",      lengthIn:32,res:"115-290"},
  {id:"b18", brand:"Serious Steel",color:"Orange",    model:"#0",        lengthIn:37,res:"2-15"},
  {id:"b19", brand:"Serious Steel",color:"Purple",    model:"#1",        lengthIn:37,res:"5-35"},
  {id:"b20", brand:"Serious Steel",color:"Red",       model:"#2",        lengthIn:37,res:"10-50"},
  {id:"b21", brand:"Serious Steel",color:"Blue",      model:"#3",        lengthIn:37,res:"25-80"},
  {id:"b22", brand:"Serious Steel",color:"Green",     model:"#4",        lengthIn:37,res:"50-120"},
  {id:"b23", brand:"Serious Steel",color:"Black",     model:"#5",        lengthIn:37,res:"60-150"},
  {id:"b24", brand:"Serious Steel",color:"Yellow",    model:"#6",        lengthIn:37,res:"80-200"},
  {id:"b25", brand:"Serious Steel",color:"Gray",      model:"#6.5",      lengthIn:37,res:"115-290"},
  {id:"b26", brand:"Serious Steel",color:"Orange",    model:"#0",        lengthIn:41,res:"2-15"},
  {id:"b27", brand:"Serious Steel",color:"Purple",    model:"#1",        lengthIn:41,res:"5-35"},
  {id:"b28", brand:"Serious Steel",color:"Red",       model:"#2",        lengthIn:41,res:"10-50"},
  {id:"b29", brand:"Serious Steel",color:"Blue",      model:"#3",        lengthIn:41,res:"25-80"},
  {id:"b30", brand:"Serious Steel",color:"Green",     model:"#4",        lengthIn:41,res:"50-120"},
  {id:"b31", brand:"Serious Steel",color:"Black",     model:"#5",        lengthIn:41,res:"60-150"},
  {id:"b32", brand:"Serious Steel",color:"Yellow",    model:"#6",        lengthIn:41,res:"80-200"},
  {id:"b33", brand:"Serious Steel",color:"Gray",      model:"#6.5",      lengthIn:41,res:"115-290"},
  {id:"b34", brand:"Serious Steel",color:"Orange",    model:"#7 Mega",   lengthIn:41,res:"120-300+"},
  {id:"b35", brand:"Harambe",      color:"Yellow",    model:"1/4in wide",lengthIn:38,res:"10-20"},
  {id:"b36", brand:"Harambe",      color:"White",     model:"1/2in wide",lengthIn:38,res:"20-40"},
  {id:"b37", brand:"Harambe",      color:"Lt Green",  model:"1in wide",  lengthIn:38,res:"40-80"},
  {id:"b38", brand:"Harambe",      color:"Hvy Green", model:"2in wide",  lengthIn:38,res:"80-160"},
  {id:"b39", brand:"Harambe",      color:"Black",     model:"2.5in wide",lengthIn:38,res:"100-200"},
  {id:"b103",brand:"Harambe",      color:"Orange",    model:"Deficit 1/4in",lengthIn:38,res:"5-10"},
  {id:"b40", brand:"X3",           color:"White UL",  model:"Ultra Light",lengthIn:41,res:"<10-30"},
  {id:"b41", brand:"X3",           color:"White",     model:"Standard",  lengthIn:41,res:"10-50+"},
  {id:"b42", brand:"X3",           color:"Lt Grey",   model:"Standard",  lengthIn:41,res:"25-80+"},
  {id:"b43", brand:"X3",           color:"Dk Grey",   model:"Standard",  lengthIn:41,res:"50-120+"},
  {id:"b44", brand:"X3",           color:"Black",     model:"Standard",  lengthIn:41,res:"60-150+"},
  {id:"b45", brand:"X3",           color:"Orange",    model:"Elite",     lengthIn:41,res:"110-300+"},
  {id:"b104",brand:"X3",           color:"Orange",    model:"PF Gen2 Elite",   lengthIn:41,res:"120-300+"},
  {id:"b105",brand:"X3",           color:"Orange",    model:"PF Gen2 UL",      lengthIn:41,res:"<5-20"},
  {id:"b46", brand:"X3",           color:"White",     model:"Short Set", lengthIn:34,res:"10-50+"},
  {id:"b47", brand:"X3",           color:"Lt Grey",   model:"Short Set", lengthIn:34,res:"25-80+"},
  {id:"b48", brand:"X3",           color:"Dk Grey",   model:"Short Set", lengthIn:34,res:"50-120+"},
  {id:"b49", brand:"X3",           color:"Black",     model:"Short Set", lengthIn:34,res:"60-150+"},
  {id:"b50", brand:"X3",           color:"White UL",  model:"Gen2 Perf", lengthIn:41,res:"<10-30"},
  {id:"b51", brand:"X3",           color:"White",     model:"Gen2 Perf", lengthIn:41,res:"10-50+"},
  {id:"b52", brand:"X3",           color:"Lt Grey",   model:"Gen2 Perf", lengthIn:41,res:"25-80+"},
  {id:"b53", brand:"X3",           color:"Dk Grey",   model:"Gen2 Perf", lengthIn:41,res:"50-120+"},
  {id:"b54", brand:"X3",           color:"Black",     model:"Gen2 Perf", lengthIn:41,res:"60-150+"},
  {id:"b55", brand:"Clench",       color:"Orange",    model:"Light",     lengthIn:34,res:"5-15"},
  {id:"b56", brand:"Clench",       color:"Red",       model:"Light",     lengthIn:34,res:"15-35"},
  {id:"b57", brand:"Clench",       color:"Black",     model:"Medium",    lengthIn:34,res:"35-75"},
  {id:"b58", brand:"Clench",       color:"Purple",    model:"Heavy",     lengthIn:34,res:"50-100"},
  {id:"b59", brand:"Clench",       color:"Green",     model:"XH",        lengthIn:34,res:"75-150"},
  {id:"b60", brand:"Clench",       color:"Blue",      model:"XXH",       lengthIn:34,res:"90-230"},
  {id:"b61", brand:"Clench",       color:"Org Heavy", model:"Monster",   lengthIn:34,res:"110-300"},
  {id:"b62", brand:"Clench",       color:"Grey",      model:"Mega",      lengthIn:34,res:"150-400"},
  {id:"b63", brand:"Clench",       color:"Orange",    model:"Light",     lengthIn:41,res:"5-15"},
  {id:"b64", brand:"Clench",       color:"Red",       model:"Light",     lengthIn:41,res:"15-35"},
  {id:"b65", brand:"Clench",       color:"Black",     model:"Medium",    lengthIn:41,res:"35-75"},
  {id:"b66", brand:"Clench",       color:"Purple",    model:"Heavy",     lengthIn:41,res:"50-100"},
  {id:"b67", brand:"Clench",       color:"Green",     model:"XH",        lengthIn:41,res:"75-150"},
  {id:"b68", brand:"Clench",       color:"Blue",      model:"XXH",       lengthIn:41,res:"90-230"},
  {id:"b69", brand:"Clench",       color:"Org Heavy", model:"Monster",   lengthIn:41,res:"110-300"},
  {id:"b70", brand:"Clench",       color:"Grey",      model:"Mega",      lengthIn:41,res:"150-400"},
  {id:"b71", brand:"Quantum",      color:"Orange",    model:"Micro",      lengthIn:13,res:"5-30"},
  {id:"b72", brand:"Quantum",      color:"Yellow",    model:"Super Micro",lengthIn:13,res:"10-40"},
  {id:"b73", brand:"Quantum",      color:"Red",       model:"Mini",       lengthIn:13,res:"15-55"},
  {id:"b74", brand:"Quantum",      color:"Orange",    model:"Micro",      lengthIn:41,res:"5-30"},
  {id:"b75", brand:"Quantum",      color:"Yellow",    model:"Super Micro",lengthIn:41,res:"10-40"},
  {id:"b76", brand:"Quantum",      color:"Red",       model:"Mini",       lengthIn:41,res:"15-55"},
  {id:"b77", brand:"Quantum",      color:"Black",     model:"Medium",     lengthIn:41,res:"20-85"},
  {id:"b78", brand:"Quantum",      color:"Purple",    model:"Large",      lengthIn:41,res:"30-115"},
  {id:"b79", brand:"Quantum",      color:"Green",     model:"XL",         lengthIn:41,res:"40-180"},
  {id:"b80", brand:"Quantum",      color:"Blue",      model:"XXL",        lengthIn:41,res:"65-230"},
  {id:"b81", brand:"Quantum",      color:"Gray",      model:"XXXL",       lengthIn:41,res:"110-300"},
  {id:"b82", brand:"Quantum",      color:"Black",     model:"Mega",       lengthIn:41,res:"150-400"},
  {id:"b83", brand:"Quantum",      color:"Orange",    model:"Thunder",   lengthIn:73,res:"5-30"},
  {id:"b84", brand:"Quantum",      color:"Yellow",    model:"Thunder",   lengthIn:73,res:"10-40"},
  {id:"b85", brand:"Quantum",      color:"Red",       model:"Thunder",   lengthIn:73,res:"15-55"},
  {id:"b86", brand:"Quantum",      color:"Black",     model:"Thunder",   lengthIn:73,res:"20-85"},
  {id:"b87", brand:"Quantum",      color:"Purple",    model:"Thunder",   lengthIn:73,res:"30-115"},
  {id:"b88", brand:"Quantum",      color:"Green",     model:"Thunder",   lengthIn:73,res:"40-180"},
  {id:"b89", brand:"Quantum",      color:"Blue",      model:"Thunder",   lengthIn:73,res:"65-230"},
  {id:"b90", brand:"Quantum",      color:"Gray",      model:"Thunder",   lengthIn:73,res:"110-300"},
  {id:"b91", brand:"HeavyDutyBar", color:"Yellow",    model:"PO 1/4in",  lengthIn:41,res:"~5-25"},
  {id:"b92", brand:"HeavyDutyBar", color:"Red",       model:"PO 1/2in",  lengthIn:41,res:"~15-50"},
  {id:"b93", brand:"HeavyDutyBar", color:"Blue",      model:"PO 1-1/8in",lengthIn:41,res:"~30-90"},
  {id:"b94", brand:"HeavyDutyBar", color:"Black",     model:"PO 1-3/4in",lengthIn:41,res:"~55-130"},
  {id:"b95", brand:"HeavyDutyBar", color:"Green",     model:"PO 3-1/4in",lengthIn:41,res:"~90-200"},
  {id:"b96", brand:"HeavyDutyBar", color:"White",     model:"PO 4in",    lengthIn:41,res:"~120-300+"},
  {id:"b97", brand:"HeavyDutyBar", color:"Purple",    model:"Monster",   lengthIn:38,res:"~65-160"},
  {id:"b98", brand:"HeavyDutyBar", color:"Yellow",    model:"Travel",    lengthIn:41,res:"~5-20"},
  {id:"b99", brand:"HeavyDutyBar", color:"Red",       model:"Travel",    lengthIn:41,res:"~10-35"},
  {id:"b100",brand:"HeavyDutyBar", color:"Black",     model:"Travel",    lengthIn:41,res:"~25-70"},
  {id:"b101",brand:"HeavyDutyBar", color:"Purple",    model:"Travel",    lengthIn:41,res:"~40-100"},
  {id:"b102",brand:"HeavyDutyBar", color:"Green",     model:"Travel",    lengthIn:41,res:"~60-150"},
];

export const COLOR_HEX = {
  "Orange":"#f97316","Purple":"#a855f7","Red":"#ef4444","Blue":"#3b82f6",
  "Green":"#22c55e","Black":"#4b5563","Yellow":"#eab308","Gray":"#9ca3af",
  "Grey":"#9ca3af","White":"#f1f5f9","Lt Grey":"#d1d5db","Dk Grey":"#6b7280",
  "Lt Green":"#86efac","Hvy Green":"#15803d","Org Heavy":"#ea580c",
  "White UL":"#ecfdf5",
};

export const BAND_BRANDS = ["All","Serious Steel","Harambe","X3","Clench","Quantum","HeavyDutyBar"];

// ─────────────────────────────────────────────────────────────────────────────
// GEAR INVENTORY
// ─────────────────────────────────────────────────────────────────────────────
export const GEAR = [
  { brand:"Harambe", items:[
    {name:"T Bar",qty:1,status:"owned"},{name:"Cyberplate",qty:1,status:"owned"},
    {name:"Handles",qty:2,status:"owned"},{name:"Rods",qty:2,status:"owned"},
    {name:"Black Ropes",qty:1,status:"owned",note:"set"},{name:"White Ropes",qty:1,status:"owned",note:"set"},
    {name:"Split Squat Belt",qty:1,status:"owned"},{name:"Wedges",qty:2,status:"owned"},
    {name:"Foam Block",qty:1,status:"owned"},
  ]},
  { brand:"X3 Bar", items:[
    {name:"Steel Ground Plate",qty:1,status:"owned"},{name:"Squat Belt (Medium)",qty:1,status:"owned"},
    {name:"Elite Bar",qty:1,status:"owned"},{name:"Force Bar",qty:1,status:"owned"},
  ]},
  { brand:"Clench", items:[
    {name:"Carbon Pro Bar",qty:1,status:"owned"},{name:"Handles",qty:2,status:"owned"},
    {name:"Heavy Duty Anchors",qty:2,status:"owned"},{name:"Footplate",qty:1,status:"owned"},
    {name:"Carbon EZ Bar",qty:1,status:"owned",note:""},
  ]},
  { brand:"Serious Steel", items:[
    {name:"Acacia Training Platform",qty:1,status:"owned"},{name:"Wrist Wraps",qty:2,status:"owned",note:"pairs"},
    {name:"Door Anchor",qty:1,status:"owned"},{name:"Large Band Guard",qty:1,status:"owned"},
  ]},
  { brand:"HeavyDutyBar", items:[
    {name:"Bantam Bar",qty:1,status:"owned"},{name:"Qlaw Handles",qty:2,status:"owned"},
    {name:"Qdeck",qty:1,status:"preorder",note:"In transit"},{name:"Tension Master",qty:1,status:"owned",note:"PO"},
    {name:"Elevators",qty:2,status:"owned"},
  ]},
];

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
export const SCHED_DAYS = { MWF:[1,3,5], TTS:[2,4,6] };

export function countWkDays(startStr, days, upTo) {
  const s = new Date(startStr + "T00:00:00");
  const e = new Date(upTo); e.setHours(0,0,0,0);
  let n = 0;
  const d = new Date(s);
  while (d <= e) {
    if (days.includes(d.getDay())) n++;
    d.setDate(d.getDate()+1);
  }
  return n;
}

export function nextWkDay(from, days) {
  const d = new Date(from);
  for (let i=1; i<=7; i++) {
    d.setDate(d.getDate()+1);
    if (days.includes(d.getDay())) return new Date(d);
  }
}

export function calcToday(startStr, sched, pi) {
  const days = SCHED_DAYS[sched];
  const today = new Date(); today.setHours(0,0,0,0);
  const isWk = days.includes(today.getDay());
  if (isWk) {
    const n = countWkDays(startStr, days, today);
    const idx = n - 1;
    return { isWk:true, session:["C","D","E","F","G"][idx%5],
             week:Math.min(Math.floor(idx/3)+1,6), num:n, prog:PROGRAMS[pi] };
  } else {
    const next = nextWkDay(today, days);
    const n2 = countWkDays(startStr, days, next);
    const idx2 = n2 - 1;
    return { isWk:false, nextDate:next, session:["C","D","E","F","G"][idx2%5],
             week:Math.min(Math.floor(idx2/3)+1,6), prog:PROGRAMS[pi] };
  }
}


// ─── TECHNIQUE SCHEDULER ─────────────────────────────────────────────────────
// Techniques are prescribed per (week, session), but the rotation means each
// week only contains 3 of 5 sessions. Remap every prescribed technique onto
// the real occurrence of its session closest to its prescribed week.
const SESSION_KEYS = ["C","D","E","F","G"];
const TECH_SCHEDULES = {};
export function buildTechSchedule(prog) {
  if (TECH_SCHEDULES[prog.id]) return TECH_SCHEDULES[prog.id];
  const slots = new Array(15).fill(null);
  const weekCount = wk => { let n=0; for (let i=(wk-1)*3;i<wk*3;i++) if (slots[i]) n++; return n; };
  for (let w = 1; w <= 5; w++) {
    (prog.techniques[`week${w}`] || []).forEach(t => {
      let best = -1, bestScore = Infinity;
      for (let idx = 0; idx < 15; idx++) {
        if (slots[idx]) continue;
        if (SESSION_KEYS[idx % 5] !== t.session) continue;
        const wk = Math.floor(idx / 3) + 1;
        const score = Math.abs(wk - w) * 10 + weekCount(wk) * 30 + wk;
        if (score < bestScore) { bestScore = score; best = idx; }
      }
      if (best >= 0) slots[best] = { session:t.session, slot:t.slot, technique:t.technique, prescribedWeek:w };
    });
  }
  TECH_SCHEDULES[prog.id] = slots;
  return slots;
}
export function getTechMap(prog, week, sKey) {
  const map = {};
  if (week === 6 || week < 1) return map;
  const sched = buildTechSchedule(prog);
  for (let idx = (week-1)*3; idx < (week-1)*3+3 && idx < 15; idx++) {
    const a = sched[idx];
    if (a && SESSION_KEYS[idx % 5] === sKey) map[a.slot] = a.technique;
  }
  return map;
}
export function getWeekTechniques(prog, week) {
  if (week === 6 || week < 1) return [];
  const sched = buildTechSchedule(prog);
  const out = [];
  for (let idx = (week-1)*3; idx < (week-1)*3+3 && idx < 15; idx++) {
    if (sched[idx]) out.push(sched[idx]);
  }
  return out;
}

export const PROG_REPS = 12;
