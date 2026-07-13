/*
 * Sequences living-canvas runtime v1.
 *
 * Finite scene-local proxy tweens drive imagery/furniture/light as a pure
 * function of timeline position. No timers, RAF, wall clock, autoplay, or
 * infinite repeats: reverse and out-of-order seeks reproduce exact frames.
 * Camera worlds and text-bearing product pedestals are never transformed.
 */
(function (global) {
  "use strict";

  var VERSION = 1;
  var TAU = Math.PI * 2;
  var SETTLE_FEATHER_SEC = 0.18;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function smoothstep(value) {
    var t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function readPlan() {
    var island = document.getElementById("sequences-environment");
    if (!island) return null;
    var plan = JSON.parse(island.textContent || "{}");
    if (
      plan.version !== VERSION ||
      !plan.wallpaper ||
      !Array.isArray(plan.scenes)
    ) {
      throw new Error("unsupported sequences environment plan");
    }
    return plan;
  }

  function settleScaleAt(scenePlan, atSec) {
    var scale = 1;
    var windows = scenePlan.settleWindows || [];
    for (var index = 0; index < windows.length; index += 1) {
      var windowPlan = windows[index];
      var target = clamp(windowPlan.amplitudeScale, 0.08, 0.6);
      if (atSec >= windowPlan.startSec && atSec <= windowPlan.endSec) {
        scale = Math.min(scale, target);
        continue;
      }
      if (atSec < windowPlan.startSec && atSec >= windowPlan.startSec - SETTLE_FEATHER_SEC) {
        var entering = smoothstep(
          (atSec - (windowPlan.startSec - SETTLE_FEATHER_SEC)) / SETTLE_FEATHER_SEC,
        );
        scale = Math.min(scale, 1 + (target - 1) * entering);
      } else if (
        atSec > windowPlan.endSec &&
        atSec <= windowPlan.endSec + SETTLE_FEATHER_SEC
      ) {
        var leaving = smoothstep((atSec - windowPlan.endSec) / SETTLE_FEATHER_SEC);
        scale = Math.min(scale, target + (1 - target) * leaving);
      }
    }
    return scale;
  }

  function activityAt(scenePlan, atSec) {
    var direction = clamp(scenePlan.directionScore, 0, 1);
    return (0.35 + direction * 0.65) * settleScaleAt(scenePlan, atSec);
  }

  function wallpaperReadingScaleAt(scenePlan, atSec) {
    var scale = 1;
    var windows = scenePlan.readingWindows || [];
    for (var index = 0; index < windows.length; index += 1) {
      var windowPlan = windows[index];
      if (atSec >= windowPlan.startSec && atSec <= windowPlan.endSec) return 0;
      if (atSec < windowPlan.startSec && atSec >= windowPlan.startSec - SETTLE_FEATHER_SEC) {
        scale = Math.min(
          scale,
          1 - smoothstep(
            (atSec - (windowPlan.startSec - SETTLE_FEATHER_SEC)) / SETTLE_FEATHER_SEC,
          ),
        );
      } else if (
        atSec > windowPlan.endSec &&
        atSec <= windowPlan.endSec + SETTLE_FEATHER_SEC
      ) {
        scale = Math.min(
          scale,
          smoothstep((atSec - windowPlan.endSec) / SETTLE_FEATHER_SEC),
        );
      }
    }
    return scale;
  }

  function wallpaperPose(scenePlan, wallpaper, elapsedSec, activity) {
    var motion = wallpaper.motion;
    var phase = scenePlan.phaseRad || 0;
    var period = Math.max(8, scenePlan.periodSec || 16);
    var angle = TAU * elapsedSec / period + phase;
    var wave = Math.sin(angle);
    var cross = Math.cos(angle * 0.73 + phase * 0.31);
    var travel = Math.max(0, motion.maxTravelPercent || 0) * activity;
    var scaleDelta = Math.max(0, (motion.maxScale || 1) - 1) * activity;
    var x = 0;
    var y = 0;
    var scale = 1;
    switch (motion.mode) {
      case "micro-drift":
        x = travel * wave;
        y = travel * 0.46 * cross;
        scale = 1 + scaleDelta * (0.5 + 0.5 * cross);
        break;
      case "slow-pan-left":
        x = -travel * wave;
        scale = 1 + scaleDelta * (0.35 + 0.65 * (0.5 + 0.5 * cross));
        break;
      case "slow-pan-right":
        x = travel * wave;
        scale = 1 + scaleDelta * (0.35 + 0.65 * (0.5 + 0.5 * cross));
        break;
      case "slow-pan-up":
        y = -travel * wave;
        scale = 1 + scaleDelta * (0.35 + 0.65 * (0.5 + 0.5 * cross));
        break;
      case "slow-push":
        x = travel * 0.16 * cross;
        y = travel * 0.12 * wave;
        scale = 1 + scaleDelta * (0.5 + 0.5 * wave);
        break;
      case "static":
      default:
        break;
    }
    return {
      x: clamp(x, -motion.maxTravelPercent, motion.maxTravelPercent),
      y: clamp(y, -motion.maxTravelPercent, motion.maxTravelPercent),
      scale: clamp(scale, 1, motion.maxScale || 1),
    };
  }

  function fixed(value, places) {
    var power = Math.pow(10, places);
    return String(Math.round(value * power) / power);
  }

  function applyScene(scenePlan, wallpaper, environment, atSec) {
    var elapsed = clamp(atSec, scenePlan.startSec, scenePlan.endSec) - scenePlan.startSec;
    var activity = activityAt(scenePlan, atSec);
    var phase = scenePlan.phaseRad || 0;
    var period = Math.max(8, scenePlan.periodSec || 16);
    var angle = TAU * elapsed / period + phase;
    environment.style.setProperty("--seq-env-activity", fixed(activity, 6));

    var image = environment.querySelector("[data-env-wallpaper]");
    if (image) {
      var wallpaperActivity = activity * wallpaperReadingScaleAt(scenePlan, atSec);
      environment.style.setProperty(
        "--seq-env-wallpaper-activity",
        fixed(wallpaperActivity, 6),
      );
      var pose = wallpaperPose(scenePlan, wallpaper, elapsed, wallpaperActivity);
      image.style.transform =
        "translate3d(" + fixed(pose.x, 5) + "%," + fixed(pose.y, 5) + "%,0) " +
        "scale(" + fixed(pose.scale, 6) + ")";
    }

    var floats = environment.querySelectorAll("[data-env-float]");
    for (var index = 0; index < floats.length; index += 1) {
      var offset = index * 1.73;
      var maxPx = Math.min(4, Math.max(0, scenePlan.furnitureMaxPx || 0)) * activity;
      var x = Math.sin(angle + offset) * maxPx;
      var y = Math.cos(angle * 0.81 + offset * 0.67) * maxPx * 0.72;
      floats[index].style.transform =
        "translate3d(" + fixed(x, 4) + "px," + fixed(y, 4) + "px,0)";
    }

    var lights = environment.querySelectorAll("[data-env-light]");
    for (var lightIndex = 0; lightIndex < lights.length; lightIndex += 1) {
      var lightOffset = lightIndex * 2.11;
      var lightMax = Math.min(4, Math.max(0, scenePlan.lightMaxPx || 0)) * activity;
      var lx = Math.sin(angle * 0.61 + lightOffset) * lightMax;
      var ly = Math.cos(angle * 0.53 + lightOffset) * lightMax;
      lights[lightIndex].style.transform =
        "translate3d(" + fixed(lx, 4) + "px," + fixed(ly, 4) + "px,0)";
      lights[lightIndex].style.opacity = fixed(
        0.14 + (0.5 + 0.5 * Math.sin(angle + lightOffset)) * 0.08 * activity,
        5,
      );
    }
    return activity;
  }

  function compileScene(timeline, root, wallpaper, scenePlan) {
    var scene = root.querySelector('[data-scene="' + CSS.escape(scenePlan.sceneId) + '"]');
    if (!scene) throw new Error('environment plan references absent scene "' + scenePlan.sceneId + '"');
    var environment = scene.querySelector(
      ':scope > [data-sequences-environment][data-env-scene="' +
        CSS.escape(scenePlan.sceneId) + '"]',
    );
    if (!environment) {
      throw new Error('environment markup is absent for scene "' + scenePlan.sceneId + '"');
    }
    var duration = Math.max(0.01, scenePlan.endSec - scenePlan.startSec);
    var proxy = { progress: 0 };
    applyScene(scenePlan, wallpaper, environment, scenePlan.startSec);
    timeline.fromTo(proxy, { progress: 0 }, {
      progress: 1,
      duration: duration,
      ease: "none",
      immediateRender: false,
      onUpdate: function () {
        applyScene(
          scenePlan,
          wallpaper,
          environment,
          scenePlan.startSec + proxy.progress * duration,
        );
      },
    }, scenePlan.startSec);
    return {
      sceneId: scenePlan.sceneId,
      shape: scenePlan.shape,
      wallpaperId: scenePlan.shape === "generated-field" ? null : wallpaper.id,
      ambientNodes: environment.querySelectorAll("[data-sequences-ambient]").length,
    };
  }

  function compile(timeline, root) {
    if (!timeline || !root) {
      throw new Error("SequencesEnvironment.compile requires timeline + root");
    }
    var plan = readPlan();
    if (!plan) return [];
    var bindings = [];
    for (var index = 0; index < plan.scenes.length; index += 1) {
      bindings.push(compileScene(timeline, root, plan.wallpaper, plan.scenes[index]));
    }
    global.__sequencesEnvironmentBindings = bindings;
    return bindings;
  }

  global.SequencesEnvironment = Object.freeze({
    version: VERSION,
    activityAt: activityAt,
    compile: compile,
  });
})(window);
