(function (global) {
  "use strict";

  var VERSION = 1;

  // ---------------------------------------------------------------- eases
  // Curated motion-graphics curve library. Registered at script load so both
  // the camera compiler and authored GSAP beats can reference them by name.
  // Every function is pure, f(0)=0, f(1)=1 — deterministic under seek.
  var EASES = {
    // Sharp symmetric in-out with a high peak velocity and feathered ends —
    // the signature SaaS "swoosh" reframe.
    seqSwoosh: function (t) {
      return t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2;
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
  var REGION_MARGIN_RATIO = 0.04;
  var PART_MARGIN_RATIO = 0.16;
  var CREEP_ZOOM = 1.028;
  var ORBIT_DEG = 2.2;

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
    var r = layoutRect(world, element);
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

  function tween(timeline, target, fromVars, toVars, at) {
    toVars.immediateRender = false;
    timeline.fromTo(target, fromVars, toVars, at);
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

    var layers = [];
    var layerNodes = world.querySelectorAll("[data-parallax]");
    for (var i = 0; i < layerNodes.length; i += 1) {
      var depth = Number(layerNodes[i].getAttribute("data-parallax"));
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
    var proxy = { x: start.x, y: start.y, z: start.z, r: 0 };

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
      world.style.transform = transform;
      for (var index = 0; index < layers.length; index += 1) {
        var layer = layers[index];
        var factor = 1 - layer.depth;
        layer.element.style.transform =
          "translate(" + (proxy.x - reference.x) * factor + "px," +
          (proxy.y - reference.y) * factor + "px)";
      }
    }

    var state = start;
    for (var s = 0; s < segments.length; s += 1) {
      var segment = segments[s];
      var duration = segment.endSec - segment.startSec;
      var end;
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
      state = end;
    }
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
