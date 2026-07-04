/*
 * Sequences time runtime v1 — host-owned speed ramping (time remapping).
 *
 * Reads the `sequences-time` JSON island (piecewise-linear warp knots solved
 * by the host; this file never duplicates solver logic) and wraps the content
 * timeline in a paused master of equal duration. The master's single
 * ease:"none" proxy tween seeks the content timeline at warp(masterTime) in
 * onUpdate, so child time is a pure function of master position and every
 * frame renders identically regardless of seek order. If the island is absent
 * or empty, wrap() returns the content timeline unchanged — non-ramped films
 * are byte-identical in behavior.
 *
 * NOTE for future audio work: any soundtrack must be remapped through the
 * same warp knots, or picture and sound drift inside every dip.
 */
(function (global) {
  "use strict";

  var VERSION = 1;

  function readPlan() {
    var island = document.getElementById("sequences-time");
    if (!island) return null;
    var plan = JSON.parse(island.textContent || "{}");
    if (plan.version !== VERSION || !Array.isArray(plan.ramps)) {
      throw new Error("unsupported sequences time plan");
    }
    return plan;
  }

  // Piecewise-linear interpolation over [outputSec, contentSec] knots.
  // Identity outside every ramp window (net-zero guarantees continuity).
  function warp(ramps, t) {
    for (var i = 0; i < ramps.length; i += 1) {
      var knots = ramps[i].knots;
      if (!knots || knots.length < 2) continue;
      if (t <= knots[0][0] || t >= knots[knots.length - 1][0]) continue;
      for (var k = 1; k < knots.length; k += 1) {
        if (t <= knots[k][0]) {
          var a = knots[k - 1];
          var b = knots[k];
          var span = b[0] - a[0];
          var f = span > 0 ? (t - a[0]) / span : 0;
          return a[1] + (b[1] - a[1]) * f;
        }
      }
    }
    return t;
  }

  function wrap(tl) {
    if (!tl) throw new Error("SequencesTime.wrap requires the content timeline");
    var plan = readPlan();
    if (!plan || !plan.ramps.length) return tl;
    var duration = tl.duration();
    // The child must never be registered and must stay paused: the master is
    // the only driven timeline, and it renders the child exclusively through
    // this proxy so double-driving is impossible.
    tl.pause();
    var master = global.gsap.timeline({ paused: true });
    var proxy = { t: 0 };
    master.fromTo(proxy, { t: 0 }, {
      t: duration,
      duration: duration,
      ease: "none",
      immediateRender: false,
      onUpdate: function () {
        tl.seek(warp(plan.ramps, proxy.t), false);
      },
    }, 0);
    // QA introspection (tween boundaries live on the content timeline).
    master.__seqChild = tl;
    return master;
  }

  global.SequencesTime = Object.freeze({
    version: VERSION,
    wrap: wrap,
  });
})(window);
