(function (global) {
  "use strict";

  var VERSION = 1;

  function hashUnit(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 10000) / 10000;
  }

  function part(scene, name) {
    return scene.querySelector('[data-part="' + CSS.escape(name) + '"]');
  }

  function childItems(element) {
    function scoped(selector) {
      var direct = element.querySelectorAll(":scope > " + selector);
      return direct.length ? direct : element.querySelectorAll(selector);
    }
    var selectors = [
      ".cmp-row", ".cmp-item", ".cmp-card", ".cmp-msg", "[data-cmp-item]",
      '[class$="-row"],[class*="-row "]', "i",
    ];
    for (var i = 0; i < selectors.length; i += 1) {
      var found = scoped(selectors[i]);
      if (found.length) return Array.prototype.slice.call(found);
    }
    return [];
  }

  function interactionTarget(scene, intent, targetName) {
    var name = targetName || intent.targetPart;
    var element = part(scene, name);
    if (!element || name !== intent.targetPart ||
        typeof intent.item !== "number" || !isFinite(intent.item)) {
      return element;
    }
    var items = childItems(element);
    if (!items.length) return element;
    var index = Math.max(0, Math.min(items.length - 1, Math.round(intent.item) - 1));
    return items[index];
  }

  function cursor(root, id) {
    return root.querySelector('[data-cursor-id="' + CSS.escape(id) + '"]');
  }

  function pointInRect(rect, x, y, offsetX, offsetY) {
    return {
      x: rect.left + rect.width * x + (offsetX || 0),
      y: rect.top + rect.height * y + (offsetY || 0),
    };
  }

  function framePoint(rect, anchor, safe) {
    var inset = safe || Math.min(rect.width, rect.height) * 0.06;
    var points = {
      "frame:center": [0.5, 0.5],
      "frame:top-left": [0, 0],
      "frame:top-right": [1, 0],
      "frame:bottom-left": [0, 1],
      "frame:bottom-right": [1, 1],
      "frame:left-third": [1 / 3, 0.5],
      "frame:right-third": [2 / 3, 0.5],
    };
    var pair = points[anchor] || points["frame:center"];
    var x = rect.left + pair[0] * rect.width;
    var y = rect.top + pair[1] * rect.height;
    if (pair[0] === 0) x += inset;
    if (pair[0] === 1) x -= inset;
    if (pair[1] === 0) y += inset;
    if (pair[1] === 1) y -= inset;
    return { x: x, y: y };
  }

  function anchorPoint(root, scene, source) {
    if (source.indexOf("part:") === 0) {
      var element = part(scene, source.slice(5));
      if (element) return pointInRect(element.getBoundingClientRect(), 0.5, 0.5, 0, 0);
    }
    var rootRect = root.getBoundingClientRect();
    var safe = parseFloat(getComputedStyle(root).getPropertyValue("--space-safe")) || 0;
    return framePoint(rootRect, source, safe);
  }

  function targetPoint(scene, intent, targetName) {
    var element = interactionTarget(scene, intent, targetName);
    if (!element) return null;
    var rect = element.getBoundingClientRect();
    var requested = pointInRect(rect, intent.aimX, intent.aimY, intent.offsetX, intent.offsetY);
    var inset = Math.min(
      Math.max(2, intent.hitInsetPx || Math.min(12, Math.min(rect.width, rect.height) * 0.14)),
      Math.max(0, rect.width / 2 - 0.5),
      Math.max(0, rect.height / 2 - 0.5),
    );
    return {
      x: Math.max(rect.left + inset, Math.min(rect.right - inset, requested.x)),
      y: Math.max(rect.top + inset, Math.min(rect.bottom - inset, requested.y)),
    };
  }

  function localize(root, point) {
    var rootRect = root.getBoundingClientRect();
    var scaleX = root.offsetWidth ? rootRect.width / root.offsetWidth : 1;
    var scaleY = root.offsetHeight ? rootRect.height / root.offsetHeight : 1;
    return {
      x: (point.x - rootRect.left) / Math.max(0.0001, scaleX),
      y: (point.y - rootRect.top) / Math.max(0.0001, scaleY),
    };
  }

  function cursorHotspot(element) {
    var x = parseFloat(element.dataset.cursorHotspotX || "0");
    var y = parseFloat(element.dataset.cursorHotspotY || "0");
    return {
      x: Math.max(0, Math.min(1, isFinite(x) ? x : 0)),
      y: Math.max(0, Math.min(1, isFinite(y) ? y : 0)),
    };
  }

  function customPoint(root, start, end, intent, progress) {
    var rootRect = root.getBoundingClientRect();
    var points = [start];
    (intent.waypoints || []).forEach(function (waypoint) {
      points.push({
        x: rootRect.left + rootRect.width * waypoint.x,
        y: rootRect.top + rootRect.height * waypoint.y,
      });
    });
    points.push(end);
    var scaled = progress * (points.length - 1);
    var index = Math.min(points.length - 2, Math.floor(scaled));
    var local = scaled - index;
    return {
      x: points[index].x + (points[index + 1].x - points[index].x) * local,
      y: points[index].y + (points[index + 1].y - points[index].y) * local,
    };
  }

  function pathPoint(root, start, end, intent, progress) {
    if (intent.path === "custom") return customPoint(root, start, end, intent, progress);
    if (intent.path === "direct") {
      return {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      };
    }
    var dx = end.x - start.x;
    var dy = end.y - start.y;
    var length = Math.max(1, Math.hypot(dx, dy));
    var bend = typeof intent.bend === "number"
      ? intent.bend
      : (hashUnit(intent.id) - 0.5) * (intent.path === "human" ? 0.32 : 0.5);
    var rawOffset = length * bend;
    var maximumOffset = intent.path === "human" ? 72 : 128;
    var curveOffset = Math.max(-maximumOffset, Math.min(maximumOffset, rawOffset));
    var control = {
      x: (start.x + end.x) / 2 - (dy / length) * curveOffset,
      y: (start.y + end.y) / 2 + (dx / length) * curveOffset,
    };
    var inverse = 1 - progress;
    return {
      x: inverse * inverse * start.x + 2 * inverse * progress * control.x +
        progress * progress * end.x,
      y: inverse * inverse * start.y + 2 * inverse * progress * control.y +
        progress * progress * end.y,
    };
  }

  // Re-parameterize authored direct/quadratic/custom paths by approximate arc
  // length. Equal Bezier `t` does not mean equal distance, so cursors otherwise
  // accelerate around a bend for no semantic reason and kink at custom segment
  // boundaries. The outer ease still supplies anticipation/settle character;
  // this function only makes its progress correspond to travelled distance.
  function arcLengthProgress(root, start, end, intent, distanceProgress) {
    var steps = intent.path === "direct" ? 2 : 18;
    var points = [];
    var cumulative = [0];
    var total = 0;
    for (var i = 0; i <= steps; i += 1) {
      var point = pathPoint(root, start, end, intent, i / steps);
      points.push(point);
      if (i > 0) {
        total += Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y);
        cumulative.push(total);
      }
    }
    if (total <= 0.001) return Math.max(0, Math.min(1, distanceProgress));
    var target = Math.max(0, Math.min(1, distanceProgress)) * total;
    for (var index = 1; index < cumulative.length; index += 1) {
      if (cumulative[index] < target) continue;
      var span = Math.max(0.001, cumulative[index] - cumulative[index - 1]);
      var local = (target - cumulative[index - 1]) / span;
      return ((index - 1) + local) / steps;
    }
    return 1;
  }

  function place(root, element, point, hotspot) {
    var local = localize(root, point);
    var style = getComputedStyle(element);
    // SVG cursors have no HTMLElement offsetWidth/offsetHeight. Their client
    // rect is transform-scaled during press feedback, so using it as the base
    // box drifts the hotspot by the scale delta. Prefer the untransformed CSS
    // box and keep the rendered rect only as a final fallback.
    var rendered = element.getBoundingClientRect();
    var width = element.offsetWidth || parseFloat(style.width) || rendered.width;
    var height = element.offsetHeight || parseFloat(style.height) || rendered.height;
    global.gsap.set(element, {
      x: local.x - width * hotspot.x,
      y: local.y - height * hotspot.y,
      transformOrigin: (hotspot.x * 100) + "% " + (hotspot.y * 100) + "%",
    });
  }

  function bindRipple(timeline, root, scene, intent, target, ripple) {
    if (!ripple || intent.pressSec == null) return;
    var duration = Math.max(0.3, (intent.holdUntilSec || intent.releaseSec || intent.pressSec + 0.6) -
      intent.pressSec);
    var tracker = { p: 0 };
    // Seek renderers may open the document at t=0 before visiting pressSec.
    // Hide authored/id-only ripple markup both immediately and on the master
    // timeline so a default-position ring can never flash at frame-left.
    global.gsap.set(ripple, { opacity: 0, scale: 0.2 });
    timeline.set(ripple, { opacity: 0, scale: 0.2 }, 0);
    timeline.set(ripple, { opacity: 0, scale: 0.2 }, intent.pressSec);
    timeline.to(tracker, {
      p: 1,
      duration: duration,
      ease: "none",
      onUpdate: function () {
        var point = targetPoint(scene, intent);
        if (!point) return;
        // Ripples live beside/inside their target and therefore inherit the
        // camera-world transform. Localize into their actual positioning
        // parent (including inverse camera scale), while the global cursor
        // continues to use the composition root.
        var local = localize(ripple.offsetParent || root, point);
        global.gsap.set(ripple, {
          x: local.x - (ripple.offsetWidth || 0) / 2,
          y: local.y - (ripple.offsetHeight || 0) / 2,
        });
      },
    }, intent.pressSec);
    timeline.fromTo(ripple, { opacity: 0.8, scale: 0.2 }, {
      opacity: 0,
      scale: 2.6,
      duration: duration,
      ease: "power2.out",
      immediateRender: false,
    }, intent.pressSec);
  }

  function bindPress(timeline, intent, cursorElement, target) {
    if (intent.pressSec == null || intent.releaseSec == null) return;
    var downDuration = Math.max(0.04, Math.min(0.14, intent.releaseSec - intent.pressSec));
    var cursorScale = intent.cursorScale || 0.84;
    var targetScale = intent.targetScale || 0.95;
    if (intent.feedback === "press" || intent.feedback === "press-ripple") {
      timeline.to(cursorElement, {
        scale: cursorScale,
        duration: downDuration,
        ease: "power2.in",
      }, intent.pressSec);
      timeline.to(target, {
        scale: targetScale,
        duration: downDuration,
        ease: "power2.in",
        transformOrigin: "50% 50%",
      }, intent.pressSec);
      timeline.to(cursorElement, {
        scale: 1,
        duration: 0.14,
        ease: "back.out(1.8)",
      }, intent.releaseSec);
      timeline.to(target, {
        scale: 1,
        duration: 0.14,
        ease: "back.out(1.8)",
      }, intent.releaseSec);
    }
  }

  function bindArrivalFocus(timeline, intent, target) {
    var travelSec = intent.arriveSec - intent.startSec;
    if (!(travelSec >= 0.12)) return;
    var computed = global.getComputedStyle(target);
    var baseFilter = computed.filter && computed.filter !== "" ? computed.filter : "none";
    var focusFilter = baseFilter === "none"
      ? "brightness(1.08)"
      : baseFilter + " brightness(1.08)";
    var focusStart = Math.max(
      intent.startSec,
      intent.arriveSec - Math.min(0.18, travelSec * 0.4)
    );
    timeline.fromTo(target, { filter: baseFilter }, {
      filter: focusFilter,
      duration: Math.max(0.08, intent.arriveSec - focusStart),
      ease: "power2.out",
      immediateRender: false,
    }, focusStart);
    var restoreAt = intent.pressSec != null
      ? intent.pressSec
      : (intent.holdUntilSec || intent.releaseSec || intent.arriveSec + 0.18);
    if (restoreAt > intent.arriveSec) {
      timeline.to(target, {
        filter: baseFilter,
        duration: Math.min(0.12, Math.max(0.06, restoreAt - intent.arriveSec)),
        ease: "power2.out",
      }, restoreAt);
    }
  }

  function followTarget(timeline, root, scene, intent, cursorElement, hotspot, start, end, targetName) {
    if (!(end > start)) return;
    var tracker = { p: 0 };
    timeline.to(tracker, {
      p: 1,
      duration: end - start,
      ease: "none",
      onUpdate: function () {
        var point = targetPoint(scene, intent, targetName);
        if (point) place(root, cursorElement, point, hotspot);
      },
    }, start);
  }

  function pinTargetAt(timeline, root, scene, intent, cursorElement, hotspot, at, targetName) {
    if (at == null || !isFinite(at)) return;
    // A long-running follower sorts before tweens that BEGIN on its endpoint.
    // Re-measure in a zero-duration endpoint callback so a button's release
    // bounce, component state seam, or camera landing cannot move underneath
    // the cursor on the exact QA/viewer action frame.
    timeline.call(function () {
      var point = targetPoint(scene, intent, targetName);
      if (point) place(root, cursorElement, point, hotspot);
    }, null, at);
  }

  function compile(timeline, root) {
    if (!timeline || !root) throw new Error("SequencesInteractions.compile requires timeline + root");
    var island = document.getElementById("sequences-interactions");
    if (!island) return [];
    var plan = JSON.parse(island.textContent || "{}");
    if (plan.version !== VERSION || !Array.isArray(plan.interactions)) {
      throw new Error("unsupported sequences interaction plan");
    }
    var bindings = [];
    plan.interactions.forEach(function (intent) {
      var scene = root.querySelector('[data-scene="' + CSS.escape(intent.sceneId) + '"]');
      var cursorElement = cursor(root, intent.cursorId);
      var target = scene && interactionTarget(scene, intent);
      if (!scene || !cursorElement || !target) {
        throw new Error('could not bind interaction "' + intent.id + '"');
      }
      var overlay = cursorElement.closest("[data-camera-overlay]");
      if (!overlay) {
        throw new Error('cursor "' + intent.cursorId + '" must be inside data-camera-overlay');
      }
      // Model-authored markup often adds a decorative wrapper around the
      // cursor or camera overlay. Canonicalize those mechanical relationships
      // before measuring so placement remains root-relative and QA sees one
      // unambiguous screen-space actor.
      if (overlay.parentElement !== scene && overlay.parentElement !== root) {
        scene.appendChild(overlay);
      }
      if (cursorElement.parentElement !== overlay) {
        overlay.appendChild(cursorElement);
      }
      var hotspot = cursorHotspot(cursorElement);
      var proxy = { p: 0 };
      var ease = global.gsap.parseEase(intent.ease || "power2.out");
      if (typeof ease !== "function") ease = global.gsap.parseEase("power2.out");
      global.gsap.set(cursorElement, { opacity: 0 });
      timeline.set(cursorElement, { opacity: 0 }, 0);
      timeline.call(function () {
        place(root, cursorElement, anchorPoint(root, scene, intent.from), hotspot);
      }, null, intent.startSec);
      timeline.to(cursorElement, {
        opacity: 1,
        duration: Math.min(0.14, (intent.arriveSec - intent.startSec) * 0.18),
        ease: "none",
      }, intent.startSec);
      timeline.to(proxy, {
        p: 1,
        duration: intent.arriveSec - intent.startSec,
        ease: "none",
        onUpdate: function () {
          var start = anchorPoint(root, scene, intent.from);
          var end = targetPoint(scene, intent);
          if (!end) return;
          var progress = arcLengthProgress(root, start, end, intent, ease(proxy.p));
          place(root, cursorElement, pathPoint(root, start, end, intent, progress), hotspot);
        },
      }, intent.startSec);
      // A 32px cursor moving across a 1920px frame is valid mechanical
      // evidence but too small to read as a primary arrival moment. Give the
      // measured target one restrained hover/focus lift on arrival, restore its
      // exact authored filter at press/hold, then let press feedback own the
      // result. This makes the intent visible without minting another actor.
      bindArrivalFocus(timeline, intent, target);
      bindPress(timeline, intent, cursorElement, target);
      var visibleUntil = intent.holdUntilSec || intent.releaseSec || intent.arriveSec;
      var sceneEnd = (parseFloat(scene.dataset.start || "0") || 0) +
        (parseFloat(scene.dataset.duration || "0") || 0);
      var hideAt = sceneEnd > visibleUntil
        ? Math.min(visibleUntil + 0.08, sceneEnd - 0.001)
        : visibleUntil;
      // Nav/list single-active (probe-audit-01): a cursor click that selects a
      // list item must clear the active state on its siblings, or a
      // default-active item stays highlighted beside the clicked one. The
      // components runtime owns the exclusive-active mechanism (ONE owner); route
      // the click through it at the press instant so the click, never a
      // per-target hack, defines HOW state changes. It self-guards to real
      // selection lists, so a click on a plain button is a no-op.
      if (
        (intent.action === "click" || intent.action === "press" ||
          intent.feedback === "press" || intent.feedback === "press-ripple") &&
        global.SequencesComponents &&
        typeof global.SequencesComponents.activateExclusiveItem === "function"
      ) {
        var activateAt = intent.pressSec != null ? intent.pressSec : intent.arriveSec;
        global.SequencesComponents.activateExclusiveItem(timeline, target, activateAt);
      }
      if (intent.action === "drag" && intent.pressSec != null && intent.releaseSec != null) {
        followTarget(
          timeline,
          root,
          scene,
          intent,
          cursorElement,
          hotspot,
          intent.arriveSec,
          intent.pressSec,
          intent.targetPart,
        );
      } else {
        followTarget(
          timeline,
          root,
          scene,
          intent,
          cursorElement,
          hotspot,
          intent.arriveSec,
          hideAt,
          intent.targetPart,
        );
      }
      var ripple = intent.ripplePart ? part(scene, intent.ripplePart) : null;
      if (intent.feedback === "ripple" || intent.feedback === "press-ripple") {
        bindRipple(timeline, root, scene, intent, target, ripple);
      }
      if (intent.action === "drag" && intent.dragTargetPart && intent.releaseSec != null) {
        var dragProxy = { p: 0 };
        timeline.to(dragProxy, {
          p: 1,
          duration: intent.releaseSec - intent.pressSec,
          ease: "none",
          onUpdate: function () {
            var start = targetPoint(scene, intent);
            var end = targetPoint(scene, intent, intent.dragTargetPart);
            if (!start || !end) return;
            place(root, cursorElement, pathPoint(root, start, end, intent, dragProxy.p), hotspot);
          },
        }, intent.pressSec);
        followTarget(
          timeline,
          root,
          scene,
          intent,
          cursorElement,
          hotspot,
          intent.releaseSec,
          hideAt,
          intent.dragTargetPart,
        );
      }
      pinTargetAt(
        timeline, root, scene, intent, cursorElement, hotspot, intent.arriveSec, intent.targetPart,
      );
      pinTargetAt(
        timeline, root, scene, intent, cursorElement, hotspot, intent.pressSec, intent.targetPart,
      );
      pinTargetAt(
        timeline,
        root,
        scene,
        intent,
        cursorElement,
        hotspot,
        intent.releaseSec,
        intent.action === "drag" && intent.dragTargetPart ? intent.dragTargetPart : intent.targetPart,
      );
      pinTargetAt(
        timeline,
        root,
        scene,
        intent,
        cursorElement,
        hotspot,
        intent.holdUntilSec,
        intent.action === "drag" && intent.dragTargetPart ? intent.dragTargetPart : intent.targetPart,
      );
      timeline.set(cursorElement, { opacity: 0 }, hideAt);
      bindings.push({ intent: intent, scene: scene, cursor: cursorElement, target: target, ripple: ripple });
    });
    global.__sequencesInteractionBindings = bindings;
    return bindings;
  }

  global.SequencesInteractions = Object.freeze({ version: VERSION, compile: compile });
})(window);
