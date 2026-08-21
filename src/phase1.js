/* Phase 1 schema/migration — ESM wrapper (generated from phase1_schema_migration.js).
   CommonJS branch removed; always assigns globalThis.RBTS_PHASE1. */
/* ============================================================================
 * fitness_app — Phase 1: schema config, read-time upcasters, profile migration
 * ----------------------------------------------------------------------------
 * Goal of Phase 1 (per SPEC_v2_roadmap.md): introduce the v2 data foundations
 * WITHOUT changing any visible behavior. Existing logs/programs must render
 * identically; backup/restore must keep working.
 *
 * Two hard rules this file obeys:
 *   1. Decision #3 — leave logged HISTORY as-is. We NEVER rewrite the contents
 *      of stored log entries. Old sets are normalized at READ time only.
 *      "No schemaVersion on an entry" simply means v1; the normalizer handles it.
 *   2. The storage migration is ADDITIVE, IDEMPOTENT and NON-DESTRUCTIVE.
 *      It copies flat `rbts_*` keys into a namespaced `greg` profile and leaves
 *      the originals in place so current code + backup/restore keep working
 *      until later phases switch the readers over.
 *
 * Works in the browser (uses localStorage by default) and under Node for the
 * self-tests at the bottom (pass a mock store). No build step, no imports.
 * ==========================================================================*/
(function (root) {
  "use strict";

  /* ---- schema versions -------------------------------------------------- */
  var SCHEMA = {
    logEntry: 2,   // entries WRITTEN going forward carry schemaVersion:2.
    program:  2,   // absence of schemaVersion ⇒ treat as v1 and normalize on read.
    profile:  1,
  };

  /* ======================================================================
   * 1. INTENSIFIER REGISTRY
   *    `alters` drives normalization:
   *      "resistance" → uses segments; volume-load sums naturally; reps NOT inflated
   *      "rom_tempo"  → same bands/reps, apply sseMultiplier to get straight-set-equiv
   *      "density"    → uses segments + short intra-set rest; flag high fatigue
   * ==================================================================== */
  var INTENSIFIERS = {
    // alters: how the technique changes the stimulus → drives normalization.
    //   "none"       straight set
    //   "rom_tempo"  same bands+reps, more stimulus/rep → apply sseMultiplier
    //   "resistance" bands change mid-set → log segments; volume-load sums honestly
    //   "density"    reps split by short rests past failure → log segments
    //   "isometric"  timed hold → log seconds (not rep-multiplied)
    //   "sequence"   a pairing/order effect across exercises (a tag, not a per-set math)
    // sseMultiplier values are explicit, tunable PROXIES for trend tracking — not physiology truth.
    // `order` leads the picker with Greg's most-used; lower = higher in the list.
    straight:        { label: "Straight Set",          alters: "none",      sseMultiplier: 1.0,  jointFriendly: true,  minExperience: "novice",       order: 0 },
    one_and_quarter: { label: "1¼ Reps",               alters: "rom_tempo", sseMultiplier: 1.25, jointFriendly: true,  minExperience: "intermediate", order: 1 },
    drop_set:        { label: "Drop Set",              alters: "resistance", usesSegments: true,                       minExperience: "intermediate", order: 2 },
    rest_pause:      { label: "Rest-Pause",            alters: "density",    usesSegments: true,                       minExperience: "intermediate", order: 3 },
    tempo:           { label: "Slow Eccentric",        alters: "rom_tempo", sseMultiplier: 1.15, jointFriendly: true,  minExperience: "novice",       order: 4, params: { eccentricSec: 4 } },
    super_slow_ecc:  { label: "Super-Slow Eccentric",  alters: "rom_tempo", sseMultiplier: 1.35, jointFriendly: true,  minExperience: "intermediate", order: 5, params: { eccentricSec: 10 } },
    m_set:           { label: "M-Set",                 alters: "rom_tempo", sseMultiplier: 2.5, jointFriendly: true,   minExperience: "advanced",     order: 6, note: "multi-partial single rep: full + 1/4 + 1/2 + 3/4 returns; large TUT/rep (proxy ×2.5)" },
    thirty_ten_thirty:{ label: "30-10-30",            alters: "density",    usesSegments: true,                       minExperience: "intermediate", order: 7, note: "30s eccentric + mid reps + 30s eccentric; log time-based bookend segments" },
    iso_hold:        { label: "Isometric Hold",        alters: "isometric", timeBased: true,                          minExperience: "novice",       order: 8, note: "log hold seconds; not rep-multiplied" },
    pre_exhaustion:  { label: "Pre-Exhaustion",        alters: "sequence",  isPairing: true,                          minExperience: "novice",       order: 9, note: "isolation immediately before compound, same muscle; a tag, not a multiplier" },
    neg_accentuated: { label: "Negative-Accentuated",  alters: "rom_tempo", sseMultiplier: 1.30, jointFriendly: true,  minExperience: "advanced",     order: 10, note: "eccentric overload; concentric assisted/unloaded (e.g. step up to bar, lower slowly)" },
    pause:           { label: "Paused Reps",           alters: "rom_tempo", sseMultiplier: 1.10, jointFriendly: true,  minExperience: "novice",       order: 11 },
    cluster:         { label: "Cluster Set",           alters: "density",   usesSegments: true,                        minExperience: "intermediate", order: 12 },
  };

  /* ======================================================================
   * 2. SPLIT DEFINITIONS
   *    Rotation length derives from days.length (retires the hardcoded mod-5).
   *    `muscleDay` routes muscles to a day AND lets B6 check per-day balance.
   *    Greg's convention deliberately differs from textbook:
   *      neck + forearms = UPPER (he trains them, they're upper-body),
   *      core = LOWER (purely to keep the two days' exercise counts close).
   *    The kids' profiles can adopt the conventional assignment instead.
   * ==================================================================== */
  /* Flexible-splits rework (SPEC_programs_flexible_splits.md, FINAL 2026-07-04):
   *   validDayCounts — schedule day-counts that keep each split day anchored to
   *     the same weekday (warn-don't-block; splitScheduleCheck arrives in P2).
   *   focusCycles — per split day, the rotating "lead with" emphasis label shown
   *     on the Nth occurrence of that day (engine hookup arrives in P5). Labels
   *     are deliberately independent of muscleDay routing (a focus can be a
   *     movement pattern, e.g. "Deadlifts", not just a muscle on that day).
   *   push_pull routing (Greg 2026-07-04): deadlifts feel like a PUSH → hams +
   *     glutes live on push day; squats are a hinge with no hinge day and must
   *     not share an emphasis day with deadlifts → quads live on pull day.
   *   back_chest_legs routing (Greg 2026-07-04): front-view/rear-view rule —
   *     what you see facing someone = chest day (chest, biceps, neck, forearms);
   *     what you see from behind = back day (back, triceps, shoulders);
   *     core rides with legs to balance exercise counts.
   */
  var SPLITS = {
    full_body:   { label: "Full Body", days: ["fb"], freqNote: "2–3×/wk",
      validDayCounts: [1, 2, 3, 4, 5, 6, 7],
      muscleDay: {
        chest: "fb", back: "fb", shoulders: "fb",
        biceps: "fb", triceps: "fb", forearms: "fb", neck: "fb",
        quads: "fb", hamstrings: "fb", glutes: "fb", calves: "fb", core: "fb",
      },
      focusCycles: { fb: ["Chest", "Back", "Legs", "Shoulders", "Arms", "Core"] },
    },
    upper_lower: {
      label: "Upper / Lower", days: ["upper", "lower"],
      validDayCounts: [2, 4, 6],
      muscleDay: {
        chest: "upper", back: "upper", shoulders: "upper",
        biceps: "upper", triceps: "upper", forearms: "upper", neck: "upper",
        quads: "lower", hamstrings: "lower", glutes: "lower",
        calves: "lower", core: "lower",
      },
      focusCycles: {
        upper: ["Chest", "Back", "Abs", "Neck Sides"],
        lower: ["Quads", "Hamstrings", "Calves", "Forearms (supinated)"],
      },
    },
    upper_lower_textbook: {
      label: "Upper / Lower (conventional)", days: ["upper", "lower"],
      validDayCounts: [2, 4, 6],
      muscleDay: {
        chest: "upper", back: "upper", shoulders: "upper",
        biceps: "upper", triceps: "upper", forearms: "upper", neck: "upper",
        core: "upper",
        quads: "lower", hamstrings: "lower", glutes: "lower", calves: "lower",
      },
      focusCycles: {
        upper: ["Chest", "Back", "Abs", "Neck Sides"],
        lower: ["Quads", "Hamstrings", "Calves", "Forearms (supinated)"],
      },
    },
    push_pull: {
      label: "Push / Pull", days: ["push", "pull"],
      validDayCounts: [2, 4, 6],
      muscleDay: {
        chest: "push", shoulders: "push", triceps: "push",
        hamstrings: "push", glutes: "push", core: "push", neck: "push",
        back: "pull", biceps: "pull", forearms: "pull",
        quads: "pull", calves: "pull",
      },
      focusCycles: {
        push: ["Presses", "Deadlifts", "Obliques", "Neck Up/Down"],
        pull: ["Rows", "Squats", "Extensions", "Forearms (pronated)"],
      },
    },
    ppl:         { label: "Push / Pull / Legs", days: ["push", "pull", "legs"],
      validDayCounts: [3, 6],
      // Provisional routing (not Greg-confirmed): forearms + neck with pull
      // (grip/traps), core with legs (his B/C/L count-balancing rationale).
      muscleDay: {
        chest: "push", shoulders: "push", triceps: "push",
        back: "pull", biceps: "pull", forearms: "pull", neck: "pull",
        quads: "legs", hamstrings: "legs", glutes: "legs",
        calves: "legs", core: "legs",
      },
    },
    back_chest_legs: {
      label: "Back / Chest / Legs", days: ["back", "chest", "legs"],
      validDayCounts: [3, 6],
      dayLabels: { back: "BACK DAY", chest: "CHEST DAY", legs: "LEGS DAY" },
      muscleDay: {
        back: "back", triceps: "back", shoulders: "back",
        chest: "chest", biceps: "chest", neck: "chest", forearms: "chest",
        quads: "legs", hamstrings: "legs", glutes: "legs",
        calves: "legs", core: "legs",
      },
    },
    // 4-day Upper/Lower with DISTINCT A/B days. The 2-day upper_lower split
    // above repeats the same session twice a week; this one gives Upper A and
    // Upper B (and Lower A / Lower B) their own exercise sets, which is what
    // the 24-week workbook programs (Hypertrophy / X3-Harambe / Joint-Friendly
    // / Built With Science) actually prescribe. muscleDay routing splits the
    // A/B pair by movement emphasis — A = horizontal push/pull + squat pattern,
    // B = vertical press/pull + hinge pattern — so the DERIVED path (used only
    // when the user overrides the split) still fills all four days. Programs
    // authored against this split carry all four sessions verbatim.
    upper_lower_4: {
      label: "Upper / Lower (4-day A/B)", days: ["upperA", "lowerA", "upperB", "lowerB"],
      validDayCounts: [4],
      dayLabels: { upperA: "UPPER A", lowerA: "LOWER A",
                   upperB: "UPPER B", lowerB: "LOWER B" },
      muscleDay: {
        chest: "upperA", back: "upperA", biceps: "upperA", forearms: "upperA",
        shoulders: "upperB", triceps: "upperB", neck: "upperB",
        quads: "lowerA", glutes: "lowerA", core: "lowerA",
        hamstrings: "lowerB", calves: "lowerB",
      },
      focusCycles: {
        upperA: ["Chest", "Back", "Arms"],
        lowerA: ["Quads", "Glutes", "Abs"],
        upperB: ["Presses", "Rows", "Shoulders"],
        lowerB: ["Hamstrings", "Calves", "Deadlifts"],
      },
    },
    body_part_5: { label: "Body-Part (legacy)", days: ["C", "D", "E", "F", "G"],
                   legacy: true,
                   // freeRotation: designed to drift — C–G rotate continuously
                   // across any schedule (the original app behavior), so the P2
                   // split↔schedule check never warns for this split.
                   freeRotation: true,
                   validDayCounts: [5],
                   dayLabels: { C: "CHEST", D: "BACK", E: "TRICEPS",
                                F: "BICEPS", G: "CORE+LEGS" } },
  };

  /* ======================================================================
   * 3. PROFILE schema + defaults + Greg's seed
   *    Defaults reproduce TODAY'S behavior so a migrated single profile is
   *    byte-for-byte equivalent to the current app (progressReps:12, all
   *    intensifiers allowed, body_part_5 split, deload at week 6 etc.).
   * ==================================================================== */
  var PROFILE_DEFAULTS = {
    schemaVersion: SCHEMA.profile,
    population: "general",      // older_adult | general | novice ...
    goal: "hypertrophy",       // strength | hypertrophy | endurance | power
    experience: "intermediate",
    repTarget: [8, 12],
    progressReps: 12,           // replaces global PROG_REPS (per-profile)
    progressSecs: 60,           // replaces global PROG_SECS for time-based moves
    rirTarget: 2,               // reps in reserve (default; Greg overrides to 1)
    deloadEvery: 6,             // weeks between deloads (legacy default = week 6)
    deloadStyle: "intensity",  // volume | intensity | rest
    deloadScope: "week",       // week | session
    allowedIntensifiers: Object.keys(INTENSIFIERS),
    splitId: "body_part_5",    // legacy default so nothing changes until opted in
    ownedBands: [],            // migrates from rbts_myBands
    /* How many set rows an exercise seeds with in the workout logger.
       null = follow whatever the PROGRAM prescribes (progDefaultSets), which
       is the legacy behavior and must stay the default so nothing changes for
       an existing profile that never set this. A number overrides the program
       — a HIT trainee seeds 1 regardless of what the block says. */
    defaultSets: null,
    /* How VOLUME is judged. "standard" = the analyzer's absolute weekly
       working-set landmarks (CHEST 10, BICEPS 6, ...) apply as usual.
       "hit" = single-set-to-failure training (Yates / Mentzer / Jones): those
       landmarks describe a volume philosophy this trainee has deliberately
       rejected, so balance is judged against the PROGRAM'S OWN prescribed
       share only — which is already the analyzer's primary test — and the
       absolute landmark comparison is suppressed rather than firing UNDER on
       every group forever. Nothing else about the analyzer changes. */
    volumeModel: "standard",   // standard | hit
  };

  /* ----------------------------------------------------------------------
   * POPULATION DEFAULTS
   * `population` was set correctly on Greg's profile and read by NOTHING —
   * the string appeared exactly twice in the whole codebase (the default and
   * the override) and zero times in the analyzer. This is the hook that makes
   * it live.
   *
   *   >>> HARD RULE: a population default NEVER overrides a value the profile
   *   >>> set explicitly. Greg's rirTarget is 1 and must stay 1 even though
   *   >>> older_adult would otherwise suggest 2. This is enforced as a
   *   >>> resolution ORDER (below), not as a special case for one field, so
   *   >>> no population rule added later can regress it.
   *
   * Layering, lowest precedence first:
   *     PROFILE_DEFAULTS  <  POPULATION_DEFAULTS[population]  <  explicit
   * -------------------------------------------------------------------- */
  var POPULATION_DEFAULTS = {
    general: {},
    novice: {
      rirTarget: 3,          // leave more in reserve while technique is forming
      progressReps: 12,
    },
    older_adult: {
      rirTarget: 2,          // SUGGESTION ONLY — an explicit profile value wins
      deloadEvery: 5,        // recover a touch more often
    },
  };

  /* Which keys the profile set for itself. Recorded at creation; for profiles
     stored before this existed, fall back to "differs from PROFILE_DEFAULTS",
     which is conservative in the right direction - an intentionally changed
     value is treated as explicit and therefore protected. */
  /* CORRECTED 2026-08-03. This used to RETURN EARLY on a stored array, so an
     array that existed protected only what it happened to name -- which is
     LESS than no array at all, because the fallback below protects every field
     that differs from the base default. Greg's live profile was
     `explicitKeys:["defaultSets","volumeModel"]` with `rirTarget:1` sitting
     unlisted beside it, so older_adult's suggested 2 overrode a stored 1 and
     every seeded set read RIR 2. The stored value was never wrong; the record
     of it being deliberate had been narrowed.

     The two are now UNIONED, which also means a profile damaged this way heals
     itself on the next load with no migration to run. A value the user left AT
     the base default is still not "deliberate" and the population may fill it
     -- that is the whole distinction, and it is why the union is with the
     DIFFERS test rather than with every key present. */
  function explicitKeysOf(p) {
    var out = (p && Array.isArray(p.explicitKeys)) ? p.explicitKeys.slice() : [];
    Object.keys(PROFILE_DEFAULTS).forEach(function (k) {
      if (!p || !(k in p)) return;
      if (JSON.stringify(p[k]) === JSON.stringify(PROFILE_DEFAULTS[k])) return;
      if (out.indexOf(k) < 0) out.push(k);
    });
    return out;
  }

  /* The explicitKeys a profile SHOULD carry once `keys` have been set on it.

     Seeded from explicitKeysOf(p), never from [] -- that is the entire point.
     Both apps' saveTrainingStyle built the array from [] and pushed only the
     key being edited, so the first tap on TODAY -> TRAINING STYLE replaced a
     nine-field inferred protection with a one-field recorded one and silently
     unprotected everything else. Pure: returns a new array, mutates nothing. */
  function markExplicit(p, keys) {
    var out = explicitKeysOf(p);
    (keys || []).forEach(function (k) {
      if (out.indexOf(k) < 0) out.push(k);
    });
    return out;
  }

  /* The effective profile: population fills in only what the profile left at
     the base default. Pure - does not mutate or persist anything. */
  function resolveProfile(p) {
    if (!p) return Object.assign({}, PROFILE_DEFAULTS);
    var pop = POPULATION_DEFAULTS[p.population] || {};
    var explicit = explicitKeysOf(p);
    var out = Object.assign({}, p);
    Object.keys(pop).forEach(function (k) {
      if (explicit.indexOf(k) >= 0) return;              // profile wins, always
      out[k] = pop[k];
    });
    return out;
  }

  function makeProfile(id, name, overrides) {
    var p = Object.assign({}, PROFILE_DEFAULTS, {
      id: id, name: name || id, createdAt: nowISO(),
      allowedIntensifiers: PROFILE_DEFAULTS.allowedIntensifiers.slice(),
      repTarget: PROFILE_DEFAULTS.repTarget.slice(),
      ownedBands: [],
    });
    Object.assign(p, overrides || {});
    // Remember what was chosen deliberately so resolveProfile can protect it.
    p.explicitKeys = Object.keys(overrides || {});
    return p;
  }

  // Greg's profile-specific settings (NOT global defaults):
  //   RIR 0–1 (trains close to failure); Upper/Lower with his balancing convention;
  //   HIT volume model (Yates / Mentzer / Jones) — one set carried to momentary
  //   muscular failure, so the logger seeds ONE set and the analyzer stops
  //   measuring him against multi-set weekly landmarks he does not train to.
  //   These are HIS choices. The defaults above stay multi-set for everyone else.
  //
  //   NOT APPLIED BY migrateToProfiles SINCE 2026-08-21. It seeded every
  //   profile the migration created, on any device, which handed a stranger
  //   his training philosophy invisibly. Kept and exported because it is the
  //   record of what he trains and test_profile_population.cjs builds his
  //   profile from it. Apply it deliberately or not at all.
  function gregSeedOverrides() {
    return {
      population: "older_adult",
      experience: "advanced",
      rirTarget: 1,                 // 0–1 in practice
      splitId: "upper_lower",       // his balanced upper/lower (neck+forearms upper, core lower)
      deloadEvery: 5,               // older adult → recover a touch more often
      defaultSets: 1,               // HIT: one set to failure, not the program's 3
      volumeModel: "hit",
    };
  }

  /* ======================================================================
   * 4. READ-TIME UPCASTERS / NORMALIZERS  (never mutate stored data)
   * ==================================================================== */

  // Normalize ONE set into a canonical analysis view. Pure; no mutation.
  // Returns: { intensifier, alters, segments:[{bands:[],reps}], rir, isTimeBased, raw }
  function normalizeSet(set) {
    if (!set || typeof set !== "object") {
      return { intensifier: "straight", alters: "none", segments: [], rir: null, raw: set };
    }
    var intensifier = set.intensifier ||
      (set.drop === true ? "drop_set" : "straight");   // legacy `drop` ⇒ drop_set view
    var meta = INTENSIFIERS[intensifier] || INTENSIFIERS.straight;

    var segments;
    if (Array.isArray(set.segments) && set.segments.length) {
      segments = set.segments.map(function (s) {
        return { bands: (s.bands || []).slice(), reps: numOr0(s.reps), secs: s.secs };
      });
    } else {
      // simple set (today's shape) ⇒ a single segment
      segments = [{ bands: (set.bands || []).slice(), reps: numOr0(set.reps), secs: set.secs }];
    }

    return {
      intensifier: intensifier,
      alters: meta.alters,
      segments: segments,
      rir: (typeof set.rir === "number") ? set.rir : null,
      isTimeBased: segments.some(function (s) { return typeof s.secs === "number"; }),
      raw: set,
    };
  }

  // Straight-set-equivalent reps for analysis/progression.
  function sseReps(set) {
    var n = normalizeSet(set);
    var totalReps = n.segments.reduce(function (a, s) { return a + s.reps; }, 0);
    if (n.alters === "rom_tempo") {
      var m = (INTENSIFIERS[n.intensifier] || {}).sseMultiplier || 1;
      return Math.round(totalReps * m * 10) / 10;
    }
    // resistance/density: reps are honest; the real signal is in volume-load.
    return totalReps;
  }

  // Volume-load for a set, given a resistance lookup fn (band id -> nominal midpoint).
  // resOf defaults to a no-op (0) so this is safe to call before BANDS is wired in.
  function volumeLoad(set, resOf) {
    resOf = resOf || function () { return 0; };
    var n = normalizeSet(set);
    return n.segments.reduce(function (acc, seg) {
      var segRes = (seg.bands || []).reduce(function (a, id) { return a + (resOf(id) || 0); }, 0);
      return acc + segRes * seg.reps;
    }, 0);
  }

  // Normalize a log ENTRY for reading (does not mutate the stored object).
  function normalizeLogEntry(entry) {
    if (!entry) return entry;
    var v = entry.schemaVersion || 1;
    // v1 and v2 entries share the same outer shape; only sets differ, and those
    // are handled by normalizeSet at the point of analysis. We expose the version.
    return Object.assign({}, entry, { schemaVersion: v, _normalized: true });
  }

  // Normalize a PROGRAM object on load: attach splitId + day-keyed slots derived
  // from legacy C–G `sessions` when missing. Programs are code/config (not user
  // history), so normalizing them in-memory is fine and changes nothing visible.
  function upcastProgram(prog) {
    if (!prog || prog.schemaVersion >= SCHEMA.program) return prog;
    var out = Object.assign({}, prog);
    out.schemaVersion = SCHEMA.program;

    if (!out.splitId) out.splitId = "body_part_5";

    // Map legacy `sessions.{C..G}` → `days.{C..G}` if a v2 `days` map is absent.
    if (!out.days && out.sessions) {
      out.days = {};
      Object.keys(out.sessions).forEach(function (k) {
        out.days[k] = { slots: out.sessions[k] };  // keep original slot shape verbatim
      });
    }
    // lengthWeeks / deloadPolicy defaults mirror current behavior (6 weeks, wk6 deload).
    if (typeof out.lengthWeeks !== "number") out.lengthWeeks = 6;
    if (!out.deloadPolicy) out.deloadPolicy = { every: 6, style: "intensity", scope: "week" };
    return out;
  }

  /* ======================================================================
   * 5. STORAGE KEYS + PROFILE-SCOPED RESOLVER
   * ==================================================================== */
  var PREFIX = "rbts_";
  // Keys that become per-profile (namespaced rbts_<id>_<base>):
  var SCOPED_BASES = ["log", "draft", "startDate", "schedule", "progIdx", "gear"];
  // Keys that stay GLOBAL (shared across profiles):
  var GLOBAL_KEYS = ["rbts_customBands", "rbts_hiddenBrands", "rbts_customPrograms",
                     "rbts_customExercises",
                     "rbts_profiles", "rbts_activeProfile", "rbts_schemaMigrated"];
  var FLAT = {  // legacy flat keys we migrate FROM
    log: "rbts_log", draft: "rbts_draft", startDate: "rbts_startDate",
    schedule: "rbts_schedule", progIdx: "rbts_progIdx", gear: "rbts_gear",
    myBands: "rbts_myBands",
  };
  var MIGRATION_FLAG = "rbts_schemaMigrated";

  function profileKey(base, profileId) { return PREFIX + profileId + "_" + base; }

  // Read a profile-scoped value with graceful fallback to the legacy flat key.
  // This lets Phase-1 readers work whether or not migration has run yet.
  function getScoped(store, base, profileId) {
    var v = store.getItem(profileKey(base, profileId));
    if (v !== null && v !== undefined) return v;
    if (FLAT[base]) return store.getItem(FLAT[base]);   // fallback
    return null;
  }
  function setScoped(store, base, profileId, value) {
    store.setItem(profileKey(base, profileId), value);
  }

  /* ======================================================================
   * 6. ONE-TIME MIGRATION  (additive · idempotent · non-destructive)
   * ==================================================================== */
  function migrateToProfiles(store, opts) {
    store = store || (root && root.localStorage);
    opts = opts || {};
    var profileId = opts.profileId || "greg";
    var profileName = opts.profileName || "Greg";

    var report = { ran: false, alreadyMigrated: false, profileId: profileId,
                   copied: [], created: [], skipped: [] };

    if (store.getItem(MIGRATION_FLAG)) {        // idempotent guard
      report.alreadyMigrated = true;
      return report;
    }

    // 6a. Build the profile object, pulling ownedBands from legacy rbts_myBands.
    /* NOTHING PERSONAL IS SEEDED HERE (changed 2026-08-21, Greg's ruling).
       This used to apply gregSeedOverrides() -- population "older_adult",
       experience "advanced", rirTarget 1, defaultSets 1, volumeModel "hit",
       deloadEvery 5, splitId "upper_lower" -- to EVERY profile this function
       creates. That is correct for exactly one person, and this function runs
       at module load on ANY device with no profile, so the first person handed
       the app inherited a training philosophy they never chose: the logger
       seeded one set to failure, the analyzer withheld the weekly volume
       landmarks, and READY / STALLED verdicts were judged at RIR 1. There is
       no profile screen, so none of it was visible or switchable -- only
       defaultSets and volumeModel have editors at all (TODAY -> TRAINING
       STYLE), and rirTarget has none.

       An absent field falls through to PROFILE_DEFAULTS, which reproduce the
       ordinary multi-set behaviour: rirTarget 2, defaultSets null (follow the
       program), volumeModel "standard". A new trainee chooses HIT or volume
       for themselves rather than being defaulted into someone else's answer.

       Greg's own profile is UNAFFECTED: it was written to rbts_profiles when
       his device migrated, MIGRATION_FLAG has guarded this function ever
       since, and his values carry explicitKeys so no population rule can
       overwrite them. gregSeedOverrides() is kept and still exported -- it is
       the record of what he actually trains, and test_profile_population.cjs
       builds his profile from it -- it is simply no longer imposed on
       strangers. A device of his that somehow still holds legacy flat keys and
       no profile now lands on the defaults; one visit to TRAINING STYLE puts
       it back, which is the same tap any user makes. */
    var ownedBands = [];
    try { ownedBands = JSON.parse(store.getItem(FLAT.myBands) || "[]") || []; }
    catch (e) { ownedBands = []; }

    var profile = makeProfile(profileId, profileName, { ownedBands: ownedBands });

    // 6b. Create profile registry + active pointer (only if absent).
    if (!store.getItem("rbts_profiles")) {
      store.setItem("rbts_profiles", JSON.stringify([profile]));
      report.created.push("rbts_profiles");
    }
    if (!store.getItem("rbts_activeProfile")) {
      store.setItem("rbts_activeProfile", profileId);
      report.created.push("rbts_activeProfile");
    }

    // 6c. COPY (not move) each flat scoped key → namespaced. Leave originals.
    SCOPED_BASES.forEach(function (base) {
      var flatVal = store.getItem(FLAT[base]);
      var nsKey = profileKey(base, profileId);
      if (flatVal === null || flatVal === undefined) { report.skipped.push(base); return; }
      if (store.getItem(nsKey) !== null) { report.skipped.push(base + " (ns exists)"); return; }
      store.setItem(nsKey, flatVal);
      report.copied.push(base);
    });

    store.setItem(MIGRATION_FLAG, JSON.stringify({ version: SCHEMA, at: nowISO() }));
    report.ran = true;
    return report;
  }

  /* ---- small utils ------------------------------------------------------ */
  function numOr0(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function nowISO() { try { return new Date().toISOString(); } catch (e) { return ""; } }

  /* ---- public surface --------------------------------------------------- */
  var API = {
    SCHEMA: SCHEMA,
    INTENSIFIERS: INTENSIFIERS,
    SPLITS: SPLITS,
    PROFILE_DEFAULTS: PROFILE_DEFAULTS,
    POPULATION_DEFAULTS: POPULATION_DEFAULTS,
    makeProfile: makeProfile,
    resolveProfile: resolveProfile,
    explicitKeysOf: explicitKeysOf,
    markExplicit: markExplicit,
    gregSeedOverrides: gregSeedOverrides,
    normalizeSet: normalizeSet,
    sseReps: sseReps,
    volumeLoad: volumeLoad,
    normalizeLogEntry: normalizeLogEntry,
    upcastProgram: upcastProgram,
    profileKey: profileKey,
    getScoped: getScoped,
    setScoped: setScoped,
    migrateToProfiles: migrateToProfiles,
    SCOPED_BASES: SCOPED_BASES,
    GLOBAL_KEYS: GLOBAL_KEYS,
  };

  root.RBTS_PHASE1 = API;

})(typeof globalThis !== "undefined" ? globalThis : this);
const RBTS_PHASE1 = (typeof globalThis !== 'undefined' ? globalThis : window).RBTS_PHASE1;
export default RBTS_PHASE1;
