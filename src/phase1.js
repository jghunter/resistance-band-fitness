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
    straight:         { label: "Straight Set", alters: "none", sseMultiplier: 1.0,
                        jointFriendly: true, minExperience: "novice" },
    one_and_quarter:  { label: "1¼ Reps",      alters: "rom_tempo", sseMultiplier: 1.25,
                        jointFriendly: true, minExperience: "intermediate" },
    tempo:            { label: "Slow Eccentric", alters: "rom_tempo", sseMultiplier: 1.15,
                        jointFriendly: true, minExperience: "novice" },
    pause:            { label: "Paused Reps",  alters: "rom_tempo", sseMultiplier: 1.10,
                        jointFriendly: true, minExperience: "novice" },
    drop_set:         { label: "Drop Set",     alters: "resistance", usesSegments: true,
                        minExperience: "intermediate" },
    rest_pause:       { label: "Rest-Pause",   alters: "density", usesSegments: true,
                        minExperience: "intermediate" },
    myo_reps:         { label: "Myo-Reps",     alters: "density", usesSegments: true,
                        minExperience: "advanced" },
    cluster:          { label: "Cluster Set",  alters: "density", usesSegments: true,
                        minExperience: "intermediate" },
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
  var SPLITS = {
    full_body:   { label: "Full Body", days: ["fb"], freqNote: "2–3×/wk" },
    upper_lower: {
      label: "Upper / Lower", days: ["upper", "lower"],
      muscleDay: {
        chest: "upper", back: "upper", shoulders: "upper",
        biceps: "upper", triceps: "upper", forearms: "upper", neck: "upper",
        quads: "lower", hamstrings: "lower", glutes: "lower",
        calves: "lower", core: "lower",
      },
    },
    upper_lower_textbook: {
      label: "Upper / Lower (conventional)", days: ["upper", "lower"],
      muscleDay: {
        chest: "upper", back: "upper", shoulders: "upper",
        biceps: "upper", triceps: "upper", forearms: "upper", neck: "upper",
        core: "upper",
        quads: "lower", hamstrings: "lower", glutes: "lower", calves: "lower",
      },
    },
    ppl:         { label: "Push / Pull / Legs", days: ["push", "pull", "legs"] },
    body_part_5: { label: "Body-Part (legacy)", days: ["C", "D", "E", "F", "G"],
                   legacy: true,
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
  };

  function makeProfile(id, name, overrides) {
    var p = Object.assign({}, PROFILE_DEFAULTS, {
      id: id, name: name || id, createdAt: nowISO(),
      allowedIntensifiers: PROFILE_DEFAULTS.allowedIntensifiers.slice(),
      repTarget: PROFILE_DEFAULTS.repTarget.slice(),
      ownedBands: [],
    });
    return Object.assign(p, overrides || {});
  }

  // Greg's profile-specific settings (NOT global defaults):
  //   RIR 0–1 (trains close to failure); Upper/Lower with his balancing convention.
  function gregSeedOverrides() {
    return {
      population: "older_adult",
      experience: "advanced",
      rirTarget: 1,                 // 0–1 in practice
      splitId: "upper_lower",       // his balanced upper/lower (neck+forearms upper, core lower)
      deloadEvery: 5,               // older adult → recover a touch more often
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
    var ownedBands = [];
    try { ownedBands = JSON.parse(store.getItem(FLAT.myBands) || "[]") || []; }
    catch (e) { ownedBands = []; }

    var profile = makeProfile(profileId, profileName,
      Object.assign(gregSeedOverrides(), { ownedBands: ownedBands }));

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
    makeProfile: makeProfile,
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
