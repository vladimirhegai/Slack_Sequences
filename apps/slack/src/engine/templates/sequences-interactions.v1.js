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
    var element = part(scene, targetName || intent.targetPart);
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
    return { x: point.x - rootRect.left, y: point.y - rootRect.top };
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

  function place(root, element, point, hotspot) {
    var local = localize(root, point);
    var width = element.offsetWidth || element.getBoundingClientRect().width;
    var height = element.offsetHeight || element.getBoundingClientRect().height;
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
    timeline.set(ripple, { opacity: 0, scale: 0.2 }, intent.pressSec);
    timeline.to(tracker, {
      p: 1,
      duration: duration,
      ease: "none",
      onUpdate: function () {
        var point = targetPoint(scene, intent);
        if (!point) return;
        var local = localize(root, point);
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
      var target = scene && part(scene, intent.targetPart);
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
          var progress = ease(proxy.p);
          place(root, cursorElement, pathPoint(root, start, end, intent, progress), hotspot);
        },
      }, intent.startSec);
      bindPress(timeline, intent, cursorElement, target);
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
          intent.holdUntilSec || intent.releaseSec || intent.arriveSec,
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
          intent.holdUntilSec || intent.releaseSec,
          intent.dragTargetPart,
        );
      }
      var visibleUntil = intent.holdUntilSec || intent.releaseSec || intent.arriveSec;
      var sceneEnd = (parseFloat(scene.dataset.start || "0") || 0) +
        (parseFloat(scene.dataset.duration || "0") || 0);
      var hideAt = sceneEnd > visibleUntil
        ? Math.min(visibleUntil + 0.08, sceneEnd - 0.001)
        : visibleUntil;
      timeline.set(cursorElement, { opacity: 0 }, hideAt);
      bindings.push({ intent: intent, scene: scene, cursor: cursorElement, target: target, ripple: ripple });
    });
    global.__sequencesInteractionBindings = bindings;
    return bindings;
  }

  global.SequencesInteractions = Object.freeze({ version: VERSION, compile: compile });
})(window);
