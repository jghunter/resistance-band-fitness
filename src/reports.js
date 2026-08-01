/* Reports & progress analyzer - ESM wrapper (generated from rbts_reports.js).
   CommonJS branch removed; always assigns globalThis.RBTS_REPORTS.
   DO NOT EDIT - regenerate with: python sync_phase_module.py */
/* ============================================================================
 * fitness_app - Reports & Progress Analyzer (canonical module)
 * ----------------------------------------------------------------------------
 * Owns ALL derived calculation for the three report features:
 *   1. Workout setup sheet   (next session, last-used bands + gear, pull list)
 *   2. History report        (one session, or a date range)
 *   3. Progress analyzer     (program block / exercise / muscle group)
 *
 * Hard rules this file obeys (see SPEC_reports_analyzer.md):
 *   1. NO app globals. No window, document, localStorage, BANDS, PROGRAMS,
 *      React. Everything arrives through the injected `ctx` object. This is
 *      what makes the whole thing testable under node.
 *   2. ES5 syntax only (var / function). It is inlined into fitness_app.html
 *      under Babel-in-browser AND bundled by Vite for the PWA; both paths must
 *      accept it unchanged.
 *   3. Builders return a dumb DOC MODEL, never a string. Markdown and print
 *      HTML are two renderers over that one model, so they cannot drift.
 *
 * Synced into both apps by sync_phase_module.py. Do not edit the copies.
 * ==========================================================================*/
(function (root) {
  "use strict";

  /* ---- tunable constants ------------------------------------------------ */
  var CONST = {
    /* PROG_REPS and RIR_TARGET are FALLBACKS ONLY. Both apps override them
       per profile (_ACTIVE_PROFILE.progressReps / .rirTarget) and Greg's
       profile sets rirTarget to 1. Every judgment reads ctx.progressReps /
       ctx.rirTarget first - see threshOf() and progressionState(). */
    PROG_REPS:    12,   // fallback rep threshold for progression-ready
    PROG_SECS:    30,   // time-based (seconds) threshold - not profile-tunable
    RIR_TARGET:    2,   // fallback: logged RIR above this means reps left over
    STALL_N:       3,   // consecutive working sessions with no gain = stalled
    TREND_BAND:    1,   // +/- percent per session that still counts as FLAT
    NEAR_REPS:     2,   // "close to threshold" window, in reps
    NEGLECT_DAYS: 10,
    DORMANT_DAYS: 21,
    UNDER_FACTOR: 0.75, // weekly sets below this x the landmark = UNDER
    OVER_FACTOR:  1.5,  // weekly sets above this x the landmark = OVER
    REC_CAP:      10,   // max recommendations surfaced
    /* Minimum sessions before a direction is asserted. A 3x/week trainee on the
       5-session rotation gets n=3 per exercise per 6-week block and n=2 at the
       30-day window. At n=3 the least-squares slope is exactly
       (last - first)/2 - the middle point carries zero weight, so [100,300,100]
       and [100,100,100] both report FLAT. Below this, report the trend as
       provisional rather than asserting GROWING or DECLINING. */
    TREND_MIN_N:   4
  };

  /* Weekly working-set landmarks per muscle group. Tunable in one place.
     MOBILITY and FULL BODY deliberately have no landmark - see isExempt(). */
  var SET_LANDMARKS = {
    CHEST: 10, BACK: 10, SHOULDERS: 10, QUADS: 10, HAMSTRINGS: 10, GLUTES: 10,
    BICEPS: 6, TRICEPS: 6, CORE: 6,
    NECK: 4, FOREARMS: 4, CALVES: 4,
    /* Tibialis anterior split out of CALVES 2026-07-30 (panel rec 20). It is
       the calves' antagonist, and it is the muscle that governs toe clearance
       and therefore trip risk - worth measuring separately rather than hiding
       inside a calf total that was already running at twice its landmark. */
    TIBIALIS: 4,
  };

  /* Groups excluded from balance + neglect flags. MOBILITY is stretch/carry
     work with no meaningful load; FULL BODY volume credits no single group. */
  var BALANCE_EXEMPT = { MOBILITY: true, "FULL BODY": true };
  function isExempt(label) { return !!BALANCE_EXEMPT[label]; }

  /* ---- time-based exercises (logged in seconds, not reps) --------------- */
  /* Time-based movements progress on SECONDS (CONST.PROG_SECS), never on the
     rep threshold, and never earn a "add a heavier band" suggestion from the
     rep rule.
     177-180 (dynamic cervical flexion / extension / lateral flexion) were added
     2026-07-30. They are programmed ~70 times and were progressing on the same
     12-rep rule as a chest press, so the app proposed a heavier band for
     dynamic neck loading every time the rule fired. At 66 cervical
     degenerative change is near-universal even when asymptomatic; sub-maximal
     and time-based is the correct mode and it already existed here for the
     isometric holds (181/182/184). Sets still store their number in `reps` -
     only the unit label and the threshold change - so no stored data moves. */
  var TIME_BASED = [71, 72, 166, 177, 178, 179, 180, 181, 182, 184];
  function isTimeBased(id) { return TIME_BASED.indexOf(Number(id)) >= 0; }
  /* progressReps is the PROFILE's target (ctx.progressReps). Omit it and the
     CONST fallback applies. Time-based exercises always use PROG_SECS. */
  function threshOf(id, progressReps) {
    if (isTimeBased(id)) return CONST.PROG_SECS;
    return (typeof progressReps === "number") ? progressReps : CONST.PROG_REPS;
  }
  function repUnit(id) { return isTimeBased(id) ? "sec" : "r"; }

  /* ---- band resistance math -------------------------------------------- */
  /* Mirrors fitness_app.html's parseResRange exactly: strips + < ~ decorations,
     splits on the dash, keeps the "+" as an open-ended flag. */
  function parseResRange(res) {
    if (res == null) return { min: 0, max: 0, plus: false };
    var s = String(res);
    var plus = s.indexOf("+") >= 0;
    var parts = s.replace(/[+<~]/g, "").split("-");
    return {
      min: parseFloat(parts[0]) || 0,
      max: parseFloat(parts[1]) || 0,
      plus: plus,
    };
  }

  /* Sums a band stack's resistance range. Duplicate ids are intentional -
     the same band doubled over itself contributes twice. Returns null for an
     empty stack so callers can omit the line entirely. */
  function sumRes(bandIds, bandOf) {
    if (!bandIds || bandIds.length === 0) return null;
    var min = 0, max = 0, plus = false;
    for (var i = 0; i < bandIds.length; i++) {
      var b = bandOf(bandIds[i]);
      if (!b) continue;
      var r = parseResRange(b.res);
      min += r.min; max += r.max; plus = plus || r.plus;
    }
    return min + "\u2013" + max + (plus ? "+" : "") + " lbs";
  }

  /* Mid-point of a band's range - the single number used for load math. */
  function bandMid(b) {
    if (!b) return 0;
    var r = parseResRange(b.res);
    return (r.min + r.max) / 2;
  }


  /* ---- safety content ---------------------------------------------------
     Per-exercise and per-technique cautions. These live in the CANONICAL
     module, not in either app, for two reasons: both apps need them and there
     is no generator to keep hand-copies in step, and the printed setup sheet
     is built here -- a caution you only see on screen is not much use on a
     sheet of paper beside the anchor.
     The app contained ZERO words about pain, injury or contraindication
     before 2026-07-30 (panel finding 5). */
  var TECH_CAUTION = {
    "forced_reps":         "Training solo: there is no spotter. Get the extra reps from your non-working limb or by shortening the range — not by adding momentum to a loaded spine. Skip the momentum cue entirely on squats, deadlifts, RDLs, good mornings and any overhead press.",
    "mechanical_drop_set": "Change position before you are unsteady, not after. Set the easier variation up before the set starts so you are not improvising past failure.",
    "rest_pause":          "Keep the band under control during the pause — a loaded band that slips at rest snaps toward you.",
    "drop_set":            "Have the lighter band already laid out. Do not unhook a loaded band with one hand mid-set.",
    "30_10_30":            "Two 30-second eccentrics under band tension is a long time to hold position. Have a way to bail out that does not involve letting the band go.",
    "negative_accentuated":"Only useful if you can control the whole lowering phase. If the last third gets away from you, the band is too heavy.",
  };
  var EX_CAUTION = {
    // Cervical spine. Programmed ~70 times across the library.
    177: "Sub-maximal only, and slow. Stop immediately for tingling, numbness, or pain radiating into the shoulder, arm or hand — that is a nerve symptom, not a training symptom.",
    178: "Sub-maximal only, and slow. Never force end-range extension. Stop for any radiating or electric sensation.",
    179: "Sub-maximal only. Keep the movement small and controlled; do not let the head drop into the end range.",
    180: "Sub-maximal only. Keep the movement small and controlled; do not let the head drop into the end range.",
    181: "Build the hold gradually. Breathe through it — do not brace against a held breath.",
    182: "Build the hold gradually. Breathe through it — do not brace against a held breath.",
    183: "This is a low-load positional drill. If it is ever making noise or pinching, reduce the range.",
    184: "Build the hold gradually. Stop for any radiating symptom.",
    // Loaded hip hinge / axial spine.
    37:  "Hinge from the hips with a neutral spine. The band pulls hardest at the top, which is exactly where form breaks — stop the set when the back rounds, not when the reps run out.",
    38:  "Good mornings load the spine at the longest lever in the library. Stay conservative on band choice and stop the set at the first loss of a neutral back.",
    185: "Set your back before the band loads. If you cannot start the pull with a neutral spine, the stack is too heavy.",
    186: "Two movements loaded at once. Finish the hinge before starting the row — do not let the row pull you out of position.",
    217: "Anchor the belt and test the band tension before loading the split position. Losing balance under a stretched band is the failure mode here.",
    // Overhead / shoulder.
    187: "Overhead under band tension. Do not press into a shrug, and stop if the shoulder pinches at the top.",
    56:  "Upright rows can impinge the shoulder. Keep the pull below chest height and stop for any pinching.",
  };
  function exCautionOf(id) { return EX_CAUTION[Number(id)] || null; }
  function techCautionOf(k) { return TECH_CAUTION[k] || null; }


  /* The safety card's content, as a doc model so both apps and the printed
     sheet render the same words. Prose lives here rather than in either app
     because there is no generator to keep two hand-copies in step. */
  var SAFETY_DOC = {
    title: "SAFETY - WARM-UP, GEAR CHECK, WHEN TO STOP",
    sections: [
      { heading: "BEFORE THE FIRST SET", items: [
        ["Warm up.", "Five minutes of easy movement to raise your temperature, then one set of 12-15 easy reps with a band two steps lighter than your working stack, on the first exercise of the session. Repeat the light set for the first exercise of each new movement pattern. Warm-up sets are not working sets - log them only if you want them counted, because everything you log counts toward progression and volume."],
        ["Check the band.", "Run the whole loop through your hands, stretched slightly, and look at both faces. Retire it for surface cracks, nicks in the edge, a milky or chalky patch that does not wipe off, or any spot that feels thinner or stickier than the rest. Latex degrades from ozone, UV and oil - a band that has lived in sunlight or near a motor is suspect regardless of how it looks."],
        ["Check the anchor.", "Inspect the door anchor strap, the stitching, and every carabiner and hook you are about to load. Confirm the door opens AWAY from you and is latched. A band or anchor that fails under load travels back along its own line - toward your face. Never set up so that your head is in that path, and never look directly down the line of a stretched band while hooking or unhooking it."]
      ] },
      { heading: "STOP THE SET - AND THE SESSION", items: [
        ["", "Stop immediately and do not push through: chest pain or pressure, unusual shortness of breath, dizziness or light-headedness, a cold sweat, or an irregular or racing heartbeat. Any of those warrant medical attention, not a rest and a retry."],
        ["", "Stop the exercise for: sharp or stabbing joint pain, pain that is one-sided, anything that tingles, burns, goes numb or feels electric, or pain that radiates into an arm or leg. Nerve symptoms are never a training effect to work through. Muscular burn and breathlessness are expected; joint and nerve pain are not."],
        ["", "Losing your neutral spine, your balance, or control of the band on the way down ends the set - that is the rep to stop on, not the one after."]
      ] },
      { heading: "BETWEEN SESSIONS", items: [
        ["", "Muscle soreness peaking a day or two later and easing is normal. Soreness that is sharp, one-sided, joint-centred, or still worsening after 72 hours is not - back off and let it settle."],
        ["", "Sleep and protein do the actual adapting; training only provides the signal. Persistent poor sleep, unusual resting heart rate, or strength dropping across several sessions means take the deload early rather than late."]
      ] }
    ],
    disclaimer: "This app is a training log, not medical advice. Clear resistance training with your physician before starting, and again after any new symptom, injury, procedure, or change in medication - particularly anything affecting blood pressure, heart rate, bone density, or balance."
  };

  /* ---- returning from a layoff ------------------------------------------
     Panel recommendation 28. The program's week is derived from the START
     DATE, not from what was logged, so two weeks away silently advances it —
     and can deposit a returning trainee straight into a <=50% deload week, or
     worse, into week 5 at full intensifier density after a fortnight of
     complete rest. Neither is a sane place to restart.

     Detraining is not linear: strength holds up far better than work capacity,
     and connective tissue re-adapts more slowly than muscle. The guidance below
     scales with the gap and deliberately errs toward too little. */
  var RETURN_DAYS = 10;
  function returningState(ctx, asOfISO) {
    var all = sortedLog(ctx.log);
    if (!all.length) return null;
    var last = all[all.length - 1];
    var asOf = asOfISO || localISO();
    var days = daysBetween(last.date, asOf);
    if (days <= RETURN_DAYS) return null;

    var band, headline, advice;
    if (days <= 20) {
      band = "SHORT";
      headline = "You have been away " + days + " days.";
      advice = "Pick up where you left off, but take the first session at about " +
               "80% of your usual stack and stop 2-3 reps short on every set. " +
               "If that feels easy, you are back to normal next session.";
    } else if (days <= 41) {
      band = "MEDIUM";
      headline = "You have been away " + days + " days — about " +
                 Math.round(days / 7) + " weeks.";
      advice = "Restart one step lighter than you remember and keep 3-4 reps in " +
               "reserve for a full week. Expect soreness out of proportion to the " +
               "effort; that is normal after a break and is not a reason to add load. " +
               "Skip intensifiers entirely this week.";
    } else {
      band = "LONG";
      headline = "You have been away " + days + " days — about " +
                 Math.round(days / 7) + " weeks.";
      advice = "Treat this as a restart, not a resumption. Two weeks at roughly " +
               "half your previous stacks, every set stopped well short of failure, " +
               "no intensifiers. Tendons and connective tissue re-adapt more slowly " +
               "than muscle, and this is the window where people hurt themselves " +
               "trying to prove they have not lost anything.";
    }
    return {
      days: days, lastDate: last.date, band: band,
      headline: headline, advice: advice,
      /* A returning session must never be a deload session: the point of a
         deload is to recover from accumulated fatigue that no longer exists. */
      suppressDeload: true
    };
  }

  /* ---- effective load model ---------------------------------------------
     Panel finding 1, found by all five reviewers: the app measures WHICH
     SPRING and then reports POUNDS. bandMid reduces a band to the midpoint of
     its rated range and that constant drives volume, top load, PRs, slopePct
     and every trend verdict - while band force is a function of ELONGATION,
     which the log never recorded. One identical entry spans a 9:1 force range
     between a short seated row and a deadlift lockout.

     Three layers, each degrading into the one below:

       RATED    the vendor midpoint. Always available, including for every
                historical entry logged before geometry existed.
       MODELED  a force curve fitted from the vendor's rated range using ONE
                explicit strain assumption (below), evaluated at a stretch
                derived from the gear actually used.
       MEASURED the same, but the curve is interpolated through real Tension
                Master readings instead of assumed. Requires >= 2 points.

     The honest part is Layer 1: a RATIO between two setups needs only that
     force rises monotonically with elongation, which is true of every band
     regardless of how badly the curve is fitted. Absolute pounds need the
     curve to be right; a ratio does not. That is why the gear-change warning
     is quantitative even while the absolute figure stays an estimate. */
  var LOAD_MODEL = {
    /* The single strain assumption this whole model rests on, stated once.
       Loop bands are conventionally rated with the maximum figure at about
       2.5x the loop's rest length (strain 1.5) and the minimum at a light
       working stretch (strain 0.5). Between those two points the fit is
       LINEAR: real latex stiffens toward the top of its range, so modeled
       figures understate load at high stretch. Measured points remove the
       assumption entirely, which is the whole reason for the Tension Master. */
    STRAIN_AT_RATED_MIN: 0.5,
    STRAIN_AT_RATED_MAX: 1.5,
    /* Assumed working strain of a REFERENCE setup - the strain at which a
       band produces its rated midpoint, i.e. exactly what the app has always
       implicitly assumed. Gear deltas move away from this point. */
    REF_STRAIN: 1.0,
    MIN_MEASURED_POINTS: 2
  };

  /* Force in lb at a given absolute stretched-past-rest distance.
     stretchIn is how far BEYOND its rest length the loop has been pulled. */
  function bandForceAt(band, stretchIn, geom) {
    if (!band) return 0;
    var rest = (geom && isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
      ? geom.restLengthIn : (band.lengthIn || 0);
    if (!rest) return bandMid(band);
    var pts = (geom && Array.isArray(geom.measured)) ? geom.measured.filter(function (p) {
      return p && isFinite(p.stretchIn) && isFinite(p.lb);
    }).sort(function (a, b) { return a.stretchIn - b.stretchIn; }) : [];

    if (pts.length >= LOAD_MODEL.MIN_MEASURED_POINTS) {
      /* Piecewise-linear through real readings; clamp outside the measured
         span rather than extrapolating a curve nobody measured. */
      if (stretchIn <= pts[0].stretchIn) return pts[0].lb;
      var last = pts[pts.length - 1];
      if (stretchIn >= last.stretchIn) return last.lb;
      for (var i = 1; i < pts.length; i++) {
        if (stretchIn <= pts[i].stretchIn) {
          var a = pts[i - 1], b2 = pts[i];
          var span = b2.stretchIn - a.stretchIn;
          if (span <= 0) return b2.lb;
          return a.lb + (b2.lb - a.lb) * ((stretchIn - a.stretchIn) / span);
        }
      }
      return last.lb;
    }

    var r = parseResRange(band.res);
    var s = stretchIn / rest;                                   // strain
    var lo = LOAD_MODEL.STRAIN_AT_RATED_MIN, hi = LOAD_MODEL.STRAIN_AT_RATED_MAX;
    if (hi <= lo) return bandMid(band);
    var f = r.min + (r.max - r.min) * ((s - lo) / (hi - lo));
    return f < 0 ? 0 : f;                                       // never negative
  }

  /* Total inches this gear set adds to (+) or removes from (-) the stretch the
     band must cover. Mirrors gearPathDeltaIn in fitness_app.html; kept here so
     the module stays self-contained and testable. */
  function gearPathDelta(gearIds, gearOf) {
    if (!gearIds || !gearIds.length || !gearOf) return 0;
    return gearIds.reduce(function (a, id) {
      var g = gearOf(id);
      if (!g) return a;
      var d = resolveGearDims(g) || {}, t = g.type;
      if (t === "footplate") return a + 2 * (d.thicknessIn || 0) + (d.channelIn || 0);
      if (t === "bar")       return a - (d.hookOffsetIn || 0);
      if (t === "handle" || t === "anchor" || t === "belt") return a - (d.seriesIn || 0);
      return a + 2 * (d.thicknessIn || 0) - (d.seriesIn || 0);
    }, 0);
  }

  /* True only when every dimension in play was measured by the user. A vendor
     spec is not a measurement of THIS unit. Routes through resolveGearDims
     so that PWA-shaped gear (no stored dims, resolved from table) is handled
     identically to HTML-shaped gear (dims stored on item). */
  function gearDimsVerified(gearIds, gearOf) {
    if (!gearIds || !gearIds.length || !gearOf) return false;
    return gearIds.every(function (id) {
      var g = gearOf(id);
      if (!g) return false;
      var d = resolveGearDims(g);
      return !!(d && d.verified === true);
    });
  }

  /* Effective load for one set, with its provenance.
       bandIds   the stack
       gearIds   the gear used for this exercise (may be empty)
       ctx       needs bandOf, and optionally gearOf / bandGeomOf
     Returns { lb, rated, ratio, provenance, stretchIn, basis }.
     provenance is MEASURED / MODELED / RATED and callers MUST surface it -
     the number means something different in each case. */
  function effectiveLoad(ctx, bandIds, gearIds) {
    var ids = bandIds || [];
    var rated = ids.reduce(function (a, id) {
      var b = ctx.bandOf ? ctx.bandOf(id) : null;
      return a + (b ? bandMid(b) : 0);
    }, 0);
    var out = { lb: rated, rated: rated, ratio: 1, provenance: "RATED",
                stretchIn: null, basis: "vendor midpoint" };
    if (!ids.length) return out;

    var delta = gearPathDelta(gearIds, ctx.gearOf);
    var anyGeom = false, anyMeasured = false, lb = 0, refTotal = 0;

    ids.forEach(function (id) {
      var b = ctx.bandOf ? ctx.bandOf(id) : null;
      if (!b) return;
      var geom = ctx.bandGeomOf ? (ctx.bandGeomOf(id) || {}) : {};
      var rest = (isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
        ? geom.restLengthIn : (b.lengthIn || 0);
      if (!rest) { lb += bandMid(b); refTotal += bandMid(b); return; }
      if (isFinite(geom.restLengthIn) || delta) anyGeom = true;
      var pts = Array.isArray(geom.measured) ? geom.measured : [];
      if (pts.length >= LOAD_MODEL.MIN_MEASURED_POINTS) anyMeasured = true;
      var refStretch = LOAD_MODEL.REF_STRAIN * rest;
      refTotal += bandForceAt(b, refStretch, geom);
      lb += bandForceAt(b, refStretch + delta, geom);
    });

    if (!anyGeom && !anyMeasured) return out;      // nothing to improve on

    out.lb = lb;
    out.ratio = refTotal ? (lb / refTotal) : 1;
    out.stretchIn = delta;
    /* MEASURED requires BOTH a measured band curve AND (when gear is in play)
       gear the user measured. Anything less is MODELED - it is still an
       estimate, and must not be presented as a reading. */
    var gearOK = !gearIds || !gearIds.length || gearDimsVerified(gearIds, ctx.gearOf);
    out.provenance = (anyMeasured && gearOK) ? "MEASURED" : "MODELED";
    out.basis = out.provenance === "MEASURED"
      ? "interpolated through your Tension Master readings"
      : "fitted from the vendor's rated range at an assumed strain, adjusted for gear";
    return out;
  }

  /* Freeze the computed load onto a workout entry AT SAVE TIME. Re-measuring a
     band or correcting a gear dimension next year must never rewrite what a
     past workout meant -- an entry saved before this existed simply has no
     `load` block and falls back to the vendor midpoint, marked RATED. Same
     discipline as the band-id stability rule, applied to load instead of
     identity.

       exercises   { exId: [ {reps, bands, segments?, ...}, ... ] } -- the
                   `exercises` map of a log entry
       gearMap     { exId: [gearId, ...] } -- the `gear` map of a log entry,
                   keyed by exercise id (gear doesn't change set to set the
                   way band resistance does)
       ctx         needs bandOf, and optionally gearOf / bandGeomOf -- exactly
                   what effectiveLoad needs. Callers build and inject it
                   (makeReportCtx() in both apps); this module touches no DOM,
                   no localStorage and no app globals.

     Returns { exId: { lb, rated, ratio, provenance, deltaIn } }, one entry per
     exercise that logged at least one band. The band stack can differ set to
     set, so the stamp uses the HEAVIEST set -- the same set setTopLoad already
     reports. Returns undefined when there is nothing to stamp (no usable ctx,
     or no exercise logged any bands). */
  function stampLoad(exercises, gearMap, ctx) {
    if (!ctx || typeof ctx.bandOf !== "function") return undefined;
    var out = {}, any = false;
    Object.keys(exercises || {}).forEach(function (exId) {
      var sets = exercises[exId] || [];
      var gearIds = (gearMap && gearMap[exId]) || [];
      var best = null;
      sets.forEach(function (s) {
        var bands = Array.isArray(s.segments)
          ? (((s.segments[0] || {}).bands) || []) : (s.bands || []);
        if (!bands.length) return;
        var e = effectiveLoad(ctx, bands, gearIds);
        if (!best || e.lb > best.lb) best = e;
      });
      if (!best) return;
      any = true;
      out[exId] = { lb: Math.round(best.lb * 10) / 10, rated: Math.round(best.rated * 10) / 10,
                    ratio: Math.round(best.ratio * 1000) / 1000,
                    provenance: best.provenance, deltaIn: best.stretchIn };
    });
    return any ? out : undefined;
  }

  /* Did the equipment change between two sessions, and by how much?
     The WARNING is worth more than a correction: an 18-36% shift the model can
     only estimate is better flagged than silently modelled away. */
  function gearChange(ctx, prevGearIds, nowGearIds) {
    var a = (prevGearIds || []).slice().sort().join(",");
    var b = (nowGearIds || []).slice().sort().join(",");
    if (a === b) return null;
    var da = gearPathDelta(prevGearIds, ctx.gearOf);
    var db = gearPathDelta(nowGearIds, ctx.gearOf);
    var names = function (list) {
      return (list || []).map(function (id) {
        var g = ctx.gearOf ? ctx.gearOf(id) : null;
        return g ? g.name : id;
      });
    };
    return {
      changed: true,
      deltaIn: db - da,
      prev: names(prevGearIds),
      now: names(nowGearIds),
      /* Positive delta = more stretch = heavier at the same body position. */
      direction: (db - da) > 0 ? "heavier" : ((db - da) < 0 ? "lighter" : "unknown")
    };
  }

  /* ---- progressive-resistance stack search ------------------------------
     A port of the BandStack engine that already exists three times in this
     project (Rails `BandStack.suggestions`, `resistance_bands.c`, and the
     generated static /bands page) into the one place the decision is actually
     made. The app's own suggestProgression offered "next band up in the same
     brand+length family, or add the lightest band you own"; measured over the
     128 parseable catalog entries, same brand+length step-ups are a MEDIAN
     +43%, mean +52%, max +270%, with 76% of all steps over +25%. Serious Steel
     #0 to #1 is +135%. That turns READY TO PROGRESS into a jump the lifter
     cannot absorb, and the same engine then flags STALLED three sessions later.

     Ranking, identical to the other three implementations so all four agree:
       - candidate must be strictly heavier than the current stack
       - target window is +5%..+15% on SINGLED TOP END, ideal +10%
       - in-window score is the integer |10*candMax - 11*curMax|; out-of-window
         candidates rank after all in-window ones, by smallest step up
       - key = [outOfWindow, score, bandCount, max, min], lexicographic, low wins
       - dedup on identical (min,max) totals
     All scoring is integer so there is no float-comparison drift between the
     four implementations.

     DOUBLING IS DELIBERATELY NOT OFFERED. The app models a doubled band as 2x,
     which is the manufacturer's convention at matched PERCENTAGE elongation; at
     the matched ABSOLUTE length a human ROM actually produces, the true ratio
     is 5.3x-13.1x. Suggesting "double it" as a +10% step would be wrong by
     most of an order of magnitude. See the doubled-band note in the UI. */
  var STACK_MAX = 4;            // realistic bar/anchor limit; also caps the search
  var STACK_SUGGESTIONS = 3;

  /* The search always runs to the full STACK_MAX depth so this implementation
     stays byte-identical to the Rails / C / static ones - verified against
     BandStack.suggestions on the real 71-band 41" pool. That worst case
     (~1.03M combinations, no MY BANDS set) measures ~130ms here, roughly half
     Ruby's, so it is memoised rather than depth-limited: reducing the depth
     would have made the four implementations disagree exactly when the pool is
     widest. With MY BANDS set the pool is a handful of bands and the search is
     sub-millisecond. */
  var _STACK_MEMO = {};
  function stackKey(curBands, poolBands, opts) {
    return (curBands || []).map(function (b) { return b.id; }).sort().join(",") + "|" +
           (poolBands || []).map(function (b) { return b.id + ":" + b.res; }).join(",") + "|" +
           ((opts && opts.count) || "") + ":" + ((opts && opts.maxStack) || "");
  }

  /* curBands / poolBands are band OBJECTS. poolBands must already be filtered
     to one loop length (bands only stack when lengths match) and de-duplicated.
     Returns up to 3 { bands, min, max, pct, inWindow }, best first. */
  function stackSuggestions(curBands, poolBands, opts) {
    var memoK = stackKey(curBands, poolBands, opts);
    if (_STACK_MEMO[memoK]) return _STACK_MEMO[memoK];
    var result = stackSuggestionsUncached(curBands, poolBands, opts);
    _STACK_MEMO[memoK] = result;
    return result;
  }
  function stackSuggestionsUncached(curBands, poolBands, opts) {
    var pool = (poolBands || []).filter(function (b) { return b && parseResRange(b.res).max > 0; });
    if (!pool.length) return [];
    var want = (opts && opts.count) || STACK_SUGGESTIONS;
    var depth = Math.min((opts && opts.maxStack) || STACK_MAX, pool.length);

    var mins = pool.map(function (b) { return parseResRange(b.res).min; });
    var maxs = pool.map(function (b) { return parseResRange(b.res).max; });
    var curMax = (curBands || []).reduce(function (a, b) { return a + parseResRange(b.res).max; }, 0);

    /* Positions of the current stack inside the pool, so the identical stack is
       not offered back. null when it is not wholly inside the pool. */
    var curPos = null;
    if (curBands && curBands.length) {
      var used = {}, pos = [];
      var okAll = curBands.every(function (cb) {
        for (var i = 0; i < pool.length; i++) {
          if (pool[i].id === cb.id && !used[i]) { used[i] = 1; pos.push(i); return true; }
        }
        return false;
      });
      if (okAll) { pos.sort(function (a, b) { return a - b; }); curPos = pos.join(","); }
    }

    var winLo = curMax * 105, winHi = curMax * 115;
    var best = [], worst = null;

    function keyCmp(a, b) {
      for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
      return 0;
    }
    function refreshWorst() {
      worst = null;
      if (best.length < want) return;
      best.forEach(function (c) { if (!worst || keyCmp(c.key, worst.key) > 0) worst = c; });
    }

    var combo = [];
    function walk(start, n) {
      if (combo.length === n) {
        var maxS = 0, i;
        for (i = 0; i < n; i++) maxS += maxs[combo[i]];
        if (maxS <= curMax) return;                       // must be heavier
        if (curPos !== null && combo.join(",") === curPos) return;

        var m100 = maxS * 100, w, sc;
        if (m100 >= winLo && m100 <= winHi) { w = 0; sc = Math.abs(maxS * 10 - curMax * 11); }
        else                                { w = 1; sc = maxS - curMax; }
        // Cheap reject on the two leading key fields, before any allocation.
        if (worst && (w > worst.key[0] || (w === worst.key[0] && sc > worst.key[1]))) return;

        var minS = 0;
        for (i = 0; i < n; i++) minS += mins[combo[i]];
        var key = [w, sc, n, maxS, minS];

        var dup = null;
        for (i = 0; i < best.length; i++) {
          if (best[i].min === minS && best[i].max === maxS) { dup = best[i]; break; }
        }
        if (dup) {
          if (keyCmp(key, dup.key) < 0) {
            dup.key = key; dup.idx = combo.slice(); dup.inWindow = (w === 0);
            refreshWorst();
          }
          return;
        }
        if (worst) {
          if (keyCmp(key, worst.key) >= 0) return;
          best.splice(best.indexOf(worst), 1);
        }
        best.push({ key: key, idx: combo.slice(), min: minS, max: maxS, inWindow: (w === 0) });
        refreshWorst();
        return;
      }
      for (var j = start; j < pool.length; j++) { combo.push(j); walk(j + 1, n); combo.pop(); }
    }
    for (var n = 1; n <= depth; n++) walk(0, n);

    best.sort(function (a, b) { return keyCmp(a.key, b.key); });
    return best.map(function (c) {
      return {
        bands: c.idx.map(function (j) { return pool[j]; }),
        min: c.min, max: c.max, inWindow: c.inWindow,
        pct: curMax ? ((c.max - curMax) / curMax) * 100 : null
      };
    });
  }

  /* ---- set shape helpers ------------------------------------------------
     A set is either plain ({reps, bands}) or segmented ({segments:[...]}) for
     drop sets. Every reader goes through setSegments so both shapes work. */
  function setSegments(s) {
    if (s && Array.isArray(s.segments) && s.segments.length) return s.segments;
    return [{ reps: (s && s.reps) || 0, bands: (s && s.bands) || [] }];
  }
  function setReps(s) {
    return setSegments(s).reduce(function (a, g) { return a + (g.reps || 0); }, 0);
  }
  /* Display band stack = the FIRST segment's bands (the working stack you set
     up with); later segments are the drop-downs. */
  function setBands(s) { return setSegments(s)[0].bands || []; }
  function setIntens(s) {
    if (s && s.intensifier) return s.intensifier;
    return (s && s.drop) ? "drop_set" : "straight";
  }
  function isPlainSet(s) { return setIntens(s) === "straight"; }
  function setSide(s) {
    return (s && (s.side === "L" || s.side === "R")) ? s.side : null;
  }
  function setPartials(s) { return (s && s.partials > 0) ? s.partials : 0; }
  /* Top load = heaviest single phase of the set (not the last, not the sum). */
  function setTopLoad(s, bandOf) {
    return setSegments(s).reduce(function (m, g) {
      var sr = (g.bands || []).reduce(function (a, id) { return a + bandMid(bandOf(id)); }, 0);
      return sr > m ? sr : m;
    }, 0);
  }
  function setVolume(s, bandOf) {
    return setSegments(s).reduce(function (a, g) {
      var sr = (g.bands || []).reduce(function (x, id) { return x + bandMid(bandOf(id)); }, 0);
      return a + sr * (g.reps || 0);
    }, 0);
  }

  /* ---- log queries ------------------------------------------------------ */
  /* Dateless and null entries are dropped rather than sorted. A single null
     element - which a merge-import can introduce - otherwise dereferences
     a.date here and takes out buildSetupDoc and buildHistoryDoc, i.e. the whole
     TODAY tab. entriesFor already guards; this is the matching guard. */
  function sortedLog(log) {
    return (log || []).filter(function (e) {
      return e && e.date != null && e.date !== "";
    }).sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date));
    });
  }
  /* Entries containing exId strictly before beforeDate, NEWEST FIRST.
     beforeDate == null means no upper bound. */
  function entriesFor(log, exId, beforeDate) {
    var key = String(exId);
    return (log || []).filter(function (e) {
      if (!e || !e.exercises || !e.exercises[key]) return false;
      return beforeDate == null || String(e.date) < String(beforeDate);
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  }
  /* The literal last combination run - what staging works from. Deliberately
     does NOT skip deloads; it reports isDeload so the sheet can warn instead. */
  function lastUse(log, exId, beforeDate, deloadOf) {
    var found = entriesFor(log, exId, beforeDate);
    if (!found.length) return null;
    var e = found[0], key = String(exId);
    return {
      date: e.date,
      sets: e.exercises[key] || [],
      gear: (e.gear && e.gear[key]) || [],
      isDeload: deloadOf ? !!deloadOf(e) : false,
    };
  }
  /* WORKING history only - deloads are reduced load, which is junk data for
     every progression and trend judgment. */
  function exHistory(log, exId, beforeDate, n, deloadOf) {
    var key = String(exId);
    var out = entriesFor(log, exId, beforeDate).filter(function (e) {
      return !(deloadOf && deloadOf(e));
    });
    if (n != null) out = out.slice(0, n);
    return out.map(function (e) { return { date: e.date, sets: e.exercises[key] || [] }; });
  }
  /* Stalled = STALL_N straight working sessions with no improvement in best
     plain-set reps. Drop sets are excluded: a correct drop set ends low by
     design and would fake a stall. */
  function isStalled(log, exId, beforeDate, deloadOf) {
    var h = exHistory(log, exId, beforeDate, CONST.STALL_N, deloadOf);
    if (h.length < CONST.STALL_N) return false;
    var best = h.map(function (e) {
      return e.sets.filter(isPlainSet).reduce(function (m, s) {
        var r = setReps(s); return r > m ? r : m;
      }, 0);
    });
    for (var i = 1; i < best.length; i++) if (best[0] > best[i]) return false;
    return true;
  }
  /* Double progression, RIR-gated. L and R sets are evaluated INDEPENDENTLY
     (reps can legitimately differ per side); untagged sets keep the legacy
     bilateral behavior. Single source of truth for the flag - both the
     in-workout exercise card and the setup sheet call this. */
  function progressionState(ctx, exId, beforeDate) {
    var deloadOf = ctx.deloadOf;
    /* Two sessions, not one: the readiness rule needs a load reference. */
    var h = exHistory(ctx.log, exId, beforeDate, 2, deloadOf);
    var working = h.length ? h[0].sets.filter(isPlainSet) : [];

    /* --- load awareness -------------------------------------------------
       The rep rule alone cannot tell "hit 12 at the same stack" (a genuine
       progression signal) from "hit 12 because the stack got lighter". Two
       corrections, both from panel recommendation 18:

       1. BACK-OFF SETS. Sets after the heaviest one, at a lighter stack, are
          back-off work. Requiring every set to clear the threshold means a
          deliberate back-off set blocks READY forever. Only sets at the
          session's top load gate readiness.
       2. LOAD REGRESSION. If the last session's top load is BELOW the previous
          working session's, reaching the rep target there is not evidence you
          can add load - you already removed some. Refuse READY and say so. */
    function topOf(sets) {
      return sets.reduce(function (m, s) {
        var l = setTopLoad(s, ctx.bandOf); return l > m ? l : m;
      }, 0);
    }
    var lastTop = topOf(working);
    var prevTop = h.length > 1 ? topOf(h[1].sets.filter(isPlainSet)) : 0;
    var loadDropped = (prevTop > 0 && lastTop > 0 && lastTop < prevTop);

    if (lastTop > 0) {
      var seenTop = false;
      working = working.filter(function (s) {
        var atTop = setTopLoad(s, ctx.bandOf) >= lastTop;
        if (atTop) { seenTop = true; return true; }
        return !seenTop;          // lighter sets BEFORE the top set still count
      });
    }
    /* Profile-driven, NOT hardcoded: both apps let a profile override the rep
       target and the RIR cap, and Greg's profile sets rirTarget to 1. */
    var thresh = threshOf(exId, ctx.progressReps);
    var rirCap = (typeof ctx.rirTarget === "number") ? ctx.rirTarget : CONST.RIR_TARGET;
    function sideReady(list) {
      if (!list.length) return false;
      var i;
      for (i = 0; i < list.length; i++) if (setReps(list[i]) < thresh) return false;
      for (i = 0; i < list.length; i++) {
        if (list[i].rir != null && list[i].rir > rirCap) return false;
      }
      return true;
    }
    var bySide = { B: [], L: [], R: [] };
    working.forEach(function (s) { bySide[setSide(s) || "B"].push(s); });
    var sides = (bySide.L.length || bySide.R.length)
      ? { hasL: bySide.L.length > 0, hasR: bySide.R.length > 0,
          L: sideReady(bySide.L), R: sideReady(bySide.R) }
      : null;
    var repsReady = sides ? (sides.L || sides.R) : sideReady(bySide.B);
    var ready = repsReady && !loadDropped;
    return {
      ready: ready,
      sides: sides,
      /* NOT gated on loadDropped: flat reps with FALLING load is a genuine
         stall. It is RISING load that suppresses STALLED (see exerciseVerdict),
         because flat reps at a heavier stack is load progression. */
      stalled: !ready && isStalled(ctx.log, exId, beforeDate, deloadOf),
      threshold: thresh,
      /* Set when the rep target was met but the load had come down, so callers
         can explain the withheld READY instead of just not showing it. */
      loadDropped: loadDropped,
      repsReady: repsReady,
      lastTop: lastTop,
      prevTop: prevTop,
    };
  }

  /* ---- program block detection ------------------------------------------
     Log entries carry no block instance id, so a boundary is inferred: the
     programId changed, or workoutNum failed to increase (a restart).
     KNOWN LIMITATION: a past session hand-logged out of order can split a
     block. Callers surface the block count and spans so that stays visible. */
  function detectBlocks(log) {
    var blocks = [], cur = null, prevNum = null;
    sortedLog(log).forEach(function (e) {
      var num = (e.workoutNum == null) ? null : Number(e.workoutNum);
      var restart = (num != null && prevNum != null && num <= prevNum);
      if (!cur || e.programId !== cur.programId || restart) {
        cur = { programId: e.programId, from: e.date, to: e.date, entries: [] };
        blocks.push(cur);
      }
      cur.to = e.date;
      cur.entries.push(e);
      prevNum = num;
    });
    return blocks;
  }

  /* ---- shared formatting ------------------------------------------------ */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* Text bar, drawn identically by both renderers so markdown and print agree. */
  function barText(pct, width) {
    width = width || 20;
    var p = (pct == null || isNaN(pct)) ? 0 : Math.max(0, Math.min(100, pct));
    var n = Math.round((p / 100) * width), s = "", i;
    for (i = 0; i < width; i++) s += (i < n ? "#" : "-");
    return s;
  }
  function pctStr(p) {
    if (p == null || isNaN(p)) return "0%";
    return Math.round(p) + "%";
  }
  /* One exercise block flattened into ordered label/text lines. Shared by both
     renderers so they can never disagree about which lines an exercise shows.
     Any null field is simply omitted rather than printed as "null". */
  function exLines(r) {
    var out = [];
    if (r.technique) out.push({ k: "TECHNIQUE", v: r.technique, cls: "flag" });
    if (r.lastDate) {
      out.push({ k: "Last (" + r.lastDate + ")", v: r.lastReps || "-", cls: "" });
    } else {
      out.push({ k: "Last", v: "no prior log - first session", cls: "warn" });
    }
    if (r.deloadWarn) {
      out.push({ k: "", v: "(deload - was reduced load)", cls: "warn" });
    }
    if (r.bands) out.push({ k: "Bands", v: r.bands + (r.res ? "   (" + r.res + ")" : ""), cls: "" });
    if (r.gear) out.push({ k: "Gear", v: r.gear, cls: "" });
    (r.flags || []).forEach(function (f) {
      out.push({ k: "", v: ">> " + f, cls: "flag" });
    });
    return out;
  }
  function exTitle(r) {
    var bits = [];
    if (r.group) bits.push(r.group);
    if (r.cls) bits.push(String(r.cls).toUpperCase());
    var tag = bits.length ? "  [" + bits.join(" / ") + "]" : "";
    return r.n + ". " + r.name + tag;
  }
  /* Write-in blanks. Time-based exercises (planks / holds / carries) are logged
     in seconds, so the row carries its own unit and the sheet never invites reps
     where seconds belong. Defaults to "r" when the row omits it. */
  function blanksLine(r) {
    var u = r.unit || "r";
    return (r.blanks || []).map(function (b) {
      return b + " ____" + u + " ____";
    }).join("   ");
  }

  /* ---- markdown renderer ------------------------------------------------ */
  function renderMarkdown(doc) {
    var L = [];
    L.push("# " + doc.title);
    L.push("");
    if ((doc.meta || []).length) {
      L.push(doc.meta.map(function (m) {
        return "**" + m.label + ":** " + m.value;
      }).join("  |  "));
      L.push("");
    }
    (doc.sections || []).forEach(function (sec) {
      if (sec.heading) { L.push("## " + sec.heading); L.push(""); }
      if (sec.type === "kv") {
        (sec.rows || []).forEach(function (r) {
          L.push("- **" + r.label + ":** " + r.value);
        });
        L.push("");
      } else if (sec.type === "table") {
        var cols = sec.cols || [];
        L.push("| " + cols.join(" | ") + " |");
        L.push("| " + cols.map(function () { return "---"; }).join(" | ") + " |");
        (sec.rows || []).forEach(function (row) {
          L.push("| " + row.map(function (c) {
            return c == null ? "" : String(c);
          }).join(" | ") + " |");
        });
        L.push("");
      } else if (sec.type === "exercises") {
        (sec.rows || []).forEach(function (r) {
          L.push("### " + exTitle(r) + "  `#" + r.id + "`");
          exLines(r).forEach(function (ln) {
            L.push("- " + (ln.k ? "**" + ln.k + ":** " : "") + ln.v);
          });
          var bl = blanksLine(r);
          if (bl) { L.push(""); L.push("`" + bl + "`"); }
          L.push("");
        });
      } else if (sec.type === "bars") {
        L.push("```");
        (sec.rows || []).forEach(function (r) {
          var lab = (r.label + "            ").slice(0, 12);
          L.push(lab + " " + barText(r.pct, 20) + " " + pctStr(r.pct) +
                 "  " + (r.value == null ? "" : r.value) +
                 (r.note ? "  " + r.note : ""));
        });
        L.push("```");
        L.push("");
      } else if (sec.type === "logged") {
        (sec.rows || []).forEach(function (r) {
          L.push("### " + r.name + "  `#" + r.id + "`" + (r.group ? "  " + r.group : ""));
          if (r.gear) L.push("- **Gear:** " + r.gear);
          L.push("```");
          (r.lines || []).forEach(function (t) { L.push(t); });
          L.push("```");
          L.push("");
        });
      } else if (sec.type === "notes") {
        (sec.rows || []).forEach(function (t) { L.push(t); L.push(""); });
      }
    });
    L.push("---");
    L.push("_Generated " + doc.generatedAt + " by Resistance Band Training System_");
    return L.join("\n");
  }

  /* ---- print HTML renderer --------------------------------------------- */
  var PRINT_CSS = [
    "#rbts-print-root{background:#fff;color:#000;font-family:'Courier New',monospace;font-size:9.5pt;line-height:1.35;}",
    "#rbts-print-root h1{font-size:13pt;letter-spacing:.06em;margin:0 0 2pt;}",
    "#rbts-print-root h2{font-size:10.5pt;margin:9pt 0 3pt;border-bottom:1px solid #000;padding-bottom:1pt;}",
    "#rbts-print-root h3{font-size:10pt;margin:5pt 0 1pt;}",
    "#rbts-print-root .meta{margin:0 0 7pt;font-size:9pt;}",
    "#rbts-print-root .meta span{margin-right:16pt;}",
    "#rbts-print-root table{border-collapse:collapse;width:100%;font-size:9pt;margin-bottom:6pt;}",
    "#rbts-print-root th,#rbts-print-root td{border:1px solid #999;padding:2pt 4pt;text-align:left;}",
    "#rbts-print-root th{background:#eee;}",
    "#rbts-print-root .ex{page-break-inside:avoid;margin-bottom:7pt;}",
    "#rbts-print-root .ln{margin-left:14pt;}",
    "#rbts-print-root .flag{font-weight:bold;}",
    "#rbts-print-root .warn{font-style:italic;}",
    "#rbts-print-root .blanks{margin-left:14pt;margin-top:2pt;}",
    "#rbts-print-root pre{margin:0 0 6pt;font-size:9pt;}",
    "#rbts-print-root .pgbreak{page-break-before:always;}",
    "#rbts-print-root .gen{margin-top:10pt;font-size:8pt;color:#444;border-top:1px solid #999;padding-top:2pt;}"
  ].join("");

  function renderPrintHTML(doc) {
    var H = [];
    H.push("<style>" + PRINT_CSS + "</style>");
    H.push("<h1>" + esc(doc.title) + "</h1>");
    if ((doc.meta || []).length) {
      H.push('<div class="meta">' + doc.meta.map(function (m) {
        return "<span><b>" + esc(m.label) + ":</b> " + esc(m.value) + "</span>";
      }).join("") + "</div>");
    }
    (doc.sections || []).forEach(function (sec) {
      var pb = sec.pageBreak ? ' class="pgbreak"' : "";
      if (sec.heading) H.push("<h2" + pb + ">" + esc(sec.heading) + "</h2>");
      else if (sec.pageBreak) H.push('<div class="pgbreak"></div>');
      if (sec.type === "kv") {
        (sec.rows || []).forEach(function (r) {
          H.push('<div class="ln"><b>' + esc(r.label) + ":</b> " + esc(r.value) + "</div>");
        });
      } else if (sec.type === "table") {
        H.push("<table><tr>" + (sec.cols || []).map(function (c) {
          return "<th>" + esc(c) + "</th>";
        }).join("") + "</tr>");
        (sec.rows || []).forEach(function (row) {
          H.push("<tr>" + row.map(function (c) {
            return "<td>" + esc(c) + "</td>";
          }).join("") + "</tr>");
        });
        H.push("</table>");
      } else if (sec.type === "exercises") {
        (sec.rows || []).forEach(function (r) {
          H.push('<div class="ex' + (r.pageBreak ? " pgbreak" : "") + '">');
          H.push("<h3>" + esc(exTitle(r)) + "  #" + esc(r.id) + "</h3>");
          exLines(r).forEach(function (ln) {
            H.push('<div class="ln ' + ln.cls + '">' +
              (ln.k ? "<b>" + esc(ln.k) + ":</b> " : "") + esc(ln.v) + "</div>");
          });
          var bl = blanksLine(r);
          if (bl) H.push('<div class="blanks">' + esc(bl) + "</div>");
          H.push("</div>");
        });
      } else if (sec.type === "bars") {
        H.push("<pre>" + (sec.rows || []).map(function (r) {
          var lab = (r.label + "            ").slice(0, 12);
          return esc(lab + " " + barText(r.pct, 20) + " " + pctStr(r.pct) +
                     "  " + (r.value == null ? "" : r.value) +
                     (r.note ? "  " + r.note : ""));
        }).join("\n") + "</pre>");
      } else if (sec.type === "logged") {
        (sec.rows || []).forEach(function (r) {
          H.push('<div class="ex">');
          H.push("<h3>" + esc(r.name) + "  #" + esc(r.id) +
                 (r.group ? "  " + esc(r.group) : "") + "</h3>");
          if (r.gear) H.push('<div class="ln"><b>Gear:</b> ' + esc(r.gear) + "</div>");
          H.push("<pre>" + (r.lines || []).map(esc).join("\n") + "</pre>");
          H.push("</div>");
        });
      } else if (sec.type === "notes") {
        (sec.rows || []).forEach(function (t) {
          H.push('<div class="ln">' + esc(t) + "</div>");
        });
      }
    });
    H.push('<div class="gen">Generated ' + esc(doc.generatedAt) +
           " by Resistance Band Training System</div>");
    return H.join("\n");
  }

  /* ---- setup sheet ------------------------------------------------------ */
  /* "Serious Steel Red #2 x2 + X3 Light" - duplicates collapse to a xN count,
     preserving first-seen order. */
  function bandStackLabel(bandIds, bandOf) {
    var counts = {}, order = [];
    (bandIds || []).forEach(function (id) {
      if (counts[id] == null) { counts[id] = 0; order.push(id); }
      counts[id]++;
    });
    return order.map(function (id) {
      var b = bandOf(id);
      var nm = b ? (b.brand + " " + b.color + (b.model ? " " + b.model : "")) : String(id);
      return nm + (counts[id] > 1 ? " x" + counts[id] : "");
    }).join(" + ");
  }
  /* Fuller form for the pull list: adds length and the printed rating, since
     that is what you match against when picking a band off the rack. */
  function bandCatalogLabel(b) {
    if (!b) return "";
    return b.brand + " " + b.color + (b.model ? " " + b.model : "") +
           (b.lengthIn ? " " + b.lengthIn + "in" : "") +
           (b.res ? " (" + b.res + ")" : "");
  }
  /* Staging quantity is the MAXIMUM any single exercise needs, never the sum:
     two exercises each using two red bands still means carrying two. */
  function pullList(perEx) {
    var bandMax = {}, bandOrder = [], gearMax = {}, gearOrder = [];
    (perEx || []).forEach(function (ex) {
      var bc = {}, gc = {};
      (ex.bandIds || []).forEach(function (id) { bc[id] = (bc[id] || 0) + 1; });
      (ex.gearIds || []).forEach(function (id) { gc[id] = (gc[id] || 0) + 1; });
      Object.keys(bc).forEach(function (id) {
        if (bandMax[id] == null) { bandMax[id] = 0; bandOrder.push(id); }
        if (bc[id] > bandMax[id]) bandMax[id] = bc[id];
      });
      Object.keys(gc).forEach(function (id) {
        if (gearMax[id] == null) { gearMax[id] = 0; gearOrder.push(id); }
        if (gc[id] > gearMax[id]) gearMax[id] = gc[id];
      });
    });
    return {
      bands: bandOrder.map(function (id) { return { id: id, count: bandMax[id] }; }),
      gear: gearOrder.map(function (id) { return { id: id, count: gearMax[id] }; })
    };
  }
  function gearLabel(gearIds, gearOf) {
    var counts = {}, order = [];
    (gearIds || []).forEach(function (id) {
      if (counts[id] == null) { counts[id] = 0; order.push(id); }
      counts[id]++;
    });
    return order.map(function (id) {
      var g = gearOf(id);
      var nm = g ? (g.brand + " " + g.name) : String(id);
      return nm + (counts[id] > 1 ? " x" + counts[id] : "");
    }).join(", ");
  }
  /* "12r / 12r / 10r+4p" - per-set reps with side tags and partials. */
  function repsLabel(sets, exId) {
    var u = repUnit(exId);
    return (sets || []).map(function (s) {
      var side = setSide(s), p = setPartials(s);
      return setReps(s) + u + (p ? "+" + p + "p" : "") + (side ? " " + side : "");
    }).join(" / ");
  }

  function buildSetupDoc(ctx, opts) {
    var prog = opts.prog, sKey = opts.sKey, week = opts.week;
    var session = ctx.sessionExOf(prog, sKey) || { primary: {}, accessories: {} };
    var techMap = ctx.techMapOf(prog, week, sKey) || {};
    var slots = []
      .concat(ctx.orderSlots(session.primary || {}, opts.focusLabel))
      .concat(ctx.orderSlots(session.accessories || {}, opts.focusLabel));

    var exRows = [], perEx = [], n = 0;
    slots.forEach(function (pair) {
      var slot = pair[0], id = pair[1];
      if (id == null) return;
      n++;
      var lu = lastUse(ctx.log, id, opts.date, ctx.deloadOf);
      var ps = progressionState(ctx, id, opts.date);
      var bandIds = lu ? setBands(lu.sets[0]) : [];
      var gearIds = lu ? (lu.gear || []) : [];
      var flags = [];
      if (ps.ready) {
        var sug = ctx.suggestOf ? ctx.suggestOf(bandIds) : null;
        var how = sug ? (sug.add || sug.swap) : null;
        flags.push("READY TO PROGRESS" + (how ? " - " + how : " - add a band"));
      } else if (ps.stalled) {
        flags.push("STALLED " + CONST.STALL_N +
          " sessions - apply a technique, or drop back 10% and rebuild");
      }
      /* Per-side asymmetry is worth calling out on paper: you set up for the
         weaker side differently than the stronger one. */
      if (ps.sides) {
        if (ps.sides.L && !ps.sides.R) flags.push("LEFT side ready, right is behind");
        if (ps.sides.R && !ps.sides.L) flags.push("RIGHT side ready, left is behind");
      }
      var techKey = techMap[slot] || null;
      /* Blank count mirrors what was actually done last time; with no history,
         fall back to the app's own initSets rule (L/R pair for unilateral). */
      var blanks;
      if (lu && lu.sets.length) {
        blanks = lu.sets.map(function (s, i) {
          var side = setSide(s);
          return "S" + (i + 1) + (side ? " " + side : "");
        });
      } else {
        blanks = (ctx.initSetsOf(id) || [{}]).map(function (s, i) {
          return "S" + (i + 1) + (s && s.side ? " " + s.side : "");
        });
      }
      exRows.push({
        n: n, id: id, name: ctx.nameOf(id),
        group: (ctx.groupOf(id) || {}).label || null,
        cls: ctx.classOf(id) || null,
        technique: techKey ? ctx.techLabelOf(techKey) : null,
        lastDate: lu ? lu.date : null,
        lastReps: lu ? repsLabel(lu.sets, id) : null,
        bands: bandIds.length ? bandStackLabel(bandIds, ctx.bandOf) : null,
        res: sumRes(bandIds, ctx.bandOf),
        gear: gearIds.length ? gearLabel(gearIds, ctx.gearOf) : null,
        deloadWarn: !!(lu && lu.isDeload),
        unit: repUnit(id),
        flags: flags,
        blanks: blanks
      });
      perEx.push({ bandIds: bandIds, gearIds: gearIds });
    });

    var pl = pullList(perEx);
    var pullRows = [];
    if (pl.bands.length) {
      pullRows.push({ label: "BANDS", value: pl.bands.map(function (x) {
        return bandCatalogLabel(ctx.bandOf(x.id)) + (x.count > 1 ? " x" + x.count : "");
      }).join(" | ") });
    }
    if (pl.gear.length) {
      pullRows.push({ label: "GEAR", value: pl.gear.map(function (x) {
        var g = ctx.gearOf(x.id);
        return (g ? g.brand + " " + g.name : x.id) + (x.count > 1 ? " x" + x.count : "");
      }).join(" | ") });
    }

    var techCount = Object.keys(techMap).length;
    var meta = [
      { label: "DATE", value: opts.date },
      { label: "PROGRAM", value: "P" + prog.id + " " + prog.name },
      { label: "WEEK", value: String(week) },
      { label: "SESSION", value: ctx.sessionLabelOf(prog, sKey) + " (" + sKey + ")" },
      { label: "WORKOUT", value: "#" + (opts.workoutNum == null ? "?" : opts.workoutNum) }
    ];
    if (opts.focusLabel) meta.push({ label: "FOCUS", value: opts.focusLabel });
    meta.push({ label: "TECHNIQUES", value: String(techCount) });
    if (opts.isDeload) {
      meta.push({ label: "DELOAD", value: "yes - all work at 50% intensity or less" });
    }

    return {
      kind: "setup",
      title: "WORKOUT SETUP SHEET",
      meta: meta,
      sections: [
        { heading: "PULL LIST", type: "kv", rows: pullRows },
        { heading: "EXERCISES", type: "exercises", rows: exRows }
      ],
      generatedAt: new Date().toISOString()
    };
  }

  /* ---- history report --------------------------------------------------- */
  function entryTotals(entry, ctx) {
    var sets = 0, reps = 0, volume = 0, topLoad = 0;
    Object.keys(entry.exercises || {}).forEach(function (exId) {
      (entry.exercises[exId] || []).forEach(function (s) {
        sets++;
        reps += setReps(s);
        volume += setVolume(s, ctx.bandOf);
        var l = setTopLoad(s, ctx.bandOf);
        if (l > topLoad) topLoad = l;
      });
    });
    return { sets: sets, reps: reps, volume: volume, topLoad: topLoad };
  }
  function fmtNum(n) {
    return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function fmtDelta(p) {
    if (p == null || !isFinite(p)) return "-";
    return (p >= 0 ? "+" : "") + Math.round(p) + "%";
  }
  /* One text line per set: intensifier, RIR, reps (+partials), side, bands,
     summed resistance. Drop-set segments become their own indented lines so the
     printed log shows the same shape the on-screen card does. */
  function setLines(s, i, exId, ctx) {
    var out = [], u = repUnit(exId);
    var kind = setIntens(s);
    var tags = [];
    if (kind === "drop_set") tags.push("DROP");
    else if (kind !== "straight") tags.push(ctx.intensLabelOf ? ctx.intensLabelOf(kind) : kind);
    if (s.rir != null) tags.push("RIR" + s.rir);
    var side = setSide(s), p = setPartials(s);
    var segs = setSegments(s);
    var isSeg = Array.isArray(s.segments) && s.segments.length > 0;
    var head = "S" + (i + 1) + "  " + setReps(s) + u +
      (p ? " +" + p + "p" : "") + (side ? " " + side : "") + (isSeg ? " total" : "");
    if (!isSeg) {
      var bl = bandStackLabel(setBands(s), ctx.bandOf);
      var rs = sumRes(setBands(s), ctx.bandOf);
      if (bl) head += "   " + bl;
      if (rs) head += "   (" + rs + ")";
    }
    if (tags.length) head += "   [" + tags.join(" ") + "]";
    out.push(head);
    if (isSeg) {
      segs.forEach(function (g, gi) {
        var gb = bandStackLabel(g.bands || [], ctx.bandOf);
        var gr = sumRes(g.bands || [], ctx.bandOf);
        out.push("    phase " + (gi + 1) + ": " + (g.reps || 0) + u +
          (gb ? "   " + gb : "") + (gr ? "   (" + gr + ")" : ""));
      });
    }
    return out;
  }
  /* Per-exercise progression across a set of entries. The analyzer's report
     reuses this verbatim so the printed table and ANALYZE always agree. */
  function rangeExTable(entries, ctx) {
    var per = {};
    sortedLog(entries).forEach(function (e) {
      Object.keys(e.exercises || {}).forEach(function (exId) {
        var top = 0, best = 0;
        (e.exercises[exId] || []).forEach(function (s) {
          var l = setTopLoad(s, ctx.bandOf);
          if (l > top) top = l;
          if (isPlainSet(s)) { var r = setReps(s); if (r > best) best = r; }
        });
        if (!per[exId]) per[exId] = [];
        per[exId].push({ date: e.date, top: top, best: best });
      });
    });
    var rows = Object.keys(per).map(function (exId) {
      var arr = per[exId];
      var first = arr[0], last = arr[arr.length - 1];
      var delta = first.top ? ((last.top - first.top) / first.top) * 100 : null;
      var bestReps = arr.reduce(function (m, x) { return x.best > m ? x.best : m; }, 0);
      return [
        ctx.nameOf(exId) + " (#" + exId + ")",
        (ctx.groupOf(exId) || {}).label || "",
        String(arr.length),
        fmtNum(first.top),
        fmtNum(last.top),
        fmtDelta(delta),
        String(bestReps)
      ];
    }).sort(function (a, b) { return a[0].localeCompare(b[0]); });
    return {
      cols: ["EXERCISE", "GROUP", "N", "FIRST LOAD", "LAST LOAD", "DELTA", "BEST REPS"],
      rows: rows
    };
  }

  function buildHistoryDoc(ctx, opts) {
    var entries = sortedLog(opts.entries || []);
    var single = !!opts.single;
    var sections = [];

    if (!entries.length) {
      return {
        kind: "history",
        title: "WORKOUT HISTORY  " + (opts.fromDate || "start") + " to " + (opts.toDate || "today"),
        meta: [],
        sections: [{ heading: "RANGE SUMMARY", type: "notes",
          rows: ["No sessions logged in this range."] }],
        generatedAt: new Date().toISOString()
      };
    }

    var title = single
      ? "WORKOUT LOG  " + entries[0].date
      : "WORKOUT HISTORY  " + (opts.fromDate || entries[0].date) +
        " to " + (opts.toDate || entries[entries.length - 1].date);

    var meta = [];
    if (!single) {
      var gt = { sets: 0, reps: 0, volume: 0 };
      entries.forEach(function (e) {
        var t = entryTotals(e, ctx);
        gt.sets += t.sets; gt.reps += t.reps; gt.volume += t.volume;
      });
      meta = [
        { label: "SESSIONS", value: String(entries.length) },
        { label: "SETS", value: fmtNum(gt.sets) },
        { label: "REPS", value: fmtNum(gt.reps) },
        { label: "VOLUME", value: fmtNum(gt.volume) + " lb-reps" }
      ];
      sections.push({ heading: "RANGE SUMMARY", type: "kv", rows: [
        { label: "SPAN", value: entries[0].date + " to " + entries[entries.length - 1].date },
        { label: "SESSIONS", value: String(entries.length) },
        { label: "TOTAL SETS", value: fmtNum(gt.sets) },
        { label: "TOTAL REPS", value: fmtNum(gt.reps) },
        { label: "TOTAL VOLUME", value: fmtNum(gt.volume) + " lb-reps" }
      ] });
    }

    entries.forEach(function (e, ei) {
      var prog = ctx.progOf ? ctx.progOf(e.programId) : null;
      var dayName = "";
      try {
        dayName = new Date(e.date + "T12:00:00")
          .toLocaleDateString("en-US", { weekday: "long" });
      } catch (err) { dayName = ""; }
      var t = entryTotals(e, ctx);
      var head = [
        { label: "DATE", value: e.date + (dayName ? " (" + dayName + ")" : "") },
        { label: "PROGRAM", value: "P" + e.programId + (prog ? " " + prog.name : "") },
        { label: "WEEK", value: String(e.week) },
        { label: "SESSION", value:
            (ctx.sessionLabelOf ? ctx.sessionLabelOf(prog, e.session) : e.session) +
            " (" + e.session + ")" },
        { label: "WORKOUT", value: "#" + (e.workoutNum == null ? "?" : e.workoutNum) }
      ];
      if (ctx.deloadOf && ctx.deloadOf(e)) head.push({ label: "DELOAD", value: "yes" });
      if (e.completedAt) head.push({ label: "COMPLETED", value: e.completedAt });
      head.push({ label: "TOTALS", value: t.sets + " sets  " + fmtNum(t.reps) +
        " reps  " + fmtNum(t.volume) + " lb-reps  top " + fmtNum(t.topLoad) + " lb" });

      /* In a range report every session starts on a fresh page. */
      sections.push({
        heading: (single ? "SESSION  " : "") + e.date + "  " + e.session,
        type: "kv", rows: head,
        pageBreak: !single && ei > 0
      });

      var exRows = Object.keys(e.exercises || {}).map(function (exId) {
        var gids = (e.gear && e.gear[exId]) || [];
        var lines = [];
        (e.exercises[exId] || []).forEach(function (s, i) {
          lines = lines.concat(setLines(s, i, exId, ctx));
        });
        return {
          id: exId, name: ctx.nameOf(exId),
          group: (ctx.groupOf(exId) || {}).label || null,
          cls: ctx.classOf ? ctx.classOf(exId) : null,
          gear: gids.length ? gearLabel(gids, ctx.gearOf) : null,
          lines: lines
        };
      });
      sections.push({ heading: null, type: "logged", rows: exRows });

      if (e.notes) sections.push({ heading: "NOTES", type: "notes", rows: [e.notes] });
    });

    if (!single) {
      var tbl = rangeExTable(entries, ctx);
      sections.push({ heading: "PROGRESSION ACROSS RANGE", type: "table",
        cols: tbl.cols, rows: tbl.rows, pageBreak: true });
    }

    return { kind: "history", title: title, meta: meta, sections: sections,
             generatedAt: new Date().toISOString() };
  }

  /* ---- analyzer: dates, windows, trends --------------------------------- */
  function dayMs() { return 86400000; }
  /* Noon UTC keeps arithmetic clear of DST and timezone edges: every ISO date
     maps to a fixed instant, so day differences are exact. */
  function toDate(iso) { return new Date(String(iso) + "T12:00:00Z"); }
  function isoOf(d) {
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  /* The current date in the RUNNING MACHINE'S timezone. isoOf() reads UTC
     fields, which is right for the noon-anchored arithmetic above but wrong for
     "what day is it now": at UTC-10 it returns tomorrow for ten hours a day, so
     every NEGLECTED (10d) and DORMANT (21d) threshold fires a day early and a
     session logged this afternoon reports daysSince = 1. */
  function localISO(d) {
    var t = d || new Date();
    var m = t.getMonth() + 1, day = t.getDate();
    return t.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function daysBetween(aISO, bISO) {
    return Math.round((toDate(bISO).getTime() - toDate(aISO).getTime()) / dayMs());
  }
  function shiftISO(iso, days) {
    return isoOf(new Date(toDate(iso).getTime() + days * dayMs()));
  }
  var WINDOW_LABELS = { "7":"7 DAYS", "30":"30 DAYS", "90":"90 DAYS",
                        "365":"1 YEAR", all:"ALL TIME", block:"CURRENT BLOCK" };
  /* The window carries its own entries plus the immediately preceding period of
     equal length for comparison. "all" and "block" have no comparison period. */
  function resolveWindow(ctx, opts) {
    var asOf = (opts && opts.asOf) || localISO();
    var key = String((opts && opts.window) || "30");
    var all = sortedLog(ctx.log);
    var from, to = asOf, spanDays = null, entries, prevEntries = null;
    if (key === "all") {
      from = all.length ? all[0].date : asOf;
      entries = all.slice();
      spanDays = all.length ? daysBetween(from, to) + 1 : 0;
    } else if (key === "block") {
      var blocks = detectBlocks(all);
      var b = blocks.length ? blocks[blocks.length - 1] : null;
      from = b ? b.from : asOf;
      entries = b ? b.entries.slice() : [];
      spanDays = b ? daysBetween(b.from, b.to) + 1 : 0;
    } else {
      var n = parseInt(key, 10);
      if (isNaN(n) || n <= 0) n = 30;
      spanDays = n;
      from = shiftISO(asOf, -(n - 1));
      var prevFrom = shiftISO(from, -n);
      entries = all.filter(function (e) { return e.date >= from && e.date <= to; });
      prevEntries = all.filter(function (e) { return e.date >= prevFrom && e.date < from; });
    }
    return { key: key, label: WINDOW_LABELS[key] || (key + " DAYS"),
             from: from, to: to, asOf: asOf, spanDays: spanDays,
             entries: entries, prevEntries: prevEntries };
  }
  /* Least-squares slope over session index, expressed as percent of the first
     value per session. Under 3 points there is no trend worth claiming. */
  function slopePct(series) {
    var n = (series || []).length;
    if (n < 3) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0, i;
    for (i = 0; i < n; i++) { sx += i; sy += series[i]; sxx += i * i; sxy += i * series[i]; }
    var denom = n * sxx - sx * sx;
    if (denom === 0) return null;
    var slope = (n * sxy - sx * sy) / denom;
    var first = series[0];
    if (!first) return null;
    return (slope / first) * 100;
  }
  function classifyTrend(sp) {
    if (sp == null) return "INSUFFICIENT";
    if (sp > CONST.TREND_BAND) return "GROWING";
    if (sp < -CONST.TREND_BAND) return "DECLINING";
    return "FLAT";
  }

  /* ---- analyzer: exercise level ----------------------------------------- */
  /* Priority-ordered, first match wins. READY outranks STALLED: if the lift has
     earned a load increase, that is the action, not a stall remedy. */
  function exerciseVerdict(ctx, row) {
    /* Staleness first. progressionState judges the most recent session however
       old it is, so a lift abandoned weeks ago would otherwise be told to "add a
       band". Past the dormant threshold the only useful advice is to resume it.
       (progressionState is unchanged - the in-workout badge should still read
       READY when you open an old exercise, because you are about to train it.) */
    if (row.daysSince != null && row.daysSince >= CONST.DORMANT_DAYS) {
      return { code: "EX_DORMANT", text: "Not trained in " + row.daysSince +
        " days. Resume it before judging progression - the last session reached " +
        row.bestReps + row.unit + " against a " + row.thresh + row.unit + " target." };
    }
    if (row.ready) {
      var sug = ctx.suggestOf ? ctx.suggestOf(row.lastBands || []) : null;
      var how = sug ? (sug.add || sug.swap) : null;
      return { code: "READY", text: "Hit the " + row.thresh + row.unit +
        " target - progress the load: " + (how || "add the lightest band you own") + "." };
    }
    /* isStalled measures REPS only (the app's inherited rule for the in-workout
       badge). Under double progression, flat reps with RISING top load is load
       progression, not a stall - so do not prescribe a stall remedy for a lift
       that is climbing. progressionState is deliberately left alone; only this
       narrative verdict differs. */
    if (row.stalled && row.trend !== "GROWING") {
      return { code: "STALLED", text: "No improvement in " + CONST.STALL_N +
        " straight working sessions. Apply a high-intensity technique you have not used on it recently, or drop back 10% and rebuild." };
    }
    /* Direction claims need enough sessions to mean anything. Below
       TREND_MIN_N the numbers are reported without asserting a direction -
       the load metric is quantized to the band catalog (consecutive catalog
       steps are +83%, +91%) against a TREND_BAND of +/-1%, so at n=2-3 "trend"
       answers only "did you use a different band in the last session than in
       the first?". */
    if (row.n < CONST.TREND_MIN_N && (row.trend === "DECLINING" || row.trend === "GROWING")) {
      return { code: "INSUFFICIENT_N", text: "Top load " +
        (row.trend === "GROWING" ? "is up " : "is down ") + fmtDelta(row.deltaPct) +
        " but only " + row.n + " session" + (row.n === 1 ? "" : "s") +
        " in this window - too few to call a trend (needs " + CONST.TREND_MIN_N +
        "). Keep logging." };
    }
    if (row.trend === "DECLINING") {
      return { code: "DECLINING", text: "Top load is falling (" + fmtDelta(row.deltaPct) +
        " across " + row.n + " sessions). Hold the load and rebuild reps, and check recovery." };
    }
    if (row.trend === "FLAT" && row.bestReps < row.thresh &&
        row.bestReps >= row.thresh - CONST.NEAR_REPS) {
      return { code: "NEAR", text: (row.thresh - row.bestReps) + " " + row.unit +
        " short of the " + row.thresh + row.unit + " target and flat - push 1-2 more reps before adding load." };
    }
    if (row.trend === "GROWING") {
      return { code: "GROWING", text: "Progressing (" + fmtDelta(row.deltaPct) +
        " top load across " + row.n + " sessions). Hold course." };
    }
    return { code: "HOLDING", text: row.n < 3
      ? "Only " + row.n + " session(s) in this window - insufficient data for a trend."
      : "Holding steady. Keep accumulating reps toward the " + row.thresh + row.unit + " target." };
  }

  function analyzeExercises(ctx, win) {
    /* Deloads are excluded from every judgment: reduced load is not a
       regression. They still count toward volume totals elsewhere. */
    var working = win.entries.filter(function (e) {
      return !(ctx.deloadOf && ctx.deloadOf(e));
    });
    var per = {};
    sortedLog(working).forEach(function (e) {
      Object.keys(e.exercises || {}).forEach(function (exId) {
        var top = 0, reps = 0, vol = 0, best = 0;
        (e.exercises[exId] || []).forEach(function (s) {
          var l = setTopLoad(s, ctx.bandOf);
          if (l > top) top = l;
          reps += setReps(s);
          vol += setVolume(s, ctx.bandOf);
          if (isPlainSet(s)) { var r = setReps(s); if (r > best) best = r; }
        });
        if (!per[exId]) per[exId] = [];
        per[exId].push({ date: e.date, top: top, reps: reps, vol: vol, best: best,
                         bands: setBands((e.exercises[exId] || [])[0]) });
      });
    });
    /* All-time bests come from the FULL log, not the window, so a PR badge means
       a genuine personal record rather than a local maximum.
       allBest is the true all-time top load INCLUDING the latest session - it is
       a display value. allTops keeps the per-date tops so the PR test can be
       made against sessions strictly BEFORE the one being judged: testing
       last.top >= max(..., last.top) is trivially true and made PR LIFTS list
       nearly every exercise in every window. */
    var allBest = {}, allTops = {};
    sortedLog(ctx.log).forEach(function (e) {
      Object.keys(e.exercises || {}).forEach(function (exId) {
        var top = 0;
        (e.exercises[exId] || []).forEach(function (s) {
          var l = setTopLoad(s, ctx.bandOf);
          if (l > top) top = l;
        });
        if (!allBest[exId] || top > allBest[exId]) allBest[exId] = top;
        if (!allTops[exId]) allTops[exId] = [];
        allTops[exId].push({ date: e.date, top: top });
      });
    });
    /* Best top load on any date strictly earlier than beforeDate. */
    function priorBest(exId, beforeDate) {
      var best = 0;
      (allTops[exId] || []).forEach(function (x) {
        if (String(x.date) < String(beforeDate) && x.top > best) best = x.top;
      });
      return best;
    }

    return Object.keys(per).map(function (exId) {
      var arr = per[exId];
      var first = arr[0], last = arr[arr.length - 1];
      var sp = slopePct(arr.map(function (x) { return x.top; }));
      var ps = progressionState(ctx, exId, shiftISO(win.to, 1));
      var row = {
        id: exId,
        name: ctx.nameOf(exId),
        group: (ctx.groupOf(exId) || {}).label || "OTHER",
        cls: ctx.classOf ? ctx.classOf(exId) : "iso",
        n: arr.length,
        firstTop: first.top,
        lastTop: last.top,
        deltaPct: first.top ? ((last.top - first.top) / first.top) * 100 : null,
        slopePct: sp,
        trend: classifyTrend(sp),
        bestReps: arr.reduce(function (m, x) { return x.best > m ? x.best : m; }, 0),
        thresh: ps.threshold,
        unit: repUnit(exId),
        volume: arr.reduce(function (a, x) { return a + x.vol; }, 0),
        allTimeBest: allBest[exId] || 0,
        isPR: last.top > 0 && last.top > priorBest(exId, last.date),
        ready: ps.ready,
        stalled: ps.stalled,
        lastDate: last.date,
        daysSince: daysBetween(last.date, win.asOf),
        lastBands: last.bands || [],
        verdict: null
      };
      row.verdict = exerciseVerdict(ctx, row);
      return row;
    }).sort(function (a, b) { return b.n - a.n || b.lastTop - a.lastTop; });
  }

  /* ---- analyzer: muscle group level -------------------------------------- */
  /* The program's own prescribed mix is the balance reference - it defines the
     intended distribution, so no invented "ideal split" is needed. A group
     getting materially less than its prescribed share is an ADHERENCE gap. */
  function prescribedShares(ctx, prog) {
    var counts = {}, total = 0;
    if (!prog || !ctx.splitDaysOf || !ctx.sessionExOf) {
      return { shares: {}, counts: {}, total: 0 };
    }
    (ctx.splitDaysOf(prog) || []).forEach(function (sKey) {
      var s = ctx.sessionExOf(prog, sKey) || {};
      [s.primary || {}, s.accessories || {}].forEach(function (obj) {
        Object.keys(obj).forEach(function (slot) {
          var id = obj[slot];
          if (id == null) return;
          var g = (ctx.groupOf(id) || {}).label || "OTHER";
          counts[g] = (counts[g] || 0) + 1;
          total++;
        });
      });
    });
    var shares = {};
    Object.keys(counts).forEach(function (g) {
      shares[g] = total ? (counts[g] / total) * 100 : 0;
    });
    return { shares: shares, counts: counts, total: total };
  }
  /* BALANCE: weekly hard sets against the group's landmark. Sets against sets.
     UNDER below 0.75x the landmark, OVER above 1.5x.

     This used to compare share-of-lb-reps-VOLUME against share-of-exercise-
     SLOTS - two different units - and returned OVER *before* the landmark
     check, so a group trained at 1-2 sets/week could be reported
     over-represented. On a synthetic block where every prescribed exercise was
     logged in every prescribed session (100% adherence) it flagged three of
     four groups UNDER and one OVER: identical 3x12 work on a squat and a neck
     exercise reported the squat "over-represented at 95% of volume against a
     prescribed 50%" purely because a squat uses a heavier band. The flag
     therefore pointed away from exactly the work that was missing.

     Volume share is now informational only and produces no flag. Whether you
     actually logged the mix the program prescribes is a SEPARATE, separately
     labelled question - see adherenceOf, which compares slots to slots. */
  function balanceOf(weeklySets, landmark, adherencePct) {
    if (landmark == null) {
      /* No landmark for this group (small or unlisted): adherence is the only
         reference left, and with neither there is nothing to judge. */
      if (adherencePct == null) return "NONE";
      return adherencePct < CONST.UNDER_FACTOR * 100 ? "UNDER" : "OK";
    }
    if (weeklySets < landmark * CONST.UNDER_FACTOR) return "UNDER";
    if (weeklySets > landmark * CONST.OVER_FACTOR) return "OVER";
    return "OK";
  }

  /* ADHERENCE: did you log the MIX the program prescribes?
     Compares logged slot share against prescribed slot share - both are shares
     of exercise slots, so the comparison is unit-consistent. Deliberately
     separate from balance: a program can be faithfully followed and still be
     badly balanced, which is the single most important thing this report has
     to be able to say. Returns a percentage, or null when nothing is
     prescribed for the group. */
  function adherenceOf(loggedSlotShare, prescribedShare) {
    if (!prescribedShare) return null;
    return (loggedSlotShare / prescribedShare) * 100;
  }
  function adherenceCodeOf(pct) {
    if (pct == null) return "NONE";
    if (pct < CONST.UNDER_FACTOR * 100) return "UNDER";
    if (pct > CONST.OVER_FACTOR * 100) return "OVER";
    return "OK";
  }

  /* A unilateral exercise logs an L set and an R set for what is one set of
     work per side. The landmarks are calibrated for one. Counting L+R doubles
     a group's apparent weekly sets purely because its exercises are one-sided. */
  function countableSets(sets) {
    var L = 0, R = 0, B = 0;
    (sets || []).forEach(function (s) {
      var sd = setSide(s);
      if (sd === "L") L++; else if (sd === "R") R++; else B++;
    });
    return B + Math.max(L, R);
  }
  function neglectOf(daysSince) {
    if (daysSince == null) return "DORMANT";
    if (daysSince >= CONST.DORMANT_DAYS) return "DORMANT";
    if (daysSince >= CONST.NEGLECT_DAYS) return "NEGLECTED";
    return "OK";
  }
  function analyzeGroups(ctx, win, prog) {
    var pres = prescribedShares(ctx, prog);
    var acc = {};
    function bucket(label) {
      if (!acc[label]) {
        acc[label] = { label: label, sets: 0, rawSets: 0, slots: 0, reps: 0,
                       volume: 0, exIds: {}, dates: {}, lastDate: null,
                       perSession: {} };
      }
      return acc[label];
    }
    /* Volume totals INCLUDE deloads - that work happened. Trends and flags do
       not, which is why the slope below is computed per session date and the
       exercise-level rows were already filtered. */
    sortedLog(win.entries).forEach(function (e) {
      Object.keys(e.exercises || {}).forEach(function (exId) {
        var label = (ctx.groupOf(exId) || {}).label || "OTHER";
        var b = bucket(label);
        var sets = e.exercises[exId] || [];
        /* Raw set count for display; countable sets (L/R pair = one) for the
           landmark comparison. */
        b.rawSets += sets.length;
        b.sets += countableSets(sets);
        b.slots++;                       // one exercise slot actually logged
        sets.forEach(function (s) {
          b.reps += setReps(s);
          var v = setVolume(s, ctx.bandOf);
          b.volume += v;
          b.perSession[e.date] = (b.perSession[e.date] || 0) + v;
        });
        b.exIds[exId] = true;
        b.dates[e.date] = true;
        if (!b.lastDate || e.date > b.lastDate) b.lastDate = e.date;
      });
    });
    /* Prescribed groups with zero logged volume still deserve a row: that
       absence is exactly what the report exists to surface. */
    Object.keys(pres.counts).forEach(function (label) { bucket(label); });

    var totalVol = Object.keys(acc).reduce(function (a, k) { return a + acc[k].volume; }, 0);
    var totalSlots = Object.keys(acc).reduce(function (a, k) { return a + acc[k].slots; }, 0);
    var weeks = (win.spanDays && win.spanDays > 0) ? (win.spanDays / 7) : 1;

    /* The share of weekly sets each group WOULD get if the landmarks were the
       plan. Used to tell a program-design gap ("your program prescribes 4% of
       its slots to QUADS against a 10-set landmark") apart from an adherence
       gap ("you skipped the quad slot"). Recommendation 14: same data, correct
       blame. */
    var landmarkTotal = 0;
    Object.keys(acc).forEach(function (k) {
      if (!isExempt(k) && SET_LANDMARKS[k] != null) landmarkTotal += SET_LANDMARKS[k];
    });

    /* VOLUME MODEL. SET_LANDMARKS encode a multi-set volume philosophy. A
       trainee following HIT (Yates / Mentzer / Jones) takes ONE set to
       momentary muscular failure by design, so measuring him against a
       10-sets/week CHEST landmark reports UNDER on every group, every week,
       forever - a flag that fires unconditionally carries no information and
       drowns the ones that do. Under "hit" the landmark is withheld and
       balance falls through to the program's own prescribed share, which the
       analyzer already treats as the primary test. Everything else - trends,
       stalls, neglect, adherence, progression - is unchanged. */
    var hitModel = (ctx.volumeModel === "hit");

    return Object.keys(acc).map(function (label) {
      var b = acc[label];
      var exempt = isExempt(label);
      var share = totalVol ? (b.volume / totalVol) * 100 : 0;      // INFORMATIONAL ONLY
      var slotShare = totalSlots ? (b.slots / totalSlots) * 100 : 0;
      var prescribedShare = pres.shares[label] || 0;
      var landmark = hitModel ? null : SET_LANDMARKS[label];
      var weeklySets = b.sets / weeks;
      var daysSince = b.lastDate ? daysBetween(b.lastDate, win.asOf) : null;
      var dates = Object.keys(b.perSession).sort();
      var sp = slopePct(dates.map(function (d) { return b.perSession[d]; }));
      var adherencePct = adherenceOf(slotShare, prescribedShare);
      var adherence = exempt ? "EXEMPT" : adherenceCodeOf(adherencePct);
      var balance = exempt ? "EXEMPT" : balanceOf(weeklySets, landmark, adherencePct);
      /* Is the shortfall the program's or yours? The program under-prescribes
         this group if its own prescribed slot share is well below the share the
         landmarks imply. */
      var impliedShare = (landmark != null && landmarkTotal)
        ? (landmark / landmarkTotal) * 100 : null;
      var programGap = !exempt && balance === "UNDER" && impliedShare != null &&
        prescribedShare > 0 && prescribedShare < impliedShare * CONST.UNDER_FACTOR;
      var neglect = exempt ? "EXEMPT" : neglectOf(daysSince);
      var flags = [];
      if (!exempt) {
        if (neglect === "DORMANT") {
          flags.push(daysSince == null
            ? "Never trained in this window"
            : "Dormant - " + daysSince + " days since last trained");
        } else if (neglect === "NEGLECTED") {
          flags.push("Neglected - " + daysSince + " days since last trained");
        }
        /* Flags cite the test that actually fired, in its own units. With no
           landmark - an unlisted group, or the HIT volume model - the test that
           fired was the prescribed-share one, and the flag has to say so; it
           used to interpolate the missing landmark and print "a landmark of
           undefined". */
        if (balance === "UNDER") {
          flags.push(landmark == null
            ? "Under-trained - logged " + Math.round(slotShare) +
              "% of slots against a prescribed " + Math.round(prescribedShare) + "%"
            : "Under-trained - " + weeklySets.toFixed(1) +
              " sets/week against a landmark of " + landmark +
              (programGap
                ? ". Your program only prescribes " + Math.round(prescribedShare) +
                  "% of its slots to " + label + " against the " +
                  Math.round(impliedShare) + "% the landmark implies - this is a " +
                  "program-design gap, not an adherence gap."
                : ""));
        } else if (balance === "OVER") {
          flags.push(landmark == null
            ? "Over-trained - logged " + Math.round(slotShare) +
              "% of slots against a prescribed " + Math.round(prescribedShare) + "%"
            : "Over-trained - " + weeklySets.toFixed(1) +
              " sets/week against a landmark of " + landmark +
              ". Consider moving a set to an under-trained group.");
        }
        /* Adherence is reported separately and labelled as such: it answers a
           different question from balance and must not be mistaken for it. */
        if (adherence === "UNDER") {
          flags.push("Adherence - logged " + Math.round(slotShare) +
            "% of slots against a prescribed " + Math.round(prescribedShare) +
            "% (you are skipping this group's slot)");
        } else if (adherence === "OVER") {
          flags.push("Adherence - logged " + Math.round(slotShare) +
            "% of slots against a prescribed " + Math.round(prescribedShare) +
            "% (you are adding work here beyond the program)");
        }
      }
      return {
        label: label, sets: b.sets, rawSets: b.rawSets, reps: b.reps, volume: b.volume,
        share: share,                     // volume share - INFORMATIONAL ONLY
        slotShare: slotShare, slots: b.slots,
        prescribedShare: prescribedShare, impliedShare: impliedShare,
        exercises: Object.keys(b.exIds).length,
        sessions: Object.keys(b.dates).length,
        daysSince: daysSince, slopePct: sp, trend: classifyTrend(sp),
        weeklySets: weeklySets, landmark: landmark == null ? null : landmark,
        balance: balance, adherence: adherence, adherencePct: adherencePct,
        programGap: programGap, neglect: neglect, flags: flags
      };
    }).sort(function (a, b) {
      return b.volume - a.volume || a.label.localeCompare(b.label);
    });
  }

  /* ---- analyzer: program block level ------------------------------------- */
  function analyzeBlocks(ctx, win) {
    var blocks = detectBlocks(win.entries);
    var rows = blocks.map(function (b) {
      var prog = ctx.progOf ? ctx.progOf(b.programId) : null;
      var prescribed = (prog && ctx.blockWorkoutsOf) ? ctx.blockWorkoutsOf(prog) : null;
      var vol = 0, sets = 0, reps = 0;
      var byGroup = {};
      b.entries.forEach(function (e) {
        Object.keys(e.exercises || {}).forEach(function (exId) {
          var label = (ctx.groupOf(exId) || {}).label || "OTHER";
          (e.exercises[exId] || []).forEach(function (s) {
            var v = setVolume(s, ctx.bandOf);
            vol += v; sets++; reps += setReps(s);
            byGroup[label] = (byGroup[label] || 0) + v;
          });
        });
      });
      var top = Object.keys(byGroup).map(function (g) {
        return { label: g, volume: byGroup[g] };
      }).sort(function (x, y) { return y.volume - x.volume; }).slice(0, 3);
      return {
        programId: b.programId,
        name: prog ? prog.name : ("P" + b.programId),
        from: b.from, to: b.to,
        logged: b.entries.length,
        prescribed: prescribed,
        adherence: prescribed ? (b.entries.length / prescribed) * 100 : null,
        volume: vol, sets: sets, reps: reps,
        volPerSession: b.entries.length ? vol / b.entries.length : 0,
        topGroups: top,
        vsPrev: null
      };
    });
    for (var i = 1; i < rows.length; i++) {
      var cur = rows[i], prv = rows[i - 1];
      rows[i].vsPrev = {
        volPerSession: prv.volPerSession
          ? ((cur.volPerSession - prv.volPerSession) / prv.volPerSession) * 100 : null,
        adherence: (prv.adherence != null && cur.adherence != null)
          ? cur.adherence - prv.adherence : null,
        against: prv.name + " (" + prv.from + ")"
      };
    }
    return rows;
  }

  /* Exercises the current program prescribes that never appear in the window. */
  function unloggedPrescribed(ctx, win, prog) {
    if (!prog || !ctx.splitDaysOf || !ctx.sessionExOf) return [];
    var seen = {};
    win.entries.forEach(function (e) {
      Object.keys(e.exercises || {}).forEach(function (id) { seen[String(id)] = true; });
    });
    var out = [], added = {};
    (ctx.splitDaysOf(prog) || []).forEach(function (sKey) {
      var s = ctx.sessionExOf(prog, sKey) || {};
      [s.primary || {}, s.accessories || {}].forEach(function (obj) {
        Object.keys(obj).forEach(function (slot) {
          var id = obj[slot];
          if (id == null) return;
          var k = String(id);
          if (seen[k] || added[k]) return;
          added[k] = true;
          out.push({ id: id, name: ctx.nameOf(id),
                     group: (ctx.groupOf(id) || {}).label || "OTHER" });
        });
      });
    });
    return out;
  }

  /* ---- recommendations ---------------------------------------------------
     Severity 1 dormant group, 2 stalled compound, 3 declining load, 4 under-
     volume group, 5 ready-to-progress, 6 minor (neglected group, stalled
     isolation, prescribed-but-unlogged). OVER volume and PRs are reported in
     their own sections and never consume a slot - they are not problems to act
     on. Capped at REC_CAP so the list stays actionable. */
  function buildRecommendations(ctx, exRows, groupRows, unlogged) {
    var recs = [];
    (groupRows || []).forEach(function (g) {
      if (g.balance === "EXEMPT" || g.neglect === "EXEMPT") return;
      if (g.neglect === "DORMANT") {
        recs.push({ severity: 1, code: "DORMANT", scope: "group", subject: g.label,
          detail: g.label + (g.daysSince == null ? " (never)" : " (" + g.daysSince + "d)"),
          text: g.label + " is dormant" +
            (g.daysSince == null ? " (never trained in this window)"
                                 : " (" + g.daysSince + " days)") +
            ". Schedule it into the next session before anything else." });
      } else if (g.neglect === "NEGLECTED") {
        recs.push({ severity: 6, code: "NEGLECTED", scope: "group", subject: g.label,
          detail: g.label + " (" + g.daysSince + "d)",
          text: g.label + " has not been trained in " + g.daysSince +
            " days. Work it back into the rotation." });
      }
      /* Balance recommendations are always stated in sets against the landmark,
         which is the test that fired. Volume share is never cited here - it is
         a different unit and citing it read as a contradiction. */
      if (g.balance === "UNDER") {
        if (g.programGap) {
          /* Recommendation 14: name the real cause. Telling someone to "stop
             skipping the slot" when the program barely prescribes one sends
             them to fix the wrong thing. */
          recs.push({ severity: 4, code: "UNDER_PROGRAM", scope: "group", subject: g.label,
            detail: g.label + " (" + g.weeklySets.toFixed(1) + " sets/wk vs " + g.landmark +
              ", program prescribes " + Math.round(g.prescribedShare) + "%)",
            text: g.label + " is under-trained at " + g.weeklySets.toFixed(1) +
              " sets/week against a landmark of " + g.landmark +
              ", but your program only prescribes " + Math.round(g.prescribedShare) +
              "% of its slots to " + g.label + " against the " + Math.round(g.impliedShare) +
              "% the landmark implies. This is a program-design gap, not an adherence gap" +
              (ctx.betterProgramFor ? ctx.betterProgramFor(g.label) : "") +
              ". Adding a set to the existing slot will not close it on its own." });
        } else if (g.landmark == null) {
          /* No landmark applied (unlisted group, or the HIT volume model): the
             prescribed-share test is what fired, so state it in those units
             rather than citing a landmark that was never used. */
          recs.push({ severity: 4, code: "UNDER", scope: "group", subject: g.label,
            detail: g.label + " (" + Math.round(g.slotShare) + "% of slots vs " +
              Math.round(g.prescribedShare) + "% prescribed)",
            text: g.label + " is under-trained: you logged " + Math.round(g.slotShare) +
              "% of your slots to it against the " + Math.round(g.prescribedShare) +
              "% your program prescribes. Stop skipping its slot." });
        } else {
          recs.push({ severity: 4, code: "UNDER", scope: "group", subject: g.label,
            detail: g.label + " (" + g.weeklySets.toFixed(1) + " sets/wk vs " + g.landmark + ")",
            text: g.label + " is under-trained: " + g.weeklySets.toFixed(1) +
              " sets/week against a landmark of " + g.landmark +
              ". Add a set or an exercise, or stop skipping its slot." });
        }
      } else if (g.balance === "OVER") {
        /* This used to be computed and thrown away - OVER produced no
           recommendation at all, so the signal was discarded. */
        recs.push(g.landmark == null
          ? { severity: 7, code: "OVER", scope: "group", subject: g.label,
              detail: g.label + " (" + Math.round(g.slotShare) + "% of slots vs " +
                Math.round(g.prescribedShare) + "% prescribed)",
              text: g.label + " is over-trained: you logged " + Math.round(g.slotShare) +
                "% of your slots to it against the " + Math.round(g.prescribedShare) +
                "% your program prescribes. Move a slot to an under-trained group " +
                "rather than adding one." }
          : { severity: 7, code: "OVER", scope: "group", subject: g.label,
              detail: g.label + " (" + g.weeklySets.toFixed(1) + " sets/wk vs " + g.landmark + ")",
              text: g.label + " is over-trained: " + g.weeklySets.toFixed(1) +
                " sets/week against a landmark of " + g.landmark +
                ". Recovery is the constraint at this volume - move a set to an " +
                "under-trained group rather than adding one." });
      }
      /* Adherence is its own recommendation, distinctly worded, so it is never
         mistaken for a balance judgment. */
      if (g.adherence === "UNDER" && g.balance !== "UNDER") {
        recs.push({ severity: 8, code: "ADHERENCE", scope: "group", subject: g.label,
          detail: g.label + " (" + Math.round(g.slotShare) + "% vs " +
            Math.round(g.prescribedShare) + "% prescribed)",
          text: g.label + ": you logged " + Math.round(g.slotShare) +
            "% of your slots here against a prescribed " + Math.round(g.prescribedShare) +
            "%. Its weekly sets are still adequate, so this is about following " +
            "the program rather than about volume." });
      }
    });
    (exRows || []).forEach(function (r) {
      if (!r.verdict) return;
      if (r.verdict.code === "STALLED") {
        recs.push({ severity: r.cls === "comp" ? 2 : 6, code: "STALLED",
          scope: "exercise", subject: r.name, text: r.name + ": " + r.verdict.text });
      } else if (r.verdict.code === "DECLINING") {
        recs.push({ severity: 3, code: "DECLINING", scope: "exercise",
          subject: r.name, text: r.name + ": " + r.verdict.text });
      } else if (r.verdict.code === "READY") {
        recs.push({ severity: 5, code: "READY", scope: "exercise",
          subject: r.name, text: r.name + ": " + r.verdict.text });
      } else if (r.verdict.code === "EX_DORMANT") {
        recs.push({ severity: 4, code: "EX_DORMANT", scope: "exercise",
          subject: r.name, text: r.name + ": " + r.verdict.text });
      }
    });
    (unlogged || []).forEach(function (u) {
      recs.push({ severity: 6, code: "UNLOGGED", scope: "exercise", subject: u.name,
        text: u.name + " (" + u.group +
          ") is in your program but has no logged sets in this window." });
    });
    /* Dedupe on code+subject, keeping the most severe instance. */
    var seen = {}, uniq = [];
    recs.sort(function (a, b) { return a.severity - b.severity; }).forEach(function (r) {
      var k = r.code + "|" + r.subject;
      if (seen[k]) return;
      seen[k] = true;
      uniq.push(r);
    });

    /* Collapse group-scope items sharing a code into ONE entry. Eight separate
       "X is dormant" lines would fill the cap and push out the per-exercise
       advice, which is the wall the cap exists to prevent. Exercise-scope items
       stay separate - each carries different advice. */
    var byCode = {}, order = [], out = [];
    uniq.forEach(function (r) {
      if (r.scope !== "group") { out.push(r); return; }
      if (!byCode[r.code]) { byCode[r.code] = []; order.push(r.code); }
      byCode[r.code].push(r);
    });
    order.forEach(function (code) {
      var list = byCode[code];
      if (list.length === 1) { out.push(list[0]); return; }
      var lead = { DORMANT: "groups are dormant",
                   NEGLECTED: "groups have not been trained recently",
                   UNDER: "groups are under-trained",
                   OVER: "groups are over-represented" }[code] || ("groups flagged " + code);
      var detail = list.map(function (r) { return r.detail || r.subject; }).join(", ");
      out.push({
        severity: list[0].severity,
        code: code,
        scope: "group",
        subject: list.length + " groups",
        text: list.length + " " + lead + ": " + detail + "."
      });
    });
    out.sort(function (a, b) { return a.severity - b.severity; });
    return out.slice(0, CONST.REC_CAP);
  }

  /* ---- the single public entry point ------------------------------------- */
  function analyze(ctx, opts) {
    opts = opts || {};
    var win = resolveWindow(ctx, opts);
    var prog = opts.prog || null;

    function totalsOf(entries) {
      var t = { sessions: (entries || []).length, sets: 0, reps: 0, volume: 0 };
      (entries || []).forEach(function (e) {
        Object.keys(e.exercises || {}).forEach(function (exId) {
          (e.exercises[exId] || []).forEach(function (s) {
            t.sets++; t.reps += setReps(s); t.volume += setVolume(s, ctx.bandOf);
          });
        });
      });
      return t;
    }
    function pct(cur, prev) {
      if (prev == null || prev === 0) return null;
      return ((cur - prev) / prev) * 100;
    }

    var totals = totalsOf(win.entries);
    var prevTotals = win.prevEntries ? totalsOf(win.prevEntries) : null;
    var exercises = analyzeExercises(ctx, win);
    var groups = analyzeGroups(ctx, win, prog);
    var blocks = analyzeBlocks(ctx, win);
    var unlogged = unloggedPrescribed(ctx, win, prog);
    var recommendations = buildRecommendations(ctx, exercises, groups, unlogged);

    var notes = [];
    notes.push(blocks.length + " program block(s) detected in this window" +
      (blocks.length ? ": " + blocks.map(function (b) {
        return b.name + " " + b.from + " to " + b.to;
      }).join("; ") : "") + ".");
    notes.push("Blocks are inferred from programId changes and workoutNum restarts; " +
      "a past session logged out of order can split one.");
    notes.push("Deload sessions count toward volume and adherence but are excluded " +
      "from every trend, stall and progression judgment.");
    /* Recommendation 21: say what the load axis actually is, on the report
       itself, every time. Band force is a function of ELONGATION, not of band
       identity: these figures come from the midpoint of each band's rated
       range, at a stretch the manufacturer does not state. */
    notes.push("LOAD IS AN INDEX, NOT POUNDS. Every load and volume figure here " +
      "comes from the midpoint of each band's manufacturer-rated range, at an " +
      "unstated stretch. Band force depends on how far the band is stretched, " +
      "which the log does not record - the median band's own published range " +
      "spans +/-45% around its midpoint. Use these numbers to compare a lift " +
      "against itself over time; do not read them as pounds, and do not compare " +
      "them across brands.");
    notes.push(ctx.volumeModel === "hit"
      ? "VOLUME MODEL: HIT. Your profile trains one set to muscular failure, so " +
        "the weekly working-set landmarks (CHEST 10, BICEPS 6, ...) are NOT " +
        "applied - they encode a multi-set philosophy you have deliberately " +
        "rejected, and against them every group would read UNDER forever. " +
        "Balance is judged against your program's own prescribed slot share " +
        "instead. The LANDMARK column reads '-' for this reason, not because " +
        "the group is unlisted. Volume share is shown for information only and " +
        "raises no flag."
      : "Balance is judged on weekly hard sets against the group landmark " +
        "(sets against sets). Volume share is shown for information only and " +
        "raises no flag. Whether you logged the mix your program prescribes is " +
        "reported separately as adherence.");
    notes.push("Direction (GROWING / DECLINING) is only asserted at " +
      CONST.TREND_MIN_N + " or more sessions in the window. A 3x/week trainee on " +
      "the 5-session rotation reaches n=3 per exercise per block and n=2 at the " +
      "30-day window.");

    return {
      window: win, totals: totals, prevTotals: prevTotals,
      deltas: {
        volume: prevTotals ? pct(totals.volume, prevTotals.volume) : null,
        reps: prevTotals ? pct(totals.reps, prevTotals.reps) : null,
        sessions: prevTotals ? pct(totals.sessions, prevTotals.sessions) : null
      },
      exercises: exercises, groups: groups, blocks: blocks,
      unlogged: unlogged, recommendations: recommendations, notes: notes
    };
  }

  /* ---- analysis report ---------------------------------------------------- */
  /* Takes an analyze() result only - every label it needs is already resolved,
     so it needs no ctx and cannot reach app state. */
  function buildAnalysisDoc(res) {
    var w = res.window;
    var meta = [
      { label: "WINDOW", value: w.label },
      { label: "SPAN", value: w.from + " to " + w.to },
      { label: "SESSIONS", value: String(res.totals.sessions) },
      { label: "SETS", value: fmtNum(res.totals.sets) },
      { label: "VOLUME", value: fmtNum(res.totals.volume) + " lb-reps" }
    ];
    var sections = [];

    if (!res.totals.sessions) {
      sections.push({ heading: "HEADLINE", type: "notes",
        rows: ["No sessions logged in this window - nothing to analyze yet. " +
               "Log a workout on the TODAY tab and the analysis will fill in."] });
      return { kind: "analysis", title: "PROGRESS ANALYSIS", meta: meta,
               sections: sections, generatedAt: new Date().toISOString() };
    }

    /* HEADLINE */
    var prs = res.exercises.filter(function (r) { return r.isPR; });
    var head = [
      { label: "SESSIONS", value: String(res.totals.sessions) +
        (res.deltas.sessions != null
          ? "  (" + fmtDelta(res.deltas.sessions) + " vs previous period)" : "") },
      { label: "TOTAL SETS", value: fmtNum(res.totals.sets) },
      { label: "TOTAL REPS", value: fmtNum(res.totals.reps) },
      { label: "TOTAL VOLUME", value: fmtNum(res.totals.volume) + " lb-reps" +
        (res.deltas.volume != null
          ? "  (" + fmtDelta(res.deltas.volume) + " vs previous period)" : "") },
      { label: "EXERCISES TRAINED", value: String(res.exercises.length) },
      { label: "PRs THIS WINDOW", value: String(prs.length) }
    ];
    if (prs.length) {
      head.push({ label: "PR LIFTS", value: prs.map(function (r) {
        return r.name + " " + fmtNum(r.lastTop) + " lb";
      }).join(" | ") });
    }
    sections.push({ heading: "HEADLINE", type: "kv", rows: head });

    /* BY PROGRAM BLOCK */
    if (res.blocks.length) {
      sections.push({ heading: "BY PROGRAM BLOCK", type: "table",
        cols: ["BLOCK", "SPAN", "LOGGED", "PRESCRIBED", "ADHERENCE",
               "VOLUME", "VOL/SESSION", "VS PREV"],
        rows: res.blocks.map(function (b) {
          return [
            "P" + b.programId + " " + b.name,
            b.from + " to " + b.to,
            String(b.logged),
            b.prescribed == null ? "-" : String(b.prescribed),
            b.adherence == null ? "-" : Math.round(b.adherence) + "%",
            fmtNum(b.volume),
            fmtNum(b.volPerSession),
            (b.vsPrev && b.vsPrev.volPerSession != null)
              ? fmtDelta(b.vsPrev.volPerSession) + " vol/session" : "-"
          ];
        }) });
      sections.push({ heading: "BLOCK EMPHASIS (top groups by volume)", type: "kv",
        rows: res.blocks.map(function (b) {
          return { label: "P" + b.programId + " " + b.name,
                   value: b.topGroups.length
                     ? b.topGroups.map(function (g) {
                         return g.label + " " + fmtNum(g.volume);
                       }).join(" | ")
                     : "no volume recorded" };
        }) });
    }

    /* BY MUSCLE GROUP */
    sections.push({ heading: "BY MUSCLE GROUP (volume share)", type: "bars",
      rows: res.groups.map(function (g) {
        var note = [];
        if (g.balance === "UNDER") note.push("UNDER");
        if (g.balance === "OVER") note.push("OVER");
        if (g.neglect === "NEGLECTED") note.push("NEGLECTED");
        if (g.neglect === "DORMANT") note.push("DORMANT");
        if (g.trend === "GROWING") note.push("rising");
        if (g.trend === "DECLINING") note.push("falling");
        return { label: g.label, value: fmtNum(g.volume), pct: g.share,
                 note: note.length ? note.join(" ") : null };
      }) });
    sections.push({ heading: "MUSCLE GROUP DETAIL", type: "table",
      cols: ["GROUP", "SETS", "SETS/WK", "LANDMARK", "SHARE", "PRESCRIBED",
             "BALANCE", "LAST TRAINED", "TREND"],
      rows: res.groups.map(function (g) {
        return [ g.label, String(g.sets), g.weeklySets.toFixed(1),
          g.landmark == null ? "-" : String(g.landmark),
          Math.round(g.share) + "%", Math.round(g.prescribedShare) + "%",
          g.balance,
          g.daysSince == null ? "never" : g.daysSince + "d ago",
          g.trend ];
      }) });
    var gFlags = [];
    res.groups.forEach(function (g) {
      (g.flags || []).forEach(function (f) { gFlags.push(g.label + ": " + f); });
    });
    if (gFlags.length) {
      sections.push({ heading: "GROUP FLAGS", type: "notes", rows: gFlags });
    }

    /* BY EXERCISE, grouped under its muscle group */
    var byGroup = {};
    res.exercises.forEach(function (r) {
      if (!byGroup[r.group]) byGroup[r.group] = [];
      byGroup[r.group].push(r);
    });
    var exRows = [];
    Object.keys(byGroup).sort().forEach(function (label) {
      exRows.push(["-- " + label + " --", "", "", "", "", "", ""]);
      byGroup[label].forEach(function (r) {
        exRows.push([
          r.name + " (#" + r.id + ")",
          String(r.n),
          fmtNum(r.firstTop) + " -> " + fmtNum(r.lastTop),
          fmtDelta(r.deltaPct),
          r.trend + (r.isPR ? " PR" : ""),
          r.bestReps + r.unit + " / " + r.thresh + r.unit,
          r.verdict.code
        ]);
      });
    });
    sections.push({ heading: "BY EXERCISE", type: "table",
      cols: ["EXERCISE", "N", "TOP LOAD", "DELTA", "TREND", "BEST/TARGET", "VERDICT"],
      rows: exRows });
    sections.push({ heading: "EXERCISE VERDICTS", type: "notes",
      rows: res.exercises.map(function (r) { return r.name + " - " + r.verdict.text; }) });

    /* RECOMMENDATIONS */
    sections.push({ heading: "RECOMMENDATIONS", type: "notes",
      rows: res.recommendations.length
        ? res.recommendations.map(function (r, i) {
            return (i + 1) + ". [" + r.code + "] " + r.text;
          })
        : ["Nothing needs attention in this window - everything is either " +
           "progressing or on schedule."] });

    if (res.unlogged.length) {
      sections.push({ heading: "PRESCRIBED BUT UNLOGGED", type: "notes",
        rows: res.unlogged.map(function (u) {
          return u.name + " (#" + u.id + ", " + u.group + ")";
        }) });
    }

    sections.push({ heading: "METHOD NOTES", type: "notes", rows: res.notes });

    return { kind: "analysis", title: "PROGRESS ANALYSIS", meta: meta,
             sections: sections, generatedAt: new Date().toISOString() };
  }


  /* ---- gear geometry table -------------------------------------------- */
  /* Moved here from fitness_app.html 2026-07-31 so both apps share one
     copy -- see resolveGearDims below and gearPathDelta above. */
  var GEAR_DIMS = {
    // ---- Harambe ---------------------------------------------------------
    "Harambe|T Bar":            { lengthIn: 28, hookOffsetIn: 3, hookSide: "opposite",
                                  attachSpanIn: 26, source: "measured", verified: true },
    "Harambe|Cyberplate":       { thicknessIn: 2, lengthIn: 22, widthIn: 11.75,
                                  channelIn: 1, bandSpanIn: 22.25,
                                  source: "measured", verified: true },
    /* CORRECTED 2026-07-31, and the correction is large. This read seriesIn 7.75
       from 2026-07-30 to 2026-07-31 because 7 3/4in is the OVERALL LENGTH OF THE
       HANDLE, not the load-bearing series length — Greg's own words: "Originally
       misunderstood. Series length 7 3/4in is the length of the handle itself."
       The band bears about 1.5in from where the hand does.
       Consequence: the model was crediting 6.25in of series length per side that
       does not exist, so it UNDERSTATED stretch and therefore understated load on
       every handle setup. Entries logged in that window keep their stamped effLb
       (stampLoad freezes it at save time, deliberately) — they are not silently
       rewritten, but they are low by that amount. */
    "Harambe|Handles":          { seriesIn: 1.5, gripDiaIn: 1.25, source: "measured", verified: true,
                                  note: "1 1/2in series (band bearing point to grip). The 7 3/4in figure carried until 2026-07-31 was the handle's overall length — a different measurement entirely." },
    /* Rods contribute ZERO to the path on their own, deliberately.
       A rod and a rope NEST rather than add: Greg measured a standard 6" rod with
       a 5" black rope and the assembly's series length is 2 3/4", not 11". Summing
       them would overstate the shortening by roughly 4x and make every load
       derived from that setup wrong in the confident direction. Until more
       rod+rope combinations are measured, the ROPE carries the series length and
       the rod carries none. gearChange still reports that the setup changed, so
       nothing is silently ignored.
       ASSERTED in test_gear_geometry.cjs — do not "fix" this by adding 6. */
    "Harambe|Rods":             { lengthIn: 6, seriesIn: 0, nonAdditive: true,
                                  source: "measured", verified: true,
                                  note: "standard rod 6in, travel rod 4in, both stainless. Series length is EMERGENT, not additive: 6in rod + 5in black rope measures 2.75in, not 11in. Contributes 0 until more combinations are measured." },
    /* Harambe ropes are colour-coded by length (Greg, 2026-07-30):
       Black 5", Yellow 6", White 12.5", Blue 29". NONE of these is additive with
       a rod — see the Rods entry. */
    "Harambe|Black Ropes":      { seriesIn: 5, source: "measured", verified: true,
                                  note: "set of 4, 5in. Adjusted with stackable 1/2in spacers. NOT additive with a rod." },
    "Harambe|Yellow Ropes":     { seriesIn: 6, source: "measured", verified: true,
                                  note: "set of 4, 6in. NOT additive with a rod." },
    "Harambe|Blue Ropes":       { seriesIn: 29, source: "measured", verified: true,
                                  note: "29in. NOT OWNED YET — seeded inbound so the figure is ready when it arrives." },
    "Harambe|White Ropes":      { seriesIn: 12.5, source: "measured", verified: true,
                                  note: "set of 4, 12.5in. Adjusted with 1/2in spacers. NOT additive with a rod." },
    "Harambe|Split Squat Belt": { seriesIn: 40, wornHeightIn: 36, source: "measured", verified: true },
    "Harambe|Wedges":           { thicknessIn: 1.375, source: "measured", verified: true,
                                  note: "RAMP, not a slab: 2.5in at the high end, 0.25in at the low end, 8.75in of ramp. 1.375 is the mean; used both directions depending on the lift." },
    "Harambe|Foam Block":       { thicknessIn: 6, lengthIn: 9, widthIn: 3.5,
                                  source: "measured", verified: true,
                                  note: "a place to rest a bar during setup — not in the load path" },
    // ---- X3 Bar ----------------------------------------------------------
    "X3 Bar|Steel Ground Plate":{ thicknessIn: 1, lengthIn: 19.25, widthIn: 9.875,
                                  channelIn: 0.875, bandSpanIn: 19.75,
                                  source: "measured", verified: true },
    "X3 Bar|Elite Bar":         { lengthIn: 21.5, hookOffsetIn: 1.875, hookSide: "opposite",
                                  attachSpanIn: 20.375, source: "measured", verified: true },
    "X3 Bar|Force Bar":         { lengthIn: 22.375, hookOffsetIn: 1.75, hookSide: "opposite",
                                  attachSpanIn: 20.375, source: "measured", verified: true },
    "X3 Bar|Squat Belt (Medium)": { seriesIn: 40, wornHeightIn: 36, source: "measured", verified: true },
    // ---- Clench ----------------------------------------------------------
    "Clench|Carbon Pro Bar":    { lengthIn: 26, hookOffsetIn: 3.25, hookSide: "opposite",
                                  attachSpanIn: 25, source: "measured", verified: true },
    "Clench|Carbon EZ Bar":     { lengthIn: 34.25, hookOffsetIn: 3, hookSide: "opposite",
                                  attachSpanIn: 33.25, source: "measured", verified: true },
    "Clench|Footplate":         { thicknessIn: 1.5, lengthIn: 23.875, widthIn: 14.875,
                                  channelIn: 0.5, bandSpanIn: 24.25,
                                  source: "measured", verified: true },
    "Clench|Handles":           { seriesIn: 1.5, gripDiaIn: 1.25, source: "measured", verified: true,
                                  note: "measured 2026-07-31. Was an unmeasured 5.5in estimate — the estimate was ~3.7x too long, in the direction that understates load." },
    "Clench|Heavy Duty Anchors":{ seriesIn: 10, source: "measured", verified: true,
                                  note: "measured 2026-07-31 at 10in, which is what the estimate happened to say. Mounted at any height; Greg: \"basically the same as the RBT Band Utility Strap — tied to anything as an anchor point\"." },
    // ---- Serious Steel ---------------------------------------------------
    /* bandSpanIn REMOVED 2026-07-31. It read 20.5 under source:"measured",
       verified:true — but the worksheet's span field for this platform is blank,
       and always has been. 20.5 was interpolated from the other platforms (each
       spans a little more than its long dimension) and then stamped as Greg's
       tape. A vendor spec is not a measurement of this unit, and neither is an
       interpolation. The field is optional and falls back cleanly when absent;
       re-add it if and when the platform is actually measured. */
    "Serious Steel|Acacia Training Platform": { thicknessIn: 2.125, lengthIn: 20, widthIn: 11.75,
                                  channelIn: 1.125,
                                  source: "measured", verified: true },
    "Serious Steel|Door Anchor":{ seriesIn: 5.5, doorThicknessIn: 1.5, source: "measured", verified: true,
                                  note: "measured 2026-07-31 at 5 1/2in — the unmeasured estimate said 10in, nearly double. Mounts on a 1 1/2in door; Greg uses it anywhere from 2in to 80in off the floor." },
    "Serious Steel|Large Band Guard": { lengthIn: 24, source: "measured", verified: true,
                                  note: "slides freely, so it does not shorten the stretching section; placed around the band against abrasive surfaces" },
    // ---- HeavyDutyBar ----------------------------------------------------
    "HeavyDutyBar|Swift Bar":   { lengthIn: 23.75, hookOffsetIn: 2.375, hookSide: "opposite",
                                  attachSpanIn: 21.5, source: "measured", verified: true },
    "HeavyDutyBar|Bantam Bar":  { lengthIn: 27.75, hookOffsetIn: 2.375, hookSide: "opposite",
                                  attachSpanIn: 26, source: "measured", verified: true },
    "HeavyDutyBar|Qlaw Handles":{ seriesIn: 1.75, gripDiaIn: 1.125, source: "measured", verified: true,
                                  note: "measured 2026-07-31. Was an unmeasured 5.5in estimate." },
    "HeavyDutyBar|Qdeck":       { thicknessIn: 2, lengthIn: 24, widthIn: 12.5,
                                  channelIn: 0.75, bandSpanIn: 24.125,
                                  source: "measured", verified: true },
    "HeavyDutyBar|Travel Platform": { thicknessIn: 1.625, lengthIn: 19.75, widthIn: 11.1875,
                                  channelIn: 0.875, bandSpanIn: 20,
                                  source: "measured", verified: true },
    "HeavyDutyBar|Elevators":   { thicknessIn: 0.4375, source: "measured", verified: true,
                                  maxStackIn: 4,
                                  note: "7/16in each, NOT the 2in that was estimated — the panel's '+18% for a 2in elevator' does not apply to these. Used on top of the Qdeck. They stack, but Greg caps a stack at 4in total (that is a limit, not the height of two)." },
    // ---- RBT -------------------------------------------------------------
    "RBT|Band Utility Strap":   { seriesIn: 10, source: "measured", verified: true,
                                  note: "10in fully extended, 5in at the shortest usable setting; all four identical. Functions as an anchor." },
  };

  var GEAR_DIM_FIELDS = [
    { k:"thicknessIn",  l:"Thickness",    hint:"floor to standing surface", types:["footplate","other"] },
    { k:"channelIn",    l:"Channel depth",hint:"if the band runs in a slot", types:["footplate"] },
    { k:"lengthIn",     l:"Length",       hint:"overall",                   types:["bar","footplate","other"] },
    { k:"widthIn",      l:"Width",        hint:"",                          types:["footplate","other"] },
    { k:"hookOffsetIn", l:"Hook offset",  hint:"grip axis to band bearing surface", types:["bar"] },
    { k:"attachSpanIn", l:"Attach span",  hint:"between the two band points",types:["bar"] },
    { k:"seriesIn",     l:"Series length",hint:"band bearing point to your grip", types:["handle","anchor","belt","other"] },
  ];
  var GEAR_DIMS_REV = "2026-07-31-measured-r3";

  /* Shallow copy. rbts_reports.js uses no Object.assign anywhere and that is
     deliberate -- keep it that way. */
  function assign(a, b) {
    var out = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
    return out;
  }

  function gearDimFieldsFor(type) {
    return GEAR_DIM_FIELDS.filter(function (f) {
      return f.types.indexOf(type || "other") >= 0;
    });
  }

  function seedDimsFor(brand, name) {
    var d = GEAR_DIMS[brand + "|" + name];
    if (!d) return { source: "estimated", verified: false, seedRev: GEAR_DIMS_REV };
    var out = assign(d, {});
    out.verified = (d.source === "measured" && d.verified === true);
    out.seedRev = GEAR_DIMS_REV;
    return out;
  }

  function gearDimSource(it) {
    var d = it && it.dims;
    if (!d) return "none";
    if (d.verified) return "measured";
    return d.source || "estimated";
  }

  /* THE resolution order, shared by both apps.
       1. userEdited      -> always wins; a number the user typed is the
                             measurement, and no table revision may overwrite it
       2. current seedRev -> the stored copy is up to date, use it
       3. table lookup    -> by brand|name. THIS is what makes the PWA work:
                             it deliberately never seeds gear (multi-user - no
                             one inherits anyone else's inventory), so its items
                             arrive from Firestore with no dims at all.
       4. nothing         -> an unverified estimate; contributes 0 to the path
                             and leaves the load at RATED. Never throws, never
                             invents a number. */
  function resolveGearDims(it) {
    if (!it) return { source: "estimated", verified: false };
    var d = it.dims;
    if (d && d.userEdited) return d;
    if (d && d.seedRev === GEAR_DIMS_REV) return d;
    return seedDimsFor(it.brand, it.name);
  }

  /* ---- public API ------------------------------------------------------- */
  var API = {
    CONST: CONST,
    SET_LANDMARKS: SET_LANDMARKS,
    TIME_BASED: TIME_BASED,
    isExempt: isExempt,
    isTimeBased: isTimeBased,
    threshOf: threshOf,
    repUnit: repUnit,
    parseResRange: parseResRange,
    sumRes: sumRes,
    bandMid: bandMid,
    setSegments: setSegments,
    setReps: setReps,
    setBands: setBands,
    setIntens: setIntens,
    isPlainSet: isPlainSet,
    setSide: setSide,
    setPartials: setPartials,
    setTopLoad: setTopLoad,
    setVolume: setVolume,
    sortedLog: sortedLog,
    lastUse: lastUse,
    exHistory: exHistory,
    isStalled: isStalled,
    progressionState: progressionState,
    detectBlocks: detectBlocks,
    esc: esc,
    barText: barText,
    renderMarkdown: renderMarkdown,
    renderPrintHTML: renderPrintHTML,
    PRINT_CSS: PRINT_CSS,
    bandStackLabel: bandStackLabel,
    bandCatalogLabel: bandCatalogLabel,
    gearLabel: gearLabel,
    repsLabel: repsLabel,
    pullList: pullList,
    buildSetupDoc: buildSetupDoc,
    entryTotals: entryTotals,
    fmtNum: fmtNum,
    fmtDelta: fmtDelta,
    setLines: setLines,
    rangeExTable: rangeExTable,
    buildHistoryDoc: buildHistoryDoc,
    daysBetween: daysBetween,
    shiftISO: shiftISO,
    localISO: localISO,
    SAFETY_DOC: SAFETY_DOC,
    RETURN_DAYS: RETURN_DAYS,
    returningState: returningState,
    EX_CAUTION: EX_CAUTION,
    TECH_CAUTION: TECH_CAUTION,
    exCautionOf: exCautionOf,
    techCautionOf: techCautionOf,
    stackSuggestions: stackSuggestions,
    STACK_MAX: STACK_MAX,
    LOAD_MODEL: LOAD_MODEL,
    bandForceAt: bandForceAt,
    gearPathDelta: gearPathDelta,
    GEAR_DIMS: GEAR_DIMS,
    GEAR_DIMS_REV: GEAR_DIMS_REV,
    GEAR_DIM_FIELDS: GEAR_DIM_FIELDS,
    gearDimFieldsFor: gearDimFieldsFor,
    seedDimsFor: seedDimsFor,
    gearDimSource: gearDimSource,
    resolveGearDims: resolveGearDims,
    gearDimsVerified: gearDimsVerified,
    effectiveLoad: effectiveLoad,
    stampLoad: stampLoad,
    gearChange: gearChange,
    resolveWindow: resolveWindow,
    slopePct: slopePct,
    classifyTrend: classifyTrend,
    analyzeExercises: analyzeExercises,
    exerciseVerdict: exerciseVerdict,
    prescribedShares: prescribedShares,
    balanceOf: balanceOf,
    adherenceOf: adherenceOf,
    adherenceCodeOf: adherenceCodeOf,
    countableSets: countableSets,
    neglectOf: neglectOf,
    analyzeGroups: analyzeGroups,
    analyzeBlocks: analyzeBlocks,
    unloggedPrescribed: unloggedPrescribed,
    buildRecommendations: buildRecommendations,
    analyze: analyze,
    buildAnalysisDoc: buildAnalysisDoc,
  };

  root.RBTS_REPORTS = API;

})(typeof globalThis !== "undefined" ? globalThis : this);
const RBTS_REPORTS = (typeof globalThis !== 'undefined' ? globalThis : window).RBTS_REPORTS;
export default RBTS_REPORTS;
