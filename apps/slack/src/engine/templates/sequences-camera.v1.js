(function (global) {
  "use strict";

  var VERSION = 1;

  // ---------------------------------------------------------------- eases
  // Curated motion-graphics curve library. Registered at script load so both
  // the camera compiler and authored GSAP beats can reference them by name.
  // Every function is pure, f(0)=0, f(1)=1 — deterministic under seek.
  var EASES = {
    // Controlled symmetric travel for operated pans and tracks. The old
    // quintic curve covered almost no distance in the first/last quarter,
    // then rushed through the middle; chained moves read as wait-rush-wait.
    // Cubic in-out still has a confident velocity peak while leaving enough
    // visible travel in the shoulders to read as one continuous gesture.
    seqSwoosh: function (t) {
      return t < 0.5 ? 4 * Math.pow(t, 3) : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    // Violent leave, feathered landing. Asymmetric: most of the distance is
    // covered in the first 40% of the window.
    seqWhip: function (t) {
      return 1 - Math.pow(1 - t * t, 4);
    },
    // Velocity spike at t=0 with a long confident decay.
    seqImpulse: function (t) {
      var n = 1 - Math.pow(2, -11);
      return (1 - Math.pow(2, -11 * t)) / n;
    },
    // Committed acceleration into an overshoot-free arrival that feathers
    // only in the last stretch — a push-in that lands, not floats.
    seqSettle: function (t) {
      var k = 0.24;
      var y = 0.3624;
      if (t < k) {
        var u = t / k;
        return y * u * u;
      }
      var v = Math.min(1, (t - k) / (1 - k));
      return y + (1 - y) * (1 - Math.pow(1 - v, 3.6));
    },
    // Eased but never fully stops: residual end velocity for chained motion.
    seqGlide: function (t) {
      var s = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      return 0.85 * s + 0.15 * t;
    },
    // Near-linear connective motion with softened ends — the drift curve.
    seqDrift: function (t) {
      var s = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      return 0.3 * s + 0.7 * t;
    },
    // Small backward dip, then commit.
    seqAnticipate: function (t) {
      if (t < 0.2) return -0.06 * Math.sin((t / 0.2) * Math.PI);
      var v = (t - 0.2) / 0.8;
      return 1 - Math.pow(1 - v, 3);
    },
    // Single ~3% overshoot settle for UI element beats (not cameras).
    seqMicrobounce: function (t) {
      var c1 = 0.7;
      var c3 = c1 + 1;
      var u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    },
    // Playful pop (MD6): back-out family, fast attack, ~10% single overshoot —
    // the typed exception for scale-from-small on compact acknowledgment
    // surfaces. Louder than seqMicrobounce; never for cameras or text blocks.
    seqPop: function (t) {
      var c1 = 1.70158;
      var c3 = c1 + 1;
      var u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    },
    // Stamp landing (MD6): arrives ~4% oversized and settles down — a seal/badge
    // that presses into place. Smaller overshoot than seqPop, same family.
    seqStamp: function (t) {
      var c1 = 1.05;
      var c3 = c1 + 1;
      var u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    },
  };

  function registerEases() {
    if (!global.gsap || typeof global.gsap.registerEase !== "function") return;
    for (var name in EASES) {
      if (Object.prototype.hasOwnProperty.call(EASES, name)) {
        global.gsap.registerEase(name, EASES[name]);
      }
    }
  }
  registerEases();

  // ---------------------------------------------------------------- camera
  var ZOOM_MIN = 0.5;
  var ZOOM_MAX = 2.8;
  // Dive leg fallbacks — kept in sync with cameraContract's diveWindows.
  var DIVE_LEG_MAX = 0.8;
  var DIVE_LEG_FRACTION = 0.25;
  var DIVE_LEG_MIN = 0.7;
  var REGION_MARGIN_RATIO = 0.08;
  var PART_MARGIN_RATIO = 0.16;
  var CREEP_ZOOM = 1.028;
  var ORBIT_DEG = 7;
  var ORBIT_ARC_DEFAULT = 28;
  var WHIP_BLUR_PX = 7;
  var PERSPECTIVE_PX = 1200;
  var FOCUS_LAYER_CAP = 4;
  // Level-2 depth: how far layers separate in Z at full orbit deflection, and
  // how many degrees of arc ramp that separation in (a pure function of the
  // orbit proxy, so out-of-order seek stays byte-identical).
  var DEPTH_Z_RANGE_PX = 120;
  var DEPTH_ENVELOPE_DEG = 10;
  /** Max seconds a rack takes to release after its segment ends. */
  var FOCUS_RELEASE_SEC = 0.45;
  /** Pulls closer than this hand off blur directly instead of releasing. */
  var FOCUS_HANDOFF_SEC = 0.3;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function fail(sceneId, reason) {
    throw new Error('could not bind camera path for scene "' + sceneId + '": ' + reason);
  }

  // Layout-space rectangle relative to the world plane. Uses the offset chain
  // so entrance transforms applied at build time cannot poison measurement.
  function layoutRect(world, element) {
    var x = 0;
    var y = 0;
    var node = element;
    while (node && node !== world && node !== document.body) {
      x += node.offsetLeft || 0;
      y += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return {
      x: x,
      y: y,
      width: element.offsetWidth || 1,
      height: element.offsetHeight || 1,
    };
  }

  function colorHasAlpha(value) {
    if (!value || value === "transparent") return false;
    var match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return true;
    var channels = match[1].split(",");
    return channels.length < 4 || Number(channels[3]) > 0.02;
  }

  function hasVisualPaint(element) {
    var style = getComputedStyle(element);
    if (colorHasAlpha(style.backgroundColor) || style.backgroundImage !== "none") return true;
    if (style.boxShadow !== "none" || style.outlineStyle !== "none") return true;
    return (
      (parseFloat(style.borderTopWidth) || 0) > 0 ||
      (parseFloat(style.borderRightWidth) || 0) > 0 ||
      (parseFloat(style.borderBottomWidth) || 0) > 0 ||
      (parseFloat(style.borderLeftWidth) || 0) > 0
    );
  }

  function hasDirectText(element) {
    for (var i = 0; i < element.childNodes.length; i += 1) {
      var node = element.childNodes[i];
      if (node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent || "")) return true;
    }
    return false;
  }

  function isFramingContent(element) {
    if (
      element.closest("[data-layout-ignore],[data-camera-overlay]") ||
      element.matches(".cmp-scrim,.seq-whip-lens,[data-layout-decorative]")
    ) return false;
    var tag = element.tagName.toUpperCase();
    if (tag === "IMG" || tag === "SVG" || tag === "VIDEO" || tag === "CANVAS" || tag === "PICTURE") {
      return true;
    }
    return hasDirectText(element) || hasVisualPaint(element);
  }

  // A station is a placement boundary, not necessarily the shot's visual
  // silhouette. Authors commonly put one 600px product panel in a viewport-
  // sized station; fitting the station makes that panel a tiny subject adrift
  // in empty space. Frame the union of actual painted/text/media descendants,
  // while preserving an explicit escape for deliberate establishing shots.
  function regionContentRect(world, region) {
    var fallback = layoutRect(world, region);
    if (region.getAttribute("data-camera-frame") === "region") return fallback;
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    var nodes = region.querySelectorAll("*");
    for (var i = 0; i < nodes.length; i += 1) {
      var element = nodes[i];
      if (!isFramingContent(element)) continue;
      var rect = layoutRect(world, element);
      if (rect.width < 4 || rect.height < 4) continue;
      left = Math.min(left, rect.x);
      top = Math.min(top, rect.y);
      right = Math.max(right, rect.x + rect.width);
      bottom = Math.max(bottom, rect.y + rect.height);
    }
    if (right <= left || bottom <= top) return fallback;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function partWithCompanionsRect(world, element) {
    var fallback = layoutRect(world, element);
    var region = element.closest && element.closest("[data-region]");
    if (!region) return fallback;
    var companions = region.querySelectorAll("[data-layout-important]");
    if (!companions.length) return fallback;
    var left = fallback.x;
    var top = fallback.y;
    var right = fallback.x + fallback.width;
    var bottom = fallback.y + fallback.height;
    for (var i = 0; i < companions.length; i += 1) {
      var rect = layoutRect(world, companions[i]);
      if (rect.width < 4 || rect.height < 4) continue;
      left = Math.min(left, rect.x);
      top = Math.min(top, rect.y);
      right = Math.max(right, rect.x + rect.width);
      bottom = Math.max(bottom, rect.y + rect.height);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function framingRect(world, element, kind) {
    if (kind === "region") return regionContentRect(world, element);
    // Modal roots span the scene; their dialog is the surface the camera and
    // the audience perceive as the subject.
    var visual = element.querySelector && element.querySelector(".cmp-dialog");
    return partWithCompanionsRect(world, visual || element);
  }

  function targetElement(scene, segment, useFrom) {
    var part = useFrom ? segment.fromPart : segment.toPart;
    var region = useFrom ? segment.fromRegion : segment.toRegion;
    if (part) {
      return {
        element: scene.querySelector('[data-part="' + CSS.escape(part) + '"]'),
        kind: "part",
        name: part,
      };
    }
    if (region) {
      return {
        element: scene.querySelector('[data-region="' + CSS.escape(region) + '"]'),
        kind: "region",
        name: region,
      };
    }
    return null;
  }

  // The camera state that frames `element` comfortably inside the viewport.
  function frameState(viewport, world, element, kind, zoomMul) {
    var r = framingRect(world, element, kind);
    var marginRatio = kind === "part" ? PART_MARGIN_RATIO : REGION_MARGIN_RATIO;
    var margin = Math.min(viewport.w, viewport.h) * marginRatio;
    var fit = Math.min(
      viewport.w / Math.max(1, r.width + margin * 2),
      viewport.h / Math.max(1, r.height + margin * 2),
    );
    return {
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
      z: clamp(fit * zoomMul, ZOOM_MIN, ZOOM_MAX),
      r: 0,
    };
  }

  function nearlySame(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 4 && Math.abs(a.z - b.z) < 0.01;
  }

  // Per-whip blur state. A factory (not an inline closure in the segment loop)
  // so multiple whips in one scene each drive their own proxy. Blur is a pure
  // function of the proxy, cleared at rest — deterministic under seek.
  //
  // The blur lives on a dedicated backdrop lens overlay, NEVER on the world
  // element: a CSS filter on the world forces 3D flattening of its children,
  // which would silently kill level-2 depth (preserve-3d + translateZ) and any
  // future 3D feature. The lens is a pointer-transparent sibling painted above
  // the world; its backdrop-filter smears everything beneath it — the same
  // full-frame whip smear, with the world's transform tree untouched.
  function whipLens(scene) {
    var lens = scene.querySelector(".seq-whip-lens");
    if (lens) return lens;
    lens = document.createElement("div");
    lens.className = "seq-whip-lens";
    lens.setAttribute("aria-hidden", "true");
    if (getComputedStyle(scene).position === "static") {
      scene.style.position = "relative";
    }
    lens.style.cssText =
      "position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:40;";
    scene.appendChild(lens);
    return lens;
  }

  function makeWhipBlur(scene) {
    var lens = whipLens(scene);
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

  function tween(timeline, target, fromVars, toVars, at) {
    toVars.immediateRender = false;
    timeline.fromTo(target, fromVars, toVars, at);
  }

  // ------------------------------------------------------------- rack focus
  // A `focus` modifier on a segment pulls a tweened focal plane between the
  // scene's depth layers: blur = intensity * blurMax * |layerDepth - focal|.
  // Blur lands on layers only, never the world element (a filter there would
  // flatten future 3D and collide with whip blur). Everything is a pure
  // function of tweened proxies — deterministic under seek. Enhancement only:
  // no depth layers or an unresolvable focus part compiles no filter tweens.
  function focusDepthOf(scene, layers, focus) {
    if (focus.part) {
      var element = scene.querySelector('[data-part="' + CSS.escape(focus.part) + '"]');
      if (!element) return null;
      for (var i = 0; i < layers.length; i += 1) {
        if (layers[i].element === element || layers[i].element.contains(element)) {
          return layers[i].depth;
        }
      }
      // Content without a depth attribute rides the plane itself (depth 1).
      return 1;
    }
    if (typeof focus.depth === "number" && isFinite(focus.depth)) {
      return clamp(focus.depth, 0, 1);
    }
    return null;
  }

  function compileFocus(timeline, scene, world, layers, segments) {
    var blurLayers = layers.slice(0, FOCUS_LAYER_CAP);
    if (!blurLayers.length) return;
    var pulls = [];
    for (var s = 0; s < segments.length; s += 1) {
      if (!segments[s].focus) continue;
      var target = focusDepthOf(scene, layers, segments[s].focus);
      if (target === null) continue;
      pulls.push({
        segment: segments[s],
        depth: target,
        blurMax: clamp(Number(segments[s].focus.blurMaxPx) || 6, 0, 10),
      });
    }
    if (!pulls.length) return;
    var sceneEnd = segments[segments.length - 1].endSec;
    var proxy = { d: pulls[0].depth, i: 0, m: pulls[0].blurMax };
    var applyFocus = function () {
      for (var i = 0; i < blurLayers.length; i += 1) {
        var blur = proxy.i * proxy.m * Math.abs(blurLayers[i].depth - proxy.d);
        blurLayers[i].element.style.filter =
          blur > 0.05 ? "blur(" + blur.toFixed(2) + "px)" : "";
      }
    };
    var previous = null;
    for (var p = 0; p < pulls.length; p += 1) {
      var pull = pulls[p];
      var duration = pull.segment.endSec - pull.segment.startSec;
      var pullSec = Math.max(0.3, Math.min(duration, duration * 0.6));
      // A pull hands off directly only when the next focused segment begins
      // as this one ends; otherwise the rack released in between (below) and
      // this pull ramps in fresh.
      var handoff = previous &&
        pull.segment.startSec - previous.segment.endSec <= FOCUS_HANDOFF_SEC;
      var fromVars = handoff
        ? { d: previous.depth, i: 1, m: previous.blurMax }
        : { d: pull.depth, i: 0, m: pull.blurMax };
      tween(timeline, proxy, fromVars, {
        d: pull.depth,
        i: 1,
        m: pull.blurMax,
        duration: pullSec,
        ease: "sine.inOut",
        onUpdate: applyFocus,
      }, pull.segment.startSec);
      // Release: focus is motivated only while its segment frames the shot.
      // When the next pull is not contiguous, blur ramps back to zero at the
      // segment's end instead of squatting on the scene's remaining shots —
      // the "blurred for no reason" defect. A pull ending flush with the
      // scene has no room (and no need) to release; the cut clears it.
      var next = pulls[p + 1];
      var releaseAt = pull.segment.endSec;
      var releaseRoom = Math.min(
        FOCUS_RELEASE_SEC,
        (next ? next.segment.startSec : sceneEnd) - releaseAt,
      );
      var contiguous = next &&
        next.segment.startSec - pull.segment.endSec <= FOCUS_HANDOFF_SEC;
      if (!contiguous && releaseRoom > 0.05) {
        tween(timeline, proxy, { d: pull.depth, i: 1, m: pull.blurMax }, {
          d: pull.depth,
          i: 0,
          m: pull.blurMax,
          duration: releaseRoom,
          ease: "sine.out",
          onUpdate: applyFocus,
        }, releaseAt);
      }
      previous = pull;
    }
    applyFocus();
  }

  function compileScene(timeline, root, viewport, scenePlan) {
    var scene = root.querySelector('[data-scene="' + CSS.escape(scenePlan.sceneId) + '"]');
    if (!scene) fail(scenePlan.sceneId, "scene element is absent");
    var world = scene.querySelector("[data-camera-world]");
    if (!world) fail(scenePlan.sceneId, "data-camera-world plane is absent");
    if (getComputedStyle(world).position === "static") {
      world.style.position = "relative";
    }
    world.style.transformOrigin = "0 0";
    world.style.willChange = "transform";

    // One depth vocabulary: data-depth is the semantic attribute; the older
    // data-parallax stays a full alias (same 0..1 scale, same 1-depth
    // translation factor), so existing worlds keep working unchanged.
    var layers = [];
    var layerNodes = world.querySelectorAll("[data-depth],[data-parallax]");
    for (var i = 0; i < layerNodes.length; i += 1) {
      var depthAttr = layerNodes[i].getAttribute("data-depth");
      if (depthAttr === null) depthAttr = layerNodes[i].getAttribute("data-parallax");
      var depth = Number(depthAttr);
      if (isFinite(depth)) {
        layers.push({ element: layerNodes[i], depth: clamp(depth, 0, 1) });
      }
    }

    var segments = scenePlan.segments;
    var first = segments[0];
    var entry = targetElement(scene, first, true) || targetElement(scene, first, false);
    if (!entry || !entry.element) {
      fail(
        scenePlan.sceneId,
        'entry framing "' + (entry ? entry.name : "?") + '" is absent',
      );
    }
    var start = frameState(viewport, world, entry.element, entry.kind, 1);
    var reference = { x: start.x, y: start.y };
    var proxy = { x: start.x, y: start.y, z: start.z, r: 0, ry: 0 };

    // True orbit (level 1) rotates the flat world plane in 3D; perspective
    // lives on the scene wrapper. The world element NEVER carries a CSS
    // filter (whip blur lives on the lens overlay), so level-2 depth can put
    // preserve-3d on the world: layers' translateZ then composes with the
    // world's rotateY and they separate in Z while the camera arcs.
    var hasOrbit = false;
    for (var o = 0; o < segments.length; o += 1) {
      if (segments[o].move === "orbit") hasOrbit = true;
    }
    if (hasOrbit) scene.style.perspective = PERSPECTIVE_PX + "px";
    var depth3d = Boolean(scenePlan.depth3d && hasOrbit && layers.length);
    if (depth3d) world.style.transformStyle = "preserve-3d";

    function apply() {
      var z = proxy.z;
      var tx = viewport.w / 2 - proxy.x * z;
      var ty = viewport.h / 2 - proxy.y * z;
      var transform = "translate(" + tx + "px," + ty + "px) scale(" + z + ")";
      if (proxy.r) {
        transform =
          "translate(" + viewport.w / 2 + "px," + viewport.h / 2 + "px) " +
          "rotate(" + proxy.r + "deg) " +
          "translate(" + -viewport.w / 2 + "px," + -viewport.h / 2 + "px) " +
          transform;
      }
      if (proxy.ry) {
        // The framed subject is centered by frameState, so rotating about the
        // viewport center arcs the camera around the subject.
        transform =
          "translate(" + viewport.w / 2 + "px," + viewport.h / 2 + "px) " +
          "rotateY(" + proxy.ry + "deg) " +
          "translate(" + -viewport.w / 2 + "px," + -viewport.h / 2 + "px) " +
          transform;
      }
      world.style.transform = transform;
      // Level-2 depth: Z separation is a pure function of the orbit
      // deflection (proxy.ry), ramping in over the first degrees of arc and
      // back to zero at rest — non-orbit frames render byte-identically to a
      // flat scene, so rest-state layout and legibility never change.
      var depthEnvelope = depth3d
        ? Math.min(1, Math.abs(proxy.ry) / DEPTH_ENVELOPE_DEG)
        : 0;
      for (var index = 0; index < layers.length; index += 1) {
        var layer = layers[index];
        var factor = 1 - layer.depth;
        var layerTransform =
          "translate(" + (proxy.x - reference.x) * factor + "px," +
          (proxy.y - reference.y) * factor + "px)";
        if (depth3d) {
          var layerZ = depthEnvelope * (layer.depth - 0.5) * DEPTH_Z_RANGE_PX;
          layerTransform += " translateZ(" + layerZ.toFixed(2) + "px)";
        }
        layer.element.style.transform = layerTransform;
      }
    }

    var state = start;
    for (var s = 0; s < segments.length; s += 1) {
      var segment = segments[s];
      var duration = segment.endSec - segment.startSec;
      var end;
      if (segment.move === "dive") {
        // One typed move for zoom-in → act → zoom-out (MD5): push in to the
        // part-framed state, hold while the typed beat develops the surface,
        // and return EXACTLY to the saved pre-dive state so the surrounding
        // path is undisturbed. The host derived the leg durations from the
        // overlapping beat windows; here they are plain numbers.
        var diveTarget = targetElement(scene, segment, false);
        if (!diveTarget || !diveTarget.element) {
          fail(
            scenePlan.sceneId,
            'dive target "' + (diveTarget ? diveTarget.name : "?") + '" is absent',
          );
        }
        var framedDive = frameState(
          viewport, world, diveTarget.element, "part", segment.zoom,
        );
        var legCap = Math.max(DIVE_LEG_MIN, Math.min(DIVE_LEG_MAX, duration * DIVE_LEG_FRACTION));
        var inSec = isFinite(segment.inSec) ? segment.inSec : legCap;
        var outSec = isFinite(segment.outSec) ? segment.outSec : legCap;
        // Dive envelope softening (probe-audit-03: the dive read harsh on entry
        // and exit). The runtime OWNS the dive's leg eases (MD5: the host owns
        // the whole dive arithmetic), so the push-in gets a soft committed
        // ease-in-out and the pull-back a gentle ease-out — never a
        // velocity-spike ease like seqImpulse that snaps the frame. The held
        // middle between the legs is untouched (exact return to the pre-dive
        // state by construction).
        tween(timeline, proxy, { x: state.x, y: state.y, z: state.z }, {
          x: framedDive.x,
          y: framedDive.y,
          z: framedDive.z,
          duration: inSec,
          ease: "power2.inOut",
          onUpdate: apply,
        }, segment.startSec);
        tween(timeline, proxy, {
          x: framedDive.x,
          y: framedDive.y,
          z: framedDive.z,
        }, {
          x: state.x,
          y: state.y,
          z: state.z,
          duration: outSec,
          ease: "power2.out",
          onUpdate: apply,
        }, segment.endSec - outSec);
        // state is unchanged by construction — the camera came home.
        continue;
      }
      if (segment.move === "hold") {
        end = state;
      } else {
        var target = targetElement(scene, segment, false);
        if (!target || !target.element) {
          fail(
            scenePlan.sceneId,
            'camera target "' + (target ? target.name : "?") + '" is absent',
          );
        }
        var framed = frameState(viewport, world, target.element, target.kind, segment.zoom);
        if (segment.blend >= 1) {
          end = framed;
        } else if (segment.blend > 0 && !nearlySame(state, framed)) {
          end = {
            x: state.x + (framed.x - state.x) * segment.blend,
            y: state.y + (framed.y - state.y) * segment.blend,
            z: state.z + (framed.z - state.z) * segment.blend,
            r: 0,
          };
        } else {
          // Nowhere new to go: creep. The camera keeps breathing forward
          // instead of freezing between typed moves.
          end = { x: state.x, y: state.y, z: clamp(state.z * CREEP_ZOOM, ZOOM_MIN, ZOOM_MAX), r: 0 };
        }
      }
      if (segment.move !== "hold") {
        tween(timeline, proxy, { x: state.x, y: state.y, z: state.z }, {
          x: end.x,
          y: end.y,
          z: end.z,
          duration: duration,
          ease: segment.ease,
          onUpdate: apply,
        }, segment.startSec);
      }
      if (segment.move === "whip") {
        var blur = makeWhipBlur(scene);
        var blurHalf = duration / 2;
        tween(timeline, blur.proxy, { b: 0 }, {
          b: WHIP_BLUR_PX,
          duration: blurHalf,
          ease: "sine.in",
          onUpdate: blur.apply,
        }, segment.startSec);
        tween(timeline, blur.proxy, { b: WHIP_BLUR_PX }, {
          b: 0,
          duration: blurHalf,
          ease: "sine.out",
          onUpdate: blur.apply,
        }, segment.startSec + blurHalf);
      }
      if (segment.move === "orbit-lite") {
        var sign = end.x >= state.x ? 1 : -1;
        var half = duration / 2;
        tween(timeline, proxy, { r: 0 }, {
          r: sign * ORBIT_DEG,
          duration: half,
          ease: "sine.inOut",
          onUpdate: apply,
        }, segment.startSec);
        tween(timeline, proxy, { r: sign * ORBIT_DEG }, {
          r: 0,
          duration: half,
          ease: "sine.inOut",
          onUpdate: apply,
        }, segment.startSec + half);
      }
      if (segment.move === "orbit") {
        // Level-1 true orbit: sweep the flat world plane around the framed
        // subject and return to rest, so the scene never ends mid-rotation
        // and no preserve-3d is required on the world's children.
        var arc = isFinite(segment.arcDeg) ? segment.arcDeg : ORBIT_ARC_DEFAULT;
        var arcSign = end.x >= state.x ? 1 : -1;
        var arcHalf = duration / 2;
        tween(timeline, proxy, { ry: 0 }, {
          ry: arcSign * arc,
          duration: arcHalf,
          ease: "sine.inOut",
          onUpdate: apply,
        }, segment.startSec);
        tween(timeline, proxy, { ry: arcSign * arc }, {
          ry: 0,
          duration: arcHalf,
          ease: "sine.inOut",
          onUpdate: apply,
        }, segment.startSec + arcHalf);
      }
      state = end;
    }
    compileFocus(timeline, scene, world, layers, segments);
    apply();
    return { sceneId: scenePlan.sceneId, world: world, layers: layers.length };
  }

  function compile(timeline, root) {
    if (!timeline || !root) throw new Error("SequencesCamera.compile requires timeline + root");
    var island = document.getElementById("sequences-camera");
    if (!island) return [];
    var plan = JSON.parse(island.textContent || "{}");
    if (plan.version !== VERSION || !Array.isArray(plan.scenes)) {
      throw new Error("unsupported sequences camera plan");
    }
    var viewport = {
      w: Number(root.getAttribute("data-width")) || root.offsetWidth || 1920,
      h: Number(root.getAttribute("data-height")) || root.offsetHeight || 1080,
    };
    var bindings = [];
    plan.scenes.forEach(function (scenePlan) {
      bindings.push(compileScene(timeline, root, viewport, scenePlan));
    });
    global.__sequencesCameraBindings = bindings;
    return bindings;
  }

  global.SequencesCamera = Object.freeze({
    version: VERSION,
    compile: compile,
    eases: EASES,
  });
})(window);
