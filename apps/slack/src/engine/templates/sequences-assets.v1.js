(function (global) {
  "use strict";

  var VERSION = 1;

  function fail(beatId, reason) {
    throw new Error('could not bind asset beat "' + beatId + '": ' + reason);
  }

  // Linear interpolation over the host-sampled spring curve. `linear()`-style
  // samples preserve overshoot (values may exceed 1); endpoints are pinned to
  // 0/1 by the host sampler, so end states are exact. Every value is a pure
  // function of progress — deterministic under out-of-order seek.
  function sampledEase(samples) {
    var last = samples.length - 1;
    return function (progress) {
      if (progress <= 0) return samples[0];
      if (progress >= 1) return samples[last];
      var position = progress * last;
      var index = Math.floor(position);
      var t = position - index;
      return samples[index] * (1 - t) + samples[index + 1] * t;
    };
  }

  function compileBeat(timeline, scene, beat, isFirstForPart) {
    var el = scene.querySelector('[data-part="' + CSS.escape(beat.part) + '"]');
    if (!el) fail(beat.id, 'asset unit "' + beat.part + '" is absent');
    var legSec = Math.max(0.01, (beat.endSec - beat.startSec) / (beat.yoyo ? 2 : 1));
    var vars = {
      duration: legSec,
      ease: sampledEase(beat.ease),
    };
    for (var key in beat.to) vars[key] = beat.to[key];
    if (beat.yoyo) {
      vars.repeat = 1;
      vars.yoyo = true;
    }
    if (isFirstForPart) {
      // Entrance discipline (the components-runtime reveal() precedent): the
      // first beat on a unit pre-renders its from-state at build, so every
      // pre-entrance frame shows the unit hidden/at-rest exactly as authored.
      timeline.fromTo(el, beat.from, vars, beat.startSec);
      return;
    }
    // Later motion never re-renders its from-state at build (move()
    // semantics); building payoffs write their custom-prop from-values inline
    // so a pre-beat seek shows the empty state instead of the flash-of-full
    // tell (the compileProgress precedent — the inline write IS the pre-beat
    // frame, and GSAP's fromTo takes over from the beat onward).
    vars.immediateRender = false;
    if (beat.preBeat) {
      for (var prop in beat.preBeat) el.style.setProperty(prop, beat.preBeat[prop]);
    }
    timeline.fromTo(el, beat.from, vars, beat.startSec);
  }

  function compileScene(timeline, root, scenePlan) {
    var scene = root.querySelector('[data-scene="' + CSS.escape(scenePlan.sceneId) + '"]');
    if (!scene) {
      throw new Error('asset plan references absent scene "' + scenePlan.sceneId + '"');
    }
    var seenParts = {};
    var bound = 0;
    for (var i = 0; i < scenePlan.beats.length; i += 1) {
      var beat = scenePlan.beats[i];
      compileBeat(timeline, scene, beat, !seenParts[beat.part]);
      seenParts[beat.part] = true;
      bound += 1;
    }
    return { sceneId: scenePlan.sceneId, beats: bound };
  }

  function compile(timeline, root) {
    if (!timeline || !root) {
      throw new Error("SequencesAssets.compile requires timeline + root");
    }
    var island = document.getElementById("sequences-assets");
    if (!island) return [];
    var plan = JSON.parse(island.textContent || "{}");
    if (plan.version !== VERSION || !Array.isArray(plan.scenes)) {
      throw new Error("unsupported sequences assets plan");
    }
    var bindings = [];
    plan.scenes.forEach(function (scenePlan) {
      bindings.push(compileScene(timeline, root, scenePlan));
    });
    global.__sequencesAssetBindings = bindings;
    return bindings;
  }

  global.SequencesAssets = Object.freeze({
    version: VERSION,
    compile: compile,
  });
})(window);
