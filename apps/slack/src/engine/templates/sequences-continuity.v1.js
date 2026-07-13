(function (global) {
  "use strict";

  var VERSION = 1;
  var graphCache = null;
  var blockingCache = null;

  // Minimum-jerk quintic. Position, velocity, and acceleration meet cleanly at
  // both endpoints; its finite derivative maxima are persisted with the plan.
  function minimumJerk(t) {
    t = Math.max(0, Math.min(1, t));
    return 10 * Math.pow(t, 3) - 15 * Math.pow(t, 4) + 6 * Math.pow(t, 5);
  }

  if (global.gsap && typeof global.gsap.registerEase === "function") {
    global.gsap.registerEase("seqContinuity", minimumJerk);
  }

  function island(id) {
    var node = document.getElementById(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (_error) {
      return null;
    }
  }

  function graph() {
    if (!graphCache) graphCache = island("sequences-continuity");
    return graphCache;
  }

  function blocking() {
    if (!blockingCache) blockingCache = island("sequences-camera-blocking");
    return blockingCache;
  }

  function blockFor(sceneId, segment) {
    var plan = blocking();
    if (!plan || plan.version !== VERSION || !Array.isArray(plan.scenes)) return null;
    var scene = null;
    for (var s = 0; s < plan.scenes.length; s += 1) {
      if (plan.scenes[s].sceneId === sceneId) scene = plan.scenes[s];
    }
    if (!scene || !Array.isArray(scene.phrases)) return null;
    var target = segment.toPart || segment.toRegion;
    var best = null;
    var bestDistance = Infinity;
    for (var p = 0; p < scene.phrases.length; p += 1) {
      var phrase = scene.phrases[p];
      if (target &&
          (!phrase.target || phrase.target.id !== target) &&
          (!phrase.framingTarget || phrase.framingTarget.id !== target)) continue;
      var inside = phrase.arrivalSec >= segment.startSec - 0.02 &&
        phrase.arrivalSec <= segment.endSec + 0.02;
      var distance = Math.abs(phrase.arrivalSec - segment.endSec) + (inside ? 0 : 100);
      if (distance < bestDistance) {
        best = phrase;
        bestDistance = distance;
      }
    }
    return best;
  }

  function blocksForScene(sceneId) {
    var plan = blocking();
    if (!plan || plan.version !== VERSION || !Array.isArray(plan.scenes)) return [];
    for (var s = 0; s < plan.scenes.length; s += 1) {
      if (plan.scenes[s].sceneId === sceneId && Array.isArray(plan.scenes[s].phrases)) {
        return plan.scenes[s].phrases;
      }
    }
    return [];
  }

  function blockingSolver() {
    var plan = blocking();
    return plan && plan.version === VERSION && plan.solver ? plan.solver : null;
  }

  function part(scene, name) {
    if (!scene || !name) return null;
    return scene.querySelector('[data-part="' + CSS.escape(name) + '"]');
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

  function bridge(root, source, entityId, side) {
    var clone = source.cloneNode(true);
    var nodes = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*")));
    for (var n = 0; n < nodes.length; n += 1) {
      nodes[n].removeAttribute("id");
      nodes[n].removeAttribute("data-part");
      nodes[n].removeAttribute("data-component");
      nodes[n].removeAttribute("data-continuity-entity");
      nodes[n].removeAttribute("data-layout-important");
    }
    clone.setAttribute("data-sequences-runtime-continuity", side);
    clone.setAttribute("data-continuity-bridge-entity", entityId);
    clone.setAttribute("data-layout-ignore", "");
    clone.style.cssText +=
      ";position:absolute;left:0;top:0;margin:0;pointer-events:none;opacity:0;" +
      "transform-origin:0 0;z-index:97;box-sizing:border-box;min-width:0;" +
      "min-height:0;max-width:none;max-height:none;";
    root.appendChild(clone);
    return clone;
  }

  function placeBridge(clone, natural, box, opacity) {
    var scale = Math.max(0.01, Math.min(
      box.width / Math.max(1, natural.width),
      box.height / Math.max(1, natural.height),
    ));
    global.gsap.set(clone, {
      x: box.x + (box.width - natural.width * scale) / 2,
      y: box.y + (box.height - natural.height * scale) / 2,
      width: natural.width,
      height: natural.height,
      scale: scale,
      transformOrigin: "0 0",
      opacity: opacity,
    });
  }

  function bindEdge(timeline, root, edge) {
    var fromScene = root.querySelector('[data-scene="' + CSS.escape(edge.fromScene) + '"]');
    var toScene = root.querySelector('[data-scene="' + CSS.escape(edge.toScene) + '"]');
    var fromPart = part(fromScene, edge.fromPart);
    var toPart = part(toScene, edge.toPart);
    if (!fromPart || !toPart) return { edgeId: edge.id, status: "unbound" };
    if (fromPart.querySelectorAll("*").length > 120 || toPart.querySelectorAll("*").length > 120) {
      return { edgeId: edge.id, status: "heavy-subtree" };
    }
    var a0 = localRect(root, fromPart);
    var b0 = localRect(root, toPart);
    if (a0.width < 2 || a0.height < 2 || b0.width < 2 || b0.height < 2) {
      return { edgeId: edge.id, status: "zero-geometry" };
    }
    var outgoing = bridge(root, fromPart, edge.entityId, "outgoing");
    var incoming = bridge(root, toPart, edge.entityId, "incoming");
    var fromOpacity = Number.parseFloat(getComputedStyle(fromPart).opacity);
    var toOpacity = Number.parseFloat(getComputedStyle(toPart).opacity);
    if (!isFinite(fromOpacity)) fromOpacity = 1;
    if (!isFinite(toOpacity)) toOpacity = 1;
    var duration = Math.max(0.24, Number(edge.durationSec) || 0.48);
    var start = Math.max(0, edge.atSec - Math.min(0.18, duration * 0.38));
    var proxy = { p: 0 };
    // Initialize every bridge's complete geometry on the timeline at zero.
    // Without this, a bridge belonging to a later cut keeps its last inline
    // transform when the master seeks backwards to an earlier cut. It is
    // hidden, but stale DOM state breaks arbitrary-seek determinism and can
    // leak into developer evidence.
    timeline.set([outgoing, incoming], {
      opacity: 0,
      x: a0.x,
      y: a0.y,
      width: a0.width,
      height: a0.height,
    }, 0);
    timeline.set(fromPart, { opacity: 0 }, start);
    timeline.set(toPart, { opacity: 0 }, Math.max(0, start - 0.001));
    timeline.set(outgoing, { opacity: fromOpacity }, start);
    timeline.to(proxy, {
      p: 1,
      duration: duration,
      ease: "none",
      onUpdate: function () {
        var a = localRect(root, fromPart);
        var b = localRect(root, toPart);
        var t = minimumJerk(proxy.p);
        var vars = {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          width: a.width + (b.width - a.width) * t,
          height: a.height + (b.height - a.height) * t,
        };
        // Preserve each endpoint's internal layout. Reflowing clone width and
        // height on every frame rubber-sheets text and product UI; a uniform
        // scale plus crossfade keeps both representations intact.
        placeBridge(outgoing, a, vars, fromOpacity * (1 - t));
        placeBridge(incoming, b, vars, toOpacity * t);
      },
    }, start);
    timeline.set([outgoing, incoming], { opacity: 0 }, start + duration);
    // Restore the destination's authored resting opacity. Forcing every shared
    // element to 1 undimmed deliberately receded supporting surfaces and made
    // them cover the next focal metric (RouteBoardQC5).
    timeline.set(toPart, { opacity: toOpacity }, start + duration);
    return { edgeId: edge.id, status: "bound", entityId: edge.entityId };
  }

  function compile(timeline, root) {
    if (!timeline || !root) throw new Error("SequencesContinuity.compile requires timeline + root");
    var plan = graph();
    if (!plan || plan.version !== VERSION || !Array.isArray(plan.edges)) return [];
    var bindings = [];
    for (var index = 0; index < plan.edges.length; index += 1) {
      var edge = plan.edges[index];
      if (edge.mode !== "shared-element") continue;
      bindings.push(bindEdge(timeline, root, edge));
    }
    global.__sequencesContinuityBindings = bindings;
    return bindings;
  }

  global.SequencesContinuity = Object.freeze({
    version: VERSION,
    compile: compile,
    blockFor: blockFor,
    blocksForScene: blocksForScene,
    blockingSolver: blockingSolver,
    minimumJerk: minimumJerk,
  });
})(window);
