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

  // One entrance owner per text element (probe-audit-03): a `type`/split reveal
  // never moves its own slot, but an AUTHORED from-below/opacity reveal on the
  // same element makes the line type WHILE sliding up. Hold the slot's own
  // transform (and, for the plain typewriter, opacity) steady across the beat
  // window with a spanning identity tween. The component runtime compiles AFTER
  // the authored tweens and GSAP resolves overlapping same-property tweens by
  // timeline position (the later child wins per frame), so this pins the window
  // WITHOUT touching the author's tween object — seek-safe by construction
  // (immediateRender:false reverts control before beat.startSec, the move()
  // precedent). Split styles own their per-unit opacity, so they pin x/y only.
  function pinSlotIdentity(timeline, slot, beat, pinOpacity) {
    var from = { x: 0, y: 0 };
    var to = { x: 0, y: 0, duration: Math.max(0.01, beat.endSec - beat.startSec), ease: "none" };
    if (pinOpacity) {
      from.opacity = 1;
      to.opacity = 1;
    }
    move(timeline, slot, from, to, beat.startSec);
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

  /* ------------------------------------------------ exclusive list selection */
  // Nav/list single-active (probe-audit-01): when a list item becomes active,
  // its siblings must go inactive, or a default-active item stays highlighted
  // beside the selected one (TWO active nav items). The kit doesn't own state
  // motion, so the runtime clears siblings — for a `select` beat AND for a
  // cursor click (routed here from the interactions runtime, so the beat/click,
  // never a per-target hack, owns HOW state changes). Every write is a
  // zero-duration timeline.set: GSAP records the built value and reverts it on a
  // backward seek, so the authored state is restored under out-of-order seek.

  // Which channel the authored markup uses to mark an item active.
  function itemActiveState(item) {
    if (item.getAttribute && item.getAttribute("data-active") === "true") return "data-active";
    if (item.getAttribute && item.getAttribute("data-state") === "active") return "data-state";
    if (item.classList && item.classList.contains("active")) return "class";
    return "";
  }

  function setItemActive(timeline, item, active, mechanism, atSec) {
    if (mechanism === "data-state") {
      timeline.set(item, { attr: { "data-state": active ? "active" : "inactive" } }, atSec);
      return;
    }
    if (mechanism === "class") {
      var base = (item.className || "").replace(/(^|\s)active(?=\s|$)/g, "").replace(/\s+/g, " ").trim();
      timeline.set(item, { className: active ? (base ? base + " active" : "active") : base }, atSec);
      return;
    }
    timeline.set(item, { attr: { "data-active": active ? "true" : "false" } }, atSec);
  }

  // The channel a set of items uses (whatever one already carries), default
  // data-active — the kit's own active selector across sidebar/tabs/table.
  function activeMechanismOf(items) {
    for (var i = 0; i < items.length; i += 1) {
      var mechanism = itemActiveState(items[i]);
      if (mechanism) return mechanism;
    }
    return "data-active";
  }

  // Make exactly `chosen` active among `items`, at `atSec`. Each item also gets a
  // t=0 set of its AUTHORED state: a gained-active item is authored inactive, and
  // GSAP cannot restore "no attribute" under immediateRender on a backward seek,
  // so the t=0 anchor is the value the seek reverts to (the addEchoTrail /
  // compileSwap seek-safety precedent). The anchor reproduces the authored visual
  // state exactly (the kit's active selector only matches the active token).
  function activateAmong(timeline, items, chosen, atSec) {
    var mechanism = activeMechanismOf(items);
    for (var i = 0; i < items.length; i += 1) {
      setItemActive(timeline, items[i], Boolean(itemActiveState(items[i])), mechanism, 0);
      setItemActive(timeline, items[i], items[i] === chosen, mechanism, atSec);
    }
  }

  // The item's exclusive-selection peers: same-signature direct siblings under
  // one parent. childItems() only knows kit classes (.cmp-row/.cmp-item/…), but
  // authored navs use their own class (.sidebar-item), so match on the item's
  // own leading class token (else its tag).
  function listSiblings(item) {
    var parent = item.parentElement;
    if (!parent) return [item];
    var token = (item.className || "").trim().split(/\s+/)[0] || "";
    var out = [];
    var kids = parent.children;
    for (var i = 0; i < kids.length; i += 1) {
      var kid = kids[i];
      if (kid === item) { out.push(kid); continue; }
      var kidToken = (kid.className || "").trim().split(/\s+/)[0] || "";
      if (token ? kidToken === token : kid.tagName === item.tagName) out.push(kid);
    }
    return out.length ? out : [item];
  }

  // Cursor-driven exclusive activation (called from the interactions runtime).
  // Fires only when the target has real peers AND one already carries an active
  // marker — proof this is a selection list, not arbitrary content — so a click
  // on a plain button never grows a spurious active state.
  function activateExclusiveItem(timeline, item, atSec) {
    if (!item || atSec == null) return;
    var siblings = listSiblings(item);
    if (siblings.length < 2) return;
    var hasActive = false;
    for (var i = 0; i < siblings.length; i += 1) {
      if (itemActiveState(siblings[i])) { hasActive = true; break; }
    }
    if (!hasActive) return;
    activateAmong(timeline, siblings, item, atSec);
  }

  // Deterministic 32-bit string hash + seeded [0,1) generator — the assemble
  // scatter is a pure function of (beat.id, letter index), so two compiles of
  // the same storyboard produce byte-identical positions (no clocks, no random).
  function hashCode(str) {
    var h = 0;
    for (var i = 0; i < str.length; i += 1) {
      h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
    }
    return h;
  }
  function seededUnit(seed) {
    var t = (seed + 0x6d2b79f5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Split the slot's copy into inline-block per-word or per-letter spans WITHOUT
  // reflowing the measured layout (transforms only; whitespace stays as text
  // nodes so line-wrapping and width are unchanged; the authored text is the
  // final state). Returns the animatable unit spans in reading order.
  function makeUnitSpan(text) {
    var span = document.createElement("span");
    span.className = "cmp-split";
    span.style.display = "inline-block";
    span.style.whiteSpace = "pre";
    span.textContent = text;
    return span;
  }
  function splitSlot(slot, full, perWord) {
    slot.textContent = "";
    slot.style.position = "relative";
    slot.style.overflow = "visible";
    var units = [];
    if (perWord) {
      var parts = full.split(/(\s+)/);
      for (var i = 0; i < parts.length; i += 1) {
        var part = parts[i];
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          slot.appendChild(document.createTextNode(part));
        } else {
          var wordSpan = makeUnitSpan(part);
          slot.appendChild(wordSpan);
          units.push(wordSpan);
        }
      }
    } else {
      for (var j = 0; j < full.length; j += 1) {
        var ch = full.charAt(j);
        if (ch === " " || ch === "\t" || ch === "\n") {
          slot.appendChild(document.createTextNode(ch));
        } else {
          var letterSpan = makeUnitSpan(ch);
          slot.appendChild(letterSpan);
          units.push(letterSpan);
        }
      }
    }
    return units;
  }

  /* ------------------------------------------------------------- beats */

  // MD3 kinetic headline reveals. `rise` (staggered fade + lift), `pop`
  // (staggered scale-from-small with the seqPop overshoot), and `assemble` (the
  // echo word-split: seeded rectilinear scatter converging with echo trails and
  // a whole-word glow at lock). Every value is a pure function of timeline time.
  function compileSplitType(timeline, el, beat, style) {
    var slot = textSlot(el);
    var full = beat.text != null ? String(beat.text) : (slot.textContent || "");
    if (!full) return;
    // Pin the slot's transform for the window (x/y only — the per-unit spans
    // own opacity/scale). One-entrance-owner rule, shared with compileType.
    pinSlotIdentity(timeline, slot, beat, false);
    var duration = beat.endSec - beat.startSec;
    var wordCount = full.split(/\s+/).filter(Boolean).length;
    // rise: per-word for a sentence (>6 words), else per-letter; pop: per-word;
    // assemble: per-letter (the scatter is a letter gesture).
    var perWord = style === "pop" || (style === "rise" && wordCount > 6);
    var units = splitSlot(slot, full, perWord);
    if (!units.length) { slot.textContent = full; return; }
    var stagger = style === "pop" ? 0.055 : 0.045;
    var span = Math.max(0.2, duration - stagger * (units.length - 1));
    var unitDur = Math.min(style === "assemble" ? 0.6 : 0.5, span);

    if (style === "rise") {
      for (var r = 0; r < units.length; r += 1) {
        reveal(timeline, units[r], { opacity: 0, y: "0.35em" }, {
          opacity: 1, y: 0, duration: unitDur, ease: "power3.out",
        }, beat.startSec + stagger * r);
      }
      return;
    }
    if (style === "pop") {
      for (var p = 0; p < units.length; p += 1) {
        reveal(timeline, units[p], { opacity: 0, scale: 0.6 }, {
          opacity: 1, scale: 1, duration: unitDur, ease: "seqPop",
        }, beat.startSec + stagger * p);
      }
      return;
    }
    // assemble — seeded rectilinear scatter + echo trail on the 3 longest travels.
    var scatter = 96; // px displacement scale (video coordinates)
    var travels = [];
    for (var a = 0; a < units.length; a += 1) {
      var seed = hashCode(beat.id + ":" + a);
      var mag = (seededUnit(seed) * 2 - 1) * scatter;
      var horizontal = seededUnit(seed ^ 0x9e3779b9) < 0.5;
      travels.push({ span: units[a], index: a, axis: horizontal ? "x" : "y", offset: mag });
    }
    var echoRank = travels.slice().sort(function (m, n) {
      return Math.abs(n.offset) - Math.abs(m.offset);
    }).slice(0, 3);
    var echoSet = {};
    for (var e = 0; e < echoRank.length; e += 1) echoSet[echoRank[e].index] = true;
    for (var t = 0; t < travels.length; t += 1) {
      var travel = travels[t];
      var at = beat.startSec + stagger * t;
      var fromVars = { opacity: 0 };
      var toVars = { opacity: 1, duration: unitDur, ease: "seqSettle" };
      fromVars[travel.axis] = travel.offset;
      toVars[travel.axis] = 0;
      reveal(timeline, travel.span, fromVars, toVars, at);
      if (echoSet[travel.index]) addEchoTrail(timeline, slot, travel, at, unitDur);
    }
    // Whole-word glow at lock: a kit bloom behind the slot swells and settles.
    addLockGlow(timeline, el, slot, beat.endSec);
  }

  // Two decaying ghost clones trail a fast-moving letter along its own axis,
  // lagged so they always sit where the letter just was (the AE Echo idiom).
  // Visibility discipline: the ghost is CSS-hidden at rest AND pinned hidden by
  // a t=0 set, because its flight is a `move` (immediateRender:false) whose
  // from-state carries a visible opacity — without the pin, a fresh forward
  // render shows stray duplicate letters before the assemble, and a backward
  // seek re-renders the flight's from-state. GSAP renders children in reverse
  // order on backward seeks, so the t=0 set wins for every pre-flight frame.
  function addEchoTrail(timeline, slot, travel, at, unitDur) {
    var restX = travel.span.offsetLeft;
    var restY = travel.span.offsetTop;
    var opacities = [0.32, 0.16];
    for (var k = 0; k < opacities.length; k += 1) {
      var ghost = document.createElement("span");
      ghost.className = "cmp-split";
      ghost.setAttribute("data-sequences-fx", "echo");
      ghost.setAttribute("data-layout-ignore", "");
      ghost.setAttribute("aria-hidden", "true");
      ghost.textContent = travel.span.textContent;
      ghost.style.cssText =
        "position:absolute;display:inline-block;white-space:pre;pointer-events:none;" +
        "margin:0;opacity:0;left:" + restX + "px;top:" + restY + "px";
      slot.appendChild(ghost);
      timeline.set(ghost, { opacity: 0 }, 0);
      var lag = (k + 1) * 0.05;
      var from = { opacity: opacities[k] };
      var to = { opacity: 0, duration: unitDur, ease: "seqSettle" };
      from[travel.axis] = travel.offset;
      to[travel.axis] = 0;
      move(timeline, ghost, from, to, at + lag);
    }
  }

  function addLockGlow(timeline, el, slot, atSec) {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    var bloom = document.createElement("span");
    bloom.className = "bloom";
    bloom.setAttribute("data-sequences-fx", "assemble-glow");
    bloom.setAttribute("data-layout-ignore", "");
    bloom.setAttribute("aria-hidden", "true");
    bloom.style.cssText = "position:absolute;inset:-25%;z-index:0;pointer-events:none;opacity:0";
    el.insertBefore(bloom, el.firstChild);
    move(timeline, bloom, { opacity: 0 }, {
      opacity: 0.7, duration: 0.28, ease: "sine.in",
    }, atSec - 0.14);
    move(timeline, bloom, { opacity: 0.7 }, {
      opacity: 0, duration: 0.5, ease: "sine.out",
    }, atSec + 0.14);
  }

  function compileType(timeline, el, beat) {
    if (beat.style && HEADLINE_SPLIT_STYLES[beat.style]) {
      compileSplitType(timeline, el, beat, beat.style);
      return;
    }
    var slot = textSlot(el);
    var full = beat.text != null ? String(beat.text) : (slot.textContent || "");
    slot.textContent = "";
    var caret = ensureCaret(slot);
    var duration = beat.endSec - beat.startSec;
    // The plain typewriter writes in place — pin the slot's transform AND
    // opacity so an authored reveal on the same element cannot slide or fade the
    // line while it types (probe-audit-03 self-writing-digest).
    pinSlotIdentity(timeline, slot, beat, true);
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

  var HEADLINE_SPLIT_STYLES = { rise: true, pop: true, assemble: true };

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
      // Eager pre-beat state (the compileCount format(0) precedent): the kit
      // markup carries the FULL final state, so without this the ring renders
      // full from t=0, snaps empty at the beat, then animates — the
      // flash-of-full tell. The inline write is what a pre-beat seek shows.
      ring.style.strokeDashoffset = String(length);
      move(timeline, ring, { strokeDashoffset: length }, {
        strokeDashoffset: length * (1 - value),
        duration: duration,
        ease: beat.ease,
      }, beat.startSec);
      return;
    }
    var fill = firstMatch(el, ["[data-cmp-fill]", ":scope > i"]);
    if (!fill) fail(beat.id, "progress component has no fill element");
    fill.style.transform = "scaleX(0)";
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
      // Same flash-of-full guard as compileProgress: hide the stroke until
      // its draw-on beat starts (the fx drawStrokes anchor discipline).
      stroke.style.strokeDashoffset = String(length);
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
    // MD6 pop entrance for compact acknowledgment surfaces: scale-from-small
    // with the seqPop overshoot, replacing the smooth default panel open. The
    // compact-kind + 2/scene rule is enforced deterministically at plan time.
    if (beat.style === "pop") {
      var popDur = beat.endSec - beat.startSec;
      setState(timeline, el, "open", beat.startSec);
      reveal(timeline, el, { opacity: 0, scale: 0.6 }, {
        opacity: 1, scale: 1, duration: popDur, ease: "seqPop",
      }, beat.startSec);
      return;
    }
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
    // Single-active: the chosen item goes active, every sibling inactive, across
    // whatever channel the markup uses (data-active/data-state/.active class).
    activateAmong(timeline, items, chosen, beat.startSec + duration * 0.4);
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
    // Style variants beyond the default ring (sweep, underline) are compiled
    // by the host fx runtime (sequences-fx) — one owner per visual channel.
    if (beat.style && beat.style !== "ring") return;
    var ring = el.querySelector(".cmp-highlight-ring");
    if (!ring) {
      ring = document.createElement("span");
      ring.className = "cmp-highlight-ring";
      ring.setAttribute("aria-hidden", "true");
      el.appendChild(ring);
    }
    var duration = beat.endSec - beat.startSec;
    // Quick rise, long settle, near-still scale: the ring is a focus glow now
    // (hairline + bloom in the kit CSS), so the motion whispers instead of
    // popping a 6% scale jump.
    move(timeline, ring, { opacity: 0, scale: 0.985 }, {
      opacity: 1,
      scale: 1,
      duration: duration * 0.3,
      ease: "power2.out",
    }, beat.startSec);
    move(timeline, ring, { opacity: 1, scale: 1 }, {
      opacity: 0,
      scale: 1.015,
      duration: duration * 0.7,
      ease: "sine.in",
    }, beat.startSec + duration * 0.3);
  }

  function compileSwap(timeline, el, beat) {
    var slot = firstMatch(el, ["[data-cmp-value]", ".cmp-value", "[data-cmp-text]", ".cmp-text", ".cmp-title"]) || el;
    var incoming = String(beat.text || "");
    // No-op swap (probe-audit-01): the slot already reads the incoming text, so
    // swapping to itself is a pointless double-reveal — the same word flies out
    // and the same word flies back in. Bail BEFORE building the old/new spans or
    // any tween: a swap to itself is not motion (the beat still counts for
    // paperwork, and a moment bound to it earns at most an advisory
    // moment_static_frame from the temporal judge, never a block).
    if ((slot.textContent || "").trim() === incoming.trim()) return;
    var duration = beat.endSec - beat.startSec;
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
    // Settle (probe-audit-01 "faint ghost"): during the crossfade the slot is
    // laid out by the OLD copy while the new copy floats absolute over it, so
    // leaving that arrangement forever means the settled text never rejoins
    // normal flow (it overlaps neighbors whenever lengths differ) and the
    // zeroed-out old copy still owns the slot's box. At the beat's end the old
    // span leaves the layout and the new span takes the slot in normal flow.
    // Zero-duration sets are seek-safe: GSAP records the start values on first
    // render, so seeking back before endSec restores inline-block + absolute
    // (the addEchoTrail t=0-pin precedent).
    timeline.set(old, { display: "none" }, beat.endSec);
    timeline.set(next, { position: "static" }, beat.endSec);
  }

  // An overlay kind's root spans the whole scene (.cmp-modal is inset:0 with a
  // centered .cmp-dialog inside): the FLIP must land on the VISUAL surface,
  // never the overlay root — morphing a search pill onto a full-scene rect is
  // the 2026-07-06 "weird morphing" artifact.
  function morphVisualBox(el) {
    return el.querySelector(".cmp-dialog") || el;
  }

  function commonMorphHost(scene, from, to) {
    var ancestors = new Set();
    var node = from.parentElement;
    while (node && scene.contains(node)) {
      ancestors.add(node);
      node = node.parentElement;
    }
    node = to.parentElement;
    while (node && node !== scene) {
      if (ancestors.has(node) && getComputedStyle(node).position !== "static") return node;
      node = node.parentElement;
    }
    return scene;
  }

  function positionWithin(element, host) {
    var elementBox = layoutPosition(element);
    var hostBox = layoutPosition(host);
    return {
      x: elementBox.x - hostBox.x,
      y: elementBox.y - hostBox.y,
      width: elementBox.width,
      height: elementBox.height,
    };
  }

  function stripMorphCloneBindings(root) {
    var nodes = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")));
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].removeAttribute("id");
      nodes[i].removeAttribute("data-part");
      nodes[i].removeAttribute("data-component");
      nodes[i].removeAttribute("data-layout-important");
    }
  }

  function surfaceVars(element) {
    var style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderRadius: style.borderTopLeftRadius,
      borderWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
    };
  }

  function buildMorphBridge(host, fromElement, from, toElement) {
    var bridge = document.createElement("div");
    bridge.className = "seq-component-morph-bridge";
    bridge.setAttribute("aria-hidden", "true");
    bridge.style.cssText =
      "position:absolute;pointer-events:none;overflow:hidden;box-sizing:border-box;" +
      "z-index:70;opacity:0;visibility:hidden;margin:0;transform-origin:0 0;";
    bridge.style.left = from.x + "px";
    bridge.style.top = from.y + "px";
    bridge.style.width = from.width + "px";
    bridge.style.height = from.height + "px";
    var fromSurface = surfaceVars(fromElement);
    for (var key in fromSurface) bridge.style[key] = fromSurface[key];

    // The clone preserves the first frame exactly, then its internals leave
    // before the shell changes aspect. It owns no ids/contracts, so runtime
    // selectors and browser QA continue addressing only the live components.
    var content = fromElement.cloneNode(true);
    stripMorphCloneBindings(content);
    content.classList.add("seq-component-morph-content");
    content.style.cssText +=
      ";position:absolute!important;left:0!important;top:0!important;margin:0!important;" +
      "width:" + from.width + "px!important;height:" + from.height + "px!important;" +
      "transform:none!important;transform-origin:0 0!important;pointer-events:none!important;";
    bridge.appendChild(content);
    host.appendChild(bridge);
    return { bridge: bridge, content: content, targetSurface: surfaceVars(toElement) };
  }

  function compileMorph(timeline, scene, el, beat) {
    var target = scene.querySelector('[data-part="' + CSS.escape(beat.morphTo) + '"]');
    if (!target) fail(beat.id, 'morph target "' + beat.morphTo + '" is absent');
    var fromElement = morphVisualBox(el);
    var toElement = morphVisualBox(target);
    var host = commonMorphHost(scene, fromElement, toElement);
    var from = positionWithin(fromElement, host);
    var to = positionWithin(toElement, host);
    var duration = beat.endSec - beat.startSec;
    var revealAt = beat.startSec + duration * 0.56;
    var handoffAt = beat.startSec + duration * 0.72;
    var built = buildMorphBridge(host, fromElement, from, toElement);

    // Swap the live source for a pixel-identical bridge on one frame. The
    // bridge's source content fades before the aspect ratio changes enough to
    // distort it; only the empty material shell interpolates width/height.
    timeline.set(built.bridge, { autoAlpha: 1 }, beat.startSec);
    timeline.set(el, { opacity: 0 }, beat.startSec);
    move(timeline, built.content, { opacity: 1, filter: "blur(0px)" }, {
      opacity: 0,
      filter: "blur(5px)",
      duration: duration * 0.3,
      ease: "power2.in",
    }, beat.startSec + duration * 0.08);
    move(timeline, built.bridge, {
      left: from.x,
      top: from.y,
      width: from.width,
      height: from.height,
    }, {
      left: to.x,
      top: to.y,
      width: to.width,
      height: to.height,
      backgroundColor: built.targetSurface.backgroundColor,
      borderColor: built.targetSurface.borderColor,
      borderRadius: built.targetSurface.borderRadius,
      borderWidth: built.targetSurface.borderWidth,
      boxShadow: built.targetSurface.boxShadow,
      duration: duration * 0.82,
      ease: beat.ease,
    }, beat.startSec);
    // The twin arrives only through this morph: pre-rendered hidden at build.
    // A morph IS the twin's entrance, so it must do everything `open` would —
    // kit CSS keeps an overlay's scrim/panel/items at opacity 0 until opened,
    // and a separate `open` beat on a morphed-in twin is deduped at plan time
    // (it would re-run the entrance over this reveal and flash).
    reveal(timeline, target, { opacity: 0 }, {
      opacity: 1,
      duration: duration * 0.34,
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
    move(timeline, built.bridge, { opacity: 1 }, {
      opacity: 0,
      duration: duration * 0.28,
      ease: "power2.out",
    }, handoffAt);
    // Visibility belongs only to the start swap. A second autoAlpha set here
    // leaves visibility:hidden behind when the timeline seeks backward even
    // though opacity restores, making the replayed morph shell disappear.
    timeline.set(built.bridge, { opacity: 0 }, beat.endSec);
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
      // Asset spring animations are compiled by the host assets runtime
      // (sequences-assets) from its own island — one owner per visual channel
      // (the compileHighlight/fx precedent). Skip before the element lookup so
      // a flag-flipped film without injected units cannot crash the compile.
      if (beat.kind === "animate") {
        bound += 1;
        continue;
      }
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
    activateExclusiveItem: activateExclusiveItem,
  });
})(window);
