(function (global) {
  "use strict";

  var VERSION = 1;

  // Style curve table. Exit/entry pairs are the two halves of one composite
  // ease (cut-catalog velocity matching): exit accelerates into the boundary,
  // the authored scene-window swap is the hard cut at peak velocity, entry
  // decelerates out of it in the same direction.
  var DIRECTIONS = {
    "cut-left": { axis: "x", sign: -1 },
    "cut-right": { axis: "x", sign: 1 },
    "cut-up": { axis: "y", sign: -1 },
    "cut-down": { axis: "y", sign: 1 },
  };

  // Canonical swipe axes (MD1). "left" = content travels left, incoming
  // enters from the right — identical mechanics to the legacy cut-left.
  var SWIPE_AXES = {
    left: { axis: "x", sign: -1, name: "left" },
    right: { axis: "x", sign: 1, name: "right" },
    up: { axis: "y", sign: -1, name: "up" },
    down: { axis: "y", sign: 1, name: "down" },
  };

  // Directional motion blur on swipes (the one seam that still read "CSS
  // slide"): a backdrop-filter lens in the overlay layer, the exact
  // makeWhipBlur shape from the camera runtime — NEVER a filter on a scene
  // wrapper, which can host a perspective'd orbit world.
  var SWIPE_BLUR_PX = 6;
  // The cover panel fully hides the frame for ~3 frames spanning the swap.
  var COVER_HOLD_SEC = 0.1;

  function sceneOf(root, id) {
    return root.querySelector('[data-scene="' + CSS.escape(id) + '"]');
  }

  function part(scene, name) {
    return scene.querySelector('[data-part="' + CSS.escape(name) + '"]');
  }

  function fail(cut, reason) {
    throw new Error('could not bind cut "' + cut.fromScene + '->' + cut.toScene + '": ' + reason);
  }

  function overlayLayer(root) {
    var layer = root.querySelector("[data-sequences-cut-layer]");
    if (layer) return layer;
    layer = document.createElement("div");
    layer.setAttribute("data-sequences-cut-layer", "");
    layer.setAttribute("data-layout-ignore", "");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText =
      "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2147482990";
    root.appendChild(layer);
    return layer;
  }

  function flashElement(root) {
    var layer = overlayLayer(root);
    var flash = document.createElement("div");
    flash.setAttribute("data-sequences-runtime-cut", "flash");
    flash.setAttribute("data-layout-ignore", "");
    flash.style.cssText = "position:absolute;inset:0;background:#fff;opacity:0";
    layer.appendChild(flash);
    return flash;
  }

  function bridgeElement(root, source) {
    var layer = overlayLayer(root);
    var bridge = source.cloneNode(true);
    bridge.removeAttribute("id");
    bridge.removeAttribute("data-part");
    bridge.setAttribute("data-sequences-runtime-cut", "bridge");
    bridge.setAttribute("data-layout-ignore", "");
    bridge.style.position = "absolute";
    bridge.style.left = "0";
    bridge.style.top = "0";
    bridge.style.margin = "0";
    bridge.style.pointerEvents = "none";
    bridge.style.opacity = "0";
    bridge.style.transformOrigin = "0 0";
    layer.appendChild(bridge);
    return bridge;
  }

  function localRect(root, element) {
    var rootRect = root.getBoundingClientRect();
    var rect = element.getBoundingClientRect();
    return {
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  // Every boundary tween states its from-value explicitly (fromTo with
  // immediateRender:false). QA and rendering seek frames out of order, and a
  // lazily-captured to() start value poisons the first out-of-order frame.
  function tween(timeline, target, fromVars, toVars, at) {
    toVars.immediateRender = false;
    timeline.fromTo(target, fromVars, toVars, at);
  }

  // A pointer-transparent backdrop lens inside the overlay layer; its
  // backdrop-filter smears everything painted beneath it (both scenes mid
  // swipe) while no world/scene element ever carries a CSS filter.
  function boundaryLens(root) {
    var layer = overlayLayer(root);
    var lens = document.createElement("div");
    lens.setAttribute("data-sequences-runtime-cut", "lens");
    lens.setAttribute("data-layout-ignore", "");
    lens.style.cssText = "position:absolute;inset:0;pointer-events:none";
    layer.appendChild(lens);
    var proxy = { b: 0 };
    return {
      proxy: proxy,
      apply: function () {
        var value = proxy.b > 0.05 ? "blur(" + proxy.b.toFixed(2) + "px)" : "";
        lens.style.backdropFilter = value;
        lens.style.webkitBackdropFilter = value;
      },
    };
  }

  function coverPanel(root) {
    var layer = overlayLayer(root);
    var panel = document.createElement("div");
    panel.setAttribute("data-sequences-runtime-cut", "cover");
    panel.setAttribute("data-layout-ignore", "");
    // Palette-derived: the accent custom property cascades from the authored
    // root tokens; the fallback keeps the wipe visible on token-less docs.
    panel.style.cssText =
      "position:absolute;inset:-2%;background:var(--accent,#5865f2);opacity:0";
    layer.appendChild(panel);
    return panel;
  }

  function bindDirectional(timeline, cut, from, to, root, direction) {
    var travel = cut.travelPx;
    var exitFrom = {};
    exitFrom[direction.axis] = 0;
    var exitTo = {};
    exitTo[direction.axis] = direction.sign * travel;
    exitTo.duration = cut.exitSec;
    exitTo.ease = "power4.in";
    tween(timeline, from, exitFrom, exitTo, cut.atSec - cut.exitSec);
    // The fade trick: the exit vanishes while still visibly accelerating, so
    // nothing has to reach the frame edge and no background gutter opens up.
    // power3.in keeps it visible for most of the travel and lets it die right
    // at the hard cut — an early death leaves dead air at the seam.
    tween(timeline, from, { opacity: 1 }, {
      opacity: 0,
      duration: cut.exitSec,
      ease: "power3.in",
    }, cut.atSec - cut.exitSec);
    var entryFrom = {};
    entryFrom[direction.axis] = -direction.sign * travel;
    var entryTo = {};
    entryTo[direction.axis] = 0;
    entryTo.duration = cut.entrySec;
    entryTo.ease = "power4.out";
    tween(timeline, to, entryFrom, entryTo, cut.atSec);
    tween(timeline, to, { opacity: 0.35 }, {
      opacity: 1,
      duration: cut.entrySec * 0.55,
      ease: "power2.out",
    }, cut.atSec);
    // Directional motion blur across the seam (§1.9): ramps 0 → SWIPE_BLUR_PX
    // → 0 over exit+entry on the backdrop lens, sine in/out, proxy-driven —
    // the exact makeWhipBlur shape, in the overlay layer.
    var lens = boundaryLens(root);
    tween(timeline, lens.proxy, { b: 0 }, {
      b: SWIPE_BLUR_PX,
      duration: cut.exitSec,
      ease: "sine.in",
      onUpdate: lens.apply,
    }, cut.atSec - cut.exitSec);
    tween(timeline, lens.proxy, { b: SWIPE_BLUR_PX }, {
      b: 0,
      duration: cut.entrySec,
      ease: "sine.out",
      onUpdate: lens.apply,
    }, cut.atSec);
    if (cut.cover) {
      // Natural-wipe variant: a palette panel sweeps the frame along the
      // travel axis, fully covering it for a few frames spanning the swap —
      // the invisible-cut mechanic. Pure transform+opacity on an overlay
      // child; the scene exit/entry tweens above are what the panel reveals.
      var panel = coverPanel(root);
      var prop = direction.axis === "x" ? "xPercent" : "yPercent";
      var hold = Math.min(COVER_HOLD_SEC, cut.exitSec * 0.5, cut.entrySec * 0.5);
      var enterFrom = {};
      enterFrom[prop] = -direction.sign * 110;
      var enterTo = {};
      enterTo[prop] = 0;
      enterTo.duration = Math.max(0.05, cut.exitSec - hold / 2);
      enterTo.ease = "power3.in";
      var exitFrom = {};
      exitFrom[prop] = 0;
      var exitTo = {};
      exitTo[prop] = direction.sign * 110;
      exitTo.duration = Math.max(0.05, cut.entrySec - hold / 2);
      exitTo.ease = "power3.out";
      timeline.set(panel, { opacity: 0 }, 0);
      timeline.set(panel, { opacity: 1 }, cut.atSec - cut.exitSec);
      tween(timeline, panel, enterFrom, enterTo, cut.atSec - cut.exitSec);
      tween(timeline, panel, exitFrom, exitTo, cut.atSec + hold / 2);
      timeline.set(panel, { opacity: 0 }, cut.atSec + cut.entrySec);
    }
  }

  function bindZoom(timeline, cut, from, to) {
    var inverse = cut.style === "inverse-zoom";
    var blur = 18;
    tween(timeline, from, { scale: 1, filter: "blur(0px)" }, {
      scale: inverse ? 0.84 : 1.18,
      filter: "blur(" + blur + "px)",
      duration: cut.exitSec,
      ease: "power3.in",
    }, cut.atSec - cut.exitSec);
    tween(timeline, from, { opacity: 1 }, {
      opacity: 0.15,
      duration: cut.exitSec,
      ease: "none",
    }, cut.atSec - cut.exitSec);
    tween(timeline, to, {
      scale: inverse ? 1.22 : 0.8,
      filter: "blur(" + blur + "px)",
      opacity: 0.15,
    }, {
      scale: 1,
      filter: "blur(0px)",
      opacity: 1,
      duration: cut.entrySec,
      ease: "expo.out",
    }, cut.atSec);
  }

  function bindFlash(timeline, cut, from, to, root) {
    var flash = flashElement(root);
    timeline.set(flash, { opacity: 0 }, 0);
    tween(timeline, from, { scale: 1 }, {
      scale: 1.05,
      duration: cut.exitSec,
      ease: "power3.in",
    }, cut.atSec - cut.exitSec);
    tween(timeline, flash, { opacity: 0 }, {
      opacity: 0.92,
      duration: Math.min(0.1, cut.exitSec),
      ease: "power2.in",
    }, cut.atSec - Math.min(0.1, cut.exitSec));
    tween(timeline, flash, { opacity: 0.92 }, {
      opacity: 0,
      duration: Math.min(0.26, cut.entrySec),
      ease: "power2.out",
    }, cut.atSec + 0.001);
    tween(timeline, to, { scale: 1.04 }, {
      scale: 1,
      duration: cut.entrySec,
      ease: "power3.out",
    }, cut.atSec);
  }

  function bindObjectMatch(timeline, cut, from, to, root) {
    var fromPart = part(from, cut.focalPartOut);
    var toPart = part(to, cut.focalPartIn);
    if (!fromPart) fail(cut, 'outgoing part "' + cut.focalPartOut + '" is absent');
    if (!toPart) fail(cut, 'incoming part "' + cut.focalPartIn + '" is absent');
    var bridge = bridgeElement(root, fromPart);
    var lead = Math.min(0.24, cut.exitSec);
    var start = cut.atSec - lead;
    var settle = cut.entrySec;
    var proxy = { p: 0 };
    var ease = global.gsap.parseEase("power3.inOut");
    global.gsap.set(bridge, { opacity: 0 });
    timeline.set(bridge, { opacity: 0 }, 0);
    // The real outgoing part hands its pixels to the bridge; the incoming part
    // stays hidden until the bridge lands on its measured geometry. Both rects
    // are measured live on every update, so authored motion inside either
    // scene cannot desynchronize the handoff, and every value is a pure
    // function of timeline time.
    timeline.set(fromPart, { opacity: 0 }, start);
    timeline.set(bridge, { opacity: 1 }, start);
    timeline.set(toPart, { opacity: 0 }, Math.max(0, start - 0.001));
    timeline.to(proxy, {
      p: 1,
      duration: lead + settle,
      ease: "none",
      onUpdate: function () {
        var a = localRect(root, fromPart);
        var b = localRect(root, toPart);
        var t = ease(proxy.p);
        var width = a.width + (b.width - a.width) * t;
        var height = a.height + (b.height - a.height) * t;
        global.gsap.set(bridge, {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          width: width,
          height: height,
        });
      },
    }, start);
    timeline.set(bridge, { opacity: 0 }, cut.atSec + settle);
    timeline.set(toPart, { opacity: 1 }, cut.atSec + settle);
    // Give the rest of the incoming scene the arriving energy of a soft entry
    // while the bridge carries the eye.
    tween(timeline, to, { opacity: 0.35 }, {
      opacity: 1,
      duration: settle,
      ease: "power2.out",
    }, cut.atSec);
  }

  // ------------------------------------------------------------ shape-match
  // A geometric bridge between two dissimilar silhouettes reads as a glitch,
  // so shape-match audits geometry at bind time and degrades the boundary to
  // zoom-through instead of flying a broken bridge. The audit is part of the
  // runtime compile step so QA and render run the identical decision.
  var SHAPE_ASPECT_LIMIT = 2.5;
  var SHAPE_NODE_CAP = 60;
  var SHAPE_MIN_ONFRAME = 0.5;

  // Border radius resolved to px against the element's own layout box, so a
  // "50%" circle and a "18px" card interpolate in one unit. Uses offset sizes
  // (transform-immune) for the % resolution.
  function radiusPx(element) {
    var raw = getComputedStyle(element).borderTopLeftRadius || "0px";
    var value = parseFloat(raw) || 0;
    if (raw.indexOf("%") !== -1) {
      value = (value / 100) *
        Math.min(element.offsetWidth || 1, element.offsetHeight || 1);
    }
    return value;
  }

  function shapeMatchAudit(root, fromPart, toPart) {
    var a = fromPart.getBoundingClientRect();
    var b = toPart.getBoundingClientRect();
    if (!a.width || !a.height || !b.width || !b.height) {
      return "a focal part measured zero size at bind time";
    }
    var aspectA = a.width / a.height;
    var aspectB = b.width / b.height;
    var ratio = Math.max(aspectA / aspectB, aspectB / aspectA);
    if (ratio > SHAPE_ASPECT_LIMIT) {
      return "focal silhouettes differ " + ratio.toFixed(1) +
        "x in aspect ratio (cap " + SHAPE_ASPECT_LIMIT + "x)";
    }
    // Bridges are live clones; a heavy subtree doubles paint cost for the
    // whole flight, twice.
    if (
      fromPart.querySelectorAll("*").length > SHAPE_NODE_CAP ||
      toPart.querySelectorAll("*").length > SHAPE_NODE_CAP
    ) {
      return "a focal part subtree exceeds " + SHAPE_NODE_CAP + " nodes";
    }
    // Static scenes only: a part inside a camera world is framed by the rig
    // (live measurement tracks it), so its static position proves nothing.
    var rootRect = root.getBoundingClientRect();
    var sides = [
      { rect: a, element: fromPart, label: "outgoing" },
      { rect: b, element: toPart, label: "incoming" },
    ];
    for (var i = 0; i < sides.length; i += 1) {
      if (sides[i].element.closest("[data-camera-world]")) continue;
      var r = sides[i].rect;
      var w = Math.max(0, Math.min(r.right, rootRect.right) - Math.max(r.left, rootRect.left));
      var h = Math.max(0, Math.min(r.bottom, rootRect.bottom) - Math.max(r.top, rootRect.top));
      if ((w * h) / (r.width * r.height) < SHAPE_MIN_ONFRAME) {
        return sides[i].label + " focal part is mostly outside the frame at bind time";
      }
    }
    return "";
  }

  // Dual-bridge crossfade: clones of BOTH parts fly the same interpolated
  // rect path (live per-frame measurement, so camera transforms on either
  // scene are tracked for free) while the destination's real pixels arrive
  // through a mid-flight crossfade instead of popping at landing.
  function bindShapeMatch(timeline, cut, from, to, root) {
    var fromPart = part(from, cut.focalPartOut);
    var toPart = part(to, cut.focalPartIn);
    if (!fromPart) fail(cut, 'outgoing part "' + cut.focalPartOut + '" is absent');
    if (!toPart) fail(cut, 'incoming part "' + cut.focalPartIn + '" is absent');
    var reason = shapeMatchAudit(root, fromPart, toPart);
    if (reason) {
      // Enhancement-never-veto (MD1 retarget): a degraded morph becomes a
      // swipe along the axis from the outgoing focal center to the incoming
      // focal center — the swipe still carries the eye where the morph
      // promised to take it, and the shipped film stays inside the
      // 3-transition language.
      var a = fromPart.getBoundingClientRect();
      var b = toPart.getBoundingClientRect();
      var dx = (b.left + b.width / 2) - (a.left + a.width / 2);
      var dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      var axisName;
      if (Math.abs(dx) >= Math.abs(dy)) axisName = dx >= 0 ? "left" : "right";
      else axisName = dy >= 0 ? "up" : "down";
      bindDirectional(timeline, cut, from, to, root, SWIPE_AXES[axisName]);
      return { degraded: true, reason: reason, target: "swipe-" + axisName };
    }
    // Echo garnish (MD2 §1.2): ghost clones trail the fast bridge flight,
    // AE-Echo style. Appended BEFORE the bridges so they paint beneath, and
    // evaluated inside the same per-frame onUpdate at ease(p − k·δ) — free of
    // new seeks, deterministic by construction, killed at flight end. This is
    // host-applied garnish on exactly this fast mover; it is NOT a planner
    // option.
    var ECHO_DELAYS = [0.06, 0.12];
    var ECHO_OPACITIES = [0.35, 0.18];
    var ghosts = [];
    for (var g = 0; g < ECHO_DELAYS.length; g += 1) {
      var ghost = bridgeElement(root, fromPart);
      ghost.setAttribute("data-sequences-runtime-cut", "echo");
      ghosts.push(ghost);
    }
    var bridgeA = bridgeElement(root, fromPart);
    var bridgeB = bridgeElement(root, toPart);
    var radiusA = radiusPx(fromPart);
    var radiusB = radiusPx(toPart);
    var lead = Math.min(0.24, cut.exitSec);
    var start = cut.atSec - lead;
    var settle = cut.entrySec;
    var total = lead + settle;
    var proxy = { p: 0 };
    var ease = global.gsap.parseEase("power3.inOut");
    global.gsap.set(bridgeA, { opacity: 0 });
    global.gsap.set(bridgeB, { opacity: 0 });
    timeline.set(bridgeA, { opacity: 0 }, 0);
    timeline.set(bridgeB, { opacity: 0 }, 0);
    for (var g0 = 0; g0 < ghosts.length; g0 += 1) {
      global.gsap.set(ghosts[g0], { opacity: 0 });
      timeline.set(ghosts[g0], { opacity: 0 }, 0);
      timeline.set(ghosts[g0], { opacity: ECHO_OPACITIES[g0] }, start);
      timeline.set(ghosts[g0], { opacity: 0 }, cut.atSec + settle);
    }
    timeline.set(fromPart, { opacity: 0 }, start);
    timeline.set(bridgeA, { opacity: 1 }, start);
    timeline.set(toPart, { opacity: 0 }, Math.max(0, start - 0.001));
    // The morph-twin overlap hoisted across the scene boundary: A dies while
    // B is already visible on the same flight path.
    tween(timeline, bridgeA, { opacity: 1 }, {
      opacity: 0,
      duration: total * 0.3,
      ease: "power2.in",
    }, start + total * 0.35);
    tween(timeline, bridgeB, { opacity: 0 }, {
      opacity: 1,
      duration: total * 0.3,
      ease: "power2.out",
    }, start + total * 0.35);
    timeline.to(proxy, {
      p: 1,
      duration: total,
      ease: "none",
      onUpdate: function () {
        var a = localRect(root, fromPart);
        var b = localRect(root, toPart);
        var t = ease(proxy.p);
        var vars = {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          width: a.width + (b.width - a.width) * t,
          height: a.height + (b.height - a.height) * t,
          borderRadius: (radiusA + (radiusB - radiusA) * t).toFixed(2) + "px",
        };
        global.gsap.set(bridgeA, vars);
        global.gsap.set(bridgeB, vars);
        // Echo ghosts ride the SAME interpolated path a beat behind — a pure
        // function of the same proxy, so out-of-order seek stays exact.
        for (var e = 0; e < ghosts.length; e += 1) {
          var tg = ease(Math.max(0, proxy.p - ECHO_DELAYS[e]));
          global.gsap.set(ghosts[e], {
            x: a.x + (b.x - a.x) * tg,
            y: a.y + (b.y - a.y) * tg,
            width: a.width + (b.width - a.width) * tg,
            height: a.height + (b.height - a.height) * tg,
            borderRadius: (radiusA + (radiusB - radiusA) * tg).toFixed(2) + "px",
          });
        }
      },
    }, start);
    timeline.set(bridgeA, { opacity: 0 }, cut.atSec + settle);
    timeline.set(bridgeB, { opacity: 0 }, cut.atSec + settle);
    timeline.set(toPart, { opacity: 1 }, cut.atSec + settle);
    tween(timeline, to, { opacity: 0.35 }, {
      opacity: 1,
      duration: settle,
      ease: "power2.out",
    }, cut.atSec);
    return { degraded: false };
  }

  function compile(timeline, root) {
    if (!timeline || !root) throw new Error("SequencesCuts.compile requires timeline + root");
    var island = document.getElementById("sequences-cuts");
    if (!island) return [];
    var plan = JSON.parse(island.textContent || "{}");
    if (plan.version !== VERSION || !Array.isArray(plan.cuts)) {
      throw new Error("unsupported sequences cut plan");
    }
    var bindings = [];
    plan.cuts.forEach(function (cut) {
      if (cut.style === "hard") return;
      var from = sceneOf(root, cut.fromScene);
      var to = sceneOf(root, cut.toScene);
      if (!from) fail(cut, "outgoing scene is absent");
      if (!to) fail(cut, "incoming scene is absent");
      var outcome;
      if (cut.style === "swipe") {
        bindDirectional(timeline, cut, from, to, root, SWIPE_AXES[cut.axis || "right"]);
      } else if (DIRECTIONS[cut.style]) {
        bindDirectional(timeline, cut, from, to, root, DIRECTIONS[cut.style]);
      } else if (cut.style === "zoom-through" || cut.style === "inverse-zoom") {
        bindZoom(timeline, cut, from, to);
      } else if (cut.style === "flash-white") {
        bindFlash(timeline, cut, from, to, root);
      } else if (cut.style === "match" || cut.style === "object-match") {
        bindObjectMatch(timeline, cut, from, to, root);
      } else if (cut.style === "morph" || cut.style === "shape-match") {
        outcome = bindShapeMatch(timeline, cut, from, to, root);
      } else {
        fail(cut, 'unsupported style "' + cut.style + '"');
      }
      var binding = { cut: cut, from: from, to: to };
      if (outcome && outcome.degraded) {
        binding.degraded = true;
        binding.reason = outcome.reason;
        binding.target = outcome.target || "zoom-through";
      }
      bindings.push(binding);
    });
    global.__sequencesCutBindings = bindings;
    return bindings;
  }

  global.SequencesCuts = Object.freeze({ version: VERSION, compile: compile });
})(window);
