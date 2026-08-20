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
       working stretch (strain 0.5).

       The fit is THREE SEGMENTS and continuous:

         strain <= 0            0 lb. A slack band pulls on nothing.
         0 < strain < 0.5       a straight ramp from the origin up to the
                                vendor's rated MINIMUM at strain 0.5.
         strain >= 0.5          the LINEAR fit between rated min and rated
                                max, extended above 1.5.

       Only the middle segment is new, and it is an EXTRAPOLATION BELOW
       ANYTHING THE VENDOR PUBLISHES: no manufacturer rates a band under its
       rated minimum, so nothing anchors that ramp except the two facts that a
       band at zero stretch makes zero force and the curve must meet the rated
       minimum where the rated range begins. Sub-rated figures are therefore
       the least reliable numbers this model produces -- report them, flag
       them (`belowRated`), do not treat them as measurements. What they are
       NOT is what preceded them: running the upper line backwards past its
       own lower anchor produced negative force, which `f < 0 ? 0 : f` then
       hid as a confident 0 lb.

       Above strain 0.5 the fit is linear: real latex stiffens toward the top
       of its range, so modeled figures understate load at high stretch.
       Measured points remove the assumption entirely, which is the whole
       reason for the Tension Master. */
    STRAIN_AT_RATED_MIN: 0.5,
    STRAIN_AT_RATED_MAX: 1.5,
    /* Assumed working strain of a REFERENCE setup - the strain at which a
       band produces its rated midpoint, i.e. exactly what the app has always
       implicitly assumed. Gear deltas move away from this point. */
    REF_STRAIN: 1.0,
    MIN_MEASURED_POINTS: 2
  };

  /* Force in lb at a given absolute stretched-past-rest distance.
     stretchIn is how far BEYOND its rest length the loop has been pulled.

     With >= 2 Tension Master readings this interpolates them and never
     reaches the fitted curve at all. Otherwise it evaluates the three-segment
     fit described on LOAD_MODEL:

       s <= 0        0 -- a slack band makes no force.
       0 < s < lo    r.min * (s / lo) -- a straight ramp from the origin,
                     meeting the rated minimum exactly at s === lo so the two
                     segments join continuously. THIS SEGMENT IS AN
                     EXTRAPOLATION BELOW THE VENDOR'S PUBLISHED RANGE and is
                     the least reliable output of the whole model; callers
                     surface it as `belowRated`.
       s >= lo       the linear rated fit, unchanged.

     Before this ramp existed the upper line was simply run BACKWARDS below
     strain 0.5, went negative, and was clamped to 0 -- so a genuinely light
     but real setup reported a confident zero pounds. */
  function bandForceAt(band, stretchIn, geom) {
    if (!band) return 0;
    var rest = (geom && isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
      ? geom.restLengthIn : (band.lengthIn || 0);
    if (!rest) return bandMid(band);
    var pts = (geom && Array.isArray(geom.measured)) ? sanitizeMeasuredPoints(geom.measured) : [];

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
    if (s <= 0) return 0;                       // slack: no force, not a fit
    if (s < lo) return r.min * (s / lo);        // sub-rated ramp from the origin
    var f = r.min + (r.max - r.min) * ((s - lo) / (hi - lo));
    return f < 0 ? 0 : f;                                       // never negative
  }

  /* ---- band calibration: rest length + Tension Master readings ----------
     BandCalibration (both apps) is a physical-measurement form, not a
     report, but the arithmetic under it -- parsing a typed number, rejecting
     garbage, and keeping the "fewer than 2 points is never MEASURED" floor
     (LOAD_MODEL.MIN_MEASURED_POINTS) in exactly one place -- is exactly the
     kind of thing a UI-only implementation would duplicate twice and drift.
     Storage (rbts_bandGeom, keyed by band id) stays entirely in each app;
     this module only ever sees one band's { restLengthIn, measured } entry
     and hands back a new one. Nothing here touches the DOM or localStorage. */

  /* Filter to complete points and sort ascending by stretch -- the same
     filter+sort bandForceAt above needed for interpolation, now shared so the
     calibration panel's own MEASURED/RATED badge can never disagree with what
     the load model actually does with the same points. */
  function sanitizeMeasuredPoints(points) {
    /* > 0, not just isFinite: isFinite(null) is true (null coerces to 0), so a
       plain isFinite check would treat a padded-but-half-filled slot -- one
       field typed, the other still literally `null` -- as a complete "0 lb"
       reading and feed a fabricated data point into the interpolation. */
    return (points || []).filter(function (p) {
      return p && isFinite(p.stretchIn) && p.stretchIn > 0 &&
                  isFinite(p.lb) && p.lb > 0;
    }).slice().sort(function (a, b) { return a.stretchIn - b.stretchIn; });
  }

  /* MEASURED/RATED for display, routed through the one MIN_MEASURED_POINTS
     constant so the calibration panel's badge and the load model's
     provenance can never disagree about where the floor sits. */
  function bandCalibrationLabel(points) {
    return sanitizeMeasuredPoints(points).length >= LOAD_MODEL.MIN_MEASURED_POINTS
      ? "MEASURED" : "RATED";
  }

  /* A typed rest length. `entry` is the band's current geom entry (or
     null/undefined for a band with none yet); `raw` is the input's string
     value. "" clears the field -- a band can go back to "not yet measured".
     A non-numeric or non-positive value is REJECTED: a 0in or negative rest
     length is not a usable measurement, so `entry` comes back as an
     unmodified copy rather than storing a number that would just get
     silently treated as "no rest length" by bandForceAt's `if (!rest)` guard
     anyway. Never mutates `entry`; always returns a new object. */
  function applyBandRestLengthEdit(entry, raw) {
    var e = assign(entry || {}, {});
    if (raw === "" || raw === null || raw === undefined) {
      delete e.restLengthIn;
      return e;
    }
    var v = Number(raw);
    if (!isFinite(v) || v <= 0) return assign(entry || {}, {});
    e.restLengthIn = v;
    return e;
  }

  /* One Tension Master reading, edited by UI slot index -- the panel shows a
     fixed set of READING 1/2/3 rows, so `index` addresses a slot rather than
     an array position. `points` is the band's current measured array (may be
     short or have incomplete entries); `field` is "stretchIn" or "lb"; `raw`
     is the input's string value.

     Padding keeps an earlier slot addressable even when a later one is
     filled first (READING 2 before READING 1 is a normal thing to do while
     measuring). "" clears that one field, which drops the point back to
     incomplete. A non-numeric or non-positive raw is REJECTED and the point
     at that index is left exactly as it was.

     Deliberately does NOT filter or sort -- it returns the slots exactly as
     the three visible rows would show them, including a row with only one
     field filled in. Reordering or dropping a half-filled row here would
     make a value the user just typed vanish or jump to a different visible
     row the moment they filled the OTHER field of a different reading.
     sanitizeMeasuredPoints (called by the load model and the calibration
     badge) is what decides what counts as a real, usable reading; this
     function only ever decides what one row's edit does to that row.
     Never mutates `points`; always returns a new array. */
  function applyBandMeasuredPointEdit(points, index, field, raw) {
    var pts = (points || []).slice();
    while (pts.length <= index) pts.push({ stretchIn: null, lb: null });
    pts[index] = assign(pts[index] || {}, {});
    if (raw === "" || raw === null || raw === undefined) {
      pts[index][field] = null;
      return pts;
    }
    var v = Number(raw);
    if (!isFinite(v) || v <= 0) return pts;               // reject silently
    pts[index][field] = v;
    return pts;
  }

  /* The two whole-map calibration edits. Editing ONE band rebuilds the WHOLE
     rbts_bandGeom map, so where that map is read from decides what happens to
     every OTHER band -- and that is not a detail either app should be free to
     answer for itself.

     Both take a READER rather than a map. That is the point: a caller cannot
     hand over a stale copy it captured earlier, because it has nothing to
     hand over but a way to fetch the current one. The PWA's BandCalibration
     held the map in useState from mount and rebuilt from that snapshot, while
     the sign-in reconcile writes localStorage only -- last in a long serial
     await chain, so on a cold start there are seconds where adopted
     calibration is in storage and not in the panel. One rest-length edit in
     that window wrote the pre-adopt map back over every other band, locally
     and to Firestore. fitness_app.html never had it: its setters always read
     getBandGeom() fresh. This is that behaviour, made shared and testable.

     Neither mutates what the reader returns -- the caller decides what to
     save, and a rejected edit must not have already changed storage. */
  function bandGeomRestEdit(readGeom, id, raw) {
    var g = assign(readGeom() || {}, {});
    g[id] = applyBandRestLengthEdit(g[id], raw);
    return g;
  }

  function bandGeomPointEdit(readGeom, id, index, field, raw) {
    var g = assign(readGeom() || {}, {});
    var pts = (g[id] || {}).measured || [];
    g[id] = assign(g[id] || {}, {
      measured: applyBandMeasuredPointEdit(pts, index, field, raw)
    });
    return g;
  }

  /* MERGE IMPORT for band calibration. Both apps call this and neither keeps
     its own rule.

     Before this existed, `rbts_bandGeom` was empty in EVERY export on disk:
     fitness_app.html carried the key only on REPLACE ALL, so there was no
     additive path at all, and the PWA's MERGE IMPORT replaced the whole map
     wholesale -- then pushed the truncated result to Firestore, so a file
     naming 25 bands deleted every other band's calibration on every signed-in
     device. Calibration is the one kind of data here that accumulates band by
     band across many sessions, and it was the one kind with no way to add to
     it.

     PER FIELD, file wins on what it carries. A band id absent from `incoming`
     is untouched. Within a band, a field absent from the incoming entry keeps
     its local value. That is the whole point: a rest-length-only file must
     never destroy a `measured[]` force curve that cost a Tension Master
     session to produce -- the shape of the customPrograms loss rejected on
     2026-08-07, arriving through a different door.

     Clearing a field stays REPLACE ALL's job. MERGE IMPORT is additive by
     definition, there is no way to express a deletion through it, and it does
     not pretend to offer one.

     Numbers go through finitePos, matching stampLoad and the attach map:
     isFinite(null) and isFinite("36.5") are both true, so a bare isFinite
     guard would accept an empty input box and a string that came back from an
     import -- which is how a half-entered reading once stored a fake 0-lb
     point in a force curve. `measured` is taken only as an array, and replaces
     wholesale rather than unioning: two readings at the same stretch from
     different sessions have no timestamp to break the tie with.

     Never mutates either argument. */
  function mergeBandGeom(local, incoming) {
    var own = Object.prototype.hasOwnProperty;
    var out = {}, k;
    var base = (local && typeof local === "object") ? local : {};
    for (k in base) {
      if (own.call(base, k)) out[k] = assign(base[k] || {}, {});
    }
    var added = 0, updated = 0, fields = 0;
    if (!incoming || typeof incoming !== "object") {
      return { map: out, added: 0, updated: 0, fields: 0 };
    }
    var NUM = ["restLengthIn", "widthIn", "thicknessIn"];
    for (k in incoming) {
      if (!own.call(incoming, k)) continue;
      var inc = incoming[k];
      /* A number or a string where an entry belongs is not a calibration --
         storing it would put a shape into the map that every reader of
         geom.restLengthIn would then have to defend against. */
      if (!inc || typeof inc !== "object") continue;
      var existed = own.call(out, k);
      var e = out[k] || {};
      var wrote = 0, i;
      for (i = 0; i < NUM.length; i++) {
        if (finitePos(inc[NUM[i]])) { e[NUM[i]] = inc[NUM[i]]; wrote++; }
      }
      if (Array.isArray(inc.measured)) { e.measured = inc.measured.slice(); wrote++; }
      if (typeof inc.note === "string" && inc.note) { e.note = inc.note; wrote++; }
      /* Nothing usable arrived for this band. Leave the local entry exactly as
         it was, and do not conjure an empty one for a band that had none. */
      if (!wrote) continue;
      out[k] = e;
      fields += wrote;
      if (existed) updated++; else added++;
    }
    return { map: out, added: added, updated: updated, fields: fields };
  }

  /* Total inches this gear set adds to (+) or removes from (-) the stretch the
     band must cover. Mirrors gearPathDeltaIn in fitness_app.html; kept here so
     the module stays self-contained and testable. */
  function gearPathDelta(gearIds, gearOf, opening) {
    if (!gearIds || !gearIds.length || !gearOf) return 0;
    return gearIds.reduce(function (a, id) {
      var g = gearOf(id);
      if (!g) return a;
      var d = resolveGearDims(g) || {}, t = g.type;
      /* Some gear is never in the load path AT ALL -- the Harambe Foam Block
         is somewhere to rest a bar during setup, and Greg's ruling is that it
         must never figure in any calculation of any kind. This is deliberately
         a FLAG rather than a `type` and rather than a deleted measurement: the
         block really is 6in thick and the GEAR tab should still say so, and
         the catch-all branch at the bottom would otherwise read that thickness
         as an elevation and add +12in for anyone who logged it. Checked FIRST,
         before every branch, so one field settles the next such item instead
         of another special case in the sum. */
      if (d.neverInPath) return a;
      /* An ADJUSTABLE item's inline length is whichever stamped position was
         hooked. With no position chosen this contributes NOTHING -- which is
         a silent zero, and a silent zero on a 26in strap is the belt bug in a
         smaller coat. This function stays a pure sum on purpose; it is
         effectiveLoad that REFUSES, via gearAdjustableUnset, before it ever
         gets here. Do not "fix" the zero by picking a representative value. */
      var adj = gearOpeningSeriesIn(g, opening);
      if (adj != null) return a - adj;
      if (t === "footplate") return a + 2 * (d.thicknessIn || 0) + (d.channelIn || 0);
      if (t === "bar")       return a - (d.hookOffsetIn || 0);
      if (t === "handle" || t === "anchor") return a - (d.seriesIn || 0);
      /* A belt is a loop AROUND the body, not a length in series with the
         band. Its recorded 40in was the waist circumference and it drove every
         belt exercise to 0 lb. Belt setups are modelled by beltReach /
         beltStretch, which need nothing from the belt at all. */
      if (t === "belt")      return a;
      return a + 2 * (d.thicknessIn || 0) - (d.seriesIn || 0);
    }, 0);
  }

  /* ---- adjustable gear ---------------------------------------------------
     Some gear has no single inline length: the HeavyDutyBar X Straps carry
     SEVEN stamped positions spanning 3.94in to 26.38in, and which one is
     hooked is a per-exercise choice, not a property of the item. A table can
     hold the options; only the log can hold the answer.

     The whole discipline here is that an UNANSWERED choice degrades the load
     rather than defaulting. A missing dimension that quietly reads as zero is
     precisely how a belt's 40in waist circumference produced a confident 0 lb
     on every belt lift for three weeks. */

  /* The positions an item offers, numbered 1..n AS STAMPED on the item --
     not 0-based, because the number the user reads off the strap is the
     number they will look for on screen. Empty for everything else.

     Reads through resolveGearDims, so a PWA item that arrived from Firestore
     with no `dims` at all resolves its options from the table by brand|name
     exactly as a seeded HTML item does. */
  function gearOpeningOptions(it) {
    if (!it) return [];
    var d = resolveGearDims(it) || {};
    var inch = d.seriesOptionsIn;
    if (!Array.isArray(inch) || !inch.length) return [];
    var cm = Array.isArray(d.seriesOptionsCm) ? d.seriesOptionsCm : [];
    var out = [];
    for (var i = 0; i < inch.length; i++) {
      if (!finitePos(inch[i])) continue;
      out.push({ n: i + 1, seriesIn: inch[i],
                 seriesCm: finitePos(cm[i]) ? cm[i] : null });
    }
    return out;
  }

  function gearIsAdjustable(it) {
    return gearOpeningOptions(it).length > 0;
  }

  /* The inline length of ONE chosen position, or null.

     Strict === against the option's own `n` is doing real work: it refuses
     the "3" an imported log hands back (isFinite("3") is true), a fractional
     3.5, a 0 and an out-of-range 9 -- all without a separate guard. A
     non-adjustable item has no position to price and returns null, which is
     what lets gearPathDelta ask every item unconditionally. */
  function gearOpeningSeriesIn(it, n) {
    var opts = gearOpeningOptions(it);
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].n === n) return opts[i].seriesIn;
    }
    return null;
  }

  /* The first item in this rig that is adjustable and has NO usable position
     chosen, returned BY IDENTITY so a caller can name it on screen. null when
     every adjustable item has an answer, or when there are none.

     This is the gate effectiveLoad degrades on. It is deliberately separate
     from gearPathDelta: the sum must stay a sum, and the refusal must be a
     refusal, or the two get confused the way a zero-length belt once was. */
  function gearAdjustableUnset(gearIds, gearOf, opening) {
    if (!gearIds || !gearIds.length || !gearOf) return null;
    for (var i = 0; i < gearIds.length; i++) {
      var g = gearOf(gearIds[i]);
      if (!g || !gearIsAdjustable(g)) continue;
      if (gearOpeningSeriesIn(g, opening) == null) return g;
    }
    return null;
  }

  /* Is there anything adjustable in this rig at all? -- i.e. should a picker
     be shown, and can an opening mean anything here. Expressed through
     gearAdjustableUnset with NO opening supplied, so the two can never
     disagree about what counts as adjustable. */
  function gearHasAdjustable(gearIds, gearOf) {
    return gearAdjustableUnset(gearIds, gearOf, undefined) !== null;
  }

  /* ---- footplate band paths (2026-08-14) --------------------------------
     A footplate is not one number. The same plate takes the band lengthwise,
     widthwise, through a slot, or through a centre hole, and those differ by
     more than 20in of consumed band -- enough to make a rig that is impossible
     one way perfectly ordinary another. Greg's 2026-08-11 and 2026-08-14 RDLs
     were unloggable for exactly this reason: a 20in band folded cannot wrap
     the Clench plate at all, and does not have to.

     Same posture as the X Straps: a list of discrete, named, MEASURED options
     declared by the item itself, chosen per exercise. An unmeasured path is
     simply absent, so it is never offered and never contributes a silent zero.

     `consumedIn` is the WHOLE path (Greg's ruling 2026-08-14): from where the
     band leaves the top surface on one side, down, under, up, to where it
     leaves the top surface on the other. It therefore already contains both
     edge crossings and any channel drop, which is why beltReach uses it whole
     instead of adding 2*thickness and channelIn to it. That also retires the
     question of whether a plate's groove is oriented lengthwise or widthwise:
     the tape followed the groove or it did not.

     `source` is measured | computed | derived, and ONLY `measured` may reach
     MEASURED provenance -- the same refusal that removed the Acacia's
     interpolated bandSpanIn on 2026-07-31. Interpolating and saying so is
     allowed; interpolating and calling it tape is not.

     Reads through resolveGearDims, so a PWA item that arrived from Firestore
     with no `dims` resolves its paths from the table by brand|name exactly as
     a seeded HTML item does. */
  function plateBandPaths(it) {
    if (!it) return [];
    var d = resolveGearDims(it) || {};
    var out = [];
    if (Array.isArray(d.bandPaths)) {
      d.bandPaths.forEach(function (p) {
        if (!p || p.k == null || p.k === "" || !finitePos(p.consumedIn)) return;
        out.push({ k: String(p.k), l: p.l || String(p.k), consumedIn: p.consumedIn,
                   source: (p.source === "measured" || p.source === "derived")
                     ? p.source : "computed" });
      });
      if (out.length) return out;
    }
    /* A footplate the table has never heard of -- a hand-added item, or one
       whose brand|name does not match. Generate the legacy arithmetic so it
       behaves exactly as it did before this existed, plus the derived
       widthwise counterpart. Both are labelled, and neither can reach
       MEASURED. */
    var span = finitePos(d.bandSpanIn) ? d.bandSpanIn
             : (finitePos(d.lengthIn) ? d.lengthIn : null);
    if (span == null) return [];
    var base = 2 * (finitePos(d.thicknessIn) ? d.thicknessIn : 0)
             + (finitePos(d.channelIn) ? d.channelIn : 0);
    out.push({ k: "len", l: "UNDER - LENGTHWISE",
               consumedIn: span + base, source: "computed" });
    if (finitePos(d.widthIn)) {
      /* That plate's OWN edge delta, not a ratio borrowed from other plates --
         which is precisely what made the removed Acacia 20.5 indefensible. */
      var delta = (finitePos(d.bandSpanIn) && finitePos(d.lengthIn))
        ? (d.bandSpanIn - d.lengthIn) : 0;
      out.push({ k: "wid", l: "UNDER - WIDTHWISE",
                 consumedIn: d.widthIn + delta + base, source: "derived" });
    }
    return out;
  }

  /* The chosen path, or the default.

     An UNSET key means "the ordinary way", which is the first declared path --
     so every rig logged before this existed prices unchanged and the default
     is never a guess about which of several paths was used.

     A key this plate does NOT offer returns null and the caller degrades. It
     must not silently substitute a different path: swapping the plate on a
     saved exercise would then reprice it confidently against geometry the
     user never chose. */
  function plateBandPathOf(it, k) {
    var paths = plateBandPaths(it);
    if (!paths.length) return null;
    if (k == null || k === "") return paths[0];
    for (var i = 0; i < paths.length; i++) {
      if (paths[i].k === k) return paths[i];
    }
    return null;
  }

  /* What both apps' pickers ask for: the footplate in this rig and the paths
     it declares, or null when there is no footplate or it declares none.
     Singular on purpose -- gearHasDims and gearDimSource each read `it.dims`
     raw once and disagreed with the engine in silence; a second reader of one
     fact is how that happens. */
  function plateBandPathOptions(gearIds, gearOf) {
    var it = beltPlateOf(gearIds, gearOf);
    if (!it) return null;
    var paths = plateBandPaths(it);
    return paths.length ? { item: it, paths: paths } : null;
  }

  /* ---- belt / footplate band path ---------------------------------------
     A belt exercise is not a series-length problem. The band goes UNDER a
     footplate, both strands come up, and whatever they attach to -- a belt
     clip, a rod under a rope, a threaded strap -- sits at some height. Greg's
     ruling 2026-08-02: the model terminates AT THE BAND. No belt dimension is
     an input, because the connector above the band is a rope, rod or
     adjustable strap of arbitrary length, threaded anywhere, on one or both
     sides of the body.

     What the plate and body absorb is known; what is left is the band's reach
     above the plate; the one supplied number is how high the attachment sits.
     See docs/superpowers/specs/2026-08-02-belt-footplate-band-path-design.md */

  /* Body landmarks, in ascending order. Each is a plain floor-to-landmark
     measurement on the profile.

     SHOULDER is MID-shoulder, where a racked bar bears -- not the top of the
     shoulder, which is ~2in higher. It is added 2026-08-10 for the racked-squat
     family and is deliberately NOT offered on a belt rig: a belt never sits
     there, and one fixed list served both paths until this change, which is why
     a front squat was offered three landmarks and none of them the answer. */
  var BODY_LANDMARKS = [
    { k: "kneeHeightIn",     l: "KNEE" },
    { k: "midThighHeightIn", l: "MID-THIGH" },
    { k: "hipHeightIn",      l: "HIP" },
    { k: "shoulderHeightIn", l: "SHOULDER" }
  ];

  /* What a BELT rig may attach at, and the default for every caller that does
     not say otherwise -- so adding the shoulder above moved no existing call. */
  var BELT_LANDMARK_KEYS = ["kneeHeightIn", "midThighHeightIn", "hipHeightIn"];

  /* Which landmarks a rig may attach at, from what sits at the band's TOP end
     (plateTopSpan's `kind`). A bar gets all four ON PURPOSE: a deadlift on a bar
     terminates at the hip and a front squat on the same bar at the shoulder, so
     the EXERCISE decides via PLATE_GRIP_DEFAULT, not the gear. */
  function attachLandmarkKeys(topKind) {
    if (topKind === "bar") return BELT_LANDMARK_KEYS.concat(["shoulderHeightIn"]);
    return BELT_LANDMARK_KEYS;
  }

  function beltPlateOf(gearIds, gearOf) {
    if (!gearIds || !gearIds.length || !gearOf) return null;
    for (var i = 0; i < gearIds.length; i++) {
      var g = gearOf(gearIds[i]);
      if (g && g.type === "footplate") return g;
    }
    return null;
  }

  function beltBeltPresent(gearIds, gearOf) {
    if (!gearIds || !gearIds.length || !gearOf) return false;
    return gearIds.some(function (id) {
      var g = gearOf(id);
      return !!(g && g.type === "belt");
    });
  }

  /* What the band's TOP end wraps around. This is the last term in beltReach's
     `consumed`, and it is consulted ONLY when the band is singled -- doubled,
     the top end is the FOLD and encircles nothing.

       belt     the lifter. bodyWidthIn, the original rule, unchanged.
       bar      the bar's attachSpanIn. Greg 2026-08-06: a singled band is
                hooked at TWO POINTS ACROSS the bar, so it spans the bar's
                attach width -- not the lifter, and not the bar's girth. Those
                three readings give 42 / 31 / 15 lb on the same rig, which is
                why this is recorded rather than inferred.
       handles  NOT MODELLED, deliberately. On handle exercises the handles
                travel AWAY FROM THE BODY through the rep, so the span between
                them is not constant and no single number describes it. A
                handle carries seriesIn and gripDiaIn, never an attachSpanIn.
                Guessing would produce a plausible number, which is the exact
                failure this model exists to remove.
       none     nothing recorded that the band could terminate in.

     A belt wins outright: a belt rig is priced by the belt rule whatever else
     is in the setup, which is what keeps the belt path bit-identical. */
  function plateTopSpan(gearIds, gearOf) {
    var none = { kind: "none", spanIn: null };
    if (!gearIds || !gearIds.length || !gearOf) return none;
    var bar = null, handles = false;
    for (var i = 0; i < gearIds.length; i++) {
      var g = gearOf(gearIds[i]);
      if (!g) continue;
      if (g.type === "belt") return { kind: "belt", spanIn: null };
      if (g.type === "bar" && !bar) bar = g;
      if (g.type === "handle") handles = true;
    }
    if (bar) {
      var dims = resolveGearDims(bar) || {};
      return { kind: "bar",
               spanIn: finitePos(dims.attachSpanIn) ? dims.attachSpanIn : null };
    }
    if (handles) return { kind: "handles", spanIn: null };
    return none;
  }

  /* How far the band's own end reaches above the TOP of the plate, unstretched.

       usableC  = 2 * restLength / d      the loop circumference in play; a
                                          doubled band is a half-length loop
       consumed = the plate's under-run, both edge crossings, the channel, and
                  -- SINGLED ONLY -- the user's width, because singled the loop
                  runs up both sides of the body and its top has to cross
                  between them. Doubled the band ends inches above the plate
                  and never spans anything.
       reach    = (usableC - consumed) / 2 because two strands go up.

     `plate` is a RESOLVED dims object (resolveGearDims output), not a gear
     item. Returns null when the band is too short to be rigged this way --
     never a negative reach, and never a fabricated load. */
  function beltReach(band, geom, plate, doubled, body, topSpanIn, path) {
    if (!band || !plate || !body) return null;
    var rest = (geom && isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
      ? geom.restLengthIn : (band.lengthIn || 0);
    if (!rest) return null;
    var d = doubled ? 2 : 1;
    var usableC = 2 * rest / d;
    var width = doubled ? 0
              : (finitePos(topSpanIn) ? topSpanIn : (body.bodyWidthIn || 0));
    /* `path.consumedIn` is the WHOLE path Greg taped -- top edge, down, under,
       up, top edge -- so it already contains both edge crossings and any
       channel drop, and must NOT have 2*thickness and channelIn added to it.
       Adding them would double-count roughly 2in on every plate, in the
       direction that overstates stretch and so overstates load.

       Omitted, this is byte-identical to the pre-2026-08-14 arithmetic, which
       is what keeps every existing call site and assertion unmoved. */
    var consumed = (path && finitePos(path.consumedIn))
      ? path.consumedIn
      : ((plate.bandSpanIn || plate.lengthIn || 0)
         + 2 * (plate.thicknessIn || 0)
         + (plate.channelIn || 0));
    var reach = (usableC - consumed - width) / 2;
    return reach > 0 ? reach : null;
  }

  /* The gap between the band's own top and the attachment, which IS the
     elongation. The plate's thickness is deliberately NOT subtracted: the
     lifter stands on the plate, so it raises the body and the band's top by
     the same amount and cancels. attachHeightIn is therefore the plain
     floor-to-landmark body measurement, used as measured.

     Returns null at or below the band's own top -- there is no elongation
     there, and reporting 0 lb as though it were a load is the exact failure
     this model replaces. */
  function beltStretch(reach, attachHeightIn) {
    if (reach == null || !isFinite(reach)) return null;
    if (!isFinite(attachHeightIn)) return null;
    var s = attachHeightIn - reach;
    return s > 0 ? s : null;
  }

  /* The landmarks this band can actually be attached to, each with the strain
     it implies and whether that strain falls outside the vendor's rated span.
     Sub-rated options are MARKED, not hidden: a singled 41in band on a
     footplate never reaches strain 0.5 at any landmark up to the hip, so
     hiding them would leave the picker empty. */
  /* `topSpanIn` and `path` are TRAILING OPTIONAL parameters, added 2026-08-14,
     for the same reason attachLandmarkKeys took its shape when the SHOULDER
     landmark arrived: every call site that predates them stays byte-identical
     and no prior assertion moves.

     topSpanIn is not cosmetic. effectiveLoad has always passed it and these
     two never did, so on a singled bar rig the picker priced against the
     lifter's body width (17.25in) while the engine priced against the bar's
     attach span (26in) -- an 8.4in difference in reach. The stretch figures
     printed on every landmark button, and the "no landmark sits above this
     band's reach" gate itself, were computed from a reach the engine did not
     use. Greg's ruling 2026-08-14 confirms the engine's semantics are the
     right ones: for a bar, bar span; for handles, body width. */
  function beltAttachOptions(band, geom, plate, doubled, body, keys, topSpanIn, path) {
    var reach = beltReach(band, geom, plate, doubled, body, topSpanIn, path);
    if (reach == null) return [];
    var rest = (geom && isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
      ? geom.restLengthIn : (band.lengthIn || 0);
    var d = doubled ? 2 : 1;
    var effRest = rest / d;
    var allow = keys || BELT_LANDMARK_KEYS;
    var out = [];
    BODY_LANDMARKS.forEach(function (lm) {
      if (allow.indexOf(lm.k) < 0) return;
      var h = body[lm.k];
      if (!isFinite(h)) return;
      var s = beltStretch(reach, h);
      if (s == null) return;
      var strain = effRest ? (s / effRest) : 0;
      out.push({
        k: lm.k, label: lm.l, heightIn: h, stretchIn: s, strain: strain,
        belowRated: strain < LOAD_MODEL.STRAIN_AT_RATED_MIN,
        aboveRated: strain > LOAD_MODEL.STRAIN_AT_RATED_MAX
      });
    });
    return out;
  }

  /* Which landmark a BELT determines, keyed `brand|name`.

     Greg's ruling 2026-08-03, from doing the lift rather than from the model:
     the attachment landmark is a property of the BELT, not a free per-exercise
     choice. The picker used to default to nothing, so a field with exactly one
     right answer sat blank and the exercise stamped RATED -- nothing was
     mis-measured, nothing was mis-modelled, a required input was simply never
     supplied and no code noticed.

       fixed:true    structurally determined; no other gear can move it. The X3
                     hangs a bar off the belt with one leg in front of it and one
                     behind, so on the ascent the bar meets the hamstring and
                     stops there.
       fixed:false   true only when the band runs STRAIGHT from plate to belt. A
                     rope or handle in the path hangs the attachment lower by an
                     adjustable amount no landmark describes, so the default is
                     WITHDRAWN and the user types a CUSTOM height instead. */
  var BELT_ATTACH_DEFAULT = {
    "X3 Bar|Squat Belt (Medium)": { landmark: "midThighHeightIn", fixed: true },
    "Harambe|Split Squat Belt":   { landmark: "hipHeightIn",      fixed: false }
  };
  /* Gear that sits INLINE between the band and the belt, hanging the attachment
     lower than the belt itself by an adjustable amount.

     CURATED, keyed brand|name, deliberately NOT inferred. Two heuristics were
     tried and both were wrong inside a day:

       `type` in [handle, anchor]   Every rope in GEAR_SEED is typed "other", so
                                    the Harambe hip default survived the exact
                                    gear that invalidates it.
       positive `seriesIn`          Greg's correction 2026-08-03: an ANCHOR
                                    carries a series length but sits at the
                                    band's FIXED end, not between band and belt
                                    -- the RBT Band Utility Strap is an anchor
                                    and was being flagged -- and you do not hold
                                    a HANDLE in a belt setup at all.

     No property of a gear item says "this hangs below a belt". It is a fact
     about how the item is USED, so it is written down per item rather than
     guessed from a field that happens to correlate.

     The failure mode of an omission is mild and visible: a default that stays
     HIP when it should have been withdrawn, shown on screen as a landmark the
     user can see and change. That is why a curated list is acceptable here and
     would not be in the load arithmetic. */
  var BELT_EXTENDERS = {
    "Harambe|Black Ropes":   true,
    "Harambe|Yellow Ropes":  true,
    "Harambe|White Ropes":   true,
    "Harambe|Blue Ropes":    true,
    /* heavydutybar.com/collections/accessories - a pair; usable with the belt,
       a bar, handles or a footplate, and in combination. Greg's, added
       2026-08-03. Its own seriesIn is not recorded yet, and is not needed to
       classify it: whether an item extends the belt path and how long it is are
       separate facts. */
    "HeavyDutyBar|X Straps": true
  };
  function beltSlackens(g) {
    if (!g) return false;
    return BELT_EXTENDERS[(g.brand || "") + "|" + (g.name || "")] === true;
  }

  /* Where the rep ENDS on a plate rig, keyed by EXERCISE id.

     BELT_ATTACH_DEFAULT keys off the belt because the landmark is a property of
     the belt. This keys off the exercise, because with a bar or handles it is
     the movement pattern that decides where the hands finish.

     Greg, 2026-08-06: for a deadlift and a Romanian deadlift the point of
     maximum stretch sits between MID-THIGH and HIP, closer to mid-thigh, one
     third of the way up. 117 and 119 share that endpoint.
     SUPERSEDED 2026-08-14: Greg corrected this to MID-THIGH itself while
     reporting the exercise-37 ATTACH AT bug -- the band is between the ankle
     and mid-calf at the bottom of an RDL and at mid-thigh at the top, and
     attachHeightIn is the top of the rep. All five hinge entries are `at`
     now. The 2026-08-06 reasoning is kept because it is the record of what
     the table meant for the eight days it was live.

     201 is the same hinge plus a shrug. `plusIn` is the height the HANDS rise
     -- 1.5in, confirmed directly. Greg also said the shrug "effectively adds
     3in", and that is the LOOP PATH, not this field: beltReach already halves
     for the two strands, so a 1.5in rise produces 3in of path on its own.
     Putting 3 here would double the real change. Same class as the belt defect
     that started this work, where a 40in waist circumference was consumed as an
     inline length.

     An exercise ABSENT from this table gets NO default and the height stays
     blank. A wrong default is silent -- it yields a plausible number instead of
     a degradation -- so nothing here is guessed. */
  var PLATE_GRIP_DEFAULT = {
    /* THE HINGE FAMILY. These five sat {from: midThigh, to: hip, frac: 1/3}
       from 2026-08-06 until 2026-08-14 -- 30.83in on Greg's measurements. He
       corrected it while reporting the exercise-37 ATTACH AT bug: on a band
       RDL the band is loaded somewhere between the ankle and mid-calf at the
       BOTTOM (which is beltReach, and the model computes it), and "as you
       unhinge to perform the lift the band is mid-thigh". attachHeightIn is
       the TOP of the rep, so mid-thigh is the answer.

       One movement pattern, so one rule rather than an exception for 37.
       `at` rather than a degenerate frac:0 between two copies of one field,
       for the same reason the racked squats use it: writing a single
       termination as an interpolation is a lie about the movement. It also
       means these five now need ONE measured landmark instead of two -- an
       unmeasured hip no longer withholds the default. */
    37:  { at: "midThighHeightIn" },              // Band Romanian Deadlift
    117: { at: "midThighHeightIn" },              // Romanian Deadlift (RDL)
    119: { at: "midThighHeightIn" },              // Stiff-Leg Deadlift
    185: { at: "midThighHeightIn" },              // Band Deadlift
    /* plusIn is the height the HANDS rise, NOT the loop path. beltReach
       already halves for the two strands, so 3 here would double the real
       change -- the same failure class as the belt bug, where a 40in waist
       circumference was consumed as an inline extension. */
    201: { at: "midThighHeightIn", plusIn: 1.5 }, // Band Deadlift + Shrug
    /* THE SHRUG, on its own. Greg, 2026-08-14: "you're standing upright and
       holding the bar with your arms straight down (wherever that happens to
       be on the individual), and all you're doing is shrugging your shoulders
       up -- about 1 1/2 to 2 inches."

       So the base is HANDS AT REST, not a leg landmark. Mid-thigh is where
       Greg's hands happen to hang and would have been right for him by
       coincidence of arm length -- a proxy, and a wrong default is SILENT,
       which is the failure this whole model exists to prevent. handsAtRestIn
       is a real measurement instead: floor to the hands, standing, arms
       straight down.

       plusIn 1.5 is the height the HANDS rise, exactly as on 201 -- beltReach
       already halves for the two strands, so 3 here would double the real
       change. */
    41:  { at: "handsAtRestIn", plusIn: 1.5 },     // Band Shrug with Hold
    /* The RACKED-SQUAT family, added 2026-08-10. The bar rides on the
       shoulders for the whole rep, so the band's top end at the hardest point
       is mid-shoulder -- one landmark, not an interpolation, hence `at`.
       Confirmed by Greg for exactly these four. 114 Box Squat was offered and
       NOT taken; nothing is guessed for an exercise absent from this table. */
    97:  { at: "shoulderHeightIn" },   // Band Squat
    98:  { at: "shoulderHeightIn" },   // Front Squat (Band)
    101: { at: "shoulderHeightIn" },   // Narrow-Stance Band Squat
    113: { at: "shoulderHeightIn" }    // Cyclist Squat (Heels Elevated)
  };

  function plateGripDefault(exId, body) {
    if (!body) return null;
    var rule = PLATE_GRIP_DEFAULT[String(exId)];
    if (!rule) return null;
    /* Two forms, both guarded through finitePos so an empty input box, a null
       and an imported "55.5" are all refused rather than coerced.

       `at`   -- the rep ends at ONE landmark. A racked squat terminates at the
                 shoulder and nowhere else; writing that as frac:0 between two
                 copies of the same field would be a lie about the movement.
       `from/to/frac` -- interpolates, for the hinge family where the hands
                 finish somewhere between two landmarks. */
    if (rule.at) {
      var at = body[rule.at];
      if (!finitePos(at)) return null;
      var ha = at + (rule.plusIn || 0);
      return finitePos(ha) ? ha : null;
    }
    var from = body[rule.from], to = body[rule.to];
    if (!finitePos(from) || !finitePos(to)) return null;
    var h = from + (to - from) * rule.frac + (rule.plusIn || 0);
    return finitePos(h) ? h : null;
  }

  /* The same default, WITHDRAWN when something hangs inline below the grip.

     beltAttachDefault has withdrawn the Harambe HIP landmark since 2026-08-03
     whenever a BELT_EXTENDERS item is in the rig, because a rope or strap
     hangs the attachment lower by an adjustable amount no fixed landmark can
     express. The plate/grip default has exactly the same exposure and had no
     such guard: a table height that is silently wrong yields a plausible
     number instead of a degradation, which is the failure mode this whole
     model exists to remove.

     Greg's ruling 2026-08-07. Both apps' pickers and effectiveLoad call THIS,
     never plateGripDefault directly, so the engine and the seeded field can
     never disagree about whether a default applies. plateGripDefault stays
     exported: it is the pure exercise+body rule, and the tests pin it. */
  function plateGripDefaultFor(exId, body, gearIds, gearOf) {
    if (gearIds && gearIds.length && gearOf) {
      for (var i = 0; i < gearIds.length; i++) {
        if (beltSlackens(gearOf(gearIds[i]))) return null;
      }
    }
    return plateGripDefault(exId, body);
  }

  /* The day the plate/grip path shipped. Stamps are frozen at save time, so a
     workout logged before this carries a number the current model would not
     produce -- exactly like era:"pre-fold", except that nothing needs
     REWRITING here, so this is derived from the entry's own date and NOTHING
     is written to the log. Strictly less machinery than migrateFoldEncoding,
     and no write path to get wrong. */
  var PLATE_GEOM_CUTOFF = "2026-08-06";

  function stampPredatesPlateGeom(dateISO, gearIds, gearOf, exId) {
    if (!dateISO || String(dateISO) >= PLATE_GEOM_CUTOFF) return false;
    /* Only rigs this work actually reprices. A belt rig took the absolute
       stretch path already, and a rig with no plate still does not. */
    if (!beltPlateOf(gearIds, gearOf)) return false;
    if (beltBeltPresent(gearIds, gearOf)) return false;
    /* Mirrors effectiveLoad's `knownAttach` gate: a plain footplate, or a
       footplate+handles rig on an exercise absent from PLATE_GRIP_DEFAULT, is
       STILL on the reference-strain path today, exactly as it was before this
       cutoff -- recomputing it gives the identical number. A footplate is
       also the ordinary elevation gear gearPathDelta has always treated it
       as (a riser under an unrelated lift), so flagging every plate-carrying
       entry would mislabel a large share of history with a reprice that
       never happens. Body measurements are deliberately NOT checked here --
       whether or not the profile currently has them, a rig with a known
       avenue is a genuinely different code path than before, even if it now
       degrades to a "body not set" RATED instead of a computed number. */
    var top = plateTopSpan(gearIds, gearOf);
    return top.kind === "bar" || PLATE_GRIP_DEFAULT[String(exId)] != null;
  }

  /* The day footplate band paths shipped. Same posture as PLATE_GEOM_CUTOFF:
     DERIVED from the entry's own date, gear and exercise every time it is
     read, so nothing is written to the log and there is no write path to get
     wrong. History is NOT restamped -- frozen stamps stay frozen, and this is
     how one that no longer matches the live card explains itself. */
  var BAND_PATH_CUTOFF = "2026-08-14";

  function stampPredatesBandPath(dateISO, gearIds, gearOf, exId) {
    if (!dateISO || String(dateISO) >= BAND_PATH_CUTOFF) return false;
    var plateItem = beltPlateOf(gearIds, gearOf);
    if (!plateItem) return false;
    /* Only rigs that actually took the absolute-stretch path -- the only one
       that consults `consumed`. A footplate is ALSO the ordinary elevation
       gear gearPathDelta has always treated it as (a riser under an unrelated
       lift), and such a rig was on the reference-strain path before AND after,
       so recomputing it gives the identical number.

       Unlike stampPredatesPlateGeom, a BELT rig is NOT excluded: the belt path
       calls beltReach too, so it reprices along with everything else. */
    var known = beltBeltPresent(gearIds, gearOf) ||
                plateTopSpan(gearIds, gearOf).kind === "bar" ||
                PLATE_GRIP_DEFAULT[String(exId)] != null;
    if (!known) return false;
    /* Would this rig's price ACTUALLY have changed? The Cyberplate and the
       Acacia's whole-plate paths are still the legacy arithmetic -- neither
       plate could be taped -- so their history prices identically and flagging
       it would report a change that never happened.

       Derived by comparing the default path against the formula it replaced,
       rather than listing the affected plates, so a plate taped LATER starts
       being flagged with no code edit and a plate whose figure never moves is
       never flagged at all. */
    var d = resolveGearDims(plateItem) || {};
    var legacy = (d.bandSpanIn || d.lengthIn || 0)
               + 2 * (d.thicknessIn || 0) + (d.channelIn || 0);
    var p = plateBandPathOf(plateItem, null);
    return !!p && Math.abs(p.consumedIn - legacy) > 1e-9;
  }

  /* The exercise card (item q + this task) surfaces three things about a
     load figure that a printed report was silently omitting: it is a PEAK,
     not an average; some figures were computed with no range of motion at
     all (romBlind); and some frozen stamps predate a model fix, either
     era:"pre-fold" or a plate/bar rig stamped before PLATE_GEOM_CUTOFF.
     Shared by buildSetupDoc, buildHistoryDoc and analyze() so the three
     doc models cannot drift on the wording -- exactly the reason this
     module exists (rendered by renderMarkdown/renderPrintHTML from one
     doc model each).

     The PEAK note is unconditional -- true of every effective-load figure.
     The other three fire only when an entry actually being reported carries
     the condition: a caveat that always appears is a caveat nobody reads. */
  function loadCaveatNotes(entries, gearOf) {
    var notes = [];
    notes.push("Every effective-load figure is a PEAK: the load at the hardest " +
      "point of the rep, never an average over the range of motion. A band is " +
      "near-slack at the bottom of a hinge and hardest at lockout, so a set can " +
      "feel far lighter than its peak.");
    var sawRomBlind = false, sawPreFold = false, sawPrePlate = false,
        sawPreBandPath = false;
    (entries || []).forEach(function (e) {
      if (!e) return;
      Object.keys(e.load || {}).forEach(function (exId) {
        var ld = e.load[exId];
        if (!ld || typeof ld !== "object") return;
        if (ld.romBlind) sawRomBlind = true;
        if (ld.era === "pre-fold") sawPreFold = true;
        if (stampPredatesPlateGeom(e.date, (e.gear || {})[exId], gearOf, exId)) {
          sawPrePlate = true;
        }
        if (stampPredatesBandPath(e.date, (e.gear || {})[exId], gearOf, exId)) {
          sawPreBandPath = true;
        }
      });
    });
    if (sawRomBlind) {
      notes.push("Some figures here were computed WITHOUT A RANGE OF MOTION: " +
        "a rig with no footplate still prices the band at a fixed reference " +
        "stretch, so its load is the same whatever the lifter's actual ROM.");
    }
    if (sawPreFold) {
      notes.push("Some stamps here were frozen before the fold fix and describe " +
        "a band list that no longer matches them.");
    }
    if (sawPrePlate) {
      notes.push("Some stamps here were frozen before the plate-geometry fix " +
        "(" + PLATE_GEOM_CUTOFF + ") and came from a path that could not see " +
        "the grip height. The current model would price those sets lower.");
    }
    if (sawPreBandPath) {
      notes.push("Some stamps here were frozen before the footplate " +
        "band-path fix (" + BAND_PATH_CUTOFF + ") and priced the band over " +
        "the WHOLE plate whether or not it was rigged that way. The current " +
        "model consumes about 2in less band on the plates that have since " +
        "been measured, so it prices those sets LIGHTER.");
    }
    return notes;
  }

  function beltAttachDefault(gearIds, gearOf) {
    if (!gearIds || !gearIds.length || !gearOf) return null;
    /* A belt with no footplate is not a belt setup, and effectiveLoad would not
       take the belt path for it -- offering a default here would put a height on
       an entry the engine prices by another route entirely. */
    if (!beltPlateOf(gearIds, gearOf)) return null;
    var rule = null;
    gearIds.forEach(function (id) {
      var g = gearOf(id);
      if (!g || g.type !== "belt" || rule) return;
      rule = BELT_ATTACH_DEFAULT[(g.brand || "") + "|" + (g.name || "")] || null;
    });
    if (!rule) return null;
    if (!rule.fixed && gearIds.some(function (id) {
      return beltSlackens(gearOf(id));
    })) return null;
    return rule.landmark;
  }

  /* The band's top-end height, DERIVED rather than asked for.

     Greg, 2026-08-10: "I thought all we would ask for on this one would be the
     height of opening on the strap." The Harambe belt's landmark is HIP, a
     property of the belt, and the X Straps hang STRAIGHT DOWN from it by an
     amount that is now measured -- seven stamped positions. Asking for the
     opening AND the height is asking the same question twice.

     Returns the height AND the arithmetic that produced it, so the picker can
     show its work instead of presenting a number from nowhere. */
  function beltAttachDerived(gearIds, gearOf, body, opening) {
    if (!gearIds || !gearIds.length || !gearOf || !body) return null;
    /* Not a belt setup without a footplate -- effectiveLoad would price it by
       another route entirely, and a height here would describe nothing. */
    if (!beltPlateOf(gearIds, gearOf)) return null;

    var rule = null, i;
    for (i = 0; i < gearIds.length; i++) {
      var g = gearOf(gearIds[i]);
      if (g && g.type === "belt" && !rule) {
        rule = BELT_ATTACH_DEFAULT[(g.brand || "") + "|" + (g.name || "")] || null;
      }
    }
    if (!rule) return null;
    /* A FIXED landmark cannot be moved by other gear: the X3 bar hooks off the
       belt with one leg in front and one behind and meets the hamstring on the
       ascent, whatever hangs there. There is nothing to derive -- the default
       already answers, and was never withdrawn. */
    if (rule.fixed) return null;

    var lmH = body[rule.landmark];
    if (!finitePos(lmH)) return null;

    /* EXACTLY ONE extender. Nothing has measured a strap-plus-rope assembly,
       and the Harambe rods precedent -- a 6in rod plus a 5in rope measures
       2.75in, not 11in -- says an assumed sum would be badly wrong. */
    var ext = [];
    for (i = 0; i < gearIds.length; i++) {
      var e = gearOf(gearIds[i]);
      if (beltSlackens(e)) ext.push(e);
    }
    if (ext.length !== 1) return null;

    /* Only an ADJUSTABLE extender. A Harambe rope carries a measured seriesIn,
       but that is not a vertical drop below a belt: the ropes hang in the
       DIRECTION OF THE PULL, and their working length is always LESS than the
       rated figure because the rope comes off the ends of RODS, which come in
       different lengths (Greg, 2026-08-10). Subtracting it would put the band's
       top end too low, understating stretch and so understating load. */
    var item = ext[0];
    if (!gearIsAdjustable(item)) return null;
    var seriesIn = gearOpeningSeriesIn(item, opening);
    if (!finitePos(seriesIn)) return null;

    var h = lmH - seriesIn;
    if (!finitePos(h)) return null;          // refuses zero and negative alike

    var label = "";
    for (i = 0; i < BODY_LANDMARKS.length; i++) {
      if (BODY_LANDMARKS[i].k === rule.landmark) label = BODY_LANDMARKS[i].l;
    }
    return { heightIn: h, landmarkKey: rule.landmark, landmarkLabel: label,
             landmarkHeightIn: lmH, item: item, openingN: opening,
             seriesIn: seriesIn };
  }

  /* WHICH HEIGHT THE ATTACH AT FIELD SHOULD HOLD -- the whole decision both
     apps' seeding effects make on the derived path, in one place that node can
     run. It lived inside two React components until 2026-08-10, where the only
     coverage possible was regex over source text: six such assertions said the
     wiring existed and could say nothing about the state machine, which is
     exactly where a defect was sitting (see attachClearMarker below).

     Three rules, and they are in tension, which is why the decision is worth
     a name:

       - a DERIVED height must FOLLOW the strap: move the strap and the number
         moves with it, or the field describes the wrong rig;
       - a height the USER typed is never overwritten -- "an explicit height
         always wins: a choice the user made is never overridden by a table";
       - a deliberate CLEAR sticks, and resumes when the strap moves.

     Resolved statelessly, with no "was this derived" flag stored anywhere: we
     may write when the field is EMPTY, or when it still holds exactly the
     number we last derived. So there is no write path to get wrong and nothing
     to migrate.

     st: { attachIn, derivedIn, lastDerivedIn, clearedDerivedIn }
     -> { write, lastDerivedIn, clearedDerivedIn }

     `write` is the height to set, or null for "leave the field alone". null is
     unambiguous here: derivedIn is a finitePos height whenever there is one at
     all, so a real write is never null. The two returned markers are what the
     caller stores back into its refs -- returning them rather than mutating
     anything is what keeps this pure. */
  function attachSeedDecision(st) {
    var s = st || {};
    var attachIn = s.attachIn;
    var derivedIn = (s.derivedIn === undefined) ? null : s.derivedIn;
    var lastDerivedIn = (s.lastDerivedIn === undefined) ? null : s.lastDerivedIn;
    var clearedDerivedIn = (s.clearedDerivedIn === undefined) ? null : s.clearedDerivedIn;

    /* Nothing derivable on this rig. There is no derivation to follow, so the
       last-derived marker is dropped: leaving a stale one behind would let a
       later, unrelated derivation treat a height the user typed in the interim
       as one of ours and overwrite it. The CLEARED marker is left ALONE -- it
       is only ever read against a live derivation, and expiring it here would
       mean a clear silently lapsed because the strap was briefly unselected. */
    if (derivedIn == null) {
      return { write: null, lastDerivedIn: null, clearedDerivedIn: clearedDerivedIn };
    }

    var derCleared = clearedDerivedIn != null && clearedDerivedIn === derivedIn;
    var mayFill = !derCleared && (attachIn == null ||
                  (lastDerivedIn != null && attachIn === lastDerivedIn));
    var write = (mayFill && attachIn !== derivedIn) ? derivedIn : null;

    /* Clearing the marker ON A WRITE is what stops a clear from outliving the
       strap position it was made at. Without it: clear at #3, move to #5 (which
       fills #5's height), move back to #3 -- the marker still holds #3, so the
       field KEEPS #5's height while the strap sits at #3, a plausible number
       describing the wrong rig. A clear itself never writes, so this can never
       undo one; a typed height still fails the lastDerivedIn test regardless. */
    return { write: write,
             lastDerivedIn: derivedIn,
             clearedDerivedIn: (write == null) ? clearedDerivedIn : null };
  }

  /* What CLEAR records, so attachSeedDecision knows whether to refill.

     Conditioned on what was ACTUALLY in the box, not merely on what the rig
     could derive. Until 2026-08-10 both apps recorded the derivable height
     unconditionally, which made CLEAR order-dependent: on a rig holding a
     STALE height (a saved 36.5 reopened in HISTORY, then a strap position
     chosen), pressing CLEAR marked the derivation refused and the field
     stranded BLANK -- degrading the entry to RATED, the opposite of what the
     press asked for. Pressing CLEAR first, before choosing the position,
     worked. A field whose behaviour depends on the order two unrelated
     controls were touched is a field nobody can reason about, and the spec's
     own remedy for the entries that motivated this work is "re-editable in
     HISTORY" -- in the natural order, that re-edit did not work.

     Returns null when the box held something else: nothing derived was
     refused, so nothing is recorded and seeding proceeds normally. */
  function attachClearMarker(attachIn, derivedIn) {
    return (derivedIn != null && attachIn === derivedIn) ? derivedIn : null;
  }

  /* One arbitrary attachment height, priced EXACTLY as beltAttachOptions prices
     a landmark, so CUSTOM 28 and MID-THIGH 28 can never disagree about the same
     rig. Returns null when the height is unusable or sits at or below the band's
     own reach -- never a 0, which is the whole discipline of this path.

     Added 2026-08-03 for the CUSTOM option, chosen over a MID-SHIN landmark
     because the Harambe-with-a-strap case is a VARIABLE length and no fixed
     landmark can express it. */
  function beltAttachAt(band, geom, plate, doubled, body, heightIn, topSpanIn, path) {
    /* finitePos, not isFinite: the picker's number input hands back "" while it
       is being typed into and an imported profile can hand back "28". isFinite
       says true to both. */
    if (!finitePos(heightIn)) return null;
    var reach = beltReach(band, geom, plate, doubled, body, topSpanIn, path);
    if (reach == null) return null;
    var s = beltStretch(reach, heightIn);
    if (s == null) return null;
    var rest = (geom && isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
      ? geom.restLengthIn : (band.lengthIn || 0);
    var effRest = rest / (doubled ? 2 : 1);
    var strain = effRest ? (s / effRest) : 0;
    return {
      k: "custom", label: "CUSTOM", heightIn: heightIn, stretchIn: s, strain: strain,
      belowRated: strain < LOAD_MODEL.STRAIN_AT_RATED_MIN,
      aboveRated: strain > LOAD_MODEL.STRAIN_AT_RATED_MAX
    };
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

  /* A REAL, USABLE number -- the guard CLAUDE.md's "isFinite(null) === true"
     hazard exists for. isFinite coerces before testing, so isFinite(null),
     isFinite("") and isFinite("36.5") are ALL true; a bare isFinite check
     therefore accepts a missing measurement (null), an empty input box ("")
     and a string that came back from an import as though the user had typed a
     number. 0 is rejected too: a floor-level attachment or a zero body width
     is not a measurement, it is an unset field wearing one's clothes.

     Byte-identical in semantics to bodyMeasureNum in both apps, deliberately
     -- a value that one of them refuses must not be computed on by the other.
     Used wherever a wrong answer here would show up as a confident number with
     a `basis` blaming the wrong thing. */
  function finitePos(v) {
    return typeof v === "number" && isFinite(v) && v > 0;
  }

  /* Effective load for one set, with its provenance.
       bandIds   the stack
       gearIds   the gear used for this exercise (may be empty)
       ctx       needs bandOf, and optionally gearOf / bandGeomOf / body
       opts      optional { doubled: Boolean, attachHeightIn: Number }
     Returns { lb, rated, ratio, provenance, stretchIn, basis, doubled,
     attachHeightIn, belowRated, aboveRated }. provenance is MEASURED /
     MODELED / RATED and callers MUST surface it - the number means something
     different in each case.

     Two paths. A footplate COMMITS to the first one whenever there is also a
     KNOWN AVENUE to a termination height (2026-08-06 -- used to require a
     belt specifically; see below):
       - ABSOLUTE-STRETCH (plate/belt path): taken when the exercise has a
         footplate AND (a belt, OR a bar, OR an `opts.exId` whose
         PLATE_GRIP_DEFAULT resolves against ctx.body). A plate consumes band
         identically whatever sits at the top -- a bar, handles, a belt, or
         nothing -- but a BARE footplate with none of those three is still
         the ordinary reference-strain elevation gear it has always been (a
         riser under an unrelated exercise), so it is deliberately left on
         the second path rather than forced here to degrade for lack of a
         height nobody was ever going to supply. The band's geometry fixes
         where it reaches; the attachment/grip height fixes the gap.
         REF_STRAIN is never consulted here and gearPathDelta is never
         called - this stretch is real, not a nudge off an assumption.
         Wording only distinguishes a belt rig from a plain plate rig
         ("belt setup: " vs "plate setup: " in `basis`); the arithmetic is
         one path. Missing ctx.body, a missing/non-finite height (a belt's
         from opts, a plain plate's from `plateGripDefault` unless opts
         overrides it), a missing top-end term on a SINGLED set (a belt
         needs ctx.body.bodyWidthIn; a bar needs its own attachSpanIn; bare
         handles or nothing at all are refused outright, each with its own
         reason), or a footplate whose dimensions cannot be resolved all
         degrade to RATED with a `basis` naming the reason. They do NOT fall
         through to the reference-strain path: that path returns the SAME
         number at any grip height and on either plate, which is the defect
         this path replaces -- for a belt specifically it used to subtract
         the belt's whole waist circumference as inline series length and
         report a confident 0 lb.
       - REFERENCE-STRAIN (every exercise with no footplate, plus a footplate
         with no known avenue to a height): unchanged from before this path
         existed, with one addition (2026-08-02): if series gear (a rope,
         handle, or anchor pair) is long enough to push any one band's
         modelled stretch to zero or below, that is the SAME confident-zero
         failure mode as the belt bug, arriving by a different route -- the
         model's path-length assumption has broken down for this setup, not
         the band. It degrades the WHOLE stack to RATED with a `basis`
         naming the reason, rather than let bandForceAt's correct 0-at-slack
         floor read as a real answer. */
  function effectiveLoad(ctx, bandIds, gearIds, opts) {
    var ids = bandIds || [];
    var o = opts || {};
    var d = o.doubled ? 2 : 1;
    /* MULTIPLIED BY `d` since 2026-08-03. It used to be deliberately undoubled,
       justified in a comment here on the grounds that "on the reference-strain
       path below `lb` carries no doubling either" -- which was true, and was
       itself the bug: a doubled NON-belt set changed no load at all. Now that
       `lb` doubles on both paths, an undoubled `rated` would stamp a doubled lb
       against a singled rated. 2x is also the vendor's own doubled convention,
       so it is the right figure for a fallback that quotes the vendor. */
    var rated = d * ids.reduce(function (a, id) {
      var b = ctx.bandOf ? ctx.bandOf(id) : null;
      return a + (b ? bandMid(b) : 0);
    }, 0);
    var out = { lb: rated, rated: rated, ratio: 1, provenance: "RATED",
                stretchIn: null, basis: "vendor midpoint",
                doubled: !!o.doubled, attachHeightIn: null,
                belowRated: false, aboveRated: false, romBlind: false };
    if (!ids.length) return out;

    /* ---- absolute-stretch path: footplate (+ optionally a belt) ---------
       The band's own geometry fixes where it reaches; the attachment/grip
       height fixes the gap. REF_STRAIN is never consulted here and
       gearPathDelta is never called -- this stretch is real, not a nudge
       off an assumption. */
    var plateItem = beltPlateOf(gearIds, ctx.gearOf);
    var beltOn = beltBeltPresent(gearIds, ctx.gearOf);
    /* A footplate takes this path since 2026-08-06 whenever there is some
       KNOWN AVENUE to a termination height, not only a belt rig -- a plate
       consumes band identically whatever sits at the top, and the old gate
       sent a plate-and-bar rig to REF_STRAIN, which returns the same number
       at any grip height and on either plate. See the spec, section 4a:
       "footplate AND a known termination height."

       "Known avenue" is deliberately narrower than "a footplate is present."
       A footplate is ALSO the ordinary reference-strain elevation gear it has
       always been (gearPathDelta adds its thickness+channel to the path for
       an exercise that merely stands on a riser) -- an exercise carrying a
       plain footplate and nothing else, with no belt, no bar, no exercise
       rule and no explicit height, is that case, and MUST still take the
       reference-strain path or a large, unrelated, pre-existing feature goes
       dark: it would report "plate setup: body measurements not set" for
       every ordinary lift ever logged while standing on something.

       The avenue is known when: it's a belt (unchanged), this exercise has a
       table default (`exId` was given AND it resolves), or a bar is present
       -- a bar carries its own attachSpanIn concept, so a footplate+bar rig
       is recognisably a plate/grip rig even for an exercise absent from the
       table, and is reported as missing a height rather than silently
       priced ROM-blind. An explicit `opts.attachHeightIn` on its own is
       deliberately NOT a gate trigger: without a belt, a bar, or a resolving
       exercise id there is still no known TOP-END TERMINATION for the band
       (see beltReach's `width` term), so a bare height number does not by
       itself make this a describable rig -- it still gets consumed as an
       override once some other avenue commits to this path. Handles are
       likewise NOT in this list on their own: the spec rules singled-on-
       handles unmodelled, and a footplate+handles rig with no known exercise
       stays on the reference-strain path exactly as before -- it only moves
       once a caller identifies the exercise (a resolving `exId`) or the rig
       is a belt. */
    if (plateItem) {
      var top = plateTopSpan(gearIds, ctx.gearOf);
      /* plateGripDefaultFor, not plateGripDefault: an inline extender hangs
         the grip lower than any table height describes, so the default is
         withdrawn and the user types the height instead. Same rule
         beltAttachDefault already applies on the belt side. */
      var gripDefault = beltOn ? null
                        : plateGripDefaultFor(o.exId, ctx.body, gearIds, ctx.gearOf);
      var knownAttach = beltOn || gripDefault != null || top.kind === "bar";
      if (knownAttach) {
      /* Wording only. The arithmetic below is one path; a reader looking at a
         degraded deadlift should not be told about a "belt setup". */
      var pfx = beltOn ? "belt setup: " : "plate setup: ";
      if (!ctx.body) {
        out.basis = pfx + "body measurements not set";
        return out;
      }
      /* An explicit height always wins: a choice the user made is never
         overridden by a table. The default applies to plate rigs only --
         a belt's landmark comes from BELT_ATTACH_DEFAULT via the picker. */
      var heightIn = finitePos(o.attachHeightIn) ? o.attachHeightIn
                    : (beltOn ? null : gripDefault);
      /* finitePos, NOT isFinite: isFinite(null) and isFinite("") are both
         true, so the bare check let a missing or half-entered height through
         further down, which refused it and returned RATED with a `basis`
         blaming the BAND ("no band in this stack can be rigged on this
         footplate") for a field the user simply never filled in. The number
         was never wrong; the stated reason was, which is the same failure
         in a smaller coat. A rig can reach here via the bar-present avenue
         with no resolving `exId`, so heightIn can still be unset even though
         knownAttach was true -- the avenue existed, the value didn't. */
      if (!finitePos(heightIn)) {
        out.basis = pfx + (beltOn ? "no attachment height recorded"
                                  : "no grip height recorded");
        return out;
      }
      /* SINGLED ONLY -- beltReach genuinely does not consult the top span when
         the band is doubled, because the top end is the fold. Each branch names
         the input that is missing, so nobody re-measures a band that was fine. */
      var topSpanIn = null;
      if (!o.doubled) {
        if (top.kind === "belt") {
          /* Load-bearing: `body.bodyWidthIn || 0` turned an unmeasured width
             into a real 0, which SHORTENS `consumed` and so LENGTHENS `reach`
             -- the same 41in band at the same hip landmark reports 16.44in /
             8.02 lb with the width set and 7.56in / 3.69 lb without it, 54%
             light, provenance still MODELED and nothing on screen saying so.
             bodyMeasureComplete() gates the PICKER, not the engine, so a
             history re-edit on a half-filled profile reached here. */
          if (!finitePos(ctx.body.bodyWidthIn)) {
            out.basis = "belt setup: body width not measured (a singled band spans it)";
            return out;
          }
        } else if (top.kind === "bar") {
          if (!finitePos(top.spanIn)) {
            out.basis = "plate setup: the bar's attach span is unknown";
            return out;
          }
          topSpanIn = top.spanIn;
        } else if (top.kind === "handles") {
          out.basis = "plate setup: a singled band on handles is not modelled";
          return out;
        } else {
          out.basis = "plate setup: nothing recorded for the band to terminate in";
          return out;
        }
      }
      /* resolveGearDims never returns falsy for a real item -- an unknown
         brand|name comes back as a bare unverified estimate with no
         dimensions at all. Defaulting that to {} would let beltReach compute
         off the body width alone and report a fabricated number as MODELED,
         defeating beltReach's own `if (!plate) return null` guard. */
      var plate = resolveGearDims(plateItem);
      if (!plate || (!isFinite(plate.thicknessIn) &&
                     !isFinite(plate.bandSpanIn) &&
                     !isFinite(plate.lengthIn))) {
        out.basis = pfx + "the footplate's dimensions are unknown";
        return out;
      }
      /* WHICH way the band is rigged on this plate. Unset means the plate's
         first declared path -- the ordinary way -- so every rig logged before
         band paths existed prices unchanged.

         A key this plate does not offer is REFUSED here rather than quietly
         resolved to the default. Substituting would reprice a saved exercise
         against geometry the user never chose, confidently and with nothing on
         screen saying so, which is the failure this whole model exists to
         remove. It happens when a plate is swapped on a saved entry. */
      var bPath = plateBandPathOf(plateItem, o.bandPath);
      if (!bPath) {
        out.basis = pfx + "this footplate does not offer the recorded band path";
        return out;
      }
      var lbB = 0, refB = 0, anyB = false, allMeasured = true, minStrain = Infinity,
          maxStrain = 0, firstStretch = null, anyClamped = false;
      ids.forEach(function (id) {
        var b = ctx.bandOf ? ctx.bandOf(id) : null;
        if (!b) return;
        var geom = ctx.bandGeomOf ? (ctx.bandGeomOf(id) || {}) : {};
        var reach = beltReach(b, geom, plate, o.doubled, ctx.body, topSpanIn, bPath);
        var s = beltStretch(reach, heightIn);
        if (s == null) return;                    // this band cannot be rigged so
        anyB = true;
        if (firstStretch == null) firstStretch = s;
        var rest = (isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
          ? geom.restLengthIn : (b.lengthIn || 0);
        var strain = rest ? (d * s / rest) : 0;
        if (strain < minStrain) minStrain = strain;
        if (strain > maxStrain) maxStrain = strain;
        var pts = sanitizeMeasuredPoints(geom.measured);
        /* Readings must BRACKET the stretch. Extrapolating past the ends of
           the measured span is not a measurement. */
        var enough = pts.length >= LOAD_MODEL.MIN_MEASURED_POINTS;
        var brackets = enough && pts[0].stretchIn <= d * s &&
                       pts[pts.length - 1].stretchIn >= d * s;
        if (!brackets) allMeasured = false;
        /* Enough readings to be interpolated, but they do not reach this
           stretch: bandForceAt CLAMPS to the nearest reading, so the number
           did not come off the fitted curve either. Recorded so `basis` can
           say what actually happened instead of naming a curve that was never
           evaluated. */
        if (enough && !brackets) anyClamped = true;
        lbB  += d * bandForceAt(b, d * s, geom);
        refB += d * bandMid(b);
      });
      if (anyB) {
        out.lb = lbB;
        out.rated = refB;
        out.ratio = refB ? (lbB / refB) : 1;
        out.stretchIn = firstStretch;
        out.attachHeightIn = heightIn;
        out.bandPathK = bPath.k;
        out.bandPathLabel = bPath.l;
        out.belowRated = minStrain < LOAD_MODEL.STRAIN_AT_RATED_MIN;
        out.aboveRated = maxStrain > LOAD_MODEL.STRAIN_AT_RATED_MAX;
        var gearOK = gearDimsVerified(gearIds, ctx.gearOf);
        /* Provenance follows the PATH, not the plate. A plate may carry a
           taped figure for one path and a computed one for another -- the
           Acacia's near-slot is Greg's tape while its whole-plate figure is
           still the legacy arithmetic -- so asking "did the user measure this
           plate" is the wrong question. The right one is "did the user measure
           the way this band is actually rigged".

           This replaces `finitePos(plate.bandSpanIn)`, which asked the older
           question and gave the same answer only by coincidence. */
        var plateSpanMeasured = bPath.source === "measured";
        out.provenance = (allMeasured && gearOK && plateSpanMeasured)
          ? "MEASURED" : "MODELED";
        if (out.provenance === "MEASURED") {
          out.basis = "interpolated through your Tension Master readings at a measured band path";
        } else if (anyClamped) {
          out.basis = "band path from the footplate and your attachment height, " +
                      "clamped to your nearest Tension Master reading (your readings " +
                      "do not reach this stretch)";
        } else if (allMeasured && gearOK && !plateSpanMeasured) {
          out.basis = "band path from the footplate and your attachment height, " +
                      "on your Tension Master readings but over a " + bPath.source +
                      " footplate band path (" + bPath.l + ")";
        } else {
          out.basis = "band path from the footplate and your attachment height, " +
                      "on the fitted curve";
        }
        return out;
      }
      /* Nothing riggable: stays RATED, and still never falls through. */
      out.basis = pfx + "no band in this stack can be rigged on this footplate";
      return out;
      }
      /* knownAttach was false: no belt, no explicit height, no resolving
         exId, no bar. This footplate is ordinary reference-strain elevation
         gear (or an as-yet-unidentified exercise) -- fall through, unchanged. */
    }

    /* ---- reference-strain path: unchanged for every other exercise ------ */
    /* An ADJUSTABLE item with no position chosen (2026-08-07). This path is
       the only one that consults gearPathDelta, and there an unanswered
       choice contributes a silent 0 -- on the X Straps, up to 26.38in of
       inline length priced as none at all. The absolute-stretch path above
       deliberately does NOT check this: it never calls gearPathDelta, and the
       height the user typed already accounts for whatever hangs inline (the
       model terminates AT THE BAND -- Greg, 2026-08-02).

       Degrades the WHOLE stack, like every other refusal in this function: a
       partial sum over the bands whose geometry IS describable would still
       stamp a provenance on a setup the model cannot describe. */
    var unsetAdj = gearAdjustableUnset(gearIds, ctx.gearOf, o.opening);
    if (unsetAdj) {
      out.basis = "adjustable gear with no opening set: " +
                  ((unsetAdj.brand ? unsetAdj.brand + " " : "") + (unsetAdj.name || "item"));
      return out;
    }
    var delta = gearPathDelta(gearIds, ctx.gearOf, o.opening);
    var anyGeom = false, anyMeasured = false, lb = 0, refTotal = 0, slack = false;
    var minStrainR = Infinity, maxStrainR = 0;

    ids.forEach(function (id) {
      var b = ctx.bandOf ? ctx.bandOf(id) : null;
      if (!b) return;
      var geom = ctx.bandGeomOf ? (ctx.bandGeomOf(id) || {}) : {};
      var rest = (isFinite(geom.restLengthIn) && geom.restLengthIn > 0)
        ? geom.restLengthIn : (b.lengthIn || 0);
      if (!rest) { lb += bandMid(b); refTotal += bandMid(b); return; }
      if (isFinite(geom.restLengthIn) || delta) anyGeom = true;
      /* sanitizeMeasuredPoints, not the raw array: a half-entered reading
         (stretch typed, lb still null) is padded into `measured` by the
         calibration panel on purpose, and counting it here claimed MEASURED
         over a number bandForceAt had computed off the FITTED CURVE, because
         bandForceAt sanitizes and found only one usable point. Same floor,
         read the same way, in both places. */
      var pts = sanitizeMeasuredPoints(geom.measured);
      if (pts.length >= LOAD_MODEL.MIN_MEASURED_POINTS) anyMeasured = true;
      var refStretch = LOAD_MODEL.REF_STRAIN * rest;
      /* Series gear (ropes, anchors, handles) longer than the reference path
         drives this band's modelled stretch to zero or below. bandForceAt
         would floor that at a correct 0, but a confident 0 is exactly the
         belt bug in a different coat: the model's assumption (path length
         fixed at 2x rest length) has broken down for this setup, not the
         band's force curve. Flag it and stop touching lb/refTotal -- a
         partial sum from the OTHER bands in the stack would still stamp a
         provenance on a geometry this model cannot describe. */
      if (refStretch + delta <= 0) { slack = true; return; }
      /* The sub-rated ramp is NEW (2026-08-02), and it turned the old
         confident 0 into a small positive number -- which is honest, but only
         if the caller is told the figure came off an extrapolation BELOW
         anything the vendor publishes. belowRated used to be set by the belt
         path alone, so every non-belt setup with enough series gear to fall
         under strain 0.5 got that number with nothing flagging it.
         bandForceAt's own comment already claimed "callers surface it". */
      /* THE FOLD, applied here since 2026-08-03. `doubled` used to be read only
         on the belt path, so folding a band off a belt -- physically the biggest
         single jump this app can log -- moved the number by exactly zero.

         Mirrors the belt path's convention exactly rather than inventing a
         second one: folding halves the band's free length while the lifter's ROM
         does not change, so the ABSOLUTE elongation is unchanged and the STRAIN
         doubles; then `d` strands carry it. Hence d * bandForceAt(.., d * s),
         the same shape beltReach/beltStretch already use.

         This lands well above the vendor's 2x convention, which is the point:
         the DOUBLE button in both apps already warns that 2x is the spec-sheet
         figure and a real ROM gives 5-8x. The engine now agrees with the warning
         instead of quietly contradicting it.

         `refTotal` doubles too, so `ratio` keeps meaning "what the GEAR did"
         rather than silently absorbing the fold. */
      var strainR = d * (refStretch + delta) / rest;
      if (strainR < minStrainR) minStrainR = strainR;
      if (strainR > maxStrainR) maxStrainR = strainR;
      refTotal += d * bandForceAt(b, d * refStretch, geom);
      lb += d * bandForceAt(b, d * (refStretch + delta), geom);
    });

    /* Whole-set, not per-band: if one band in a stack is slack and another
       is not, the setup's geometry is not describable and a partial number
       would mislead. Degrade the WHOLE result to RATED and say why -- the
       same rule the absolute-stretch (belt) path above already applies to
       its four degradation modes, so both paths obey one rule. */
    if (slack) {
      out.basis = "gear is longer than the reference path allows; geometry not modelled";
      return out;
    }

    /* This figure could not see the range of motion: it is REF_STRAIN * rest
       plus a gear delta, identical at any grip height. Since 2026-08-06 a
       footplate rig gets real geometry instead, so ROM-aware and ROM-blind
       loads now sit side by side on the same screen and MUST NOT look equally
       authoritative. Degraded RATED results do not carry this -- they computed
       nothing to be blind with. */
    out.romBlind = true;

    if (!anyGeom && !anyMeasured) return out;      // nothing to improve on

    out.lb = lb;
    out.ratio = refTotal ? (lb / refTotal) : 1;
    out.stretchIn = delta;
    /* Infinity/0 when no band was evaluated, which reads as "not flagged" --
       correct, because nothing was computed to flag. */
    out.belowRated = minStrainR < LOAD_MODEL.STRAIN_AT_RATED_MIN;
    out.aboveRated = maxStrainR > LOAD_MODEL.STRAIN_AT_RATED_MAX;
    /* MEASURED requires BOTH a measured band curve AND (when gear is in play)
       gear the user measured. Anything less is MODELED - it is still an
       estimate, and must not be presented as a reading. */
    var gearOK2 = !gearIds || !gearIds.length || gearDimsVerified(gearIds, ctx.gearOf);
    out.provenance = (anyMeasured && gearOK2) ? "MEASURED" : "MODELED";
    out.basis = out.provenance === "MEASURED"
      ? "interpolated through your Tension Master readings"
      : "fitted from the vendor's rated range at an assumed strain, adjusted for gear";
    return out;
  }

  /* The heaviest set in a sets list, as an effectiveLoad result -- the same
     selection stampLoad uses to decide what a whole exercise "means" when the
     band stack differs set to set (e.g. warm-up sets lighter than working
     sets). Reads each set's bands the same way stampLoad does: the first
     segment's bands for a drop/segmented set, else the plain `bands` array.
     Sets with no bands logged are skipped, not treated as a zero-load set.

     Shared by stampLoad (persisted, at save time) and any in-workout display
     that wants to show "the load this exercise represents right now" without
     duplicating the selection rule -- the exercise card must never merge
     bands ACROSS sets into one artificial stack (a lighter warm-up band plus
     a heavier working band is not a real combined stack anyone wears).

       sets           [ {reps, bands, segments?, doubled?, ...}, ... ] -- one
                      exercise's sets; `doubled` is read off each set itself.
       gearIds        [gearId, ...] -- gear used for this exercise (same for
                      every set; gear doesn't change set to set the way band
                      resistance does)
       attachHeightIn a bare number -- an explicit attachment/grip height for
                      this exercise, or undefined/omitted to let a plain
                      plate rig fall back to `plateGripDefault(exId, body)`.
       ctx            needs bandOf, and optionally gearOf / bandGeomOf / body
                      -- exactly what effectiveLoad needs.
       exId           optional -- the exercise id, threaded through to
                      effectiveLoad so a plate rig with no explicit height
                      can resolve the table default. Omitted by any caller
                      that doesn't have it, which is safe: no default is
                      exactly the pre-2026-08-06 behaviour.

     Returns the effectiveLoad result for the heaviest set, or null when no
     set in the list logged any bands.

     "Heaviest" is decided WITHIN a provenance tier first, and only then by lb,
     because a RATED figure and a MODELED one are not the same kind of number.
     A RATED result is either a degradation ("this setup could not be
     computed") or a bare vendor midpoint at an unstated stretch; a MODELED or
     MEASURED one is a real computed load at a known stretch. Comparing them
     directly let a degraded RATED 30 beat a correctly computed MODELED 8 and
     become the exercise's stamped load -- the frozen, permanent record of what
     that workout meant -- and singled sub-rated loads are small enough to make
     that reachable in ordinary use. So: any real result outranks every
     degraded one, and if EVERY set degraded the exercise degrades, carrying
     its own basis rather than a number borrowed from a different model.
     MEASURED and MODELED share a tier: both are real loads on the same scale,
     and picking by provenance there would report a lighter set as the top. */
  function bestSetLoad(ctx, sets, gearIds, attachHeightIn, exId, opening, bandPath) {
    var best = null, bestTier = -1;
    (sets || []).forEach(function (s) {
      var bands = Array.isArray(s.segments)
        ? (((s.segments[0] || {}).bands) || []) : (s.bands || []);
      if (!bands.length) return;
      var e = effectiveLoad(ctx, bands, gearIds,
                            { doubled: !!s.doubled, attachHeightIn: attachHeightIn,
                              exId: exId, opening: opening, bandPath: bandPath });
      var tier = e.provenance === "RATED" ? 0 : 1;
      if (!best || tier > bestTier || (tier === bestTier && e.lb > best.lb)) {
        best = e; bestTier = tier;
      }
    });
    return best;
  }

  /* Freeze the computed load onto a workout entry AT SAVE TIME. Re-measuring a
     band or correcting a gear dimension next year must never rewrite what a
     past workout meant -- an entry saved before this existed simply has no
     `load` block and falls back to the vendor midpoint, marked RATED. Same
     discipline as the band-id stability rule, applied to load instead of
     identity.

       exercises   { exId: [ {reps, bands, segments?, doubled?, ...}, ... ] }
                   -- the `exercises` map of a log entry
       gearMap     { exId: [gearId, ...] } -- the `gear` map of a log entry,
                   keyed by exercise id (gear doesn't change set to set the
                   way band resistance does)
       ctx         needs bandOf, and optionally gearOf / bandGeomOf / body --
                   exactly what effectiveLoad needs. Callers build and inject
                   it (makeReportCtx() in both apps); this module touches no
                   DOM, no localStorage and no app globals.
       attachMap   { exId: heightIn } -- belt attachment height per exercise
                   id, or absent/undefined for exercises that aren't a belt
                   setup.
       bandPathMap { exId: pathKey } -- WHICH way the band was rigged on the
                   footplate, per exercise id. Absent or undefined means the
                   plate's first declared path, which is how every entry
                   logged before 2026-08-14 keeps its meaning. The key is
                   frozen onto the stamp only when it actually priced the
                   result; see bandPathK below.

     Returns { exId: { lb, rated, ratio, provenance, deltaIn | stretchIn,
     doubled, attachIn, belowRated, romBlind } }, one entry per exercise that
     logged at least one band. The band stack can differ set to set, so the stamp uses
     the HEAVIEST set -- the same set setTopLoad already reports. Returns
     undefined when there is nothing to stamp (no usable ctx, or no exercise
     logged any bands).

     `deltaIn` and `stretchIn` are MUTUALLY EXCLUSIVE, and each means exactly
     one thing:
       deltaIn    reference-strain path. The signed number of inches the GEAR
                  adds to (+) or removes from (-) the reference stretch. A
                  DELTA; on its own it says nothing about how far the band was
                  actually pulled.
       stretchIn  belt path (identified by best.attachHeightIn != null). The
                  ABSOLUTE elongation of the band, in inches past its rest
                  length.
     Writing both under one key would leave a consumer unable to tell a -35in
     gear delta from a 35in real stretch without reverse-engineering the entry.

     Note the persisted stamp writes `attachIn`, while the live effectiveLoad
     result carries `attachHeightIn` -- different names, deliberately, so a
     stamped field is never confused for a live one. */
  function stampLoad(exercises, gearMap, ctx, attachMap, openingMap, bandPathMap) {
    if (!ctx || typeof ctx.bandOf !== "function") return undefined;
    var out = {}, any = false;
    Object.keys(exercises || {}).forEach(function (exId) {
      var sets = exercises[exId] || [];
      var gearIds = (gearMap && gearMap[exId]) || [];
      /* finitePos, NOT isFinite -- see finitePos. `attach` is written on every
         save, including as {} or with a null per exercise, so isFinite would
         have passed null straight through to effectiveLoad as a "height". */
      var attachIn = (attachMap && finitePos(attachMap[exId])) ? attachMap[exId] : undefined;
      /* Passed through RAW, not guarded here: gearOpeningSeriesIn's strict
         === already refuses a "3", a 3.5 and an out-of-range 9, and a value
         this rejects must DEGRADE loudly rather than be quietly dropped to
         undefined and degrade for a different stated reason. */
      var openingN = openingMap ? openingMap[exId] : undefined;
      /* Passed through RAW for the same reason as openingN: plateBandPathOf
         already refuses a key the plate does not offer, and a value it rejects
         must DEGRADE loudly in effectiveLoad rather than be quietly dropped to
         undefined here and degrade for a different stated reason. */
      var bandPathK = bandPathMap ? bandPathMap[exId] : undefined;
      var best = bestSetLoad(ctx, sets, gearIds, attachIn, exId, openingN, bandPathK);
      if (!best) return;
      any = true;
      /* One key, one meaning: a gear DELTA or an ABSOLUTE stretch, never
         both under the same name. See the note above. */
      var isBelt = best.attachHeightIn != null;
      /* Frozen only when it actually PRICED something: a value naming no real
         position, or a rig with nothing adjustable in it, must not leave a
         number on the permanent record implying an opening was in play. */
      var openingUsed = gearHasAdjustable(gearIds, ctx.gearOf) &&
                        gearAdjustableUnset(gearIds, ctx.gearOf, openingN) === null;
      out[exId] = { lb: Math.round(best.lb * 10) / 10, rated: Math.round(best.rated * 10) / 10,
                    ratio: Math.round(best.ratio * 1000) / 1000,
                    provenance: best.provenance,
                    deltaIn: isBelt ? undefined : best.stretchIn,
                    stretchIn: isBelt ? best.stretchIn : undefined,
                    doubled: best.doubled || undefined,
                    attachIn: best.attachHeightIn == null ? undefined : best.attachHeightIn,
                    openingN: openingUsed ? openingN : undefined,
                    /* Frozen only when the absolute-stretch path actually
                       produced this number AND named the path it used.
                       effectiveLoad sets best.bandPathK only inside that
                       branch, so a reference-strain rig, a degraded result and
                       a rig with no footplate all correctly record nothing --
                       the same rule openingN follows two lines above.
                       The `&& bandPathK` half is what stops an UNCHOSEN
                       default being written back as though the user had picked
                       it: the default priced the set, but nobody selected it,
                       and a stamp claiming otherwise would outlive the reason. */
                    bandPathK: (best.bandPathK && bandPathK) ? best.bandPathK : undefined,
                    belowRated: best.belowRated || undefined,
                    romBlind: best.romBlind || undefined };
    });
    return any ? out : undefined;
  }

  /* Apply a freshly computed stampLoad() result onto a log entry that is
     about to be re-persisted (a history edit, never the first save -- first
     saves just set `load` directly). Returns a NEW object; never mutates
     `entry`.

     WHY the removal branch exists: this is only ever called after the
     caller has recomputed loadStamp from the sets it is about to save. If
     that recompute comes back falsy (e.g. every band was removed from the
     entry), the entry's OLD `load` -- computed from sets that no longer
     exist -- must not survive the edit. A stamp that contradicts its own
     entry's sets is worse than no stamp: an absent `load` degrades honestly
     to RATED everywhere it's read, while a stale one silently corrupts trend
     analysis with a number that no longer describes what was logged. So a
     falsy loadStamp deletes `load` from the result entirely, rather than
     leaving whatever was there before. */
  function applyLoadStamp(entry, loadStamp) {
    var out = assign(entry || {}, {});
    if (loadStamp) {
      out.load = loadStamp;
    } else {
      delete out.load;
    }
    return out;
  }

  /* Did the equipment change between two sessions, and by how much?
     The WARNING is worth more than a correction: an 18-36% shift the model can
     only estimate is better flagged than silently modelled away. */
  /* BELT-AWARE since 2026-08-03, and it had to become so because it was
     confidently wrong on screen.

     This function used to report gearPathDelta unconditionally. gearPathDelta is
     the REFERENCE-STRAIN quantity, which the belt path never consults -- so on a
     belt lift the banner described a mechanism that does not apply to the lift
     AND inverted the answer. Greg's real screen, swapping the Acacia plate for
     the Qdeck on a belted split squat, read "about 0.8in of band path, which
     makes the same band LIGHTER". The Qdeck consumes MORE band, so it leaves
     LESS reach, so the same band is stretched FURTHER at the same attachment
     height: it is the HEAVIER setup. Same failure as the belt bug itself -- a
     number produced by the wrong path, stated without hedging.

     `mode` names the currency, so no caller can render the wrong sentence:

       "path"         neither setup is a belt setup. deltaIn is band path, as
                      before, and positive still means heavier.
       "belt"         both are belt setups. deltaIn is the change in STRETCH at
                      a fixed attachment height, i.e. -(reachNow - reachPrev),
                      so positive still means heavier and callers keep one sign
                      convention. reachPrev/reachNow are exposed for the text.
       "incomparable" the setup gained or lost its belt, or is a belt setup with
                      no band logged yet. The two states are not measured in the
                      same units and there is no honest single number, so
                      `direction` is "unknown" and deltaIn is null. Callers must
                      say the setup changed WITHOUT quantifying it.

     opts { band, geom, doubled } is required to reach "belt"; without a band
     there is no reach to compute and it degrades to "incomparable" rather than
     falling back to the path sentence that is wrong for it. */
  /* Ordered substitute candidates for one scheduled exercise.

     Three bands: same muscle group AND same iso/comp class; same group, other
     class; then everything else, which is withheld unless the caller asks for
     it. Each band is sorted by NAME, because the reader is scanning for a lift
     they already know by name and an id ordering would scatter them.

     Group and class are used rather than a curated per-exercise table on
     purpose. Both already cover every exercise and are maintained for other
     reasons, so this ordering cannot go stale. The curated tables elsewhere in
     this module -- BELT_EXTENDERS, PLATE_GRIP_DEFAULT -- earn their cost
     because a wrong value there is APPLIED SILENTLY to a load figure. Here the
     output is a list a person reads and then chooses from, so an imperfect
     ordering is visible and correctable in the moment rather than frozen onto
     a stamp.

     ctx supplies allExerciseIds(), groupOf(id), classOf(id) and nameOf(id),
     the same callback style as bandOf / gearOf / bandGeomOf.
     opts is { showAll: Boolean }, default false. */
  function substituteCandidates(exId, ctx, opts) {
    opts = opts || {};
    var id = Number(exId);
    var g = ctx.groupOf(id);
    var label = g ? g.label : null;
    var cls = ctx.classOf(id);
    var b1 = [], b2 = [], b3 = [];
    (ctx.allExerciseIds() || []).forEach(function (other) {
      other = Number(other);
      if (other === id) return;
      var og = ctx.groupOf(other);
      var ol = og ? og.label : null;
      /* A null group never matches a null group: an exercise the tables do not
         know is not "the same group" as another unknown one. Without this both
         fall into band 1 together and the picker offers a confident pairing
         off two absences. */
      if (label != null && ol === label && ctx.classOf(other) === cls) b1.push(other);
      else if (label != null && ol === label) b2.push(other);
      else b3.push(other);
    });
    function byName(a, b) {
      return String(ctx.nameOf(a)).localeCompare(String(ctx.nameOf(b)));
    }
    return {
      sameGroupSameClass: b1.sort(byName),
      sameGroup: b2.sort(byName),
      other: opts.showAll ? b3.sort(byName) : [],
    };
  }

  function gearChange(ctx, prevGearIds, nowGearIds, opts) {
    var a = (prevGearIds || []).slice().sort().join(",");
    var b = (nowGearIds || []).slice().sort().join(",");
    var o = opts || {};
    /* A BAND PATH change moves the load with the gear id list untouched -- the
       same plate threaded through its slots instead of wrapped end to end is
       4.25in less band consumed on the Clench -- so the identity test has to
       include it or the banner never fires at all.

       Both sides normalise through plateBandPathOf, so an UNSET key and an
       explicit default compare EQUAL: merely opening the picker and
       re-selecting the default must not report a phantom setup change. */
    var itPrev = beltPlateOf(prevGearIds, ctx.gearOf);
    var itNow  = beltPlateOf(nowGearIds, ctx.gearOf);
    var pathPrev = itPrev ? plateBandPathOf(itPrev, o.prevBandPath) : null;
    var pathNow  = itNow  ? plateBandPathOf(itNow,  o.bandPath)     : null;
    var kPrev = pathPrev ? pathPrev.k : null;
    var kNow  = pathNow  ? pathNow.k  : null;
    var pathChanged = kPrev !== kNow;
    if (a === b && !pathChanged) return null;
    var names = function (list) {
      return (list || []).map(function (id) {
        var g = ctx.gearOf ? ctx.gearOf(id) : null;
        return g ? g.name : id;
      });
    };
    var out = { changed: true, prev: names(prevGearIds), now: names(nowGearIds) };

    var beltBefore = !!(beltPlateOf(prevGearIds, ctx.gearOf) &&
                        beltBeltPresent(prevGearIds, ctx.gearOf));
    var beltAfter  = !!(beltPlateOf(nowGearIds, ctx.gearOf) &&
                        beltBeltPresent(nowGearIds, ctx.gearOf));

    if (beltBefore !== beltAfter) {
      out.mode = "incomparable"; out.deltaIn = null; out.direction = "unknown";
      out.reason = beltAfter ? "this setup adds a belt; the previous one had none"
                             : "the previous setup used a belt and this one does not";
      return out;
    }

    /* A key naming no real path cannot be priced against one that does. */
    if ((o.prevBandPath && itPrev && !pathPrev) || (o.bandPath && itNow && !pathNow)) {
      out.mode = "incomparable"; out.deltaIn = null; out.direction = "unknown";
      out.reason = "the recorded band path is not one this footplate offers";
      return out;
    }

    if (beltBefore && beltAfter) {
      var band = o.band || null;
      var pPrev = resolveGearDims(beltPlateOf(prevGearIds, ctx.gearOf));
      var pNow  = resolveGearDims(beltPlateOf(nowGearIds, ctx.gearOf));
      var body  = ctx.body || null;
      /* The chosen paths, not the legacy whole-plate arithmetic. Until
         2026-08-14 this quoted a delta computed off numbers effectiveLoad had
         already stopped using -- the same divergence class as the picker
         computing one reach while the engine computed another. */
      var rPrev = (band && pPrev && body)
        ? beltReach(band, o.geom || null, pPrev, !!o.doubled, body, null, pathPrev) : null;
      var rNow = (band && pNow && body)
        ? beltReach(band, o.geom || null, pNow, !!o.doubled, body, null, pathNow) : null;
      if (!finitePos(rPrev) || !finitePos(rNow)) {
        out.mode = "incomparable"; out.deltaIn = null; out.direction = "unknown";
        out.reason = !band ? "no band logged yet, so the band's reach is unknown"
                   : (!body ? "body measurements are not set"
                            : "this band cannot be rigged on one of these footplates");
        return out;
      }
      out.mode = "belt";
      out.reachPrev = rPrev;
      out.reachNow = rNow;
      /* Negated on purpose: LESS reach is MORE stretch. Keeping "positive means
         heavier" identical across both modes is what lets one banner read the
         sign without knowing which path produced it. */
      out.deltaIn = rPrev - rNow;
      out.direction = out.deltaIn > 0 ? "heavier"
                    : (out.deltaIn < 0 ? "lighter" : "unknown");
      return out;
    }

    /* A band-path change with no belt in the rig. The reach branch above is
       gated on a belt on BOTH sides, and widening that gate would change what
       the banner says for every ordinary elevation rig -- a separate decision,
       deliberately not taken here. Falling through to gearPathDelta instead
       would be worse than useless: that function never consults the band path,
       so it would quote a confident ZERO for a change worth inches of reach.
       Refusing to quantify is the same posture as the 2026-08-03 fix that
       stopped this banner reporting a belt swap in reference-strain currency. */
    if (pathChanged) {
      out.mode = "incomparable"; out.deltaIn = null; out.direction = "unknown";
      out.reason = "the band path changed, and without a belt this setup has " +
                   "no single comparable number";
      return out;
    }

    /* An adjustable item with no position chosen on EITHER side. gearPathDelta
       would price it at zero inline length and the banner would quote a
       confident number for a strap that spans 3.94in to 26.38in depending on
       one unanswered question. The banner's existing discipline applies: say
       the setup changed, refuse to quantify it, name the reason. */
    var adjPrev = gearAdjustableUnset(prevGearIds, ctx.gearOf, o.opening);
    var adjNow  = gearAdjustableUnset(nowGearIds, ctx.gearOf, o.opening);
    var adjBad = adjPrev || adjNow;
    if (adjBad) {
      out.mode = "incomparable"; out.deltaIn = null; out.direction = "unknown";
      out.reason = "no opening is set for the " +
                   ((adjBad.brand ? adjBad.brand + " " : "") + (adjBad.name || "item")) +
                   ", so its inline length is unknown";
      return out;
    }

    var da = gearPathDelta(prevGearIds, ctx.gearOf, o.opening);
    var db = gearPathDelta(nowGearIds, ctx.gearOf, o.opening);
    out.mode = "path";
    out.deltaIn = db - da;
    /* Positive delta = more stretch = heavier at the same body position. */
    out.direction = (db - da) > 0 ? "heavier" : ((db - da) < 0 ? "lighter" : "unknown");
    return out;
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

    var exRows = [], perEx = [], rawEntries = [], n = 0;
    slots.forEach(function (pair) {
      var slot = pair[0], id = pair[1];
      if (id == null) return;
      n++;
      var lu = lastUse(ctx.log, id, opts.date, ctx.deloadOf);
      /* Same last-used entry lastUse() derives from, kept whole (not the
         stripped {date,sets,gear,isDeload} shape) so loadCaveatNotes below
         can read its .load stamp. */
      var rawLu = entriesFor(ctx.log, id, opts.date)[0];
      if (rawLu) rawEntries.push(rawLu);
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

    /* Item q + Task 6: same caveats the exercise card shows, scanned over the
       same last-used entries this sheet already pulled bands/gear from. */
    var loadNotes = { heading: "LOAD METHOD NOTES", type: "notes",
      rows: loadCaveatNotes(rawEntries, ctx.gearOf) };

    return {
      kind: "setup",
      title: "WORKOUT SETUP SHEET",
      meta: meta,
      sections: [
        { heading: "PULL LIST", type: "kv", rows: pullRows },
        { heading: "EXERCISES", type: "exercises", rows: exRows },
        loadNotes
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

    /* Item q + Task 6: same caveats the exercise card and the ANALYZE tab
       show, scanned over the entries this report already walked. A distinct
       heading from the per-session "NOTES" above (that one is the lifter's
       own note text for a session). */
    sections.push({ heading: "LOAD METHOD NOTES", type: "notes",
      rows: loadCaveatNotes(entries, ctx.gearOf) });

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
    /* Item q + Task 6: the exercise card already surfaces a PEAK-not-average
       warning, romBlind and era:"pre-fold" on the load figure itself; the
       report said none of it, so a printed number could silently predate a
       model fix. Scans the same entries this report already walked. */
    loadCaveatNotes(win.entries, ctx.gearOf).forEach(function (n) { notes.push(n); });
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
                                  /* COMPUTED and DERIVED, not taped. This plate was at
                                     Greg's son's on 2026-08-14 and could not be measured.
                                     It has no hole, so the two whole-plate paths are all
                                     it needs. Both figures are the legacy arithmetic
                                     (span + 2*thickness + channel), so this plate prices
                                     exactly as it did before band paths existed --
                                     stampPredatesBandPath correctly leaves its history
                                     unflagged. On the four plates Greg DID tape, the real
                                     path runs about 2in shorter than this arithmetic, so
                                     these two carry a known bias until measured. */
                                  bandPaths: [
                                    { k: "len", l: "UNDER - LENGTHWISE", consumedIn: 27.25, source: "computed" },
                                    { k: "wid", l: "UNDER - WIDTHWISE",  consumedIn: 17,    source: "derived" }
                                  ],
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
                                  note: "set of 4, 5in. Adjusted with stackable 1/2in spacers. NOT additive with a rod. Working length is always LESS than the rated figure and is EMERGENT, not fixed: the rope comes off the ends of a ROD, and rods come in different lengths. It also hangs in the DIRECTION OF THE PULL, not straight down. So this number is NOT a vertical drop and must never be subtracted from a belt landmark -- see beltAttachDerived (Greg, 2026-08-10)." },
    "Harambe|Yellow Ropes":     { seriesIn: 6, source: "measured", verified: true,
                                  note: "set of 4, 6in. NOT additive with a rod. Working length is always LESS than the rated figure and is EMERGENT, not fixed: the rope comes off the ends of a ROD, and rods come in different lengths. It also hangs in the DIRECTION OF THE PULL, not straight down. So this number is NOT a vertical drop and must never be subtracted from a belt landmark -- see beltAttachDerived (Greg, 2026-08-10)." },
    "Harambe|Blue Ropes":       { seriesIn: 29, source: "measured", verified: true,
                                  note: "29in. NOT OWNED YET — seeded inbound so the figure is ready when it arrives. Working length is always LESS than the rated figure and is EMERGENT, not fixed: the rope comes off the ends of a ROD, and rods come in different lengths. It also hangs in the DIRECTION OF THE PULL, not straight down. So this number is NOT a vertical drop and must never be subtracted from a belt landmark -- see beltAttachDerived (Greg, 2026-08-10)." },
    "Harambe|White Ropes":      { seriesIn: 12.5, source: "measured", verified: true,
                                  note: "set of 4, 12.5in. Adjusted with 1/2in spacers. NOT additive with a rod. Working length is always LESS than the rated figure and is EMERGENT, not fixed: the rope comes off the ends of a ROD, and rods come in different lengths. It also hangs in the DIRECTION OF THE PULL, not straight down. So this number is NOT a vertical drop and must never be subtracted from a belt landmark -- see beltAttachDerived (Greg, 2026-08-10)." },
    "Harambe|Split Squat Belt": { source: "measured", verified: true,
                                  note: "no dimension is an input to load: the band's attachment is modelled by beltReach/beltStretch. seriesIn 40in (removed 2026-08-02) was the WAIST CIRCUMFERENCE and reported 0 lb on every belt lift." },
    "Harambe|Wedges":           { thicknessIn: 1.375, source: "measured", verified: true,
                                  note: "RAMP, not a slab: 2.5in at the high end, 0.25in at the low end, 8.75in of ramp. 1.375 is the mean; used both directions depending on the lift." },
    /* The measurements are real and stay; the FLAG is what keeps them out of
       the band path. Greg, 2026-08-01: the Foam Block has nothing to do with
       any exercise at all and must never figure in any calculation of any
       kind -- it is somewhere to rest a bar while setting up. Without the flag
       its 6in thickness fell through to the `other` branch below and was read
       as an ELEVATION, adding +12in of band path to any exercise it was logged
       against. ASSERTED in test_gear_geometry.cjs. */
    "Harambe|Foam Block":       { thicknessIn: 6, lengthIn: 9, widthIn: 3.5,
                                  neverInPath: true,
                                  source: "measured", verified: true,
                                  note: "a place to rest a bar during setup — not in the load path" },
    // ---- X3 Bar ----------------------------------------------------------
    "X3 Bar|Steel Ground Plate":{ thicknessIn: 1, lengthIn: 19.25, widthIn: 9.875,
                                  channelIn: 0.875, bandSpanIn: 19.75,
                                  /* THE ONLY LENGTH-LOCKED PLATE. Greg, 2026-08-14:
                                     "the X3 footplate can only travel lengthwise but
                                     that's the only footplate with that limitation."
                                     Declaring one path is the whole enforcement -- the
                                     picker offers what the plate declares, so no flag and
                                     no branch is needed and a widthwise X3 rig is not
                                     offerable. */
                                  bandPaths: [
                                    { k: "len", l: "UNDER - LENGTHWISE", consumedIn: 20.5, source: "measured" }
                                  ],
                                  source: "measured", verified: true },
    "X3 Bar|Elite Bar":         { lengthIn: 21.5, hookOffsetIn: 1.875, hookSide: "opposite",
                                  attachSpanIn: 20.375, source: "measured", verified: true },
    "X3 Bar|Force Bar":         { lengthIn: 22.375, hookOffsetIn: 1.75, hookSide: "opposite",
                                  attachSpanIn: 20.375, source: "measured", verified: true },
    "X3 Bar|Squat Belt (Medium)": { source: "measured", verified: true,
                                  note: "as the Harambe belt: no dimension is an input to load. A strap-and-hook hangs below this belt and a bar sits on the hooks, so the band never touches the belt at all." },
    // ---- Clench ----------------------------------------------------------
    "Clench|Carbon Pro Bar":    { lengthIn: 26, hookOffsetIn: 3.25, hookSide: "opposite",
                                  attachSpanIn: 25, source: "measured", verified: true },
    "Clench|Carbon EZ Bar":     { lengthIn: 34.25, hookOffsetIn: 3, hookSide: "opposite",
                                  attachSpanIn: 33.25, source: "measured", verified: true },
    "Clench|Footplate":         { thicknessIn: 1.5, lengthIn: 23.875, widthIn: 14.875,
                                  channelIn: 0.5, bandSpanIn: 24.25,
                                  /* Four bottom channels (4in x 1/2in) and FOUR OUTER
                                     SLOTS, one per side, so the band need not wrap the
                                     plate at all. `len_near` is the path Greg's 2026-08-11
                                     and 2026-08-14 RDLs actually used: down the outer face,
                                     about an inch under, back up through the near slot.
                                     Without it a 20in band folded (a 19.75in loop) cannot
                                     wrap this plate's 24.25in span by ANY orientation, and
                                     beltReach correctly returned null -- which is what made
                                     that exercise unloggable.
                                     The near-slot figure is the same 2.75in on the long and
                                     the short sides (Greg, measured 2026-08-14). */
                                  bandPaths: [
                                    { k: "len",       l: "UNDER - LENGTHWISE",                consumedIn: 25.625, source: "measured" },
                                    { k: "len_far",   l: "LENGTHWISE, TO THE FAR SLOT",       consumedIn: 23.5,   source: "measured" },
                                    { k: "len_slots", l: "LENGTHWISE, SLOT TO SLOT",          consumedIn: 21.375, source: "measured" },
                                    { k: "len_near",  l: "LENGTHWISE, EDGE TO THE NEAR SLOT", consumedIn: 2.75,   source: "measured" },
                                    { k: "wid",       l: "UNDER - WIDTHWISE",                 consumedIn: 16.75,  source: "measured" },
                                    { k: "wid_far",   l: "WIDTHWISE, TO THE FAR SLOT",        consumedIn: 14.75,  source: "measured" },
                                    { k: "wid_slots", l: "WIDTHWISE, SLOT TO SLOT",           consumedIn: 12.75,  source: "measured" },
                                    { k: "wid_near",  l: "WIDTHWISE, EDGE TO THE NEAR SLOT",  consumedIn: 2.75,   source: "measured" }
                                  ],
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
                                  /* ONE slot. `len_near` is Greg's tape (2026-08-14) and it
                                     STANDS: the vendor sheet's 6in slot LENGTH is band-WIDTH
                                     capacity -- how wide a band fits through -- not a
                                     position and not a path length. The same applies to the
                                     slot lengths published for all three Serious Steel
                                     plates; none is a path length and none should be read
                                     as one.
                                     The whole-plate paths are still COMPUTED/DERIVED. This
                                     plate has no bandSpanIn at all (the interpolated 20.5
                                     was removed 2026-07-31 for being stamped as tape), so
                                     its widthwise figure is the weakest in the table: bare
                                     widthIn with no edge delta to add. */
                                  /* ALL FOUR MEASURED 2026-08-14 (Greg's tape). This plate
                                     was the last one carrying computed/derived figures, and
                                     it was the weakest in the table: its bandSpanIn was
                                     removed on 2026-07-31 for having been an interpolation
                                     stamped as tape, so its widthwise fallback was bare
                                     widthIn with no edge delta to add.

                                     The slot sits OFF-CENTRE, which is why the two widthwise
                                     partial wraps are so different: 12.5in from the wide side
                                     and 2.875in from the short side. 12.5 + 2.875 exceeds the
                                     full 14.75 widthwise wrap because each partial path also
                                     goes around the slot lip.

                                     CORRECTED at the same time: 2.875 was labelled
                                     `len_near` "EDGE TO THE NEAR SLOT" from the 2026-08-14
                                     spec, i.e. LENGTHWISE. Greg's measurements that day place
                                     it WIDTHWISE from the short side to the hole. The figure
                                     never changed; the key and the label did. */
                                  bandPaths: [
                                    { k: "len",      l: "UNDER - LENGTHWISE",              consumedIn: 23,    source: "measured" },
                                    { k: "wid",      l: "UNDER - WIDTHWISE",               consumedIn: 14.75, source: "measured" },
                                    { k: "wid_far",  l: "WIDTHWISE, WIDE SIDE TO THE HOLE", consumedIn: 12.5,  source: "measured" },
                                    { k: "wid_near", l: "WIDTHWISE, SHORT SIDE TO THE HOLE", consumedIn: 2.875, source: "measured" }
                                  ],
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
                                  /* The centre hole exists to shorten the band with the
                                     Tension Master and elevators, and Greg's ruling
                                     2026-08-14 is that it is used LENGTHWISE ONLY -- hence
                                     no `wid_hole`. The hole measures 2 3/8in across at the
                                     centre; that is a band-width capacity note, not an
                                     input, and nothing reads it. */
                                  bandPaths: [
                                    { k: "len",      l: "UNDER - LENGTHWISE",                 consumedIn: 27,      source: "measured" },
                                    { k: "len_hole", l: "LENGTHWISE, THROUGH THE CENTRE HOLE", consumedIn: 13.5,   source: "measured" },
                                    { k: "wid",      l: "UNDER - WIDTHWISE",                  consumedIn: 15.3125, source: "measured" }
                                  ],
                                  source: "measured", verified: true },
    "HeavyDutyBar|Travel Platform": { thicknessIn: 1.625, lengthIn: 19.75, widthIn: 11.1875,
                                  channelIn: 0.875, bandSpanIn: 20,
                                  bandPaths: [
                                    { k: "len", l: "UNDER - LENGTHWISE", consumedIn: 21.75,  source: "measured" },
                                    { k: "wid", l: "UNDER - WIDTHWISE",  consumedIn: 13.375, source: "measured" }
                                  ],
                                  source: "measured", verified: true },
    /* ADJUSTABLE. A pair, 76cm overall, a hook at one end and SEVEN numbered
       positions stamped on the strap. Which position you hook is a CHOICE, so
       there is deliberately no plain `seriesIn`: one representative value
       would be confidently wrong for six of the seven positions, and wrong in
       the direction that understates stretch and so understates load.

       ALL THREE ARRAYS ARE INDEXED BY STAMPED POSITION, and `gearOpeningOptions`
       numbers them `i + 1` -- so the array ORDER *is* the numbering printed on
       the strap, and reversing it relabels every button in both pickers.
       **#1 is the opening FURTHEST from the hook: the LONGEST inline length,
       67cm.** Greg confirmed the direction 2026-08-10 with the strap in his
       hands. The 2026-08-03 handoff took his seven readings correctly and then
       numbered them from the wrong end; the arrays were reversed on 2026-08-10
       and the readings themselves are unchanged.

       `openingsFromTopCm` is Greg's raw tape reading at each stamp and
       `seriesOptionsCm[i]` is exactly `76 - openingsFromTopCm[i]`. The gaps
       are 11/9/9/9/9/10, NOT the even 9 they nearly are -- the measurements
       were KEPT rather than normalised, and test_adjustable_gear.cjs pins
       that so nobody tidies them later.

       HeavyDutyBar is a Netherlands metric vendor, so cm is the measured
       truth and inches are the conversion, same posture as the bands' resKg.

       NOT additive with a rope or a handle in series. Nothing has measured a
       strap+rope assembly, and the Harambe rods precedent (6in rod + 5in rope
       measures 2.75in, not 11in) says an assumed sum would overstate the
       shortening badly. Greg's ruling 2026-08-07: record what was measured,
       refuse to invent the rest. */
    "HeavyDutyBar|X Straps":    { overallCm: 76,
                                  openingsFromTopCm: [9, 19, 28, 37, 46, 55, 66],
                                  seriesOptionsCm: [67, 57, 48, 39, 30, 21, 10],
                                  seriesOptionsIn: [26.38, 22.44, 18.90, 15.35, 11.81, 8.27, 3.94],
                                  source: "measured", verified: true,
                                  note: "a pair; 7 stamped positions, #1 FURTHEST from the hook and the LONGEST (67cm inline), #7 nearest the hook and the shortest (10cm). Inline length = 76cm - opening. Usable with the belt, a bar, handles or a footplate, and in combination. NOT additive with a rope or handle -- no combination has been measured." },
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
    { k:"seriesIn",     l:"Series length",hint:"band bearing point to your grip", types:["handle","anchor","other"] },
  ];
  /* Bumped 2026-08-10. A stored `dims` copy carrying an older rev is discarded
     in favour of a fresh table lookup, so this string is the ONLY way a table
     correction reaches an inventory that already exists in a browser. Both of
     2026-08-07's corrections were made WITHOUT bumping it and therefore reached
     nobody: `Harambe|Foam Block`'s `neverInPath` (so the block was still adding
     +12in of band path to every exercise it was logged against) and the X
     Straps' seven positions. Adding or correcting a GEAR_DIMS entry means
     bumping this. */
  /* Bumped 2026-08-14 for the band-path table. A stored `dims` copy carrying
     an older rev is discarded in favour of a fresh table lookup, which is how
     the new bandPaths arrays actually reach an existing inventory. The
     2026-08-07 lesson: a table correction without a rev bump reaches nobody,
     and every footplate in Greg's inventory carries a stored dims copy that
     would otherwise win. */
  var GEAR_DIMS_REV = "2026-08-14-band-paths-r1";

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

  /* Does this item resolve to any real dimension figure?

     THROUGH resolveGearDims, not `it.dims` (fixed 2026-08-07). Both apps
     carried their own copy reading the raw field, so a hand-added item whose
     brand|name matches a table key showed NO DIMS in the GEAR tab while the
     engine cheerfully resolved real dimensions off that same key and priced
     loads with them. Exactly the divergence class that got gearPathDeltaIn
     deleted: a second reader of the same fact, disagreeing in silence.

     An adjustable item counts, even with no scalar field of its own -- seven
     stamped positions ARE its dimensions. */
  function gearHasDims(it) {
    if (!it) return false;
    var d = resolveGearDims(it);
    if (!d) return false;
    if (Array.isArray(d.seriesOptionsIn) && d.seriesOptionsIn.length) return true;
    return GEAR_DIM_FIELDS.some(function (f) { return typeof d[f.k] === "number"; });
  }

  function gearDimSource(it) {
    if (!it || !gearHasDims(it)) return "none";
    var d = resolveGearDims(it);
    if (d.verified) return "measured";
    return d.source || "estimated";
  }

  /* THE resolution order, shared by both apps.
       1. userEditedKeys  -> the fields the user actually typed win, and ONLY
                             those; every other field re-resolves from the
                             table below on every read
       2. userEdited      -> LEGACY, no key list: the whole stored object wins
       3. current seedRev -> the stored copy is up to date, use it
       4. table lookup    -> by brand|name. THIS is what makes the PWA work:
                             it deliberately never seeds gear (multi-user - no
                             one inherits anyone else's inventory), so its items
                             arrive from Firestore with no dims at all.
       5. nothing         -> an unverified estimate; contributes 0 to the path
                             and leaves the load at RATED. Never throws, never
                             invents a number.

     Step 1 is the 2026-08-07 fix for final-review finding 4. `userEdited: true`
     was stamped on the whole RESOLVED object -- a snapshot of that day's table
     the user never typed -- and this function then returned that snapshot
     forever regardless of seedRev. Editing any one field therefore opted the
     item out of every future table correction silently: anyone who had touched
     a belt field before the belt fix would never have received it.

     Step 2 has to stay, and it is not dead weight. Inventories stored before
     this change carry a bare `userEdited: true` with no key list, and those
     numbers are real measurements. Re-resolving them per-field would mean
     deciding on the user's behalf which of their own values to discard, which
     is the data loss this finding is about, through the other door. There is
     no migration; legacy items simply keep the old rule until they are next
     edited, at which point they gain a key list naturally. */
  function resolveGearDims(it) {
    if (!it) return { source: "estimated", verified: false };
    var d = it.dims;
    if (d && Array.isArray(d.userEditedKeys)) {
      var base = assign(seedDimsFor(it.brand, it.name), {});
      d.userEditedKeys.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(d, k)) base[k] = d[k];
        else delete base[k];
      });
      /* A pinned field is something the user measured, so the object says so.
         With every pin cleared there is nothing left that anyone measured, and
         the table's own provenance is the honest answer. */
      if (d.userEditedKeys.length) {
        base.source = "measured"; base.verified = true;
      }
      base.userEdited = true;
      base.userEditedKeys = d.userEditedKeys.slice();
      return base;
    }
    if (d && d.userEdited) return d;
    /* A stored copy at the current rev wins -- but ONLY if it actually carries
       a figure. `seedDimsFor` stamps an item the table has never heard of with
       a bare {source:"estimated", verified:false, seedRev}, and that stub says
       nothing about the item; letting it outrank a table entry that has real
       dimensions is how the X Straps' seven stamped positions stayed invisible
       to the one person who owns them. He added the item on 2026-08-03, before
       the table knew the straps existed; the table learned on 2026-08-07; his
       empty stub kept winning, so gearHasAdjustable stayed false and the
       OPENING row never rendered in either app.

       Falling through costs nothing when the table is also silent -- the
       lookup returns an equivalent stub -- and this is deliberately NOT a
       substitute for a GEAR_DIMS_REV bump: a stored copy that carries real
       figures still wins here, and only the rev refreshes those. */
    if (d && d.seedRev === GEAR_DIMS_REV && dimsCarryFigures(d)) return d;
    return seedDimsFor(it.brand, it.name);
  }

  /* Does this dims object state any actual DIMENSION? Numbers and non-empty
     arrays are figures; `source`, `note`, `seedRev`, `hookSide`, `verified`
     and the boolean flags are bookkeeping about figures that may not be there.
     Deliberately broader than GEAR_DIM_FIELDS, which lists only the fields the
     GEAR tab offers an input for -- bandSpanIn, gripDiaIn and overallCm are
     real measurements that no editor exposes. */
  function dimsCarryFigures(d) {
    if (!d) return false;
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) continue;
      if (k === "seedRev") continue;
      if (typeof d[k] === "number") return true;
      if (Array.isArray(d[k]) && d[k].length) return true;
    }
    return false;
  }

  /* A value the user types IS the measurement -- shared by both apps'
     GearDims.setField so the provenance rule (source/verified/userEdited all
     set together) is enforced in exactly one place and can be unit-tested
     without a DOM. Never mutates `dims`; always returns a new object.

       dims -- the current RESOLVED dims object (whatever the caller already
               computed, e.g. via resolveGearDims).
       key  -- the field being edited, e.g. "thicknessIn".
       raw  -- the raw string from the input element.

     raw === "" means the field was cleared: the key is DELETED (never stored
     as undefined/NaN), and clearing still counts as an edit -- the user
     telling the app "this number is wrong" is itself information, so the
     provenance flags are still stamped. Clearing also UNPINS the field, which
     is what makes CLAUDE.md's documented escape hatch ("clear the field in the
     GEAR tab to fall back to the table") actually work; it never did while
     pinning was wholesale. To say "my unit genuinely has no channel", type 0 --
     zero is a legitimate dimension (Harambe|Rods carries seriesIn: 0).

     A non-empty raw that is not a finite number is REJECTED: the edit is
     not applied, and the input's contents come back unchanged (still a new
     object, still no mutation, but no provenance flags are stamped either --
     nothing was actually edited). A NEGATIVE number is rejected the same way
     (finding 5): both band editors already refuse <= 0, and a negative length
     stamped source:"measured", verified:true is a physical impossibility
     presented as a measurement. Zero stays accepted.

     `userEditedKeys` is the set of fields the user has actually touched. It is
     what resolveGearDims pins -- see the resolution order above for why the
     whole object must not be. */
  function applyGearDimEdit(dims, key, raw) {
    var d = dims || {};
    var pinned = Array.isArray(d.userEditedKeys) ? d.userEditedKeys.slice() : [];
    function withPin(o, on) {
      var i = pinned.indexOf(key);
      if (on && i < 0) pinned.push(key);
      if (!on && i >= 0) pinned.splice(i, 1);
      o.userEditedKeys = pinned;
      return o;
    }
    if (raw === "") {
      var cleared = assign(d, {});
      delete cleared[key];
      return withPin(
        assign(cleared, { source: "measured", verified: true, userEdited: true }), false);
    }
    var v = Number(raw);
    if (!isFinite(v) || v < 0) return assign(d, {});
    var edited = assign(d, {});
    edited[key] = v;
    return withPin(
      assign(edited, { source: "measured", verified: true, userEdited: true }), true);
  }

  /* ====================================================================
     FOLD-ENCODING MIGRATION  (2026-08-04)
     ====================================================================
     Until the band picker was reworked, DOUBLE x2 expressed "the whole
     stack was folded" by DUPLICATING EVERY BAND ID. `bands` and `doubled`
     are INDEPENDENT AXES (see CLAUDE.md), so that encoding lies about the
     band count and hands the belt path d = 1 for a folded band -- modelling
     one folded loop as two full-length loops side by side.

     DETERMINACY. A list where every distinct id appears EXACTLY twice is
     what DOUBLE x2 produced, so it means "folded". Anything else is left
     ALONE. That matters: three real 2026-06 lists have one id once and
     another twice, which NEITHER control in the app can produce, and
     collapsing them would silently halve a genuine two-band stack. The
     handoff claimed DOUBLE x2 was the only source of duplicate ids in
     app-written data; measuring the log showed it is not.

     The fold is WHOLE-SET, so a segmented set migrates all-or-nothing.

     `entry.load` is NEVER rewritten -- the freeze rule. The single
     permitted write is `.era = "pre-fold"` on an exercise that actually
     changed, so a reader comparing a stamp to its own band list finds an
     explanation instead of a silent contradiction.

     PURE: no DOM, no localStorage, no clock. `cutoffISO` is a PARAMETER,
     and the input log is deep-cloned rather than mutated.

     THE GUARD TRAVELS WITH THE DATA (2026-08-04, final review finding A).
     The callers' localStorage flags record a fact about a DEVICE; what has to
     be recorded is a fact about the LOG. The hole they leave: the reworked
     picker can now enter TWO REAL COPIES of one band, so a user who edits a
     pre-cutoff entry and logs `["b30","b30"]` for real has written an
     exactly-2x list into migration scope. A second device whose own flag is
     unset then reads that entry from Firestore and collapses a genuine
     two-band stack to one folded band, silently, everywhere.

     So every pre-cutoff entry this function examines gains
     `foldMigrated: true` -- INCLUDING ones it did not change, because an
     untouched June entry that later gains a real two-band stack needs the
     same protection -- and any entry already carrying the marker is skipped
     outright. The marker rides through Firestore, through export/import and
     through a device reset. The date cutoff is now belt-and-braces rather
     than load-bearing.

     `touched` is returned alongside `changed` and `skipped` and lists every
     entry modified IN ANY WAY, marker-only included. Callers must persist
     `touched`, not `changed` -- a marker that is computed and not written
     protects nothing. */

  function foldShapeOf(bands) {
    if (!bands || !bands.length) return "empty";
    /* Object.create(null) -- a band id of "constructor", "__proto__" etc
       must never be answered by Object.prototype instead of by this data.
       A user-imported backup's band ids are not validated, so this is a
       real input, not a hypothetical one. */
    var counts = Object.create(null), ids = [], i;
    for (i = 0; i < bands.length; i++) {
      if (counts[bands[i]] == null) { counts[bands[i]] = 0; ids.push(bands[i]); }
      counts[bands[i]]++;
    }
    var anyDup = false, allTwo = true;
    for (i = 0; i < ids.length; i++) {
      if (counts[ids[i]] > 1) anyDup = true;
      if (counts[ids[i]] !== 2) allTwo = false;
    }
    if (!anyDup) return "clean";
    return allTwo ? "allx2" : "mixed";
  }

  function distinctBandIds(bands) {
    /* Same prototype-collision hazard as foldShapeOf above. */
    var seen = Object.create(null), out = [], i;
    for (i = 0; i < bands.length; i++) {
      if (!seen[bands[i]]) { seen[bands[i]] = 1; out.push(bands[i]); }
    }
    return out;
  }

  function migrateFoldEncoding(log, cutoffISO) {
    var changed = [], skipped = [], touched = [];
    if (!log || !log.length) {
      return { log: log || [], changed: changed, skipped: skipped, touched: touched };
    }

    var out;
    try { out = JSON.parse(JSON.stringify(log)); }
    catch (e) { return { log: log, changed: changed, skipped: skipped, touched: touched }; }

    for (var e2 = 0; e2 < out.length; e2++) {
      var entry = out[e2];
      if (!entry) continue;
      /* Out of scope entirely: no marker, no examination. A post-cutoff entry
         is written by the current picker, where an exactly-2x list means two
         real bands and always will. */
      if (!entry.date || entry.date > cutoffISO) continue;
      /* Already guarded by a previous run, on this device or any other. */
      if (entry.foldMigrated === true) continue;

      var exIds = entry.exercises ? Object.keys(entry.exercises) : [];
      for (var x = 0; x < exIds.length; x++) {
        var exId = exIds[x];
        var sets = entry.exercises[exId] || [];
        var exChanged = false;

        for (var s = 0; s < sets.length; s++) {
          var set = sets[s];
          if (!set) continue;
          var segs = Array.isArray(set.segments) ? set.segments : null;
          var lists = segs
            ? segs.map(function (g) { return (g && g.bands) || []; })
            : [set.bands || []];

          var shapes = [], anyDup = false, allOk = true, k;
          for (k = 0; k < lists.length; k++) {
            var sh = foldShapeOf(lists[k]);
            shapes.push(sh);
            if (sh === "allx2" || sh === "mixed") anyDup = true;
            /* "empty" never blocks -- an unused drop segment is not a
               disagreement about the fold. */
            if (sh !== "allx2" && sh !== "empty") allOk = false;
          }
          if (!anyDup) continue;

          if (!allOk) {
            skipped.push({
              date: entry.date, exId: exId, set: s, shapes: shapes.join(","),
              reason: shapes.indexOf("mixed") >= 0
                ? "mixed counts -- not produced by DOUBLE x2, may be a real multi-band stack"
                : "some band lists in this set are not doubled -- the fold is whole-set"
            });
            continue;
          }

          if (segs) {
            for (k = 0; k < segs.length; k++) {
              if (segs[k] && (segs[k].bands || []).length) {
                segs[k].bands = distinctBandIds(segs[k].bands);
              }
            }
          } else {
            set.bands = distinctBandIds(set.bands);
          }
          set.doubled = true;
          exChanged = true;
          changed.push({ date: entry.date, exId: exId, set: s });
        }

        /* Only where a stamp already exists. Never invent a load object.
           A malformed stamp (e.g. a bare number from a corrupted or
           hand-edited backup) is not this function's to repair or discard --
           leave it exactly as it is and move on. Under "use strict",
           writing a property onto a primitive throws, and this migration is
           a single pass over the whole log, so one bad entry must not abort
           every entry after it. */
        if (exChanged && entry.load && entry.load[exId] &&
            typeof entry.load[exId] === "object") {
          entry.load[exId].era = "pre-fold";
        }
      }

      /* Marked whether or not anything changed -- see the header. An entry
         with no `exercises` at all is marked too: it is in scope, and it is
         exactly the entry a later edit could add a real two-band stack to. */
      entry.foldMigrated = true;
      touched.push({ date: entry.date, session: entry.session });
    }
    return { log: out, changed: changed, skipped: skipped, touched: touched };
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
    sanitizeMeasuredPoints: sanitizeMeasuredPoints,
    bandCalibrationLabel: bandCalibrationLabel,
    applyBandRestLengthEdit: applyBandRestLengthEdit,
    applyBandMeasuredPointEdit: applyBandMeasuredPointEdit,
    bandGeomRestEdit: bandGeomRestEdit,
    bandGeomPointEdit: bandGeomPointEdit,
    mergeBandGeom: mergeBandGeom,
    gearPathDelta: gearPathDelta,
    gearOpeningOptions: gearOpeningOptions,
    gearIsAdjustable: gearIsAdjustable,
    gearOpeningSeriesIn: gearOpeningSeriesIn,
    gearAdjustableUnset: gearAdjustableUnset,
    gearHasAdjustable: gearHasAdjustable,
    BODY_LANDMARKS: BODY_LANDMARKS,
    BELT_LANDMARK_KEYS: BELT_LANDMARK_KEYS,
    attachLandmarkKeys: attachLandmarkKeys,
    beltPlateOf: beltPlateOf,
    beltBeltPresent: beltBeltPresent,
    plateTopSpan: plateTopSpan,
    beltReach: beltReach,
    beltStretch: beltStretch,
    beltAttachOptions: beltAttachOptions,
    beltAttachAt: beltAttachAt,
    beltAttachDefault: beltAttachDefault,
    beltAttachDerived: beltAttachDerived,
    attachSeedDecision: attachSeedDecision,
    attachClearMarker: attachClearMarker,
    BELT_ATTACH_DEFAULT: BELT_ATTACH_DEFAULT,
    PLATE_GRIP_DEFAULT: PLATE_GRIP_DEFAULT,
    substituteCandidates: substituteCandidates,
    plateBandPaths: plateBandPaths,
    plateBandPathOf: plateBandPathOf,
    plateBandPathOptions: plateBandPathOptions,
    plateGripDefault: plateGripDefault,
    plateGripDefaultFor: plateGripDefaultFor,
    beltSlackens: beltSlackens,
    BELT_EXTENDERS: BELT_EXTENDERS,
    PLATE_GEOM_CUTOFF: PLATE_GEOM_CUTOFF,
    stampPredatesPlateGeom: stampPredatesPlateGeom,
    stampPredatesBandPath: stampPredatesBandPath,
    /* Exported 2026-08-14 so the caveat WORDING can be pinned. It is the one
       source of these notes for buildSetupDoc, buildHistoryDoc and analyze,
       and it is what tells a reader that a frozen stamp no longer matches the
       live card -- user-visible text that should not be able to drift. */
    loadCaveatNotes: loadCaveatNotes,
    BAND_PATH_CUTOFF: BAND_PATH_CUTOFF,
    GEAR_DIMS: GEAR_DIMS,
    GEAR_DIMS_REV: GEAR_DIMS_REV,
    GEAR_DIM_FIELDS: GEAR_DIM_FIELDS,
    gearDimFieldsFor: gearDimFieldsFor,
    seedDimsFor: seedDimsFor,
    gearDimSource: gearDimSource,
    gearHasDims: gearHasDims,
    resolveGearDims: resolveGearDims,
    applyGearDimEdit: applyGearDimEdit,
    gearDimsVerified: gearDimsVerified,
    finitePos: finitePos,
    foldShapeOf: foldShapeOf,
    distinctBandIds: distinctBandIds,
    migrateFoldEncoding: migrateFoldEncoding,
    effectiveLoad: effectiveLoad,
    bestSetLoad: bestSetLoad,
    stampLoad: stampLoad,
    applyLoadStamp: applyLoadStamp,
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
