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
  var css = el("style", null, document.head || document.body);
  css.textContent = [
    "html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}",
    "#sltv{position:fixed;inset:0;font-family:'Comic Sans MS','Trebuchet MS',sans-serif;color:#fff}",
    "#ptv-stage{position:absolute;inset:0;background:#000}",
    "#ptv-stage video,#ptv-stage iframe,#ptv-stage>div{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}",
    "#ptv-idle{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#ffd6e7;color:#5a2340;text-align:center}",
    "#ptv-idle .card{background:#fff;border:3px solid #5a2340;padding:28px 44px;box-shadow:6px 6px 0 #5a2340}",
    "#ptv-idle .big{font-size:64px;line-height:1.1}",
    "#ptv-idle .small{font-size:26px;margin-top:10px}",
    "#ptv-clock{font-size:30px;margin-top:18px}",
    "#ptv-tap{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.35);cursor:pointer}",
    "#ptv-tap span{background:#ffd6e7;color:#5a2340;border:3px solid #5a2340;box-shadow:5px 5px 0 #5a2340;font-size:40px;padding:18px 34px}",
    "#ptv-badge{position:absolute;left:18px;top:14px;display:none;background:#ffd6e7;color:#5a2340;border:2px solid #5a2340;font-size:26px;padding:4px 14px}",
    "#ptv-msg{position:absolute;left:0;right:0;bottom:0;display:none;background:rgba(90,35,64,.9);font-size:24px;padding:10px 16px}",
    "#ptv-dbg{position:absolute;right:8px;top:8px;display:none;background:rgba(0,0,0,.7);font:16px monospace;padding:6px 8px;white-space:pre}"
  ].join("\n");

  var stage = el("div", { id: "ptv-stage" }, root);
  var idle = el("div", { id: "ptv-idle" }, root);
  var card = el("div", { "class": "card" }, idle);
  el("div", { "class": "big", text: "\u2661 puppy tv \u2661" }, card);
  var idleSmall = el("div", { "class": "small", text: "nothing on yet (\u1422\u2022\u1D25\u2022\u1422)" }, card);
  var clockEl = el("div", { id: "ptv-clock" }, card);
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
    idle.style.display = src ? "none" : "flex";
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
  setInterval(function () {
    var d = new Date(serverNow());
    clockEl.textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, 1000);

  // expose a little for testing
  window.PUPPYTV = { state: function () { return S; }, target: targetSec, player: function () { return player; }, kindOf: kindOf, ytId: ytId, vimeoId: vimeoId };

  poll();
})();
