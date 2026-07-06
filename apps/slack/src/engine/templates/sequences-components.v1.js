(function (global) {
  "use strict";

  var VERSION = 1;

  function fail(beatId, reason) {
    throw new Error('could not bind component beat "' + beatId + '": ' + reason);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  // Absolute layout-space position via the offset chain, so transforms applied
  // by entrances/camera cannot poison measurement (offsets are layout truth).
  function layoutPosition(element) {
    var x = 0;
    var y = 0;
    var node = element;
    while (node && node !== document.body) {
      x += node.offsetLeft || 0;
      y += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return { x: x, y: y, width: element.offsetWidth || 1, height: element.offsetHeight || 1 };
  }

  // Entrance-style reveal: default immediateRender pre-renders the hidden
  // from-state at build time — exactly the authored-entrance contract.
  function reveal(timeline, target, fromVars, toVars, at) {
    timeline.fromTo(target, fromVars, toVars, at);
  }

  // Later motion on properties an earlier tween may own: never re-render the
  // from-state at build.
  function move(timeline, target, fromVars, toVars, at) {
    toVars.immediateRender = false;
    timeline.fromTo(target, fromVars, toVars, at);
  }

  function firstMatch(scope, selectors) {
    for (var i = 0; i < selectors.length; i += 1) {
      var found = scope.querySelector(selectors[i]);
      if (found) return found;
    }
    return null;
  }

  function childItems(el) {
    var found = el.querySelectorAll(".cmp-row");
    if (!found.length) found = el.querySelectorAll(".cmp-item");
    if (!found.length) found = el.querySelectorAll(".cmp-card");
    if (!found.length) found = el.querySelectorAll(".cmp-msg");
    if (!found.length) found = el.querySelectorAll(":scope > i");
    return Array.prototype.slice.call(found);
  }

  function textSlot(el) {
    return firstMatch(el, ["[data-cmp-text]", ".cmp-text"]) || el;
  }

  function ensureCaret(slot) {
    var next = slot.nextElementSibling;
    if (next && next.classList && next.classList.contains("cmp-caret")) return next;
    var caret = document.createElement("span");
    caret.className = "cmp-caret";
    caret.setAttribute("aria-hidden", "true");
    if (slot.parentNode) slot.parentNode.insertBefore(caret, slot.nextSibling);
    return caret;
  }

  function setState(timeline, el, state, at) {
    timeline.set(el, { attr: { "data-state": state } }, at);
  }

  /* ------------------------------------------------------------- beats */

  function compileType(timeline, el, beat) {
    var slot = textSlot(el);
    var full = beat.text != null ? String(beat.text) : (slot.textContent || "");
    slot.textContent = "";
    var caret = ensureCaret(slot);
    var duration = beat.endSec - beat.startSec;
    var proxy = { n: 0 };
    move(timeline, proxy, { n: 0 }, {
      n: full.length,
      duration: duration,
      ease: "none",
      onUpdate: function () {
        slot.textContent = full.slice(0, Math.round(proxy.n));
      },
    }, beat.startSec);
    timeline.set(caret, { opacity: 1 }, Math.max(0, beat.startSec - 0.15));
    timeline.set(caret, { opacity: 0 }, beat.endSec + 0.35);
  }

  function compileStream(timeline, el, beat) {
    var bubble = firstMatch(el, ["[data-cmp-stream]", ".cmp-msg.cmp-ai"]) || textSlot(el);
    var full = beat.text != null ? String(beat.text) : (bubble.textContent || "");
    var words = full.split(/\s+/).filter(Boolean);
    bubble.textContent = "";
    var typing = el.querySelector(".cmp-typing");
    if (typing) {
      timeline.set(typing, { opacity: 1 }, Math.max(0, beat.startSec - 0.9));
      timeline.set(typing, { opacity: 0 }, beat.startSec + 0.02);
    }
    reveal(timeline, bubble, { opacity: 0, y: 14 }, {
      opacity: 1,
      y: 0,
      duration: 0.35,
      ease: "power3.out",
    }, beat.startSec);
    var duration = Math.max(0.2, beat.endSec - beat.startSec - 0.25);
    var proxy = { n: 0 };
    move(timeline, proxy, { n: 0 }, {
      n: words.length,
      duration: duration,
      ease: "none",
      onUpdate: function () {
        bubble.textContent = words.slice(0, Math.round(proxy.n)).join(" ");
      },
    }, beat.startSec + 0.25);
  }

  function compileCount(timeline, el, beat) {
    var slot = firstMatch(el, ["[data-cmp-value]", ".cmp-value"]) || el;
    var finalText = slot.textContent || "";
    var match = finalText.match(/-?\d[\d,]*(?:\.\d+)?/);
    var prefix = match ? finalText.slice(0, match.index) : "";
    var suffix = match ? finalText.slice(match.index + match[0].length) : "";
    var grouped = match ? match[0].indexOf(",") >= 0 : false;
    var decimals = match && match[0].indexOf(".") >= 0
      ? match[0].split(".")[1].length
      : 0;
    var target = typeof beat.value === "number"
      ? beat.value
      : match ? Number(match[0].replace(/,/g, "")) : 0;
    var format = function (value) {
      var fixed = value.toFixed(decimals);
      if (grouped) {
        var parts = fixed.split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        fixed = parts.join(".");
      }
      return prefix + fixed + suffix;
    };
    slot.textContent = format(0);
    var proxy = { v: 0 };
    move(timeline, proxy, { v: 0 }, {
      v: target,
      duration: beat.endSec - beat.startSec,
      ease: beat.ease,
      onUpdate: function () {
        slot.textContent = format(proxy.v);
      },
    }, beat.startSec);
  }

  function compileProgress(timeline, el, beat) {
    var value = typeof beat.value === "number" ? clamp(beat.value, 0, 1) : 1;
    var duration = beat.endSec - beat.startSec;
    var ring = el.querySelector(".cmp-ring-fg");
    if (ring && typeof ring.getTotalLength === "function") {
      var length = ring.getTotalLength();
      ring.style.strokeDasharray = String(length);
      move(timeline, ring, { strokeDashoffset: length }, {
        strokeDashoffset: length * (1 - value),
        duration: duration,
        ease: beat.ease,
      }, beat.startSec);
      return;
    }
    var fill = firstMatch(el, ["[data-cmp-fill]", ":scope > i"]);
    if (!fill) fail(beat.id, "progress component has no fill element");
    move(timeline, fill, { scaleX: 0 }, {
      scaleX: value,
      duration: duration,
      ease: beat.ease,
    }, beat.startSec);
  }

  function compileChart(timeline, el, beat) {
    var duration = beat.endSec - beat.startSec;
    var stroke = el.querySelector("svg polyline, svg path");
    if (stroke && typeof stroke.getTotalLength === "function") {
      var length = stroke.getTotalLength();
      stroke.style.strokeDasharray = String(length);
      move(timeline, stroke, { strokeDashoffset: length }, {
        strokeDashoffset: 0,
        duration: duration,
        ease: beat.ease,
      }, beat.startSec);
      return;
    }
    var bars = childItems(el);
    if (!bars.length) fail(beat.id, "chart component has no bars or stroke");
    var step = bars.length > 1 ? (duration * 0.55) / (bars.length - 1) : 0;
    var each = Math.max(0.25, duration * 0.45);
    for (var i = 0; i < bars.length; i += 1) {
      reveal(timeline, bars[i], { scaleY: 0 }, {
        scaleY: 1,
        duration: each,
        ease: beat.ease,
      }, beat.startSec + step * i);
    }
  }

  function compileRows(timeline, el, beat) {
    var rows = childItems(el);
    if (!rows.length) fail(beat.id, "component has no rows/items to reveal");
    var duration = beat.endSec - beat.startSec;
    var step = rows.length > 1 ? (duration * 0.62) / (rows.length - 1) : 0;
    var each = Math.max(0.22, duration * 0.38);
    for (var i = 0; i < rows.length; i += 1) {
      reveal(timeline, rows[i], { opacity: 0, y: 14 }, {
        opacity: 1,
        y: 0,
        duration: each,
        ease: beat.ease,
      }, beat.startSec + step * i);
    }
  }

  function openTargets(el) {
    var menu = firstMatch(el, [".cmp-results", ".cmp-menu"]);
    if (menu) return { panel: menu, items: childItems(menu) };
    var dialog = el.querySelector(".cmp-dialog");
    if (dialog) return { panel: dialog, scrim: el.querySelector(".cmp-scrim"), items: [] };
    return { panel: el, items: [] };
  }

  function compileOpen(timeline, el, beat) {
    var target = openTargets(el);
    var duration = beat.endSec - beat.startSec;
    setState(timeline, el, "open", beat.startSec);
    if (target.scrim) {
      reveal(timeline, target.scrim, { opacity: 0 }, {
        opacity: 1,
        duration: duration * 0.5,
        ease: "power2.out",
      }, beat.startSec);
    }
    reveal(timeline, target.panel, { opacity: 0, y: -10, scale: 0.96 }, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: duration * 0.7,
      ease: beat.ease,
    }, beat.startSec);
    var step = target.items.length > 1
      ? (duration * 0.45) / (target.items.length - 1)
      : 0;
    for (var i = 0; i < target.items.length; i += 1) {
      reveal(timeline, target.items[i], { opacity: 0, y: -8 }, {
        opacity: 1,
        y: 0,
        duration: Math.max(0.18, duration * 0.4),
        ease: "power3.out",
      }, beat.startSec + duration * 0.25 + step * i);
    }
  }

  function compileClose(timeline, el, beat) {
    var target = openTargets(el);
    var duration = beat.endSec - beat.startSec;
    move(timeline, target.panel, { opacity: 1, y: 0, scale: 1 }, {
      opacity: 0,
      y: -8,
      scale: 0.97,
      duration: duration,
      ease: beat.ease,
    }, beat.startSec);
    if (target.scrim) {
      move(timeline, target.scrim, { opacity: 1 }, {
        opacity: 0,
        duration: duration,
        ease: "power2.in",
      }, beat.startSec);
    }
    setState(timeline, el, "closed", beat.endSec);
  }

  function compileSelect(timeline, el, beat) {
    var items = childItems(el);
    if (!items.length) fail(beat.id, "component has no items to select");
    var index = clamp((beat.item || 1) - 1, 0, items.length - 1);
    var chosen = items[index];
    var duration = beat.endSec - beat.startSec;
    for (var i = 0; i < items.length; i += 1) {
      timeline.set(items[i], {
        attr: { "data-active": i === index ? "true" : "false" },
      }, beat.startSec + duration * 0.4);
    }
    move(timeline, chosen, { scale: 1 }, {
      scale: 0.96,
      duration: duration * 0.35,
      ease: "power2.in",
    }, beat.startSec);
    move(timeline, chosen, { scale: 0.96 }, {
      scale: 1,
      duration: duration * 0.65,
      ease: beat.ease,
    }, beat.startSec + duration * 0.35);
  }

  function compilePress(timeline, el, beat) {
    var duration = beat.endSec - beat.startSec;
    move(timeline, el, { scale: 1 }, {
      scale: 0.94,
      duration: duration * 0.3,
      ease: "power2.in",
    }, beat.startSec);
    move(timeline, el, { scale: 0.94 }, {
      scale: 1,
      duration: duration * 0.7,
      ease: beat.ease,
    }, beat.startSec + duration * 0.3);
    if (beat.toState) setState(timeline, el, beat.toState, beat.startSec + duration * 0.5);
  }

  function compileSetState(timeline, el, beat) {
    var duration = beat.endSec - beat.startSec;
    var knob = el.querySelector(".cmp-knob");
    if (knob) {
      // Toggle: the runtime owns knob travel; CSS owns per-state color.
      var travel = Math.max(
        0,
        el.clientWidth - knob.offsetWidth - knob.offsetLeft * 2,
      );
      var on = beat.toState !== "off";
      move(timeline, knob, { x: on ? 0 : travel }, {
        x: on ? travel : 0,
        duration: duration,
        ease: "seqMicrobounce",
      }, beat.startSec);
      setState(timeline, el, beat.toState, beat.startSec + duration * 0.5);
      return;
    }
    setState(timeline, el, beat.toState, beat.startSec + Math.min(0.1, duration * 0.5));
  }

  function compileHighlight(timeline, el, beat) {
    var ring = el.querySelector(".cmp-highlight-ring");
    if (!ring) {
      ring = document.createElement("span");
      ring.className = "cmp-highlight-ring";
      ring.setAttribute("aria-hidden", "true");
      el.appendChild(ring);
    }
    var duration = beat.endSec - beat.startSec;
    move(timeline, ring, { opacity: 0, scale: 0.94 }, {
      opacity: 0.95,
      scale: 1,
      duration: duration * 0.35,
      ease: "power2.out",
    }, beat.startSec);
    move(timeline, ring, { opacity: 0.95, scale: 1 }, {
      opacity: 0,
      scale: 1.05,
      duration: duration * 0.65,
      ease: "power2.in",
    }, beat.startSec + duration * 0.35);
  }

  function compileSwap(timeline, el, beat) {
    var slot = firstMatch(el, ["[data-cmp-value]", ".cmp-value", "[data-cmp-text]", ".cmp-text", ".cmp-title"]) || el;
    var duration = beat.endSec - beat.startSec;
    var incoming = String(beat.text || "");
    slot.style.position = slot.style.position || "relative";
    var old = document.createElement("span");
    old.className = "cmp-swap-old";
    while (slot.firstChild) old.appendChild(slot.firstChild);
    var next = document.createElement("span");
    next.className = "cmp-swap-new";
    next.textContent = incoming;
    next.style.position = "absolute";
    next.style.left = "0";
    next.style.top = "0";
    old.style.display = "inline-block";
    next.style.display = "inline-block";
    slot.appendChild(old);
    slot.appendChild(next);
    move(timeline, old, { y: 0, opacity: 1 }, {
      y: "-0.6em",
      opacity: 0,
      duration: duration * 0.45,
      ease: "power2.in",
    }, beat.startSec);
    reveal(timeline, next, { y: "0.6em", opacity: 0 }, {
      y: 0,
      opacity: 1,
      duration: duration * 0.55,
      ease: beat.ease,
    }, beat.startSec + duration * 0.4);
  }

  // An overlay kind's root spans the whole scene (.cmp-modal is inset:0 with a
  // centered .cmp-dialog inside): the FLIP must land on the VISUAL surface,
  // never the overlay root — morphing a search pill onto a full-scene rect is
  // the 2026-07-06 "weird morphing" artifact.
  function morphVisualBox(el) {
    return el.querySelector(".cmp-dialog") || el;
  }

  function compileMorph(timeline, scene, el, beat) {
    var target = scene.querySelector('[data-part="' + CSS.escape(beat.morphTo) + '"]');
    if (!target) fail(beat.id, 'morph target "' + beat.morphTo + '" is absent');
    var from = layoutPosition(morphVisualBox(el));
    var to = layoutPosition(morphVisualBox(target));
    var duration = beat.endSec - beat.startSec;
    var revealAt = beat.startSec + duration * 0.45;
    // The twin arrives only through this morph: pre-rendered hidden at build.
    // A morph IS the twin's entrance, so it must do everything `open` would —
    // kit CSS keeps an overlay's scrim/panel/items at opacity 0 until opened,
    // and a separate `open` beat on a morphed-in twin is deduped at plan time
    // (it would re-run the entrance over this reveal and flash).
    reveal(timeline, target, { opacity: 0 }, {
      opacity: 1,
      duration: duration * 0.45,
      ease: "power2.out",
    }, revealAt);
    setState(timeline, target, "open", revealAt);
    var opened = openTargets(target);
    if (opened.scrim) {
      reveal(timeline, opened.scrim, { opacity: 0 }, {
        opacity: 1,
        duration: Math.max(0.2, duration * 0.4),
        ease: "power2.out",
      }, revealAt);
    }
    if (opened.panel && opened.panel !== target) {
      reveal(timeline, opened.panel, { opacity: 0 }, {
        opacity: 1,
        duration: Math.max(0.2, duration * 0.45),
        ease: "power2.out",
      }, revealAt);
    }
    var itemStep = opened.items.length > 1
      ? (duration * 0.3) / (opened.items.length - 1)
      : 0;
    for (var i = 0; i < opened.items.length; i += 1) {
      reveal(timeline, opened.items[i], { opacity: 0, y: -8 }, {
        opacity: 1,
        y: 0,
        duration: Math.max(0.18, duration * 0.3),
        ease: "power3.out",
      }, revealAt + itemStep * i);
    }
    move(timeline, el, {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      transformOrigin: "0 0",
    }, {
      x: to.x - from.x,
      y: to.y - from.y,
      scaleX: to.width / from.width,
      scaleY: to.height / from.height,
      duration: duration,
      ease: beat.ease,
    }, beat.startSec);
    move(timeline, el, { opacity: 1 }, {
      opacity: 0,
      duration: duration * 0.4,
      ease: "power2.in",
    }, beat.startSec + duration * 0.55);
  }

  /* ------------------------------------------------------------ compile */

  var COMPILERS = {
    type: compileType,
    stream: compileStream,
    count: compileCount,
    progress: compileProgress,
    chart: compileChart,
    rows: compileRows,
    open: compileOpen,
    close: compileClose,
    select: compileSelect,
    press: compilePress,
    "set-state": compileSetState,
    highlight: compileHighlight,
    swap: compileSwap,
  };

  // Follow-through: beats declared at the same instant land 45ms apart, in
  // declaration order, so elements settle in cascade instead of freezing on
  // one shared frame. The shift stays far below the moment-evidence window.
  function staggerBeats(beats) {
    var ordered = beats.slice().sort(function (a, b) { return a.startSec - b.startSec; });
    var clusterStart = null;
    var clusterIndex = 0;
    var result = [];
    for (var i = 0; i < ordered.length; i += 1) {
      var beat = ordered[i];
      if (clusterStart !== null && beat.startSec - clusterStart <= 0.05) {
        clusterIndex += 1;
        var offset = clusterIndex * 0.045;
        beat = Object.assign({}, beat, {
          startSec: beat.startSec + offset,
          endSec: beat.endSec + offset,
        });
      } else {
        clusterStart = beat.startSec;
        clusterIndex = 0;
      }
      result.push(beat);
    }
    return result;
  }

  function compileScene(timeline, root, scenePlan) {
    var scene = root.querySelector('[data-scene="' + CSS.escape(scenePlan.sceneId) + '"]');
    if (!scene) {
      throw new Error('component plan references absent scene "' + scenePlan.sceneId + '"');
    }
    var bound = 0;
    var beats = staggerBeats(scenePlan.beats);
    for (var i = 0; i < beats.length; i += 1) {
      var beat = beats[i];
      var el = scene.querySelector('[data-part="' + CSS.escape(beat.component) + '"]');
      if (!el) fail(beat.id, 'component "' + beat.component + '" is absent');
      if (beat.kind === "morph") {
        compileMorph(timeline, scene, el, beat);
      } else {
        var compiler = COMPILERS[beat.kind];
        if (!compiler) fail(beat.id, 'beat kind "' + beat.kind + '" is unsupported');
        compiler(timeline, el, beat);
      }
      bound += 1;
    }
    return { sceneId: scenePlan.sceneId, beats: bound };
  }

  function compile(timeline, root) {
    if (!timeline || !root) {
      throw new Error("SequencesComponents.compile requires timeline + root");
    }
    var island = document.getElementById("sequences-components");
    if (!island) return [];
    var plan = JSON.parse(island.textContent || "{}");
    if (plan.version !== VERSION || !Array.isArray(plan.scenes)) {
      throw new Error("unsupported sequences components plan");
    }
    var bindings = [];
    plan.scenes.forEach(function (scenePlan) {
      bindings.push(compileScene(timeline, root, scenePlan));
    });
    global.__sequencesComponentBindings = bindings;
    return bindings;
  }

  global.SequencesComponents = Object.freeze({
    version: VERSION,
    compile: compile,
  });
})(window);
