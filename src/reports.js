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
    UNDER_FACTOR: 0.75, // actual share below this x prescribed share = UNDER
    OVER_FACTOR:  1.5,  // actual share above this x prescribed share = OVER
    REC_CAP:      10,   // max recommendations surfaced
  };

  /* Weekly working-set landmarks per muscle group. Tunable in one place.
     MOBILITY and FULL BODY deliberately have no landmark - see isExempt(). */
  var SET_LANDMARKS = {
    CHEST: 10, BACK: 10, SHOULDERS: 10, QUADS: 10, HAMSTRINGS: 10, GLUTES: 10,
    BICEPS: 6, TRICEPS: 6, CORE: 6,
    NECK: 4, FOREARMS: 4, CALVES: 4,
  };

  /* Groups excluded from balance + neglect flags. MOBILITY is stretch/carry
     work with no meaningful load; FULL BODY volume credits no single group. */
  var BALANCE_EXEMPT = { MOBILITY: true, "FULL BODY": true };
  function isExempt(label) { return !!BALANCE_EXEMPT[label]; }

  /* ---- time-based exercises (logged in seconds, not reps) --------------- */
  var TIME_BASED = [71, 72, 166, 181, 182, 184];
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
  function sortedLog(log) {
    return (log || []).slice().sort(function (a, b) {
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
    var h = exHistory(ctx.log, exId, beforeDate, 1, deloadOf);
    var working = h.length ? h[0].sets.filter(isPlainSet) : [];
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
    var ready = sides ? (sides.L || sides.R) : sideReady(bySide.B);
    return {
      ready: ready,
      sides: sides,
      stalled: !ready && isStalled(ctx.log, exId, beforeDate, deloadOf),
      threshold: thresh,
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
    var asOf = (opts && opts.asOf) || isoOf(new Date());
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
       a genuine personal record rather than a local maximum. */
    var allBest = {};
    sortedLog(ctx.log).forEach(function (e) {
      Object.keys(e.exercises || {}).forEach(function (exId) {
        (e.exercises[exId] || []).forEach(function (s) {
          var l = setTopLoad(s, ctx.bandOf);
          if (!allBest[exId] || l > allBest[exId]) allBest[exId] = l;
        });
      });
    });

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
        isPR: last.top > 0 && last.top >= (allBest[exId] || 0),
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
  /* UNDER below 0.75x the prescribed share, OVER above 1.5x. A group with no
     prescribed slots is judged against its weekly-set landmark alone; with
     neither reference there is nothing to judge, hence NONE. */
  function balanceOf(actualShare, prescribedShare, weeklySets, landmark) {
    if (!prescribedShare) {
      if (landmark == null) return "NONE";
      return weeklySets < landmark ? "UNDER" : "OK";
    }
    if (actualShare < prescribedShare * CONST.UNDER_FACTOR) return "UNDER";
    if (actualShare > prescribedShare * CONST.OVER_FACTOR) return "OVER";
    if (landmark != null && weeklySets < landmark) return "UNDER";
    return "OK";
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
        acc[label] = { label: label, sets: 0, reps: 0, volume: 0, exIds: {},
                       dates: {}, lastDate: null, perSession: {} };
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
        (e.exercises[exId] || []).forEach(function (s) {
          b.sets++;
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
    var weeks = (win.spanDays && win.spanDays > 0) ? (win.spanDays / 7) : 1;

    return Object.keys(acc).map(function (label) {
      var b = acc[label];
      var exempt = isExempt(label);
      var share = totalVol ? (b.volume / totalVol) * 100 : 0;
      var prescribedShare = pres.shares[label] || 0;
      var landmark = SET_LANDMARKS[label];
      var weeklySets = b.sets / weeks;
      var daysSince = b.lastDate ? daysBetween(b.lastDate, win.asOf) : null;
      var dates = Object.keys(b.perSession).sort();
      var sp = slopePct(dates.map(function (d) { return b.perSession[d]; }));
      var balance = exempt ? "EXEMPT" : balanceOf(share, prescribedShare, weeklySets, landmark);
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
        if (balance === "UNDER") {
          flags.push("Under-trained - " + Math.round(share) +
            "% of volume against a prescribed " + Math.round(prescribedShare) + "%" +
            (landmark != null
              ? ", " + weeklySets.toFixed(1) + " sets/week against a " + landmark + " landmark"
              : ""));
        } else if (balance === "OVER") {
          flags.push("Over-represented - " + Math.round(share) +
            "% of volume against a prescribed " + Math.round(prescribedShare) +
            "% (informational)");
        }
      }
      return {
        label: label, sets: b.sets, reps: b.reps, volume: b.volume,
        share: share, prescribedShare: prescribedShare,
        exercises: Object.keys(b.exIds).length,
        sessions: Object.keys(b.dates).length,
        daysSince: daysSince, slopePct: sp, trend: classifyTrend(sp),
        weeklySets: weeklySets, landmark: landmark == null ? null : landmark,
        balance: balance, neglect: neglect, flags: flags
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
      if (g.balance === "UNDER") {
        /* Report the reason that actually fired. A group can clear its share
           test and still be UNDER on the weekly-set landmark; citing the share
           there reads as a contradiction ("17% vs 14% prescribed" under an
           under-trained heading). Both the standalone text and the collapsed
           detail use the same reason. */
        var byShare = g.share < g.prescribedShare * CONST.UNDER_FACTOR;
        var reason = byShare
          ? Math.round(g.share) + "% of volume against a prescribed " +
            Math.round(g.prescribedShare) + "%"
          : g.weeklySets.toFixed(1) + " sets/wk against a landmark of " + g.landmark;
        recs.push({ severity: 4, code: "UNDER", scope: "group", subject: g.label,
          detail: g.label + " (" + (byShare
            ? Math.round(g.share) + "% vs " + Math.round(g.prescribedShare) + "% prescribed"
            : g.weeklySets.toFixed(1) + " sets/wk vs " + g.landmark) + ")",
          text: g.label + " is under-trained: " + reason +
            ". Add a set or an exercise, or stop skipping its slot." });
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
    resolveWindow: resolveWindow,
    slopePct: slopePct,
    classifyTrend: classifyTrend,
    analyzeExercises: analyzeExercises,
    exerciseVerdict: exerciseVerdict,
    prescribedShares: prescribedShares,
    balanceOf: balanceOf,
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
