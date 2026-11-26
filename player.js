/*
 * puppy tv ♡ synced player for Second Life media-on-a-prim
 *
 * How sync works:
 *   The TV's LSL script is the one boss. It keeps: what is playing (src),
 *   whether it is playing, and "position pos (ms) at server time (as, am)".
 *   Every viewer's screen polls  <base>/state  every ~2 s, learns the
 *   server clock, works out where the video SHOULD be right now, and
 *   nudges / seeks its own player there. Late joiners just land on the
 *   right moment because the math is the same for everyone.
 *
 * Plain JavaScript, no build step. Works when loaded by:
 *   - the XHTML loader page the LSL script serves (lsl mode), or
 *   - web/index.html on GitHub Pages (pages mode, via the worker proxy).
 */
(function () {
  "use strict";

  var CFG = window.PUPPYTV_CONFIG || {};
  var POLL_PLAYING_MS = CFG.pollPlayingMs || 2000;
  var POLL_IDLE_MS = CFG.pollIdleMs || 4000;
  var TICK_MS = 250;
  var DEBUG = /[?&]debug=1/.test(location.search) || !!CFG.debug;

  // ---------- where is the state? ----------
  function stateUrl() {
    if (CFG.stateBase) {
      if (CFG.proxy) {
        return CFG.proxy.replace(/\/+$/, "") + "/state?u=" + encodeURIComponent(CFG.stateBase);
      }
      return CFG.stateBase.replace(/\/+$/, "") + "/state";
    }
    var here = location.href.split(/[?#]/)[0];
    return here.replace(/\/tv\/?$/, "").replace(/\/+$/, "") + "/state";
  }
  function reportUrl() {
    if (CFG.stateBase) {
      if (CFG.proxy) {
        return CFG.proxy.replace(/\/+$/, "") + "/report?u=" + encodeURIComponent(CFG.stateBase);
      }
      return CFG.stateBase.replace(/\/+$/, "") + "/report";
    }
    return stateUrl().replace(/\/state$/, "/report");
  }

  // ---------- tiny DOM helpers (createElement works in XHTML too) ----------
  function el(tag, attrs, parent) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "style") e.style.cssText = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  var root = document.getElementById("sltv") || el("div", { id: "sltv" }, document.body);
  root.textContent = "";
  var F_HAND = "'Segoe Print','Bradley Hand','Comic Sans MS','Chalkboard SE','Comic Neue','Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',cursive";
  var F_COMIC = "'Comic Sans MS','Chalkboard SE','Comic Neue','Trebuchet MS','Malgun Gothic',sans-serif";
  var F_98 = "'MS Sans Serif','Microsoft Sans Serif',Tahoma,Geneva,'DejaVu Sans',sans-serif";
  var F_MONO = "'Courier New',Courier,'Liberation Mono',monospace";
  var F_MIN = "'Segoe UI Light','Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";
  var BEVEL = "inset -1px -1px #0a0a0a,inset 1px 1px #fff,inset -2px -2px #808080,inset 2px 2px #dfdfdf";
  var THEME_CSS = [
    "#sltv{--tbg:#ffd6e7;--tfg:#5a2340;--tln:#5a2340;--msg:rgba(90,35,64,.9);--mfg:#fff;--font:" + F_COMIC + ";font-family:var(--font)}",
    "#ptv-tap span{background:var(--tbg);color:var(--tfg);border:3px solid var(--tln);box-shadow:5px 5px 0 var(--tln);font-size:40px;padding:18px 34px;font-family:var(--font)}",
    "#ptv-badge{position:absolute;left:18px;top:14px;display:none;background:var(--tbg);color:var(--tfg);border:2px solid var(--tln);font-size:26px;padding:4px 14px;font-family:var(--font)}",
    "#ptv-msg{position:absolute;left:0;right:0;bottom:0;display:none;background:var(--msg);color:var(--mfg);font-size:24px;padding:10px 16px;font-family:var(--font)}",
    "#ptv-idle{position:absolute;inset:0;overflow:hidden;background:#000;display:block}",
    "#ptv-box{position:absolute;left:0;top:0;width:1024px;height:576px;transform-origin:0 0;overflow:hidden}",
    "#ptv-canvas,#ptv-fx,#ptv-layer{position:absolute;left:0;top:0;width:1024px;height:576px}",
    "#ptv-fx{overflow:hidden;pointer-events:none}",
    "#ptv-layer{text-align:center}",
    ".ptv-foot{position:absolute;left:0;right:0;bottom:6px;font-size:15px;opacity:.7}",
    // particles: transform-only animation, a couple dozen at most
    ".ptv-p{position:absolute;border-radius:60% 0 60% 0;animation-name:ptvfall;animation-timing-function:linear;animation-iteration-count:infinite;opacity:.9}",
    ".ptv-snow{border-radius:50%;opacity:.85}",
    ".ptv-petals{border-radius:70% 30% 70% 30%}",
    ".ptv-fireflies,.ptv-motes{border-radius:50%;animation-name:ptvfly;animation-timing-function:ease-in-out;animation-direction:alternate;box-shadow:0 0 8px 3px rgba(255,214,120,.55)}",
    ".ptv-motes{box-shadow:0 0 6px 2px rgba(255,236,170,.5);opacity:.7}",
    "@keyframes ptvfall{from{transform:translate(0,0) rotate(0deg)}to{transform:translate(var(--dx),640px) rotate(var(--rot))}}",
    "@keyframes ptvfly{0%{transform:translate(0,0);opacity:.15}50%{opacity:1}100%{transform:translate(var(--dx),var(--dy));opacity:.25}}",
    ".ptv-flame{position:absolute;width:52px;height:52px;border-radius:50%;background:radial-gradient(circle,rgba(255,206,120,.55),rgba(255,206,120,0) 70%);animation:ptvflick 2.4s ease-in-out infinite alternate}",
    "@keyframes ptvflick{from{transform:scale(.85);opacity:.65}to{transform:scale(1.12);opacity:1}}",
    // pink (the original look)
    ".t-pink #ptv-idle{background:#ffd6e7}",
    ".ptv-pwrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5a2340}",
    ".ptv-pwrap .card{background:#fff;border:3px solid #5a2340;padding:28px 44px;box-shadow:6px 6px 0 #5a2340}",
    ".ptv-pwrap .big{font-size:64px;line-height:1.1}",
    ".ptv-pwrap .small{font-size:26px;margin-top:10px}",
    "#ptv-clock{font-size:30px;margin-top:18px}",
    ".ptv-slt{font-size:.3em;margin-left:.35em;opacity:.7;letter-spacing:1px;vertical-align:.25em}",
    "#ptv-clock .ptv-slt,.w98-tray .ptv-slt,.w98-clock .ptv-slt,.ptv-rclock .ptv-slt{font-size:.55em;vertical-align:.1em}",
    // nature
    ".t-nature{--tbg:#f4efe0;--tfg:#33402c;--tln:#4a5a3a;--msg:rgba(40,56,44,.88);--font:" + F_HAND + "}",
    ".t-nature #ptv-tap span,.t-seasons #ptv-tap span{border-radius:22px 14px 26px 12px/14px 24px 12px 22px;box-shadow:4px 5px 0 rgba(0,0,0,.25)}",
    ".t-nature #ptv-badge,.t-seasons #ptv-badge{border-radius:14px 8px 16px 8px}",
    ".ptv-ntop{position:absolute;left:0;right:0;top:140px;color:#fffaf0;text-shadow:0 2px 12px rgba(30,30,40,.45),0 0 2px rgba(30,30,40,.4)}",
    ".ptv-nclock{font-size:132px;line-height:1}",
    ".ptv-ndate{font-size:28px;margin-top:6px}",
    ".t-nature .ptv-foot{color:#fffaf0;text-shadow:0 1px 4px rgba(0,0,0,.5)}",
    // seasons & holidays
    ".t-seasons{--tbg:#fdf6e8;--tfg:#4a3222;--tln:rgba(74,50,34,.85);--msg:rgba(74,50,34,.92);--mfg:#fdf6e8;--font:" + F_HAND + "}",
    ".ptv-scard{position:absolute;left:252px;top:82px;width:480px;padding:16px 20px 14px;background:rgba(253,246,232,.94);border:3px solid rgba(74,50,34,.85);border-radius:26px 14px 30px 12px/14px 28px 12px 24px;box-shadow:4px 6px 0 rgba(74,50,34,.22);color:#4a3222}",
    ".ptv-kicker{font-size:19px;letter-spacing:1px;color:#8a5a34}",
    ".ptv-title{font-size:46px;line-height:1.1;margin:4px 0 2px}",
    ".ptv-sub{font-size:19px;color:#6b4a2a}",
    ".ptv-sclock{font-size:76px;line-height:1.05;margin-top:8px;color:#3e2a1c}",
    ".ptv-sdate{font-size:20px;color:#6b4a2a}",
    ".ptv-next{font-size:16px;margin-top:8px;color:#8a6a45}",
    ".t-seasons .ptv-foot{color:#4a3222}",
    ".t-seasons[data-dark='1'] .ptv-foot{color:#f5e6c8}",
    // retro
    ".t-retro{--tbg:#111;--tfg:#fff;--tln:#eee;--msg:rgba(0,0,0,.88);--font:" + F_MONO + "}",
    ".ptv-scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.2) 0,rgba(0,0,0,.2) 2px,rgba(0,0,0,0) 2px,rgba(0,0,0,0) 4px);animation:ptvscan 4s steps(2) infinite}",
    "@keyframes ptvscan{0%{opacity:.85}50%{opacity:1}}",
    ".ptv-rbox{position:absolute;left:252px;top:168px;width:480px;padding:20px 20px 16px;background:#111;border:4px solid #eee;color:#fff;font-family:" + F_MONO + "}",
    ".ptv-rbig{font-size:40px;font-weight:bold;letter-spacing:2px}",
    ".ptv-rsmall{font-size:22px;margin-top:8px;color:#ddd}",
    ".ptv-rclock{font-size:30px;margin-top:8px;color:#ffd6e7}",
    // win98
    ".t-win98{--font:" + F_98 + ";--msg:#000080;--mfg:#fff}",
    ".t-win98 #ptv-tap span,.t-win98 #ptv-badge{background:#c0c0c0;color:#000;border:0;box-shadow:" + BEVEL + "}",
    ".w98{background:#c0c0c0;box-shadow:" + BEVEL + "}",
    ".w98-win{position:absolute;left:252px;top:118px;width:520px;padding:3px;color:#000;font-family:" + F_98 + ";font-size:18px;text-align:left;-webkit-font-smoothing:none}",
    ".w98-bar{background:linear-gradient(90deg,#000080,#1084d0);color:#fff;font-weight:bold;padding:4px 4px 4px 8px;display:flex;justify-content:space-between;align-items:center}",
    ".w98-b{display:inline-block;width:22px;height:20px;line-height:18px;text-align:center;color:#000;font-size:14px;margin-left:3px}",
    ".w98-body{padding:20px 18px 16px;display:flex;flex-wrap:wrap;align-items:center}",
    ".w98-face{font-size:36px;margin-right:18px;color:#5a2340;background:#ffd6e7;padding:8px 10px;box-shadow:inset 1px 1px #808080,inset -1px -1px #fff}",
    ".w98-text{flex:1;line-height:1.5}",
    ".w98-clock{font-size:34px;margin-top:6px}",
    ".w98-row{padding:0 0 16px}",
    ".w98-ok{width:96px;margin:0 auto;text-align:center;padding:6px 0}",
    ".w98-task{position:absolute;left:0;right:0;bottom:0;height:40px;display:flex;align-items:center;padding:0 4px;font-family:" + F_98 + ";font-size:17px;color:#000;text-align:left}",
    ".w98-start{font-weight:bold;padding:5px 10px;margin-right:6px}",
    ".w98-item{padding:5px 12px;width:220px;background:#dcdcdc;box-shadow:inset -1px -1px #fff,inset 1px 1px #0a0a0a,inset -2px -2px #dfdfdf,inset 2px 2px #808080}",
    ".w98-tray{margin-left:auto;padding:5px 14px;box-shadow:inset -1px -1px #fff,inset 1px 1px #808080}",
    // minimal
    ".t-minimal{--tbg:#151515;--tfg:#e8e8e8;--tln:#444;--msg:rgba(0,0,0,.88);--font:" + F_MIN + "}",
    ".t-minimal #ptv-tap span,.t-minimal #ptv-badge{box-shadow:none;border-width:1px;border-radius:10px}",
    ".ptv-min{position:absolute;left:0;right:0;top:160px;color:#e8e8e8;font-family:" + F_MIN + "}",
    ".ptv-mclock{font-size:168px;font-weight:200;line-height:1;letter-spacing:-2px}",
    ".ptv-mdate{font-size:24px;color:#8a8a8a;margin-top:14px}",
    ".t-minimal .ptv-foot{color:#555}"
  ].join("\n");
  var css = el("style", null, document.head || document.body);
  css.textContent = [
    "html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}",
    "#sltv{position:fixed;inset:0;color:#fff}",
    "#ptv-stage{position:absolute;inset:0;background:#000}",
    "#ptv-stage video,#ptv-stage iframe,#ptv-stage>div{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}",
    "#ptv-tap{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.35);cursor:pointer}",
    "#ptv-dbg{position:absolute;right:8px;top:8px;display:none;background:rgba(0,0,0,.7);font:16px monospace;padding:6px 8px;white-space:pre}"
  ].join("\n") + "\n" + THEME_CSS;

  var stage = el("div", { id: "ptv-stage" }, root);
  // =====================================================================
  //  THEMES  (the idle / standby screen)  ♡
  //  pink (default) · nature · seasons · retro · win98 · minimal
  //  The TV sends "theme" (and optional "tdate" preview) in /state, so every
  //  screen switches together. For testing in a browser:  ?theme=nature&date=2026-12-21&hour=6:30
  //  Everything is drawn here (canvas + a few CSS shapes): no images, no web fonts.
  // =====================================================================
  var Q = (function () {
    var o = {}, s = (location.search || "").replace(/^\?/, "");
    s.split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("="), k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      o[k] = i < 0 ? "" : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
    });
    return o;
  })();
  var THEMES = ["pink", "nature", "seasons", "retro", "win98", "minimal"];
  var ALIAS = { puppy: "pink", "default": "pink", "": "pink", pagan: "seasons", wheel: "seasons", holidays: "seasons",
    holiday: "seasons", cozy: "seasons", season: "seasons", witchy: "seasons", landscape: "nature", tv: "retro",
    "98": "win98", windows: "win98", clock: "minimal", dark: "minimal" };
  function themeName(t) {
    t = String(t || "").toLowerCase().trim();
    if (ALIAS.hasOwnProperty(t)) t = ALIAS[t];
    return THEMES.indexOf(t) >= 0 ? t : "pink";
  }

  // ---------- time (viewer's own local time, corrected for a wrong PC clock) ----------
  var _ovCache = { s: null, v: null };
  function override() {
    var s = (Q.date || (S && S.tdate) || "") + "|" + (Q.hour || "");
    if (s === _ovCache.s) return _ovCache.v;
    var v = null, m = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(s);
    if (m) v = { y: +m[1], m: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : 0 };
    var hm = /\|(\d{1,2})(?::(\d{2}))?$/.exec(s);
    if (hm) { v = v || {}; v.h = +hm[1]; v.mi = hm[2] ? +hm[2] : 0; }
    _ovCache = { s: s, v: v };
    return v;
  }
  // ---------- SLT (Second Life Time = US Pacific, with daylight saving) ----------
  // Returns a Date whose normal getters (getHours, getDate...) read the SLT wall clock,
  // so every theme, the sky and the holiday logic all run on SLT.
  var _sltFmt = null;
  try {
    _sltFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    if (!_sltFmt.formatToParts) _sltFmt = null;
  } catch (e) { _sltFmt = null; }
  function pacificOffsetHours(ms) {   // fallback when the browser has no time zone data: US rules since 2007
    var y = new Date(ms).getUTCFullYear();
    function nthSunday(m, n) { var d = new Date(Date.UTC(y, m, 1)); return 1 + (7 - d.getUTCDay()) % 7 + (n - 1) * 7; }
    var start = Date.UTC(y, 2, nthSunday(2, 2), 10);   // 2nd Sun of March, 2:00 PST = 10:00 UTC
    var end = Date.UTC(y, 10, nthSunday(10, 1), 9);    // 1st Sun of November, 2:00 PDT = 09:00 UTC
    return ms >= start && ms < end ? -7 : -8;
  }
  function sltDate(ms) {
    if (_sltFmt) {
      try {
        var o = {};
        _sltFmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = +p.value; });
        if (o.year && o.month) return new Date(o.year, o.month - 1, o.day, o.hour % 24, o.minute, o.second);
      } catch (e) { }
    }
    var u = new Date(ms + pacificOffsetHours(ms) * 36e5);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }
  function viewNow() {
    var d = sltDate(serverNow()), o = override();
    if (o) {
      if (o.y) d.setFullYear(o.y, o.m - 1, o.d);
      if (o.h != null) d.setHours(o.h, o.mi || 0, 0, 0);
    }
    return d;
  }
  function fmtTime(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function fmtDate(d) { return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }); }
  function ymd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  function dayOnly(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function daysBetween(a, b) { return Math.round((dayOnly(b) - dayOnly(a)) / 864e5); }
  function dayOfYear(d) { return daysBetween(new Date(d.getFullYear(), 0, 1), d) + 1; }

  // ---------- sky maths (all offline) ----------
  var RAD = Math.PI / 180;
  function jdToDate(jd) { return new Date((jd - 2440587.5) * 864e5); }
  function dateToJd(d) { return d.getTime() / 864e5 + 2440587.5; }
  // equinoxes / solstices (Meeus ch. 27, mean values: good to well under a day)
  function seasonPoint(year, which) {
    var Y = (year - 2000) / 1000, c = [
      [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
      [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
      [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
      [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]][which];
    return dayOnly(jdToDate(c[0] + c[1] * Y + c[2] * Y * Y + c[3] * Y * Y * Y + c[4] * Y * Y * Y * Y));
  }
  // full moons (Meeus ch. 49, main terms: good to a few minutes)
  function fullMoonJd(k) {
    k = Math.floor(k) + 0.5;
    var T = k / 1236.85, E = 1 - 0.002516 * T - 0.0000074 * T * T;
    var jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T;
    var M = (2.5534 + 29.1053567 * k) * RAD, Mp = (201.5643 + 385.81693528 * k) * RAD,
      F = (160.7108 + 390.67050284 * k) * RAD, Om = (124.7746 - 1.56375588 * k) * RAD;
    jde += -0.40614 * Math.sin(Mp) + 0.17302 * E * Math.sin(M) + 0.01614 * Math.sin(2 * Mp) + 0.01043 * Math.sin(2 * F)
      + 0.00734 * E * Math.sin(Mp - M) - 0.00515 * E * Math.sin(Mp + M) + 0.00209 * E * E * Math.sin(2 * M)
      - 0.00111 * Math.sin(Mp - 2 * F) - 0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M)
      - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) + 0.00038 * E * Math.sin(M - 2 * F)
      - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(Om);
    return jde - 0.0008; // TT -> UT (about 69 s)
  }
  var MOON_NAMES = ["wolf", "snow", "worm", "pink", "flower", "strawberry", "buck", "sturgeon", "corn", "hunter's", "beaver", "cold"];
  function fullMoonsAround(d) {   // [{date, name}] for the full moons near d
    var k0 = Math.floor((dateToJd(d) - 2451550.09766) / 29.530588861), out = [];
    for (var k = k0 - 2; k <= k0 + 2; k++) out.push({ date: jdToDate(fullMoonJd(k)), k: k });
    // harvest moon = the full moon closest to the September equinox, hunter's moon = the next one
    var yr = d.getFullYear(), eq = seasonPoint(yr, 2), best = null;
    var kk0 = Math.floor((dateToJd(eq) - 2451550.09766) / 29.530588861);
    for (var j = kk0 - 1; j <= kk0 + 1; j++) {
      var fd = jdToDate(fullMoonJd(j));
      if (!best || Math.abs(fd - eq) < Math.abs(best.d - eq)) best = { d: fd, k: j };
    }
    out.forEach(function (m) {
      m.name = MOON_NAMES[m.date.getMonth()];
      if (best && m.k === best.k) m.name = "harvest";
      else if (best && m.k === best.k + 1) m.name = "hunter's";
    });
    return out;
  }
  function moonPhase(d) {   // 0 new .. 0.5 full .. 1 new
    var p = ((dateToJd(d) - 2451550.1) / 29.530588853) % 1;
    return p < 0 ? p + 1 : p;
  }
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, da);
  }
  function thanksgiving(y) { var d = new Date(y, 10, 1); var off = (4 - d.getDay() + 7) % 7; return new Date(y, 10, 1 + off + 21); }
  // Korean lunar holidays (from the Korean "dangi" calendar), MMDD
  var SEOLLAL = { 2024: "0210", 2025: "0129", 2026: "0217", 2027: "0207", 2028: "0127", 2029: "0213", 2030: "0203", 2031: "0123", 2032: "0211", 2033: "0131", 2034: "0219", 2035: "0208", 2036: "0128", 2037: "0215", 2038: "0204", 2039: "0124", 2040: "0212" };
  var CHUSEOK = { 2024: "0917", 2025: "1006", 2026: "0925", 2027: "0915", 2028: "1003", 2029: "0922", 2030: "0912", 2031: "1001", 2032: "0919", 2033: "0908", 2034: "0927", 2035: "0916", 2036: "1004", 2037: "0924", 2038: "0913", 2039: "1002", 2040: "0921" };
  function lunarDay(y, table, month, day) {
    if (table[y]) return new Date(y, +table[y].slice(0, 2) - 1, +table[y].slice(2));
    try {   // other years: ask the browser's Korean calendar
      var f = new Intl.DateTimeFormat("en-u-ca-dangi", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
      for (var t = new Date(Date.UTC(y, 0, 1, 3)); t.getUTCFullYear() === y; t = new Date(t.getTime() + 864e5)) {
        var p = f.formatToParts(t), mm = "", dd = "";
        p.forEach(function (x) { if (x.type === "month") mm = x.value; if (x.type === "day") dd = x.value; });
        if (mm === String(month) && dd === String(day)) return new Date(y, t.getUTCMonth(), t.getUTCDate());
      }
    } catch (e) {}
    return null;
  }

  // ---------- the wheel of the year + holidays (upstate NY, northern hemisphere) ----------
  function sabbats(y) {
    return [
      { key: "imbolc", name: "imbolc", date: new Date(y, 1, 1), span: [0, 1] },
      { key: "ostara", name: "ostara", date: seasonPoint(y, 0), span: [-1, 1] },
      { key: "beltane", name: "beltane", date: new Date(y, 4, 1), span: [-1, 0] },
      { key: "litha", name: "litha", date: seasonPoint(y, 1), span: [-1, 1] },
      { key: "lammas", name: "lammas", date: new Date(y, 7, 1), span: [-1, 0] },
      { key: "mabon", name: "mabon", date: seasonPoint(y, 2), span: [-1, 1] },
      { key: "samhain", name: "samhain", date: new Date(y, 9, 31), span: [-1, 1] },
      { key: "yule", name: "yule", date: seasonPoint(y, 3), span: [-1, 1] }];
  }
  function holidays(y) {
    var list = [
      { key: "newyear", date: new Date(y, 0, 1), span: [0, 0] },
      { key: "newyear", date: new Date(y, 11, 31), span: [0, 0] },
      { key: "valentine", date: new Date(y, 1, 14), span: [0, 0] },
      { key: "easter", date: easter(y), span: [-1, 0] },
      { key: "july4", date: new Date(y, 6, 4), span: [0, 0] },
      { key: "samhain", date: new Date(y, 9, 31), span: [-1, 1] },
      { key: "thanksgiving", date: thanksgiving(y), span: [0, 0] },
      { key: "christmas", date: new Date(y, 11, 25), span: [-1, 0] }];
    var s = lunarDay(y, SEOLLAL, 1, 1), c = lunarDay(y, CHUSEOK, 8, 15);
    if (s) list.push({ key: "seollal", date: s, span: [-1, 1] });
    if (c) list.push({ key: "chuseok", date: c, span: [-1, 1] });
    return list;
  }
  function inSpan(today, h) { var n = daysBetween(h.date, today); return n >= h.span[0] && n <= h.span[1]; }

  var SEGMENTS = {   // between two sabbats
    samhain: { title: "the dark half", sub: "late autumn \u00B7 candles, quilts & warm tea", look: "darkhalf" },
    yule: { title: "deep winter", sub: "rest, dream & keep the hearth warm", look: "winter" },
    imbolc: { title: "the thaw", sub: "late winter \u00B7 seeds are waiting", look: "thaw" },
    ostara: { title: "spring", sub: "everything is waking up", look: "spring" },
    beltane: { title: "early summer", sub: "green & growing", look: "earlysummer" },
    litha: { title: "high summer", sub: "long golden days", look: "summer" },
    lammas: { title: "harvest season", sub: "late summer \u00B7 gathering in", look: "harvest" },
    mabon: { title: "autumn", sub: "apples, woodsmoke & falling leaves", look: "autumn" }
  };
  var SCENES = {   // title, small line above, line below, look
    newyear: ["happy new year", "new year", "new beginnings \u2726 may the year be gentle", "newyear"],
    seollal: ["\uC0C8\uD574 \uBCF5 \uB9CE\uC774 \uBC1B\uC73C\uC138\uC694", "seollal \u00B7 korean lunar new year", "happy new year \u2661 lots of luck", "seollal"],
    valentine: ["happy valentine's day", "valentine's day", "all my love \u2661", "valentine"],
    imbolc: ["blessed imbolc", "wheel of the year \u00B7 sabbat", "brigid's fire \u00B7 first stirrings of spring", "imbolc"],
    ostara: ["blessed ostara", "wheel of the year \u00B7 spring equinox", "light & dark in balance", "ostara"],
    easter: ["happy easter", "easter \u00B7 spring", "spring blessings \u2661", "easter"],
    beltane: ["blessed beltane", "wheel of the year \u00B7 may day", "fire & flowers", "beltane"],
    litha: ["blessed litha", "wheel of the year \u00B7 summer solstice", "the longest day \u2600", "litha"],
    july4: ["happy 4th of july", "independence day", "summer nights & fireflies", "july4"],
    lammas: ["blessed lammas", "wheel of the year \u00B7 first harvest", "bread, grain & gratitude", "lammas"],
    chuseok: ["\uC990\uAC70\uC6B4 \uCD94\uC11D", "chuseok \u00B7 korean harvest festival", "happy chuseok \u2661 full moon, full hearts", "chuseok"],
    mabon: ["blessed mabon", "wheel of the year \u00B7 autumn equinox", "second harvest \u00B7 give thanks", "mabon"],
    samhain: ["blessed samhain", "samhain \u00B7 halloween", "happy halloween \u2661 the veil is thin", "samhain"],
    thanksgiving: ["happy thanksgiving", "thanksgiving \u00B7 harvest home", "harvest blessings \u2661 warm hearts & full tables", "thanksgiving"],
    yule: ["blessed yule", "wheel of the year \u00B7 winter solstice", "the sun returns \u2600", "yule"],
    christmas: ["merry christmas", "christmas \u00B7 yuletide", "cozy hearts & warm candles \u2661", "christmas"]
  };
  function sceneFor(now) {
    var today = dayOnly(now), y = today.getFullYear(), i, h, hit = null;
    var hs = holidays(y).concat(holidays(y + 1), holidays(y - 1));
    var order = ["christmas", "newyear", "thanksgiving", "samhain", "seollal", "chuseok", "valentine", "easter", "july4"];
    for (i = 0; i < order.length && !hit; i++) hs.forEach(function (x) { if (!hit && x.key === order[i] && inSpan(today, x)) hit = x.key; });
    var sb = sabbats(y - 1).concat(sabbats(y), sabbats(y + 1));
    if (!hit) sb.forEach(function (x) { if (!hit && inSpan(today, x)) hit = x.key; });
    // where on the wheel are we?
    var prev = null, next = null;
    sb.forEach(function (x) {
      var n = daysBetween(x.date, today);
      if (n >= 0 && (!prev || n < daysBetween(prev.date, today))) prev = x;
      if (n < 0 && (!next || n > daysBetween(next.date, today))) next = x;
    });
    var moons = fullMoonsAround(now), fm = null, nextMoon = null;
    moons.forEach(function (m) {
      var n = daysBetween(today, m.date);
      if (n === 0) fm = m;
      if (n > 0 && (!nextMoon || m.date < nextMoon.date)) nextMoon = m;
    });
    var r = {};
    if (hit) {
      var sc = SCENES[hit];
      r = { title: sc[0], kicker: sc[1], sub: sc[2], look: sc[3], key: hit };
    } else {
      var seg = SEGMENTS[prev.key];
      r = { title: seg.title, kicker: "wheel of the year \u00B7 after " + prev.name, sub: seg.sub, look: seg.look, key: prev.key };
      if (fm) { r.kicker = "wheel of the year \u00B7 " + seg.title; r.title = "full " + fm.name + " moon"; r.sub = "\u263E " + seg.sub; }
    }
    var bits = [];
    if (fm && hit) bits.push("full " + fm.name + " moon today \u263E");
    if (next) { var dn = daysBetween(today, next.date); bits.push("next: " + next.name + (dn === 1 ? " tomorrow" : " in " + dn + " days")); }
    if (!fm && nextMoon) { var mn = daysBetween(today, nextMoon.date); if (mn <= 7) bits.push(nextMoon.name + " moon " + (mn === 1 ? "tomorrow" : "in " + mn + " days")); }
    r.next = bits.join("  \u00B7  ");
    r.phase = moonPhase(now);
    r.fullToday = !!fm;
    return r;
  }

  // ---------- hand-drawn canvas kit ----------
  var W = 1024, H = 576, C = null, seed = 1;
  function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function jit(a) { return (rnd() - 0.5) * 2 * a; }
  var INK = "rgba(74,50,34,.85)";
  function smooth(pts, closed) {
    var n = pts.length; if (n < 2) return;
    C.beginPath();
    if (closed) {
      var m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
      C.moveTo(m0[0], m0[1]);
      for (var i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; C.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
      C.closePath();
    } else {
      C.moveTo(pts[0][0], pts[0][1]);
      for (var j = 1; j < n - 1; j++) { var p = pts[j], q = pts[j + 1]; C.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
      C.lineTo(pts[n - 1][0], pts[n - 1][1]);
    }
  }
  function paint(fill, stroke, lw) {
    if (fill) { C.fillStyle = fill; C.fill(); }
    if (stroke) { C.strokeStyle = stroke; C.lineWidth = lw || 2.4; C.lineJoin = "round"; C.lineCap = "round"; C.stroke(); }
  }
  function blob(x, y, rx, ry, fill, stroke, wob, rot, n) {
    n = n || 14; wob = wob == null ? 0.06 : wob; rot = rot || 0;
    var pts = [], c = Math.cos(rot), s = Math.sin(rot);
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2, k = 1 + jit(wob), px = Math.cos(a) * rx * k, py = Math.sin(a) * ry * k;
      pts.push([x + px * c - py * s, y + px * s + py * c]);
    }
    smooth(pts, true); paint(fill, stroke === undefined ? INK : stroke);
  }
  function wline(pts, stroke, lw, wob) {
    var p = pts.map(function (q) { return [q[0] + jit(wob || 1.2), q[1] + jit(wob || 1.2)]; });
    smooth(p, false); paint(null, stroke || INK, lw);
  }
  function grad(y0, y1, cols) {
    var g = C.createLinearGradient(0, y0, 0, y1);
    cols.forEach(function (c, i) { g.addColorStop(i / (cols.length - 1), c); });
    return g;
  }
  function paper(c1, c2, dots) {
    C.fillStyle = grad(0, H, [c1, c2]); C.fillRect(0, 0, W, H);
    for (var i = 0; i < (dots || 260); i++) { C.fillStyle = "rgba(90,60,30," + (0.03 + rnd() * 0.05) + ")"; C.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); }
  }
  function hill(yBase, amp, fill, stroke, bumps) {
    var pts = [[-20, H + 20]], n = bumps || 6;
    for (var i = 0; i <= n; i++) pts.push([-20 + i * (W + 40) / n, yBase + Math.sin(i * 1.7 + rnd() * 2) * amp + jit(amp * 0.3)]);
    pts.push([W + 20, H + 20]);
    smooth(pts, true); paint(fill, stroke);
  }
  function mix(a, b, t) {   // "#rrggbb" colours
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t), g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t), bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }
  // --- motifs ---
  function leaf(x, y, s, rot, col) {
    var c = Math.cos(rot), sn = Math.sin(rot);
    function P(px, py) { return [x + px * c - py * sn, y + px * sn + py * c]; }
    smooth([P(0, -s), P(s * .55, -s * .35), P(s * .45, s * .4), P(0, s), P(-s * .45, s * .4), P(-s * .55, -s * .35)], true); paint(col, INK, 2);
    wline([P(0, -s * .8), P(0, s * 1.25)], INK, 1.6, .5);
  }
  function pumpkin(x, y, s, col, face) {
    col = col || "#e08a3c";
    blob(x - s * .38, y, s * .48, s * .55, mix(col, "#7a3e14", .15));
    blob(x + s * .38, y, s * .48, s * .55, mix(col, "#7a3e14", .15));
    blob(x, y, s * .52, s * .6, col);
    C.fillStyle = "#6b7a3a"; blob(x + s * .04, y - s * .66, s * .09, s * .16, "#6f6a3a", INK, .1, .2, 8);
    wline([[x + s * .1, y - s * .62], [x + s * .35, y - s * .8], [x + s * .3, y - s * .95]], "#5f7a3a", 2);
    if (face) {
      C.fillStyle = "#ffd37a";
      [[-.22, -.12], [.22, -.12]].forEach(function (e) { C.beginPath(); C.moveTo(x + e[0] * s - s * .1, y + e[1] * s + s * .06); C.lineTo(x + e[0] * s, y + e[1] * s - s * .1); C.lineTo(x + e[0] * s + s * .1, y + e[1] * s + s * .06); C.closePath(); C.fill(); });
      C.beginPath(); C.moveTo(x - s * .28, y + s * .18); C.quadraticCurveTo(x, y + s * .42, x + s * .28, y + s * .18); C.quadraticCurveTo(x, y + s * .3, x - s * .28, y + s * .18); C.fill();
    }
  }
  function wheat(x, y, h, lean, col) {
    col = col || "#d9a441";
    var tx = x + lean * h, ty = y - h;
    wline([[x, y], [x + lean * h * .5, y - h * .55], [tx, ty]], "#a77b2c", 2.2);
    for (var i = 0; i < 6; i++) {
      var t = 0.62 + i * 0.065, px = x + lean * h * t, py = y - h * t;
      blob(px - 5, py, 4.2, 8, col, INK, .05, -0.6, 8); blob(px + 5, py, 4.2, 8, col, INK, .05, 0.6, 8);
    }
    blob(tx, ty - 6, 3.8, 8, col, INK, .05, 0, 8);
  }
  function wheatBundle(x, y, h) {
    for (var i = -3; i <= 3; i++) wheat(x + i * 4, y, h * (0.9 + rnd() * .15), i * 0.11);
    blob(x, y - h * .32, 16, 7, "#b5523b", INK, .1, 0, 10);
  }
  function candle(x, y, w, h, col) {
    col = col || "#f3e6c8";
    smooth([[x - w / 2, y], [x - w / 2 + jit(1), y - h], [x + w / 2 + jit(1), y - h], [x + w / 2, y]], true); paint(col);
    blob(x, y - h, w / 2, 4, mix(col, "#ffffff", .3), INK, .1, 0, 10);
    wline([[x, y - h], [x, y - h - 7]], "#3a2a1a", 1.6, .3);
    var g = C.createRadialGradient(x, y - h - 16, 2, x, y - h - 16, 34); g.addColorStop(0, "rgba(255,220,120,.55)"); g.addColorStop(1, "rgba(255,220,120,0)");
    C.fillStyle = g; C.beginPath(); C.arc(x, y - h - 16, 34, 0, 7); C.fill();
    smooth([[x, y - h - 30], [x + 7, y - h - 14], [x, y - h - 6], [x - 7, y - h - 14]], true); paint("#ffbf47", "rgba(180,90,20,.8)", 1.6);
    blob(x, y - h - 13, 2.6, 5, "#fff3c4", null, .05, 0, 8);
    flames.push([x, y - h - 16]);
  }
  function apple(x, y, s, col) {
    blob(x, y, s, s * .9, col || "#c4473a");
    wline([[x, y - s * .7], [x + 2, y - s * 1.15]], "#5a3a1a", 2.4);
    leaf(x + s * .4, y - s * 1.05, s * .35, 1.1, "#7d9a4a");
  }
  function flower(x, y, s, col, mid) {
    for (var i = 0; i < 6; i++) { var a = i / 6 * Math.PI * 2; blob(x + Math.cos(a) * s * .7, y + Math.sin(a) * s * .7, s * .45, s * .32, col, INK, .08, a, 9); }
    blob(x, y, s * .38, s * .38, mid || "#e7b440", INK, .1, 0, 9);
  }
  function stemFlower(x, y, h, col, mid) {
    wline([[x, y], [x + jit(6), y - h * .5], [x + jit(4), y - h]], "#5f7a3a", 2.2);
    leaf(x - 8, y - h * .4, 9, -1.0, "#7d9a4a");
    flower(x, y - h, 9 + rnd() * 3, col, mid);
  }
  function sprig(x, y, h, col) {
    wline([[x, y], [x + jit(5), y - h]], "#5f7a3a", 2);
    for (var i = 1; i < 6; i++) leaf(x + (i % 2 ? 7 : -7), y - h * i / 6, 6, i % 2 ? .9 : -.9, col || "#8aa35a");
  }
  function holly(x, y, s) {
    [-1, 1].forEach(function (d) {
      var pts = [], n = 9;
      for (var i = 0; i <= n; i++) { var t = i / n; pts.push([x + d * s * t * 1.2, y - s * .2 * t + (i % 2 ? -s * .22 : 0)]); }
      for (var j = n; j >= 0; j--) { var u = j / n; pts.push([x + d * s * u * 1.2, y - s * .2 * u + s * .32 + (j % 2 ? s * .2 : 0)]); }
      smooth(pts, true); paint("#3f6b3a");
    });
    blob(x - 6, y + 2, 6, 6, "#b8322a"); blob(x + 5, y + 4, 6, 6, "#c43b30"); blob(x, y - 5, 6, 6, "#b8322a");
  }
  function evergreen(x, y, h, snow) {
    wline([[x, y], [x, y - h * .2]], "#6b4a2a", 5, .4);
    for (var i = 0; i < 3; i++) {
      var w = h * (0.46 - i * 0.11), yy = y - h * .15 - i * h * .25;
      smooth([[x - w, yy], [x, yy - h * .42], [x + w, yy]], true); paint("#4f7a4a");
      if (snow) { smooth([[x - w * .6, yy - h * .15], [x, yy - h * .4], [x + w * .6, yy - h * .15]], false); paint(null, "#ffffff", 3); }
    }
  }
  function heart(x, y, s, col) {
    smooth([[x, y + s], [x - s * 1.1, y - s * .1], [x - s * .6, y - s * .8], [x, y - s * .35], [x + s * .6, y - s * .8], [x + s * 1.1, y - s * .1]], true);
    paint(col || "#d4645c");
  }
  function egg(x, y, s, col, band) {
    blob(x, y, s * .7, s, col);
    if (band) wline([[x - s * .62, y - s * .1], [x - s * .3, y - s * .25], [x, y - s * .1], [x + s * .3, y - s * .25], [x + s * .62, y - s * .1]], band, 2.4, .6);
  }
  function sun(x, y, r) {
    var g = C.createRadialGradient(x, y, r * .6, x, y, r * 2.6); g.addColorStop(0, "rgba(255,214,120,.55)"); g.addColorStop(1, "rgba(255,214,120,0)");
    C.fillStyle = g; C.beginPath(); C.arc(x, y, r * 2.6, 0, 7); C.fill();
    for (var i = 0; i < 12; i++) { var a = i / 12 * Math.PI * 2 + jit(.05); wline([[x + Math.cos(a) * r * 1.2, y + Math.sin(a) * r * 1.2], [x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.6]], "rgba(190,120,40,.8)", 2.4, .6); }
    blob(x, y, r, r, "#f6c453", "rgba(190,120,40,.8)");
  }
  function moon(x, y, r, p, glow) {
    if (glow) { var g = C.createRadialGradient(x, y, r * .8, x, y, r * 3); g.addColorStop(0, "rgba(255,244,214,.35)"); g.addColorStop(1, "rgba(255,244,214,0)"); C.fillStyle = g; C.beginPath(); C.arc(x, y, r * 3, 0, 7); C.fill(); }
    C.fillStyle = "rgba(60,55,70,.28)"; C.beginPath(); C.arc(x, y, r, 0, 7); C.fill();
    var k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * r;
    C.beginPath();
    if (p <= 0.5) { C.arc(x, y, r, -Math.PI / 2, Math.PI / 2, false); C.ellipse(x, y, rx, r, 0, Math.PI / 2, -Math.PI / 2, k > 0); }
    else { C.arc(x, y, r, Math.PI / 2, Math.PI * 1.5, false); C.ellipse(x, y, rx, r, 0, -Math.PI / 2, Math.PI / 2, k > 0); }
    C.fillStyle = "#fbf0cf"; C.fill();
    C.strokeStyle = "rgba(120,100,70,.6)"; C.lineWidth = 2; C.beginPath(); C.arc(x, y, r, 0, 7); C.stroke();
  }
  function star(x, y, r, col) {
    var pts = [];
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
    smooth(pts, true); paint(col || "#f4d27a", "rgba(140,100,40,.7)", 1.6);
  }
  function persimmon(x, y, s) {
    blob(x, y, s, s * .85, "#e9823a");
    for (var i = 0; i < 4; i++) leaf(x + Math.cos(i * 1.57) * s * .25, y - s * .7 + Math.sin(i * 1.57) * s * .12, s * .22, i * 1.57, "#5f7a3a");
  }
  function songpyeon(x, y, s, col) {
    smooth([[x - s, y], [x - s * .7, y - s * .55], [x, y - s * .75], [x + s * .7, y - s * .55], [x + s, y]], true); paint(col);
  }
  function pouch(x, y, s, col) {
    smooth([[x - s * .55, y - s * .55], [x - s, y + s * .2], [x - s * .6, y + s * .8], [x + s * .6, y + s * .8], [x + s, y + s * .2], [x + s * .55, y - s * .55]], true); paint(col);
    blob(x, y - s * .6, s * .62, s * .14, mix(col, "#000000", .2));
    wline([[x - s * .3, y - s * .62], [x - s * .5, y - s * 1.0]], "#e9b949", 2.2); wline([[x + s * .3, y - s * .62], [x + s * .5, y - s * 1.0]], "#e9b949", 2.2);
    blob(x, y + s * .15, s * .2, s * .2, "#f2d38a", INK, .1, 0, 8);
  }
  function firework(x, y, r, col) {
    for (var i = 0; i < 14; i++) { var a = i / 14 * Math.PI * 2; for (var j = 1; j <= 3; j++) { C.fillStyle = col; C.beginPath(); C.arc(x + Math.cos(a) * r * j / 3, y + Math.sin(a) * r * j / 3, 2.6 - j * .4, 0, 7); C.fill(); } }
  }
  function acorn(x, y, s) {
    blob(x, y + s * .25, s * .45, s * .55, "#b98a4a");
    blob(x, y - s * .2, s * .55, s * .28, "#7a5a32"); wline([[x, y - s * .45], [x + 3, y - s * .7]], "#5a3a1a", 2);
  }
  function mushroom(x, y, s) {
    smooth([[x - s * .22, y], [x - s * .18, y - s * .55], [x + s * .18, y - s * .55], [x + s * .22, y]], true); paint("#f2e6cf");
    smooth([[x - s * .7, y - s * .5], [x - s * .4, y - s * 1.0], [x + s * .4, y - s * 1.0], [x + s * .7, y - s * .5]], true); paint("#b5523b");
    blob(x - s * .2, y - s * .75, 4, 3, "#f6e7d0", null); blob(x + s * .22, y - s * .7, 3, 3, "#f6e7d0", null);
  }
  function sunflower(x, y, h) {
    wline([[x, y], [x + jit(4), y - h]], "#5f7a3a", 3);
    leaf(x - 12, y - h * .45, 14, -1.1, "#6f8f3f"); leaf(x + 12, y - h * .6, 13, 1.1, "#6f8f3f");
    for (var i = 0; i < 12; i++) { var a = i / 12 * Math.PI * 2; blob(x + Math.cos(a) * 17, y - h + Math.sin(a) * 17, 10, 5, "#f2bf3a", INK, .06, a, 8); }
    blob(x, y - h, 12, 12, "#6b4423");
  }
  function pie(x, y, s) {
    smooth([[x - s, y], [x - s * .9, y - s * .35], [x + s * .9, y - s * .35], [x + s, y]], true); paint("#d99a52");
    blob(x, y - s * .38, s * .92, s * .16, "#c97a3a");
    for (var i = -2; i <= 2; i++) wline([[x + i * s * .3 - 6, y - s * .48], [x + i * s * .3 + 6, y - s * .28]], "rgba(120,70,30,.7)", 2, .3);
  }
  function loaf(x, y, s) {
    blob(x, y, s, s * .55, "#cf9550");
    for (var i = -1; i <= 1; i++) wline([[x + i * s * .45 - 8, y - s * .3], [x + i * s * .45 + 8, y - s * .05]], "rgba(110,60,25,.8)", 2.2, .3);
  }
  function bunny(x, y, s) {
    blob(x, y, s * .7, s * .55, "#efe6d8"); blob(x + s * .55, y - s * .45, s * .38, s * .34, "#efe6d8");
    blob(x + s * .45, y - s * 1.0, s * .1, s * .32, "#efe6d8", INK, .06, -.2, 9); blob(x + s * .7, y - s * .98, s * .1, s * .32, "#efe6d8", INK, .06, .2, 9);
    blob(x - s * .72, y - s * .05, s * .16, s * .16, "#ffffff"); C.fillStyle = "#3a2a1a"; C.beginPath(); C.arc(x + s * .68, y - s * .5, 2.4, 0, 7); C.fill();
  }
  function gift(x, y, s, col) {
    smooth([[x - s, y], [x - s, y - s * 1.4], [x + s, y - s * 1.4], [x + s, y]], true); paint(col);
    wline([[x, y], [x, y - s * 1.4]], "#e9c46a", 4, .4); blob(x - 8, y - s * 1.5, 9, 6, "#e9c46a", INK, .1, -.4, 8); blob(x + 8, y - s * 1.5, 9, 6, "#e9c46a", INK, .1, .4, 8);
  }
  function snowdrop(x, y, h) {
    wline([[x, y], [x + 2, y - h], [x + 8, y - h - 4]], "#5f7a3a", 2);
    blob(x + 10, y - h + 6, 4.5, 8, "#ffffff", INK, .08, .3, 9);
  }
  function frame(col) {   // wobbly hand-drawn border
    var pts = [], m = 16, n = 40;
    for (var i = 0; i < n; i++) {
      var t = i / n, x, y;
      if (t < .25) { x = m + t * 4 * (W - 2 * m); y = m; } else if (t < .5) { x = W - m; y = m + (t - .25) * 4 * (H - 2 * m); }
      else if (t < .75) { x = W - m - (t - .5) * 4 * (W - 2 * m); y = H - m; } else { x = m; y = H - m - (t - .75) * 4 * (H - 2 * m); }
      pts.push([x + jit(1.8), y + jit(1.8)]);
    }
    smooth(pts, true); paint(null, col || INK, 3);
  }

  // ---------- particles (light CSS animation only) ----------
  var flames = [];
  function particles(fx, kind, n) {
    var cols = { leaves: ["#c4622d", "#d9a441", "#a8432a", "#8e9a4a", "#e08a3c"], petals: ["#f6c9cf", "#fbe3e6", "#f2b6c0", "#fff2e8"], snow: ["#ffffff"], fireflies: ["#ffe58a"], motes: ["#f6d98a"] }[kind];
    if (!cols) return;
    for (var i = 0; i < n; i++) {
      var p = el("span", { "class": "ptv-p ptv-" + kind }, fx), sz = kind === "snow" ? 4 + rnd() * 6 : kind === "fireflies" || kind === "motes" ? 4 + rnd() * 3 : 10 + rnd() * 8;
      var dur = kind === "snow" ? 9 + rnd() * 8 : kind === "fireflies" || kind === "motes" ? 4 + rnd() * 5 : 11 + rnd() * 9;
      p.style.cssText = "left:" + (rnd() * 100).toFixed(1) + "%;top:" + (kind === "fireflies" || kind === "motes" ? (45 + rnd() * 50).toFixed(1) + "%" : "-6%") +
        ";width:" + sz.toFixed(1) + "px;height:" + (kind === "leaves" || kind === "petals" ? (sz * .7).toFixed(1) : sz.toFixed(1)) + "px;background:" + cols[Math.floor(rnd() * cols.length)] +
        ";animation-duration:" + dur.toFixed(1) + "s;animation-delay:-" + (rnd() * dur).toFixed(1) + "s;--dx:" + (jit(120)).toFixed(0) + "px;--dy:" + (jit(60)).toFixed(0) + "px;--rot:" + (jit(540)).toFixed(0) + "deg";
    }
  }
  function flameGlows(fx) {
    flames.forEach(function (f, i) {
      if (i > 5) return;
      var g = el("span", { "class": "ptv-flame" }, fx);
      g.style.cssText = "left:" + (f[0] - 26) + "px;top:" + (f[1] - 26) + "px;animation-delay:-" + (rnd() * 2).toFixed(2) + "s";
    });
  }

  // ---------- seasons & holidays: the scenes ----------
  var GY = 508;   // ground line
  function topGarland(kind) {
    for (var x = 50; x < W - 30; x += 46 + rnd() * 10) {
      var y = 34 + Math.sin(x / 70) * 8;
      if (kind === "leaves") leaf(x, y, 12, jit(1.2) + 1.6, ["#c4622d", "#d9a441", "#a8432a", "#8e9a4a"][Math.floor(rnd() * 4)]);
      else if (kind === "holly") { if (rnd() < .5) holly(x, y, 16); else leaf(x, y, 11, 1.6 + jit(.6), "#4f7a4a"); }
      else if (kind === "flowers") flower(x, y, 8 + rnd() * 3, ["#f2b6c0", "#fbe3e6", "#f6d98a", "#cfe0f2"][Math.floor(rnd() * 4)]);
      else if (kind === "stars") star(x, y, 7 + rnd() * 3);
      else if (kind === "hearts") heart(x, y, 9, ["#d4645c", "#e89a96", "#c44b4b"][Math.floor(rnd() * 3)]);
      else if (kind === "herbs") leaf(x, y, 11, 1.6 + jit(.8), ["#8aa35a", "#6f8f3f", "#a9b86a"][Math.floor(rnd() * 3)]);
    }
  }
  function stars(n, col) { for (var i = 0; i < n; i++) { C.fillStyle = col || "rgba(255,240,200," + (0.4 + rnd() * .6) + ")"; C.beginPath(); C.arc(rnd() * W, rnd() * 300, .8 + rnd() * 1.6, 0, 7); C.fill(); } }
  function blossomBranch(x, y, len, dir) {
    var pts = [[x, y]]; for (var i = 1; i <= 4; i++) pts.push([x + dir * len * i / 4, y - i * 14 + jit(6)]);
    wline(pts, "#6b4a2a", 4);
    pts.forEach(function (p, i) { if (i) { flower(p[0], p[1] - 6, 7, i % 2 ? "#f6c9cf" : "#fbe3e6", "#d9707a"); flower(p[0] - dir * 18, p[1] + 10, 6, "#f2b6c0", "#d9707a"); } });
  }
  var LOOKS = {
    thanksgiving: { bg: ["#f7e2bf", "#e8b97f"], ground: "#b9824a", fx: "leaves", n: 14, draw: function () {
      topGarland("leaves");
      candle(66, 540, 22, 62); wheatBundle(140, GY + 4, 130); pumpkin(236, GY + 6, 46); apple(300, 532, 16); apple(326, 538, 14, "#d0623f");
      apple(704, 534, 15, "#b5452f"); pumpkin(790, GY + 2, 54, "#d9772f"); pie(892, 536, 48); candle(966, 546, 20, 86); candle(940, 548, 16, 50);
      for (var i = 0; i < 6; i++) leaf(360 + rnd() * 300, 548 + jit(8), 10, jit(3), ["#c4622d", "#d9a441", "#a8432a"][i % 3]); } },
    samhain: { bg: ["#38281c", "#6a4128"], ground: "#2e2117", fx: "leaves", n: 12, ink: "rgba(245,225,190,.55)", moon: [900, 92, 40], stars: 70, draw: function () {
      candle(60, 546, 20, 70); pumpkin(150, GY + 2, 56, "#e08a3c", true); mushroom(240, 548, 34); acorn(290, 540, 26);
      acorn(720, 544, 24); pumpkin(810, GY - 2, 64, "#e9923f", true); candle(910, 548, 22, 96); candle(950, 550, 16, 56); pumpkin(990, 536, 26, "#d9772f"); } },
    darkhalf: { bg: ["#efe1c8", "#cdae86"], ground: "#8a6a45", fx: "leaves", n: 7, moon: [900, 96, 34], draw: function () {
      topGarland("herbs"); candle(70, 546, 22, 74); candle(104, 550, 16, 44); acorn(160, 542, 26); mushroom(220, 548, 36); acorn(282, 548, 20);
      evergreen(760, 548, 120); candle(860, 548, 22, 86); mushroom(930, 548, 30); acorn(980, 546, 22); } },
    mabon: { bg: ["#f6e3c0", "#e5bd85"], ground: "#a8783e", fx: "leaves", n: 14, sun: [110, 98, 34], draw: function () {
      topGarland("leaves"); wheatBundle(90, GY + 6, 120); apple(170, 530, 18); apple(206, 536, 17, "#d0623f"); apple(186, 506, 16); pumpkin(276, GY + 8, 36, "#e9a03c");
      pumpkin(760, GY + 8, 40, "#e08a3c"); wheat(840, 548, 110, .1); wheat(856, 548, 120, -.05); apple(906, 536, 17); candle(966, 548, 22, 72); } },
    autumn: { bg: ["#f6e3c0", "#e7c08a"], ground: "#a8783e", fx: "leaves", n: 16, sun: [912, 96, 30], draw: function () {
      topGarland("leaves"); pumpkin(110, GY + 4, 50); apple(196, 534, 17); acorn(246, 542, 24); mushroom(296, 548, 30);
      apple(730, 536, 16, "#b5452f"); pumpkin(816, GY + 6, 42, "#d9772f"); pumpkin(900, GY + 10, 30, "#e9b04a"); candle(970, 548, 20, 70); } },
    harvest: { bg: ["#fbefc9", "#efd08a"], ground: "#b99a4a", fx: "motes", n: 10, sun: [110, 96, 36], draw: function () {
      topGarland("herbs"); wheatBundle(150, GY + 6, 140); sunflower(250, 548, 150); apple(306, 540, 15);
      sunflower(760, 548, 170); wheatBundle(870, GY + 6, 130); apple(950, 540, 16, "#c4473a"); } },
    lammas: { bg: ["#fbefc9", "#ecca82"], ground: "#b99a4a", fx: "motes", n: 10, sun: [110, 96, 36], draw: function () {
      topGarland("herbs"); wheatBundle(110, GY + 6, 140); loaf(220, 528, 50); candle(296, 548, 20, 66);
      loaf(760, 530, 44); wheatBundle(860, GY + 6, 150); sunflower(950, 548, 150); } },
    chuseok: { bg: ["#22313f", "#56636a"], ground: "#3c4a3a", fx: "", n: 0, ink: "rgba(245,230,200,.55)", moon: [900, 100, 58, true], stars: 50, draw: function () {
      var cols = ["#d8e8c8", "#f6d3da", "#fbf6ea", "#e9d79a"];
      blob(170, 540, 120, 22, "#c9a46a"); for (var i = 0; i < 7; i++) songpyeon(100 + i * 24 + jit(4), 532 - (i % 2) * 10, 16, cols[i % 4]);
      persimmon(300, 532, 22); persimmon(740, 534, 22); persimmon(780, 540, 18); sprig(850, 548, 90, "#6f8f3f"); persimmon(940, 532, 24); } },
    winter: { bg: ["#eef2f0", "#d7e2e0"], ground: "#fbfbf8", fx: "snow", n: 22, moon: [912, 96, 30], draw: function () {
      evergreen(90, 548, 170, true); evergreen(190, 548, 120, true); candle(280, 548, 22, 70);
      evergreen(760, 548, 130, true); candle(850, 548, 20, 80); evergreen(940, 548, 180, true); } },
    yule: { bg: ["#eef0e8", "#d8dfd6"], ground: "#fbfbf8", fx: "snow", n: 20, sun: [110, 100, 28], draw: function () {
      topGarland("holly"); evergreen(110, 548, 170, true); loaf(240, 536, 56); candle(220, 520, 14, 40, "#d4645c"); candle(262, 520, 14, 48, "#f3e6c8");
      holly(320, 540, 22); candle(740, 548, 22, 90, "#c44b4b"); candle(780, 550, 18, 60); evergreen(880, 548, 160, true); holly(980, 540, 20); } },
    christmas: { bg: ["#f4ece0", "#e3d6c4"], ground: "#fbfbf8", fx: "snow", n: 20, draw: function () {
      topGarland("holly"); candle(70, 548, 22, 86, "#c44b4b"); candle(106, 550, 18, 56); gift(190, 548, 30, "#b8322a"); gift(262, 548, 24, "#4f7a4a");
      evergreen(860, 548, 260); for (var i = 0; i < 9; i++) blob(860 + jit(70), 450 - rnd() * 150, 6, 6, ["#c43b30", "#e9c46a", "#7a9cc0"][i % 3]);
      star(860, 300, 16); gift(740, 548, 26, "#7a9cc0"); gift(970, 548, 22, "#e9c46a"); } },
    newyear: { bg: ["#25303f", "#47525c"], ground: "#e9eef0", fx: "snow", n: 10, ink: "rgba(240,230,210,.55)", stars: 80, draw: function () {
      firework(130, 120, 60, "#f3d58a"); firework(900, 110, 54, "#f3e6c8"); firework(800, 200, 36, "#a9c2a0"); firework(220, 230, 34, "#e9a87a");
      evergreen(90, 548, 140, true); candle(200, 548, 20, 70); evergreen(940, 548, 150, true); candle(830, 548, 20, 80); } },
    thaw: { bg: ["#eef0e6", "#dfe6d2"], ground: "#e8ecdf", fx: "snow", n: 8, sun: [110, 100, 26], draw: function () {
      for (var i = 0; i < 7; i++) snowdrop(60 + i * 30 + jit(8), 548, 40 + rnd() * 30); evergreen(300, 548, 120, true);
      candle(760, 548, 20, 70); for (var j = 0; j < 6; j++) snowdrop(820 + j * 28, 548, 40 + rnd() * 30); } },
    imbolc: { bg: ["#f3efe2", "#e2e4d2"], ground: "#eef0e4", fx: "snow", n: 8, sun: [110, 100, 26], draw: function () {
      topGarland("herbs"); candle(80, 548, 20, 90); candle(116, 550, 16, 60); candle(150, 550, 18, 74); for (var i = 0; i < 5; i++) snowdrop(200 + i * 26, 548, 46 + rnd() * 20);
      for (var j = 0; j < 5; j++) snowdrop(730 + j * 26, 548, 46 + rnd() * 20); candle(890, 548, 20, 96); candle(930, 550, 16, 60); sprig(980, 548, 90); } },
    seollal: { bg: ["#f6ece0", "#ead6c6"], ground: "#fbf8f4", fx: "snow", n: 10, draw: function () {
      pouch(110, 512, 40, "#d9706a"); pouch(200, 524, 32, "#5f8fb0"); pouch(280, 530, 26, "#e9b949");
      blossomBranch(720, 140, 260, 1); pouch(860, 516, 38, "#7aa36a"); pouch(950, 526, 30, "#d9706a"); } },
    valentine: { bg: ["#f8e6e0", "#efcfc8"], ground: "#d9a39a", fx: "petals", n: 14, draw: function () {
      topGarland("hearts"); candle(70, 548, 22, 80, "#f3e6c8"); stemFlower(140, 548, 80, "#c44b4b", "#8a2a2a"); stemFlower(176, 548, 100, "#e89a96", "#c44b4b"); heart(260, 520, 26);
      heart(740, 522, 22, "#e89a96"); stemFlower(820, 548, 96, "#c44b4b", "#8a2a2a"); stemFlower(860, 548, 76, "#f2b6c0", "#c44b4b"); candle(950, 548, 22, 90); } },
    spring: { bg: ["#f3f1dc", "#e1ebc6"], ground: "#9fbf73", fx: "petals", n: 12, sun: [110, 96, 30], draw: function () {
      blossomBranch(1000, 120, 240, -1); for (var i = 0; i < 7; i++) stemFlower(50 + i * 38, 548, 40 + rnd() * 50, ["#f2b6c0", "#fbf6ea", "#f6d98a", "#cfe0f2"][i % 4]);
      for (var j = 0; j < 6; j++) stemFlower(730 + j * 44, 548, 40 + rnd() * 50, ["#fbf6ea", "#f2b6c0", "#f6d98a"][j % 3]); } },
    ostara: { bg: ["#f3f1dc", "#e1ebc6"], ground: "#a9c47f", fx: "petals", n: 12, sun: [110, 96, 30], moon: [912, 96, 30], draw: function () {
      topGarland("flowers"); egg(110, 526, 26, "#cfe0f2", "#7a9cc0"); egg(160, 534, 22, "#f6d3da", "#d9707a"); egg(204, 530, 24, "#f6e7b0", "#d9a441");
      stemFlower(280, 548, 70, "#fbf6ea"); stemFlower(740, 548, 80, "#f2b6c0"); egg(820, 530, 24, "#d8e8c8", "#7d9a4a"); egg(870, 534, 22, "#f6d3da", "#c97a8a"); sprig(950, 548, 90); } },
    easter: { bg: ["#f5f1e0", "#e4edcf"], ground: "#a9c47f", fx: "petals", n: 10, sun: [110, 96, 30], draw: function () {
      topGarland("flowers"); bunny(160, 524, 46); egg(260, 534, 20, "#cfe0f2", "#7a9cc0"); egg(296, 538, 18, "#f6d3da", "#d9707a");
      egg(740, 532, 22, "#f6e7b0", "#d9a441"); egg(782, 536, 20, "#d8e8c8", "#7d9a4a"); stemFlower(860, 548, 80, "#fbf6ea"); stemFlower(900, 548, 96, "#f2b6c0"); stemFlower(950, 548, 70, "#f6d98a"); } },
    beltane: { bg: ["#f4f2d8", "#dfeabf"], ground: "#8fb565", fx: "petals", n: 14, sun: [912, 96, 32], draw: function () {
      topGarland("flowers"); candle(70, 548, 22, 80); for (var i = 0; i < 6; i++) stemFlower(120 + i * 34, 548, 50 + rnd() * 50, ["#f2b6c0", "#fbf6ea", "#f6d98a", "#e89a96"][i % 4]);
      for (var j = 0; j < 6; j++) stemFlower(720 + j * 40, 548, 50 + rnd() * 60, ["#fbf6ea", "#f2b6c0", "#cfe0f2"][j % 3]); candle(975, 548, 20, 70); } },
    earlysummer: { bg: ["#f6f1d2", "#e4ebbd"], ground: "#8fb565", fx: "petals", n: 8, sun: [912, 96, 32], draw: function () {
      topGarland("herbs"); for (var i = 0; i < 4; i++) sprig(70 + i * 40, 548, 70 + rnd() * 40); stemFlower(250, 548, 80, "#fbf6ea"); stemFlower(290, 548, 60, "#f2b6c0");
      stemFlower(730, 548, 70, "#f6d98a"); for (var j = 0; j < 4; j++) sprig(800 + j * 44, 548, 70 + rnd() * 40, "#7d9a4a"); } },
    summer: { bg: ["#fbefc9", "#f1da9c"], ground: "#9cb565", fx: "fireflies", n: 12, sun: [912, 96, 36], draw: function () {
      sunflower(90, 548, 170); sunflower(170, 548, 130); stemFlower(240, 548, 60, "#fbf6ea"); sprig(290, 548, 80);
      stemFlower(730, 548, 70, "#f2b6c0"); sunflower(820, 548, 150); sprig(890, 548, 90); sunflower(960, 548, 180); } },
    litha: { bg: ["#fcecc0", "#f3d48c"], ground: "#9cb565", fx: "fireflies", n: 12, sun: [120, 110, 48], draw: function () {
      topGarland("herbs"); sunflower(120, 548, 130); candle(210, 548, 22, 70); sprig(270, 548, 90); stemFlower(310, 548, 60, "#fbf6ea");
      sunflower(760, 548, 160); sprig(840, 548, 100, "#7d9a4a"); candle(910, 548, 22, 86); sunflower(980, 548, 120); } },
    july4: { bg: ["#34465a", "#c98f62"], ground: "#4e6b3a", fx: "fireflies", n: 14, ink: "rgba(245,230,200,.55)", stars: 40, draw: function () {
      firework(150, 120, 56, "#f3e6c8"); firework(880, 110, 60, "#c0584a"); firework(780, 210, 38, "#a9c2e0"); firework(250, 230, 36, "#e9c46a");
      for (var i = 0; i < 5; i++) stemFlower(60 + i * 40, 548, 40 + rnd() * 40, ["#fbf6ea", "#c0584a", "#a9c2e0"][i % 3]);
      for (var j = 0; j < 5; j++) stemFlower(780 + j * 44, 548, 40 + rnd() * 40, ["#a9c2e0", "#fbf6ea", "#c0584a"][j % 3]); } }
  };
  function drawSeasons(sc) {
    var L = LOOKS[sc.look] || LOOKS.autumn;
    seed = 7 + sc.look.length * 131;
    paper(L.bg[0], L.bg[1], 320);
    if (L.stars) stars(L.stars);
    if (L.sun) sun(L.sun[0], L.sun[1], L.sun[2]);
    if (L.moon) moon(L.moon[0], L.moon[1], L.moon[2], L.moon[3] ? 0.5 : sc.phase, true);
    hill(GY + 8, 10, L.ground, L.ink || INK, 5);
    L.draw();
    frame(L.ink);
    return L;
  }
  function buildSeasons(now) {
    var sc = sceneFor(now), L = drawSeasons(sc);
    root.setAttribute("data-dark", L.ink ? "1" : "0");
    var card = el("div", { "class": "ptv-scard" }, layer);
    el("div", { "class": "ptv-kicker", text: sc.kicker }, card);
    el("div", { "class": "ptv-title", text: sc.title }, card);
    el("div", { "class": "ptv-sub", text: sc.sub }, card);
    clockEls.push(el("div", { "class": "ptv-sclock" }, card));
    dateEls.push(el("div", { "class": "ptv-sdate" }, card));
    if (sc.next) el("div", { "class": "ptv-next", text: sc.next }, card);
    el("div", { "class": "ptv-foot", text: "\u2661 puppy tv \u00B7 nothing on yet" }, layer);
    particles(fx, L.fx, L.n); flameGlows(fx);
    lastScene = sc;
  }

  // ---------- nature: a little landscape that follows the time of day ----------
  function skyAt(h, sr, ss) {
    var K = { night: ["#101b34", "#2b3b5e"], dawn: ["#8fa2d2", "#f6c3a0"], day: ["#86c0e6", "#e2f1f6"], dusk: ["#6c78ae", "#f2a06a"] };
    function lerp(a, b, t) { t = Math.max(0, Math.min(1, t)); return [mix(K[a][0], K[b][0], t), mix(K[a][1], K[b][1], t)]; }
    if (h < sr - 1.2) return { c: K.night, light: 0, name: "night" };
    if (h < sr + 0.2) return { c: lerp("night", "dawn", (h - sr + 1.2) / 1.4), light: (h - sr + 1.2) / 2.8, name: "dawn" };
    if (h < sr + 1.4) return { c: lerp("dawn", "day", (h - sr - 0.2) / 1.2), light: 0.5 + (h - sr - 0.2) / 2.4, name: "morning" };
    if (h < ss - 1.4) return { c: K.day, light: 1, name: "day" };
    if (h < ss - 0.1) return { c: lerp("day", "dusk", (h - ss + 1.4) / 1.3), light: 1 - (h - ss + 1.4) / 2.6, name: "golden hour" };
    if (h < ss + 1.1) return { c: lerp("dusk", "night", (h - ss + 0.1) / 1.2), light: 0.5 - (h - ss + 0.1) / 2.4, name: "dusk" };
    return { c: K.night, light: 0, name: "night" };
  }
  function buildNature(now) {
    var h = now.getHours() + now.getMinutes() / 60, doy = dayOfYear(now), cs = Math.cos(2 * Math.PI * (doy - 172) / 365);
    var sr = 6.4 - 1.1 * cs, ss = 18.6 + 2.0 * cs, sky = skyAt(h, sr, ss), lt = Math.max(0, Math.min(1, sky.light));
    var mo = now.getMonth(), season = mo === 11 || mo <= 1 ? "winter" : mo <= 4 ? "spring" : mo <= 7 ? "summer" : "autumn";
    seed = 4242;
    C.fillStyle = grad(0, H * .75, sky.c); C.fillRect(0, 0, W, H);
    if (lt < 0.6) { var sa = (0.6 - lt) / 0.6; for (var i = 0; i < 90; i++) { C.fillStyle = "rgba(255,248,225," + (sa * (0.35 + rnd() * .65)).toFixed(2) + ")"; C.beginPath(); C.arc(rnd() * W, rnd() * 300, .7 + rnd() * 1.5, 0, 7); C.fill(); } }
    if (h > sr - 0.6 && h < ss + 0.6) {   // sun arc
      var t = (h - sr) / (ss - sr), sx = 90 + t * (W - 180), sy = 360 - Math.sin(Math.PI * Math.max(0, Math.min(1, t))) * 290;
      sun(sx, sy, 30);
    } else {   // moon arc through the night
      var nl = 24 - (ss - sr), tn = ((h - ss + 24) % 24) / nl, mx = 90 + tn * (W - 180), my = 330 - Math.sin(Math.PI * Math.max(0, Math.min(1, tn))) * 250;
      moon(mx, my, 26, moonPhase(now), true);
    }
    if (lt > 0.3) { seed = 99; for (var c = 0; c < 3; c++) { var cx = 120 + c * 330 + jit(60), cy = 110 + jit(30), a = "rgba(255,255,255," + (0.55 * lt).toFixed(2) + ")"; blob(cx, cy, 60, 16, a, null); blob(cx + 30, cy - 12, 34, 18, a, null); blob(cx - 28, cy - 6, 28, 14, a, null); } }
    var night = "#1d2740", dim = 1 - (0.25 + 0.75 * lt);
    var P = { spring: ["#a9c99a", "#8dbb6e", "#77a85a", ["#f2b6c0", "#fbe3e6", "#9cc47a"]], summer: ["#9cb8a0", "#7fa860", "#6a9a4a", ["#5f8f3f", "#6f9e4f", "#4f7a3a"]],
      autumn: ["#b9b394", "#c9a25a", "#a8843f", ["#c9853f", "#b5652e", "#d9a441", "#8e9a4a"]], winter: ["#cfd8dc", "#e9eef0", "#f4f6f6", ["#4f7a4a", "#5f856a"]] }[season];
    function tone(col) { return mix(col, night, dim * .8); }
    var ink = "rgba(60,50,40," + (0.35 + 0.35 * lt).toFixed(2) + ")";
    seed = 777;
    hill(300, 26, tone(P[0]), ink, 5);
    hill(360, 30, tone(P[1]), ink, 4);
    // lake
    hill(430, 22, tone(P[2]), ink, 3);
    blob(560, 500, 220, 30, tone(mix(sky.c[1], "#7fa7b8", .35)), ink, .03, 0, 18);
    for (var r = 0; r < 4; r++) wline([[430 + r * 60, 494 + r * 7], [480 + r * 60, 494 + r * 7]], "rgba(255,255,255," + (0.25 + 0.3 * lt).toFixed(2) + ")", 2, .4);
    // trees
    function tree(x, y, s) {
      if (season === "winter") { evergreen(x, y, s * 2.2, true); return; }
      wline([[x, y], [x, y - s * .9]], tone("#6b4a2a"), 4, .4);
      blob(x, y - s * 1.2, s * .6, s * .55, tone(P[3][Math.floor(rnd() * P[3].length)]), ink);
      blob(x + s * .25, y - s * 1.45, s * .4, s * .38, tone(P[3][Math.floor(rnd() * P[3].length)]), ink);
    }
    seed = 31;
    [[70, 470, 60], [140, 455, 46], [210, 480, 52], [880, 470, 56], [950, 450, 70], [330, 380, 26], [380, 372, 22], [760, 378, 24]].forEach(function (t) { tree(t[0], t[1], t[2]); });
    if (season === "spring" || season === "summer") for (var f = 0; f < 18; f++) flower(260 + rnd() * 120 + (f % 2 ? 480 : 0), 520 + rnd() * 40, 4, tone(["#fbf6ea", "#f2b6c0", "#f6d98a"][f % 3]), tone("#e7b440"));
    if (lt < 0.25 && season === "summer") particles(fx, "fireflies", 12);
    if (season === "winter") particles(fx, "snow", 18);
    if (season === "autumn") particles(fx, "leaves", 8);
    root.setAttribute("data-dark", lt < 0.45 ? "1" : "0");
    var top = el("div", { "class": "ptv-ntop" }, layer);
    clockEls.push(el("div", { "class": "ptv-nclock" }, top));
    dateEls.push(el("div", { "class": "ptv-ndate" }, top));
    el("div", { "class": "ptv-foot", text: "\u2661 puppy tv \u00B7 " + sky.name + " \u00B7 nothing on yet" }, layer);
  }

  // ---------- retro tv ----------
  function buildRetro() {
    var bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"], bw = W / 7;
    bars.forEach(function (c, i) { C.fillStyle = c; C.fillRect(i * bw, 0, bw + 1, H * .67); });
    ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"].forEach(function (c, i) { C.fillStyle = c; C.fillRect(i * bw, H * .67, bw + 1, H * .08); });
    ["#00214c", "#ffffff", "#32006a", "#131313", "#090909", "#131313", "#1d1d1d"].forEach(function (c, i) { C.fillStyle = c; C.fillRect(i * W / 7 * (i < 4 ? 1.25 : 1) - (i >= 4 ? -(W / 7 * .75) * 0 : 0), H * .75, W / 7 * 1.25 + 1, H * .25); });
    C.fillStyle = "#131313"; C.fillRect(W * 5 / 7, H * .75, W * 2 / 7, H * .25);
    el("div", { "class": "ptv-scan" }, fx);
    var b = el("div", { "class": "ptv-rbox" }, layer);
    el("div", { "class": "ptv-rbig", text: "PLEASE STAND BY \u2661" }, b);
    el("div", { "class": "ptv-rsmall", text: "puppy tv (\u1422\u2022\u1D25\u2022\u1422)" }, b);
    clockEls.push(el("div", { "class": "ptv-rclock" }, b));
  }

  // ---------- win98 ----------
  function icon98(x, y, kind, label) {
    seed = 5;
    if (kind === "tv") { C.fillStyle = "#c0c0c0"; C.fillRect(x, y, 44, 34); C.fillStyle = "#000"; C.fillRect(x + 4, y + 4, 36, 24); C.fillStyle = "#ffd6e7"; C.fillRect(x + 6, y + 6, 32, 20); C.fillStyle = "#5a2340"; C.fillRect(x + 18, y + 12, 3, 3); C.fillRect(x + 24, y + 12, 3, 3); C.fillRect(x + 20, y + 18, 6, 2); C.fillStyle = "#808080"; C.fillRect(x + 14, y + 34, 16, 4); }
    else if (kind === "folder") { C.fillStyle = "#e8c04a"; C.fillRect(x, y + 6, 44, 30); C.fillRect(x, y + 2, 18, 6); C.fillStyle = "#c79a20"; C.fillRect(x, y + 34, 44, 2); }
    else { C.fillStyle = "#dfdfdf"; C.fillRect(x + 8, y + 4, 28, 34); C.fillStyle = "#808080"; for (var i = 0; i < 4; i++) C.fillRect(x + 12 + i * 6, y + 8, 2, 26); C.fillStyle = "#606060"; C.fillRect(x + 4, y, 36, 4); }
    C.font = "14px Tahoma, 'MS Sans Serif', sans-serif"; C.textAlign = "center"; C.fillStyle = "#ffffff"; C.fillText(label, x + 22, y + 56);
  }
  function buildWin98() {
    C.fillStyle = "#008080"; C.fillRect(0, 0, W, H);
    icon98(28, 24, "tv", "puppy tv"); icon98(28, 110, "folder", "My Pads"); icon98(28, 196, "bin", "Recycle Bin");
    var win = el("div", { "class": "w98 w98-win" }, layer);
    var bar = el("div", { "class": "w98-bar" }, win);
    el("span", { text: "\u2661 puppy tv.exe" }, bar);
    var btns = el("span", { "class": "w98-btns" }, bar);
    ["_", "\u25A1", "\u00D7"].forEach(function (t) { el("span", { "class": "w98 w98-b", text: t }, btns); });
    var body = el("div", { "class": "w98-body" }, win);
    el("div", { "class": "w98-face", text: "(\u1422\u2022\u1D25\u2022\u1422)" }, body);
    var tx = el("div", { "class": "w98-text" }, body);
    el("div", { text: "puppy tv is on standby." }, tx);
    el("div", { text: "nothing on yet \u2661 touch the tv to pick something." }, tx);
    clockEls.push(el("div", { "class": "w98-clock" }, tx));
    el("div", { "class": "w98 w98-ok", text: "OK" }, el("div", { "class": "w98-row" }, win));
    var task = el("div", { "class": "w98 w98-task" }, layer);
    el("span", { "class": "w98 w98-start", text: "\u2756 Start" }, task);
    el("span", { "class": "w98-item", text: "\u2661 puppy tv.exe" }, task);
    clockEls.push(el("span", { "class": "w98-tray" }, task));
  }

  // ---------- minimal ----------
  function buildMinimal() {
    C.fillStyle = "#0b0b0c"; C.fillRect(0, 0, W, H);
    var m = el("div", { "class": "ptv-min" }, layer);
    clockEls.push(el("div", { "class": "ptv-mclock" }, m));
    dateEls.push(el("div", { "class": "ptv-mdate" }, m));
    el("div", { "class": "ptv-foot", text: "puppy tv" }, layer);
  }

  // ---------- puppy pink (the original) ----------
  function buildPink() {
    C.fillStyle = "#ffd6e7"; C.fillRect(0, 0, W, H);
    var wrap = el("div", { "class": "ptv-pwrap" }, layer);
    var card = el("div", { "class": "card" }, wrap);
    el("div", { "class": "big", text: "\u2661 puppy tv \u2661" }, card);
    el("div", { "class": "small", text: "nothing on yet (\u1422\u2022\u1D25\u2022\u1422)" }, card);
    clockEls.push(el("div", { id: "ptv-clock" }, card));
  }

  // ---------- switching + ticking ----------
  var idle = el("div", { id: "ptv-idle" }, root);
  var box = el("div", { id: "ptv-box" }, idle);
  var cv = el("canvas", { id: "ptv-canvas", width: String(W), height: String(H) }, box);
  var fx = el("div", { id: "ptv-fx" }, box);
  var layer = el("div", { id: "ptv-layer" }, box);
  C = cv.getContext("2d");
  var clockEls = [], dateEls = [], curSig = "", curTheme = "", lastScene = null;
  function fit() {
    var w = window.innerWidth || 1024, h = window.innerHeight || 576, s = Math.max(w / W, h / H);
    box.style.transform = "translate(" + ((w - W * s) / 2).toFixed(1) + "px," + ((h - H * s) / 2).toFixed(1) + "px) scale(" + s.toFixed(4) + ")";
  }
  window.addEventListener("resize", fit); fit();
  function wantedTheme() { return themeName(Q.theme || (S && S.theme) || CFG.theme || "pink"); }
  function drawTheme(t, now) {
    layer.textContent = ""; fx.textContent = ""; clockEls = []; dateEls = []; flames = [];
    C.setTransform(1, 0, 0, 1, 0, 0); C.clearRect(0, 0, W, H);
    root.className = "t-" + t; root.setAttribute("data-dark", "0");
    if (t === "nature") buildNature(now);
    else if (t === "seasons") buildSeasons(now);
    else if (t === "retro") buildRetro();
    else if (t === "win98") buildWin98();
    else if (t === "minimal") buildMinimal();
    else buildPink();
    curTheme = t;
  }
  function tickIdle(force) {
    var t = wantedTheme();
    if (t !== curTheme) root.className = "t-" + t;   // tap/badge/messages follow the theme even during a video
    if (idle.style.display === "none" && !force) return;
    var now = viewNow();
    var sig = t + "|" + (t === "nature" ? ymd(now) + "|" + Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) : t === "seasons" ? ymd(now) : "");
    if (sig !== curSig || force) { curSig = sig; drawTheme(t, now); }
    var ts = fmtTime(now), ds = fmtDate(now);
    clockEls.forEach(function (e) {
      if (!e._t) { e.textContent = ""; e._t = el("span", null, e); el("span", { "class": "ptv-slt", text: "SLT" }, e); }
      if (e._t.textContent !== ts) e._t.textContent = ts;
    });
    dateEls.forEach(function (e) { if (e.textContent !== ds) e.textContent = ds; });
  }

  var tap = el("div", { id: "ptv-tap" }, root);
  var tapText = el("span", { text: "\u2661 tap to join \u2661" }, tap);
  var badge = el("div", { id: "ptv-badge", text: "\u275A\u275A paused" }, root);
  var msg = el("div", { id: "ptv-msg" }, root);
  var dbg = el("div", { id: "ptv-dbg" }, root);
  if (DEBUG) dbg.style.display = "block";

  function showMsg(t, ms) {
    msg.textContent = t;
    msg.style.display = "block";
    clearTimeout(showMsg._t);
    if (ms) showMsg._t = setTimeout(function () { msg.style.display = "none"; }, ms);
  }
  function hideMsg() { msg.style.display = "none"; }

  // ---------- server clock ----------
  // offset = serverMs - Date.now(); keep the sample with the smallest round trip.
  var clockSamples = [];
  var clockOffset = null;
  function addClockSample(serverMs, t0, t1) {
    var rtt = t1 - t0;
    clockSamples.push({ off: serverMs - (t0 + rtt / 2), rtt: rtt });
    if (clockSamples.length > 12) clockSamples.shift();
    var best = clockSamples[0];
    for (var i = 1; i < clockSamples.length; i++) if (clockSamples[i].rtt < best.rtt) best = clockSamples[i];
    clockOffset = best.off;
  }
  function serverNow() { return Date.now() + (clockOffset || 0); }

  // ---------- state ----------
  var S = null;          // last state from the TV
  var loadedV = -1;      // state version we last applied
  var loadedSrc = null;  // src the current adapter plays
  var player = null;     // current adapter
  var reportedDurFor = null;
  var reportedErrFor = null;

  function targetSec() {
    if (!S) return 0;
    var pos = S.pos;
    if (S.playing) {
      var anchor = S.as * 1000 + S.am;
      pos = pos + (serverNow() - anchor);
    }
    if (S.dur > 0 && pos > S.dur) pos = S.dur;
    return Math.max(0, pos / 1000);
  }

  function post(body) {
    try {
      fetch(reportUrl(), { method: "POST", body: body, cache: "no-store", headers: { "Content-Type": "text/plain" } })
        .catch(function () {});
    } catch (e) {}
  }

  function poll() {
    var t0 = Date.now();
    fetch(stateUrl() + (stateUrl().indexOf("?") >= 0 ? "&" : "?") + "_=" + t0, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (s) {
        var t1 = Date.now();
        addClockSample(s.ns * 1000 + s.nm, t0, t1);
        S = s;
        if (msg.dataset && msg.dataset.net) { hideMsg(); msg.dataset.net = ""; }
        apply();
      })
      .catch(function (e) {
        showMsg("can't reach the tv right now... retrying \u2727 (" + e.message + ")");
        if (msg.dataset) msg.dataset.net = "1";
      })
      .then(function () {
        setTimeout(poll, S && S.playing ? POLL_PLAYING_MS : POLL_IDLE_MS);
      });
  }

  // ---------- what kind of link is it? ----------
  function ytId(u) {
    var m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function vimeoId(u) {
    var m = u.match(/vimeo\.com\/(?:video\/|channels\/[^\/]+\/|groups\/[^\/]+\/videos\/)?(\d+)/);
    return m ? m[1] : null;
  }
  function kindOf(u) {
    if (ytId(u)) return "yt";
    if (vimeoId(u)) return "vimeo";
    if (/\.m3u8(\?|#|$)/i.test(u)) return "hls";
    return "file";
  }

  // ---------- script loader ----------
  var loadedScripts = {};
  function loadScript(src) {
    if (loadedScripts[src]) return loadedScripts[src];
    loadedScripts[src] = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = res;
      s.onerror = function () { rej(new Error("could not load " + src)); };
      (document.head || document.body).appendChild(s);
    });
    return loadedScripts[src];
  }

  // ---------- "tap to join / tap for sound" ----------
  var tapAction = null;
  function needTap(text, action) {
    tapText.textContent = text;
    tapAction = action;
    tap.style.display = "flex";
  }
  tap.addEventListener("click", function () {
    tap.style.display = "none";
    var a = tapAction; tapAction = null;
    if (a) a();
  });

  // ================= adapters =================
  // Each adapter: time() sec, seek(sec), play(), pause(), playing(), duration() sec|0|Infinity,
  //               setRate(r) (optional), destroy(), hardSeekSec, softSync

  // ---- plain video files (mp4 / webm / ogg) and HLS ----
  function FileAdapter(src, isHls) {
    var v = el("video", { playsinline: "", preload: "auto" }, stage);
    v.setAttribute("crossorigin", "anonymous");
    var self = this;
    var hls = null;
    this.hardSeekSec = 1.0;
    this.softSync = true;
    this.live = false;
    function attach() {
      if (isHls && !(v.canPlayType("application/vnd.apple.mpegurl"))) {
        return loadScript("https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js").then(function () {
          hls = new window.Hls({ lowLatencyMode: true });
          hls.loadSource(src);
          hls.attachMedia(v);
        });
      }
      v.removeAttribute("crossorigin"); // many file hosts don't send CORS headers; we don't need them
      v.src = src;
      return Promise.resolve();
    }
    this.ready = attach();
    v.addEventListener("error", function () {
      onPlayerError("this video file won't play here (" + (v.error ? "code " + v.error.code : "?") + ")");
    });
    this.time = function () { return v.currentTime || 0; };
    this.seek = function (t) { try { v.currentTime = t; } catch (e) {} };
    this.play = function () {
      var p = v.play();
      if (p && p.catch) p.catch(function (err) {
        if (err && err.name === "NotAllowedError") {
          v.muted = true;
          v.play().catch(function () {});
          needTap("\u2661 tap for sound \u2661", function () { v.muted = false; v.play().catch(function () {}); });
        }
      });
    };
    this.pause = function () { v.pause(); };
    this.playing = function () { return !v.paused && !v.ended; };
    this.duration = function () {
      var d = v.duration;
      if (d === Infinity) { self.live = true; return Infinity; }
      return isFinite(d) ? d : 0;
    };
    this.setRate = function (r) { if (v.playbackRate !== r) v.playbackRate = r; };
    this.destroy = function () {
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}
      if (hls) try { hls.destroy(); } catch (e) {}
      v.remove();
    };
  }

  // ---- YouTube (IFrame Player API) ----
  var ytApi = null;
  function loadYT() {
    if (ytApi) return ytApi;
    ytApi = new Promise(function (res) {
      if (window.YT && window.YT.Player) return res();
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (prev) prev(); res(); };
      loadScript("https://www.youtube.com/iframe_api").catch(function () {
        onPlayerError("couldn't load the YouTube player");
      });
    });
    return ytApi;
  }
  function YTAdapter(src, startSec) {
    var id = ytId(src);
    var holder = el("div", null, stage);
    var target = el("div", null, holder);
    var p = null, isReady = false, self = this;
    this.hardSeekSec = 0.7;   // 3 s cooldown between seeks stops seek loops
    this.seekLead = 0.4;      // YouTube needs a moment to buffer after a seek
    this.softSync = false;    // YouTube only has coarse speed steps
    this.ready = loadYT().then(function () {
      return new Promise(function (res) {
        p = new window.YT.Player(target, {
          host: CFG.ytHost || "https://www.youtube-nocookie.com",
          videoId: id,
          width: "100%", height: "100%",
          playerVars: {
            autoplay: 1, controls: 0, disablekb: 1, rel: 0, playsinline: 1,
            iv_load_policy: 3, fs: 0, start: Math.floor(startSec || 0),
            origin: location.origin, enablejsapi: 1
          },
          events: {
            onReady: function () { isReady = true; res(); },
            onError: function (e) {
              var why = { 2: "bad video id", 5: "html5 player error", 100: "video removed or private",
                101: "the owner doesn't allow embedding", 150: "the owner doesn't allow embedding",
                153: "YouTube player config error (153)" }[e.data] || ("error " + e.data);
              onPlayerError("YouTube says: " + why);
            }
          }
        });
        var ifr = holder.querySelector("iframe");
        if (ifr) ifr.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      });
    });
    this.time = function () { return isReady && p.getCurrentTime ? (p.getCurrentTime() || 0) : 0; };
    this.seek = function (t) { if (isReady) p.seekTo(t, true); };
    this.play = function () {
      if (!isReady) return;
      p.playVideo();
      clearTimeout(self._chk);
      self._chk = setTimeout(function () {
        var st = p.getPlayerState ? p.getPlayerState() : -1;
        if (S && S.playing && st !== 1 && st !== 3) {
          // autoplay was blocked: play muted so the picture stays in sync, ask for a tap for sound
          p.mute(); p.playVideo();
          needTap("\u2661 tap for sound \u2661", function () { p.unMute(); p.playVideo(); });
        }
      }, 2500);
    };
    this.pause = function () { if (isReady) p.pauseVideo(); };
    this.playing = function () { return isReady && p.getPlayerState && p.getPlayerState() === 1; };
    this.duration = function () { return isReady && p.getDuration ? (p.getDuration() || 0) : 0; };
    this.destroy = function () { clearTimeout(self._chk); try { p && p.destroy(); } catch (e) {} holder.remove(); };
  }

  // ---- Vimeo (Player SDK) ----
  function VimeoAdapter(src) {
    var holder = el("div", null, stage);
    var p = null, isReady = false, self = this;
    var lastT = 0, lastAt = Date.now(), isPlaying = false, dur = 0;
    this.hardSeekSec = 1.2;
    this.softSync = true;
    this.ready = loadScript("https://player.vimeo.com/api/player.js").then(function () {
      p = new window.Vimeo.Player(holder, {
        url: src, autoplay: false, controls: false, dnt: true, title: false,
        byline: false, portrait: false, keyboard: false, playsinline: true
      });
      p.on("timeupdate", function (d) { lastT = d.seconds; lastAt = Date.now(); dur = d.duration || dur; });
      p.on("play", function () { isPlaying = true; });
      p.on("pause", function () { isPlaying = false; });
      p.on("ended", function () { isPlaying = false; });
      p.on("error", function (e) { onPlayerError("Vimeo says: " + (e && e.message || "error")); });
      return p.ready().then(function () {
        isReady = true;
        return p.getDuration().then(function (d) { dur = d; });
      });
    });
    this.time = function () { return lastT + (isPlaying ? (Date.now() - lastAt) / 1000 : 0); };
    this.seek = function (t) { if (isReady) { lastT = t; lastAt = Date.now(); p.setCurrentTime(t).catch(function () {}); } };
    this.play = function () {
      if (!isReady) return;
      p.play().catch(function (err) {
        if (err && err.name === "NotAllowedError") {
          p.setMuted(true).then(function () { return p.play(); }).catch(function () {});
          needTap("\u2661 tap for sound \u2661", function () { p.setMuted(false); p.play().catch(function () {}); });
        }
      });
    };
    this.pause = function () { if (isReady) p.pause().catch(function () {}); };
    this.playing = function () { return isPlaying; };
    this.duration = function () { return dur || 0; };
    this.setRate = function (r) { if (isReady && self._rate !== r) { self._rate = r; p.setPlaybackRate(r).catch(function () { self.softSync = false; }); } };
    this.destroy = function () { try { p && p.destroy(); } catch (e) {} holder.remove(); };
  }

  function onPlayerError(text) {
    showMsg("(\u2565\uFE4F\u2565) " + text);
    if (S && reportedErrFor !== S.v) {
      reportedErrFor = S.v;
      post("err|" + S.v + "|" + String(text).replace(/\|/g, "/").slice(0, 200));
    }
  }

  // ---------- apply state ----------
  var lastSeekAt = 0;
  function apply() {
    if (!S) return;
    var src = S.mode === "sync" ? (S.src || "") : "";
    if (src !== loadedSrc) {
      if (player) { player.destroy(); player = null; }
      tap.style.display = "none";
      hideMsg();
      loadedSrc = src;
      reportedDurFor = null;
      if (src) {
        var k = kindOf(src);
        if (k === "yt") player = new YTAdapter(src, targetSec());
        else if (k === "vimeo") player = new VimeoAdapter(src);
        else player = new FileAdapter(src, k === "hls");
        var mine = player;
        player.ready.then(function () { if (mine === player) { syncNow(true); } })
          .catch(function (e) { onPlayerError(e.message); });
      }
    }
    idle.style.display = src ? "none" : "block";
    tickIdle();
    badge.style.display = src && !S.playing ? "block" : "none";
    if (S.title) badge.textContent = "\u275A\u275A paused \u00B7 " + S.title;
    else badge.textContent = "\u275A\u275A paused";
    if (loadedV !== S.v) { loadedV = S.v; syncNow(true); }
  }

  // Bring the local player to where it should be.
  function syncNow(force) {
    if (!player || !S || !S.src) return;
    var want = targetSec();
    var dur = player.duration();

    // tell the TV how long the video is (once per version) so it can auto-advance
    if (dur > 0 && isFinite(dur) && !S.dur && reportedDurFor !== S.v) {
      reportedDurFor = S.v;
      post("dur|" + S.v + "|" + Math.round(dur * 1000));
    }

    var live = dur === Infinity || player.live;
    if (S.playing) {
      if (!player.playing()) player.play();
    } else {
      if (player.playing()) player.pause();
    }
    if (live) return; // live streams: everyone is at the live edge already

    var have = player.time();
    var drift = want - have; // + means we're behind
    var now = Date.now();
    if (Math.abs(drift) > player.hardSeekSec || (force && Math.abs(drift) > 0.3)) {
      if (force || now - lastSeekAt > 3000) {
        player.seek(want + (S.playing ? (player.seekLead || 0.15) : 0)); // small lead to cover the seek itself
        lastSeekAt = now;
        if (player.setRate) player.setRate(1);
      }
    } else if (S.playing && player.softSync && player.setRate) {
      // gentle speed nudge: up to ±8%, so small drift fades without a visible jump
      var r = Math.abs(drift) < 0.08 ? 1 : 1 + Math.max(-0.08, Math.min(0.08, drift * 0.5));
      player.setRate(Math.round(r * 100) / 100);
    }

    if (DEBUG) {
      dbg.textContent = "v" + S.v + " " + (S.playing ? "play" : "pause") +
        "\nwant " + want.toFixed(2) + "\nhave " + have.toFixed(2) +
        "\ndrift " + drift.toFixed(2) + "\nclock " + (clockOffset || 0).toFixed(0) + "ms" +
        "\nrtt " + (clockSamples.length ? Math.min.apply(null, clockSamples.map(function (c) { return c.rtt; })) : 0) + "ms";
    }
  }

  setInterval(function () { syncNow(false); }, TICK_MS);
  setInterval(function () { tickIdle(false); }, 1000);
  tickIdle(true);

  // expose a little for testing
  window.PUPPYTV = { state: function () { return S; }, target: targetSec, player: function () { return player; }, kindOf: kindOf, ytId: ytId, vimeoId: vimeoId,
    theme: function () { return curTheme; }, scene: function () { return lastScene || sceneFor(viewNow()); }, now: viewNow, redraw: function () { tickIdle(true); } };

  poll();
})();
