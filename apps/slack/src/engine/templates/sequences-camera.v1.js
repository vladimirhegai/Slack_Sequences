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
  // A measured blocking landing may need a little more room than an authored
  // generic move. Keeping the generic floor at 0.5 preserves its look while
  // letting a large typed surface satisfy its own occupancy maximum instead
  // of becoming host-impossible by ~1% (RouteBoardQC5).
  var BLOCKING_ZOOM_MIN = 0.44;
  var ZOOM_MAX = 2.8;
  // Blocking occupancy is a typed readability contract. Compact headlines,
  // buttons, and lockup CTAs inside viewport-sized stations may require a
  // closer lens than an authored generic move; the fit/anchor solver still
  // caps the pose against the delivery-safe viewport before adoption.
  var BLOCKING_ZOOM_MAX = 8;
  // Dive leg fallbacks — kept in sync with cameraContract's diveWindows.
  var DIVE_LEG_MAX = 0.8;
  var DIVE_LEG_FRACTION = 0.25;
  var DIVE_LEG_MIN = 0.7;
  var REGION_MARGIN_RATIO = 0.08;
  var PART_MARGIN_RATIO = 0.16;
  var CREEP_ZOOM = 1.028;
  var ORBIT_LITE_TRAVEL_RATIO = 0.035;
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

  function hashUnit(text) {
    var hash = 2166136261;
    for (var i = 0; i < String(text).length; i += 1) {
      hash ^= String(text).charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 10000) / 10000;
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
      // SVG elements commonly expose no offsetParent. Continue through their
      // DOM parent until the first HTMLElement restores the normal offset
      // chain; otherwise an in-station SVG is measured at world origin and
      // fabricates a huge contextual union.
      node = node.offsetParent || node.parentElement;
    }
    // HTMLElement offset dimensions are transform-free layout geometry, but
    // SVG/media nodes do not consistently expose offsetWidth/offsetHeight.
    // Falling straight to 1px made a full-size SVG progress ring look like
    // only its small text label to regionContentRect, so blocking zoomed the
    // station 2-3x while browser QA measured the real SVG and rejected the
    // landing. clientWidth/clientHeight keep the same layout-space semantics
    // for SVG; getBoundingClientRect is the final media fallback at bind time,
    // before this runtime applies a camera-world transform.
    var bounds = null;
    var width = Number(element.offsetWidth) || Number(element.clientWidth);
    var height = Number(element.offsetHeight) || Number(element.clientHeight);
    if (!(width > 0) || !(height > 0)) {
      bounds = element.getBoundingClientRect && element.getBoundingClientRect();
    }
    return {
      x: x,
      y: y,
      width: width > 0 ? width : Number(bounds && bounds.width) || 1,
      height: height > 0 ? height : Number(bounds && bounds.height) || 1,
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

  // Host-generated surfaces can declare when they become load-bearing. Camera
  // blocking is solved at each phrase's arrival, so a later CTA/lockup must not
  // enlarge an earlier station silhouette while it is still intentionally
  // absent. The element itself or any owning wrapper may carry the fence.
  function isFramingContentAt(element, atSec) {
    if (!isFinite(atSec)) return true;
    var owner = element.closest && element.closest("[data-layout-important-from]");
    if (!owner) return true;
    var from = Number(owner.getAttribute("data-layout-important-from"));
    return !isFinite(from) || from <= atSec + 0.001;
  }

  // A station is a placement boundary, not necessarily the shot's visual
  // silhouette. Authors commonly put one 600px product panel in a viewport-
  // sized station; fitting the station makes that panel a tiny subject adrift
  // in empty space. Frame the union of actual painted/text/media descendants,
  // while preserving an explicit escape for deliberate establishing shots.
  function regionContentRect(world, region, atSec) {
    var fallback = layoutRect(world, region);
    if (region.getAttribute("data-camera-frame") === "region") return fallback;
    var left = Infinity;
    var top = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    // Prefer authored semantic surfaces when a station contains them. Purely
    // decorative painted strips/halos can span most of a station and used to
    // make a 200px metric resolve as a speck. Falling back to all painted
    // descendants preserves legacy/freeform stations without semantic marks.
    var semanticNodes = region.querySelectorAll(
      "[data-layout-important],[data-component],[data-part]"
    );
    var nodes = region.querySelectorAll("*");
    var prefersSemantic = false;
    for (var semanticIndex = 0; semanticIndex < semanticNodes.length; semanticIndex += 1) {
      if (isFramingContentAt(semanticNodes[semanticIndex], atSec)) {
        prefersSemantic = true;
        break;
      }
    }
    for (var i = 0; i < nodes.length; i += 1) {
      var element = nodes[i];
      if (!isFramingContentAt(element, atSec)) continue;
      // A semantic component somewhere in the station must not erase ordinary
      // load-bearing copy from the camera silhouette. Probe footage exposed
      // this with a plain "Confirmed bookings" heading and with text spans
      // inside a generated lockup: both sat outside the old semantic-only
      // query, so the lens fit the rows/button and cropped the promise. Keep
      // semantic surfaces plus any directly painted text/media; decorative
      // empty strips still stay out of the union.
      if (
        prefersSemantic &&
        !element.matches("[data-layout-important],[data-component],[data-part]") &&
        !hasDirectText(element) &&
        !element.matches("img,svg,video,canvas,picture,[data-camera-context]")
      ) continue;
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

  function framingRect(world, element, kind, atSec) {
    if (kind === "region") return regionContentRect(world, element, atSec);
    // Modal roots span the scene; their dialog is the surface the camera and
    // the audience perceive as the subject.
    var visual = element.querySelector && element.querySelector(".cmp-dialog");
    return partWithCompanionsRect(world, visual || element);
  }

  // Blocking occupancy and screen anchors describe the addressed subject,
  // not every load-bearing companion in its station. Normal part framing may
  // retain companions; a primary metric/CTA/headline must be measured alone
  // or a large neighboring panel makes the subject look falsely occupied.
  function focalRect(world, element, kind, atSec) {
    if (kind === "region") return regionContentRect(world, element, atSec);
    var visual = element.querySelector && element.querySelector(".cmp-dialog");
    return layoutRect(world, visual || element);
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

  function blockingTargetElement(scene, block) {
    if (!block || !block.target) return null;
    function resolve(target) {
      if (!target) return null;
      var element = null;
      if (target.kind === "part") {
        element = scene.querySelector('[data-part="' + CSS.escape(target.id) + '"]');
      } else if (target.kind === "region") {
        element = scene.querySelector('[data-region="' + CSS.escape(target.id) + '"]');
      } else if (target.kind === "selector") {
        try { element = scene.querySelector(target.id); } catch (_error) { element = null; }
      }
      return element ? {
        element: element,
        kind: target.kind === "region" ? "region" : "part",
        name: target.id,
      } : null;
    }
    // Evidence and eye ownership always follow the primary subject. The
    // framing target is context, retained separately so it can influence
    // scale without stealing the subject's screen anchor.
    var subject = resolve(block.target);
    var context = resolve(block.framingTarget);
    if (!subject && !context) return null;
    var result = subject || context;
    if (subject && context && subject.element !== context.element) {
      result.framingElement = context.element;
      result.framingKind = context.kind;
      result.framingName = context.name;
    } else if (
      subject && subject.kind === "part" &&
      subject.element.getAttribute("data-component") === "button"
    ) {
      // Pills and CTAs are usually read with a label/promise beside them. If
      // the planner did not name an explicit station, preserve the nearest
      // compact authored layout group as context so a larger button occupancy
      // never pushes its sibling copy off-canvas.
      var group = subject.element.closest(".zone,.stack,.cluster,[data-camera-context]");
      if (
        group && group !== scene && group !== scene.querySelector("[data-camera-world]") &&
        group.querySelectorAll("[data-component]").length <= 3
      ) {
        result.framingElement = group;
        result.framingKind = "region";
        result.framingName = "nearest-layout-group";
      }
    }
    return result;
  }

  // The camera state that frames `element` comfortably inside the viewport.
  function frameRectState(viewport, r, kind, zoomMul, blocking) {
    var marginRatio = kind === "part" ? PART_MARGIN_RATIO : REGION_MARGIN_RATIO;
    var margin = Math.min(viewport.w, viewport.h) * marginRatio;
    var fit = Math.min(
      viewport.w / Math.max(1, r.width + margin * 2),
      viewport.h / Math.max(1, r.height + margin * 2),
    );
    var anchor = blocking && blocking.arrivalPose && blocking.arrivalPose.anchor;
    var occupancy = blocking && (blocking.framingOccupancy || blocking.occupancy);
    var anchorX = anchor && isFinite(anchor.x) ? clamp(anchor.x, 0.2, 0.8) : 0.5;
    var anchorY = anchor && isFinite(anchor.y) ? clamp(anchor.y, 0.2, 0.8) : 0.5;
    var z = fit * zoomMul;
    if (occupancy && isFinite(occupancy.preferred)) {
      // The blocking director speaks in painted frame occupancy, not guessed
      // zoom multipliers. Solve scale from the measured DOM area, then cap it
      // by the room around the selected screen anchor so the subject remains
      // fully readable at its landing.
      var frameArea = Math.max(1, viewport.w * viewport.h);
      var rectArea = Math.max(1, r.width * r.height);
      var preferred = clamp(occupancy.preferred, 0.02, 0.72);
      var minimum = clamp(Number(occupancy.min) || preferred * 0.65, 0.01, preferred);
      var maximum = clamp(Number(occupancy.max) || preferred * 1.45, preferred, 0.82);
      var desired = Math.sqrt(preferred * frameArea / rectArea) * zoomMul;
      var minimumScale = Math.sqrt(minimum * frameArea / rectArea);
      var maximumScale = Math.sqrt(maximum * frameArea / rectArea);
      var availableW = Math.max(1, 2 * Math.min(anchorX * viewport.w, (1 - anchorX) * viewport.w) - margin * 2);
      var availableH = Math.max(1, 2 * Math.min(anchorY * viewport.h, (1 - anchorY) * viewport.h) - margin * 2);
      var visibleFit = Math.min(availableW / Math.max(1, r.width), availableH / Math.max(1, r.height));
      var upper = Math.max(BLOCKING_ZOOM_MIN, Math.min(maximumScale, visibleFit));
      z = clamp(desired, Math.min(minimumScale, upper), upper);
    }
    z = clamp(z, occupancy ? BLOCKING_ZOOM_MIN : ZOOM_MIN,
      occupancy ? BLOCKING_ZOOM_MAX : ZOOM_MAX);
    var centerX = r.x + r.width / 2;
    var centerY = r.y + r.height / 2;
    return {
      // `apply` maps proxy x/y to viewport center. Offset the world-space
      // camera point so the measured subject lands at the blocking anchor.
      x: centerX - (anchorX * viewport.w - viewport.w / 2) / z,
      y: centerY - (anchorY * viewport.h - viewport.h / 2) / z,
      z: z,
      r: 0,
    };
  }

  function frameState(viewport, world, element, kind, zoomMul, blocking) {
    return frameRectState(
      viewport,
      blocking && kind === "part"
        ? focalRect(world, element, kind, blocking.arrivalSec)
        : framingRect(world, element, kind, blocking && blocking.arrivalSec),
      kind,
      zoomMul,
      blocking,
    );
  }

  // Frame a contextual station while guaranteeing that its addressed part is
  // readable and owns the requested anchor. Context influences scale; it does
  // not get to move a metric/button/headline away from the viewer's eye line.
  function blockingFrameState(viewport, world, target, zoomMul, blocking) {
    if (!target.framingElement) {
      return frameState(
        viewport, world, target.element, target.kind, zoomMul, blocking,
      );
    }
    var arrivalSec = blocking && Number(blocking.arrivalSec);
    var subjectRect = focalRect(world, target.element, target.kind, arrivalSec);
    var contextRect = framingRect(
      world, target.framingElement, target.framingKind, arrivalSec,
    );
    var contextCollapsesToSubject =
      // Match the browser audit's four-pixel, post-layout tolerance. Using a
      // tighter runtime-only threshold let borders/pixel rounding call the
      // same rectangle an ensemble here but a collapsed subject in QA.
      Math.abs(contextRect.x - subjectRect.x) <= 4 &&
      Math.abs(contextRect.y - subjectRect.y) <= 4 &&
      Math.abs(contextRect.width - subjectRect.width) <= 4 &&
      Math.abs(contextRect.height - subjectRect.height) <= 4;
    if (contextCollapsesToSubject) {
      // A named station is not automatically independent visual context.
      // `regionContentRect` deliberately collapses an otherwise empty station
      // to its painted descendants; when the sole descendant is the addressed
      // subject, applying the region's ensemble occupancy to that same rect
      // over-frames it (ParcelPilot's stat card landed at 30% against a 24%
      // maximum). Preserve the subject's own occupancy contract in that case.
      return frameRectState(
        viewport,
        subjectRect,
        target.kind,
        zoomMul,
        Object.assign({}, blocking, { framingOccupancy: null }),
      );
    }
    var contextState = frameRectState(
      viewport, contextRect, target.framingKind, zoomMul, blocking,
    );
    // A declared framing target makes the ENSEMBLE occupancy contract own the
    // lens. Forcing the addressed child up to its solo minimum can exceed the
    // station's declared maximum by 2-4x (LumaFlow's future CTA lockup framed
    // at 48% against a 28% max). The landing audit deliberately accepts a
    // visible compact child when the measured ensemble is in range. Standalone
    // close-ups omit/collapse the framing target and take the subject path
    // above; local highlight/count/press motion supplies emphasis here.
    var z = clamp(contextState.z, BLOCKING_ZOOM_MIN, BLOCKING_ZOOM_MAX);
    var preservesContext = true;
    if (preservesContext) {
      // A CTA inside a card/lockup is read with its promise, not as an isolated
      // billboard button. Keep the contextual surface delivery-safe instead
      // of satisfying button area by cropping the headline out of frame.
      var contextSafe = Math.min(viewport.w, viewport.h) * 0.065;
      var contextFit = Math.min(
        (viewport.w - contextSafe * 2) / Math.max(1, contextRect.width),
        (viewport.h - contextSafe * 2) / Math.max(1, contextRect.height),
      );
      z = clamp(Math.min(z, contextFit), BLOCKING_ZOOM_MIN, BLOCKING_ZOOM_MAX);
    }
    var anchor = blocking && blocking.arrivalPose && blocking.arrivalPose.anchor;
    var anchorX = anchor && isFinite(anchor.x) ? clamp(anchor.x, 0.2, 0.8) : 0.5;
    var anchorY = anchor && isFinite(anchor.y) ? clamp(anchor.y, 0.2, 0.8) : 0.5;
    var cameraX = subjectRect.x + subjectRect.width / 2 -
      (anchorX * viewport.w - viewport.w / 2) / z;
    var cameraY = subjectRect.y + subjectRect.height / 2 -
      (anchorY * viewport.h - viewport.h / 2) / z;
    if (preservesContext) {
      var safe = Math.min(viewport.w, viewport.h) * 0.065;
      if (contextRect.width * z <= viewport.w - safe * 2 + 0.5) {
        cameraX = clamp(
          cameraX,
          contextRect.x + contextRect.width - (viewport.w - safe - viewport.w / 2) / z,
          contextRect.x - (safe - viewport.w / 2) / z,
        );
      }
      if (contextRect.height * z <= viewport.h - safe * 2 + 0.5) {
        cameraY = clamp(
          cameraY,
          contextRect.y + contextRect.height - (viewport.h - safe - viewport.h / 2) / z,
          contextRect.y - (safe - viewport.h / 2) / z,
        );
      }
    }
    return {
      x: cameraX,
      y: cameraY,
      z: z,
      r: 0,
    };
  }

  function unionFrameState(viewport, world, a, b, blocking, anchorTarget) {
    var ra = focalRect(world, a.element, a.kind);
    var rb = focalRect(world, b.element, b.kind);
    // A row and its table are not two neighboring stations. Treating nested
    // subjects as a 38%-occupancy union zoomed the whole table into a giant
    // crop, then still missed the row's own occupancy contract. Fit the
    // containing surface with the current phrase's occupancy and anchor the
    // addressed child inside that coherent product view.
    var containerTarget = a.element.contains(b.element)
      ? a
      : b.element.contains(a.element)
        ? b
        : null;
    if (containerTarget) {
      var containerRect = containerTarget === a ? ra : rb;
      var nestedSubject = focalRect(world, anchorTarget.element, anchorTarget.kind);
      var nestedBlocking = blocking;
      if (anchorTarget.element !== containerTarget.element && blocking && blocking.occupancy) {
        var subjectRatio = Math.max(
          0.01,
          nestedSubject.width * nestedSubject.height /
            Math.max(1, containerRect.width * containerRect.height),
        );
        nestedBlocking = Object.assign({}, blocking, {
          occupancy: {
            min: Number(blocking.occupancy.min) / subjectRatio,
            preferred: Number(blocking.occupancy.preferred) / subjectRatio,
            max: Number(blocking.occupancy.max) / subjectRatio,
          },
        });
      }
      var nestedState = frameRectState(
        viewport,
        containerRect,
        containerTarget.kind,
        1,
        nestedBlocking,
      );
      var nestedAnchor = blocking && blocking.arrivalPose && blocking.arrivalPose.anchor;
      var nestedAnchorX = nestedAnchor && isFinite(nestedAnchor.x)
        ? clamp(nestedAnchor.x, 0.2, 0.8)
        : 0.5;
      var nestedAnchorY = nestedAnchor && isFinite(nestedAnchor.y)
        ? clamp(nestedAnchor.y, 0.2, 0.8)
        : 0.5;
      nestedState.x = nestedSubject.x + nestedSubject.width / 2 -
        (nestedAnchorX * viewport.w - viewport.w / 2) / nestedState.z;
      nestedState.y = nestedSubject.y + nestedSubject.height / 2 -
        (nestedAnchorY * viewport.h - viewport.h / 2) / nestedState.z;
      return nestedState;
    }
    var left = Math.min(ra.x, rb.x);
    var top = Math.min(ra.y, rb.y);
    var right = Math.max(ra.x + ra.width, rb.x + rb.width);
    var bottom = Math.max(ra.y + ra.height, rb.y + rb.height);
    var unionBlocking = Object.assign({}, blocking, {
      framingOccupancy: { min: 0.2, preferred: 0.38, max: 0.62 },
    });
    var state = frameRectState(
      viewport,
      { x: left, y: top, width: right - left, height: bottom - top },
      "region",
      1,
      unionBlocking,
    );
    var subject = focalRect(world, anchorTarget.element, anchorTarget.kind);
    var anchor = blocking && blocking.arrivalPose && blocking.arrivalPose.anchor;
    var anchorX = anchor && isFinite(anchor.x) ? clamp(anchor.x, 0.2, 0.8) : 0.5;
    var anchorY = anchor && isFinite(anchor.y) ? clamp(anchor.y, 0.2, 0.8) : 0.5;
    var desiredX = subject.x + subject.width / 2 - (anchorX * viewport.w - viewport.w / 2) / state.z;
    var desiredY = subject.y + subject.height / 2 - (anchorY * viewport.h - viewport.h / 2) / state.z;
    // Keep the whole union inside a restrained safe inset when it fits. The
    // requested subject anchor wins until it would crop its contextual pair.
    var safe = Math.min(viewport.w, viewport.h) * 0.04;
    var unionWidth = (right - left) * state.z;
    var unionHeight = (bottom - top) * state.z;
    if (unionWidth <= viewport.w - safe * 2) {
      var minX = right - (viewport.w - safe - viewport.w / 2) / state.z;
      var maxX = left - (safe - viewport.w / 2) / state.z;
      desiredX = clamp(desiredX, minX, maxX);
    }
    if (unionHeight <= viewport.h - safe * 2) {
      var minY = bottom - (viewport.h - safe - viewport.h / 2) / state.z;
      var maxY = top - (safe - viewport.h / 2) / state.z;
      desiredY = clamp(desiredY, minY, maxY);
    }
    state.x = desiredX;
    state.y = desiredY;
    return state;
  }

  function blockingFor(sceneId, segment) {
    return global.SequencesContinuity &&
        typeof global.SequencesContinuity.blockFor === "function"
      ? global.SequencesContinuity.blockFor(sceneId, segment)
      : null;
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
    // With the default-on living canvas, ambient life belongs to wallpaper,
    // furniture, and light. The lens rests on readable product copy; the
    // explicit environment rollback also restores the legacy operated hold.
    var environmentOwnsAmbient = Boolean(
      scene.querySelector(":scope > [data-sequences-environment]"),
    );
    var world = scene.querySelector("[data-camera-world]");
    if (!world) fail(scenePlan.sceneId, "data-camera-world plane is absent");
    if (getComputedStyle(world).position === "static") {
      world.style.position = "relative";
    }
    world.style.transformOrigin = "0 0";
    world.style.willChange = "transform";

    // A transparent list root stretched to `height:100%` advertises an empty
    // 1400x800 subject even when its three painted rows use only half of it.
    // No camera scale can then satisfy both subject occupancy and ensemble
    // coverage. Shrink only that mechanically measurable shape to its painted
    // rows before any camera geometry is solved; filled panels and genuinely
    // developed full-height lists remain untouched.
    var collectionRoots = world.querySelectorAll('[data-component="list"]');
    for (var collectionIndex = 0; collectionIndex < collectionRoots.length; collectionIndex += 1) {
      var collection = collectionRoots[collectionIndex];
      var collectionRegion = collection.closest("[data-region]");
      if (!collectionRegion || hasVisualPaint(collection) || hasDirectText(collection)) continue;
      var collectionBox = layoutRect(world, collection);
      var regionBox = layoutRect(world, collectionRegion);
      var regionContentHeight = parseFloat(getComputedStyle(collectionRegion).height) ||
        regionBox.height;
      var collectionTop = Infinity;
      var collectionBottom = -Infinity;
      var collectionDescendants = collection.querySelectorAll("*");
      for (var descendantIndex = 0; descendantIndex < collectionDescendants.length; descendantIndex += 1) {
        var descendant = collectionDescendants[descendantIndex];
        if (!isFramingContent(descendant)) continue;
        var descendantBox = layoutRect(world, descendant);
        var descendantTag = descendant.tagName.toUpperCase();
        var descendantMedia =
          descendantTag === "IMG" || descendantTag === "SVG" || descendantTag === "VIDEO" ||
          descendantTag === "CANVAS" || descendantTag === "PICTURE";
        // A spine/hairline may span the full old list height but does not make
        // the rows a full-height surface. Exclude only textless, non-media
        // slivers from this shrinkwrap measurement.
        var decorativeSliver = !hasDirectText(descendant) && !descendantMedia &&
          (descendantBox.width < collectionBox.width * 0.08 ||
            descendantBox.height < collectionBox.height * 0.08);
        if (decorativeSliver) continue;
        collectionTop = Math.min(collectionTop, descendantBox.y);
        collectionBottom = Math.max(collectionBottom, descendantBox.y + descendantBox.height);
      }
      var paintedHeight = collectionBottom > collectionTop
        ? collectionBottom - collectionTop
        : collectionBox.height;
      if (
        collectionBox.height >= regionContentHeight * 0.7 &&
        paintedHeight < collectionBox.height * 0.72
      ) {
        collection.style.height = "auto";
        collection.setAttribute("data-sequences-camera-shrinkwrap", "1");
      }
    }

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
        // Product/layout groups may use depth for rack focus, but translating
        // those groups at different parallax rates destroys their authored
        // spatial relationship during a reframe (RouteBoardQC5's timeline
        // slid directly underneath its metric). Lateral parallax belongs to
        // decorative texture/light layers; explicit depth3d orbit separation
        // below remains available to every declared layer.
        var ownsLayout = layerNodes[i].matches("[data-component],[data-layout-important]") ||
          Boolean(layerNodes[i].querySelector("[data-component],[data-layout-important]"));
        var layerParent = layerNodes[i].parentElement;
        var parentDisplay = layerParent ? getComputedStyle(layerParent).display : "";
        if (ownsLayout && (parentDisplay === "flex" || parentDisplay === "grid") &&
            getComputedStyle(layerNodes[i]).position === "absolute" &&
            !layerNodes[i].style.position) {
          // Broad author CSS such as `[data-depth="0.3"]{position:absolute}`
          // is valid for lights/textures but must not pull a product group out
          // of its flex/grid station. That exact collision stacked RouteBoard's
          // resolved timeline underneath the 100% metric.
          layerNodes[i].style.position = "relative";
        }
        layers.push({
          element: layerNodes[i],
          depth: clamp(depth, 0, 1),
          parallax: !ownsLayout,
        });
      }
    }

    var segments = scenePlan.segments;
    var first = segments[0];
    var allDirectedBlocks = global.SequencesContinuity &&
        typeof global.SequencesContinuity.blocksForScene === "function"
      ? global.SequencesContinuity.blocksForScene(scenePlan.sceneId).filter(function (block) {
          var target = blockingTargetElement(scene, block);
          return target && (target.element === world || world.contains(target.element));
        })
      : [];
    // The host compiler has already selected primary/authored routes and
    // collapsed degenerate phrases. Runtime executes that exact list; it does
    // not re-derive route ownership or mutate dwell semantics in the browser.
    var directedBlocks = allDirectedBlocks;
    function routeKey(block) {
      // Two primary parts can share one station while asking for different eye
      // ownership (metric -> CTA, headline -> subtitle). The contextual region
      // must not collapse those into a false repeated-target hold.
      var target = block.target || block.framingTarget;
      return target.kind + ":" + target.id;
    }
    function samePoseIntent(a, b) {
      if (!a || !b || routeKey(a) !== routeKey(b)) return false;
      var aContext = a.framingTarget
        ? a.framingTarget.kind + ":" + a.framingTarget.id
        : "";
      var bContext = b.framingTarget
        ? b.framingTarget.kind + ":" + b.framingTarget.id
        : "";
      if (aContext !== bContext) return false;
      var aAnchor = a.arrivalPose && a.arrivalPose.anchor;
      var bAnchor = b.arrivalPose && b.arrivalPose.anchor;
      if (
        Math.abs(Number(aAnchor && aAnchor.x) - Number(bAnchor && bAnchor.x)) > 0.025 ||
        Math.abs(Number(aAnchor && aAnchor.y) - Number(bAnchor && bAnchor.y)) > 0.025
      ) return false;
      var aLens = a.arrivalPose && a.arrivalPose.lens;
      var bLens = b.arrivalPose && b.arrivalPose.lens;
      if (aLens && bLens && aLens !== bLens) return false;
      var aZoom = Number(a.arrivalPose && a.arrivalPose.zoom) || 1;
      var bZoom = Number(b.arrivalPose && b.arrivalPose.zoom) || 1;
      if (Math.max(aZoom, bZoom) / Math.max(0.001, Math.min(aZoom, bZoom)) > 1.08) {
        return false;
      }
      var aOccupancy = a.occupancy || {};
      var bOccupancy = b.occupancy || {};
      var preferredRatio = Math.max(
        Number(aOccupancy.preferred) || 0.001,
        Number(bOccupancy.preferred) || 0.001,
      ) / Math.max(
        0.001,
        Math.min(
          Number(aOccupancy.preferred) || 0.001,
          Number(bOccupancy.preferred) || 0.001,
        ),
      );
      return preferredRatio <= 1.18;
    }
    function targetsShareNeighborhood(a, b) {
      if (!a || !b) return false;
      var regionA = a.element.closest && a.element.closest("[data-region]");
      var regionB = b.element.closest && b.element.closest("[data-region]");
      if (regionA && regionA === regionB) return true;
      var ra = focalRect(world, a.element, a.kind);
      var rb = focalRect(world, b.element, b.kind);
      var distance = Math.hypot(
        ra.x + ra.width / 2 - (rb.x + rb.width / 2),
        ra.y + ra.height / 2 - (rb.y + rb.height / 2),
      );
      return distance <= Math.hypot(viewport.w, viewport.h) * 0.55;
    }
    function shouldPreblockUnion(current, next, currentTarget, nextTarget) {
      if (!current || !next || routeKey(current) === routeKey(next)) return false;
      var freeSec = (Number(next.arrivalSec) || 0) -
        (Number(current.dwell && current.dwell.endSec) || Number(current.arrivalSec) || 0);
      return freeSec >= 0 && freeSec < 1.35 &&
        targetsShareNeighborhood(currentTarget, nextTarget);
    }
    function preblockFreeSec(current, next) {
      return (Number(next.arrivalSec) || 0) -
        (Number(current.dwell && current.dwell.endSec) || Number(current.arrivalSec) || 0);
    }
    function minimumRouteDuration(fromState, toState) {
      var diagonal = Math.max(1, Math.hypot(viewport.w, viewport.h));
      var averageZoom = (Math.abs(fromState.z) + Math.abs(toState.z)) / 2;
      var dx = (toState.x - fromState.x) * averageZoom / diagonal;
      var dy = (toState.y - fromState.y) * averageZoom / diagonal;
      var dz = Math.log(Math.max(0.001, toState.z) / Math.max(0.001, fromState.z)) * 0.25;
      var distance = Math.hypot(dx, dy, dz);
      var solver = global.SequencesContinuity &&
          typeof global.SequencesContinuity.blockingSolver === "function"
        ? global.SequencesContinuity.blockingSolver()
        : null;
      var velocity = Number(solver && solver.maxNormalizedVelocity) || 1.9;
      var acceleration = Number(solver && solver.maxNormalizedAcceleration) || 5.8;
      var jerk = Number(solver && solver.maxNormalizedJerk) || 60;
      // Exact maxima for p(t)=10t^3-15t^4+6t^5, scaled by route distance.
      return Math.max(
        0.15,
        distance * 1.875 / Math.max(0.01, velocity),
        Math.sqrt(distance * 5.774 / Math.max(0.01, acceleration)),
        Math.pow(distance * 60 / Math.max(0.01, jerk), 1 / 3),
      );
    }
    var firstDirected = directedBlocks.length ? directedBlocks[0] : null;
    // Entry framing is what the audience sees NOW, not the first future
    // primary payoff. Supporting phrases are still forbidden from causing
    // late lens moves, but the earliest measured block (or authored from
    // target) owns the opening pose. Starting on a future chart/metric shoved
    // the actual overview into a corner for half the scene.
    var entryBlock = allDirectedBlocks.length ? allDirectedBlocks[0] : firstDirected;
    var entry = entryBlock
      ? blockingTargetElement(scene, entryBlock)
      : targetElement(scene, first, true) || targetElement(scene, first, false);
    if (!entry || !entry.element) {
      fail(
        scenePlan.sceneId,
        'entry framing "' + (entry ? entry.name : "?") + '" is absent',
      );
    }
    var firstBlocking = entryBlock || blockingFor(scenePlan.sceneId, first);
    var firstZoom = entryBlock && entryBlock.arrivalPose
      ? Number(entryBlock.arrivalPose.zoom) || 1
      : 1;
    var start = entryBlock
      ? blockingFrameState(viewport, world, entry, firstZoom, firstBlocking)
      : frameState(viewport, world, entry.element, entry.kind, firstZoom, firstBlocking);
    var carriedUnionIndex = -1;
    var carriedUnionState = null;
    var entryMatchesFirst = Boolean(
      entryBlock && firstDirected && samePoseIntent(entryBlock, firstDirected)
    );
    if (
      firstDirected && entryMatchesFirst &&
      // A PRIMARY opening is already a promised readable landing. Replacing
      // it with a dense handoff union can violate its own occupancy/anchor
      // contract before the audience has seen it (LumaFlow: the approval card
      // opened over-framed because the later Approve button was preblocked).
      // Supporting connective entries may still establish the next union.
      firstDirected.importance !== "primary"
    ) {
      var initialNextTarget = blockingTargetElement(scene, directedBlocks[1]);
      if (initialNextTarget && shouldPreblockUnion(
        firstDirected, directedBlocks[1], entry, initialNextTarget,
      )) {
        var initialCurrentUnion = unionFrameState(
          viewport, world, entry, initialNextTarget, firstDirected, entry,
        );
        var initialNextUnion = unionFrameState(
          viewport, world, entry, initialNextTarget, directedBlocks[1], initialNextTarget,
        );
        start = preblockFreeSec(firstDirected, directedBlocks[1]) < 0.4
          ? initialNextUnion
          : initialCurrentUnion;
        carriedUnionIndex = 1;
        carriedUnionState = initialNextUnion;
      }
    }
    var entryLandingState = start;
    var openingApproach = null;
    if (
      entryBlock &&
      (entryMatchesFirst || (firstDirected && routeKey(entryBlock) === routeKey(firstDirected)))
    ) {
      // A cut-entry block can name the same pose as a later camera-owned
      // primary. The cut establishes the destination, but the delayed authored
      // whip still needs a real approach window after entry settle. Use that
      // later landing as the opening deadline; otherwise the entry block's
      // scene-start arrival makes the camera gesture a zero-length no-op.
      var openingBlock = entryBlock;
      if (
        entryBlock.role === "entry" && firstDirected &&
        Number(firstDirected.arrivalSec) > Number(entryBlock.arrivalSec) + 0.4
      ) {
        openingBlock = firstDirected;
      }
      var sceneStart = Number(segments[0].startSec) || 0;
      var entryArrival = Number(openingBlock.arrivalSec);
      var openingStart = sceneStart;
      var openingWindow = entryArrival - openingStart - 0.125;
      var authoredOpening = null;
      for (var ai = 0; ai < segments.length; ai += 1) {
        var possibleOpening = segments[ai];
        if (possibleOpening.startSec > entryArrival - 0.2) continue;
        if (possibleOpening.endSec < entryArrival - 0.2) continue;
        if (possibleOpening.move === "hold" || possibleOpening.move === "dive") continue;
        authoredOpening = possibleOpening;
        break;
      }
      if (authoredOpening) {
        openingStart = Math.max(sceneStart, authoredOpening.startSec);
        openingWindow = entryArrival - openingStart - 0.125;
      }
      // A delayed impact move can have only a compact post-cut window after
      // the 125ms landing reserve. 280ms is still a readable whip/push gesture;
      // the kinematic fit below continuously reduces its distance as needed.
      if (authoredOpening && openingWindow >= 0.28) {
        var approach = {
          x: entryLandingState.x,
          y: entryLandingState.y,
          z: entryLandingState.z,
          r: 0,
        };
        var authoredFrom = targetElement(scene, authoredOpening, true);
        if (authoredFrom && authoredFrom.element) {
          var authoredFromState = frameState(
            viewport, world, authoredFrom.element, authoredFrom.kind,
            Number(authoredOpening.zoom) || 1, null,
          );
          approach.x = authoredFromState.x;
          approach.y = authoredFromState.y;
          approach.z = authoredFromState.z;
        }
        // Opener movement is a macro gesture, not hold texture. Give it enough
        // screen distance to be legible even when a contextual fit balances an
        // off-centre subject against companions; the kinematic limiter below
        // still scales it down for genuinely short approaches.
        var screenTravel = Math.min(viewport.w, viewport.h) *
          clamp(0.14 + openingWindow * 0.012, 0.14, 0.18);
        var direction = openingBlock.arrivalPose && openingBlock.arrivalPose.anchor &&
            Number(openingBlock.arrivalPose.anchor.x) < 0.48
          ? 1
          : -1;
        if (
          authoredOpening.move === "pan" ||
          authoredOpening.move === "track-to-anchor"
        ) {
          approach.x += direction * screenTravel / Math.max(0.5, approach.z);
        } else if (authoredOpening.move === "parallax-pass") {
          approach.x += direction * screenTravel / Math.max(0.5, approach.z);
          approach.z = clamp(approach.z * 0.97, ZOOM_MIN, ZOOM_MAX);
        } else if (authoredOpening.move === "push-in") {
          approach.x += direction * screenTravel * 0.34 / Math.max(0.5, approach.z);
          approach.z = clamp(approach.z * 0.82, ZOOM_MIN, ZOOM_MAX);
        } else if (authoredOpening.move === "pull-back") {
          approach.z = clamp(approach.z * 1.16, ZOOM_MIN, ZOOM_MAX);
        } else if (authoredOpening.move === "whip") {
          approach.x += direction * screenTravel * 1.45 / Math.max(0.5, approach.z);
        } else {
          approach.x += direction * screenTravel * 0.45 / Math.max(0.5, approach.z);
        }
        // If the authored idea asks for more distance than the persisted
        // kinematic budget can cover, reduce that approach continuously. This
        // preserves a motivated move without reintroducing a late lunge.
        if (minimumRouteDuration(approach, entryLandingState) > openingWindow) {
          var low = 0;
          var high = 1;
          for (var fitStep = 0; fitStep < 10; fitStep += 1) {
            var fraction = (low + high) / 2;
            var candidateApproach = {
              x: entryLandingState.x + (approach.x - entryLandingState.x) * fraction,
              y: entryLandingState.y + (approach.y - entryLandingState.y) * fraction,
              z: entryLandingState.z + (approach.z - entryLandingState.z) * fraction,
            };
            if (minimumRouteDuration(candidateApproach, entryLandingState) <= openingWindow) {
              low = fraction;
            } else {
              high = fraction;
            }
          }
          approach = {
            x: entryLandingState.x + (approach.x - entryLandingState.x) * low,
            y: entryLandingState.y + (approach.y - entryLandingState.y) * low,
            z: entryLandingState.z + (approach.z - entryLandingState.z) * low,
            r: 0,
          };
        }
        if (!nearlySame(approach, entryLandingState)) {
          start = approach;
          openingApproach = {
            startSec: openingStart,
            endSec: entryArrival - 0.125,
          };
        }
      }
    }
    var reference = { x: start.x, y: start.y };
    var proxy = { x: start.x, y: start.y, z: start.z, r: 0, ry: 0, ox: 0, oy: 0, oz: 1 };

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
      var z = proxy.z * (proxy.oz || 1);
      var cameraX = proxy.x + (proxy.ox || 0);
      var cameraY = proxy.y + (proxy.oy || 0);
      var tx = viewport.w / 2 - cameraX * z;
      var ty = viewport.h / 2 - cameraY * z;
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
        var layerTransform = layer.parallax
          ? "translate(" + (cameraX - reference.x) * factor + "px," +
            (cameraY - reference.y) * factor + "px)"
          : "translate(0px,0px)";
        if (depth3d) {
          var layerZ = depthEnvelope * (layer.depth - 0.5) * DEPTH_Z_RANGE_PX;
          layerTransform += " translateZ(" + layerZ.toFixed(2) + "px)";
        }
        layer.element.style.transform = layerTransform;
      }
    }

    function scheduleOperatedHold(block) {
      if (environmentOwnsAmbient) return;
      if (!block || !block.dwell) return;
      var holdStart = Number(block.dwell.startSec);
      var holdEnd = Number(block.dwell.endSec);
      var holdDuration = holdEnd - holdStart;
      if (!isFinite(holdStart) || !isFinite(holdEnd) || holdDuration < 0.42) return;
      // Give QA and the audience a clean landing before the operator begins a
      // living hold. The lens then moves quietly and returns exactly to pose
      // before handoff; rest is a punctuation mark, not a multi-second freeze.
      var landingRest = Math.min(0.18, holdDuration * 0.18);
      holdStart += landingRest;
      holdDuration = holdEnd - holdStart;
      // A dwell is the audience's READING window. Floating the lens through it
      // put every glyph in constant subpixel motion — measured on the
      // motion-quality-verify-1 render as whole-frame edge ghosting between
      // consecutive dwell frames (~38dB PSNR at "rest"), which H.264 turns
      // into visible text shake. Short dwells therefore rest completely (a
      // locked frame under 1.4s can never become a flagged quiet window), and
      // only holds long enough to read as a stopped slide keep a drift.
      if (holdDuration < 1.2) return;
      // The remaining long-hold drift is TRANSLATE ONLY. The old 0.35% scale
      // breathe re-rasterized every glyph radially each frame — the single
      // worst text-shimmer source — while translate on the composited world
      // reads as calm operated motion. The hash chooses a stable operated
      // side; there is no random motion and the focal never leaves its anchor
      // budget, returning to the exact blocking pose before the next route.
      var sign = hashUnit(scenePlan.sceneId + ":" + block.id) < 0.5 ? -1 : 1;
      var travel = Math.min(viewport.w, viewport.h) * 0.006 /
        Math.max(0.5, proxy.z || 1);
      var outDuration = holdDuration * 0.56;
      var backDuration = holdDuration - outDuration;
      tween(timeline, proxy, { ox: 0, oy: 0 }, {
        ox: sign * travel,
        oy: -travel * 0.34,
        duration: outDuration,
        ease: "sine.inOut",
        onUpdate: apply,
      }, holdStart);
      tween(timeline, proxy, {
        ox: sign * travel,
        oy: -travel * 0.34,
      }, {
        ox: 0,
        oy: 0,
        duration: backDuration,
        ease: "sine.inOut",
        onUpdate: apply,
      }, holdStart + outDuration);
    }

    // Feature-on route: the blocking graph, not independently authored camera
    // verbs, owns x/y/zoom. Every phrase lands on its measured target through
    // one minimum-jerk spline; the preceding phrase's readable dwell is the
    // earliest departure, so connective travel fills only genuinely free time.
    // Existing typed segments still own rack focus below. Feature-off keeps
    // the original segment compiler unchanged.
    if (directedBlocks.length) {
      world.setAttribute("data-sequences-camera-blocking", "1");
      tween(timeline, proxy, {
        x: start.x,
        y: start.y,
        z: start.z,
        r: 0,
        ry: 0,
      }, {
        x: start.x,
        y: start.y,
        z: start.z,
        r: 0,
        ry: 0,
        duration: 0.001,
        ease: "none",
        onUpdate: apply,
      }, 0);
      // A seek may jump from a late tail back into a hold where no positional
      // tween is active. Drive `apply` across the whole master so the proxy's
      // reset/held value is always written back to DOM, including hidden
      // incoming scenes whose geometry a continuity handoff measures.
      var renderDriver = { p: 0 };
      tween(timeline, renderDriver, { p: 0 }, {
        p: 1,
        duration: segments[segments.length - 1].endSec,
        ease: "none",
        onUpdate: apply,
      }, 0);
      // Primary blocks still own ROUTING. Supporting phrases may only extend
      // the operated hold when they name the same route/pose; they cannot
      // manufacture a late reframe, zoom, or orbit. This distinction matters:
      // a long supporting read after the payoff still needs a living lens.
      var operatedCandidates = [];
      function addOperatedCandidate(candidate) {
        if (!candidate || !candidate.dwell ||
            operatedCandidates.indexOf(candidate) >= 0) return;
        operatedCandidates.push(candidate);
      }
      addOperatedCandidate(entryBlock);
      for (var oh = 0; oh < directedBlocks.length; oh += 1) {
        addOperatedCandidate(directedBlocks[oh]);
      }
      for (var supportIndex = 0; supportIndex < allDirectedBlocks.length; supportIndex += 1) {
        var support = allDirectedBlocks[supportIndex];
        var sharesDirectedPose = directedBlocks.some(function (owner) {
          return samePoseIntent(owner, support);
        });
        if (sharesDirectedPose) addOperatedCandidate(support);
      }
      operatedCandidates.sort(function (a, b) {
        return Number(a.dwell.startSec) - Number(b.dwell.startSec);
      });
      // Merge touching dwells on one pose. Overlapping ox/oy/oz tweens would
      // fight each other and create tiny reversals; one longer operated arc is
      // both calmer and continuously measurable.
      var operatedHolds = [];
      for (var candidateIndex = 0; candidateIndex < operatedCandidates.length; candidateIndex += 1) {
        var held = operatedCandidates[candidateIndex];
        var priorHeld = operatedHolds[operatedHolds.length - 1];
        if (
          priorHeld && samePoseIntent(priorHeld, held) &&
          Number(held.dwell.startSec) <= Number(priorHeld.dwell.endSec) + 0.08
        ) {
          priorHeld.dwell = {
            startSec: Math.min(
              Number(priorHeld.dwell.startSec),
              Number(held.dwell.startSec),
            ),
            endSec: Math.max(
              Number(priorHeld.dwell.endSec),
              Number(held.dwell.endSec),
            ),
            readableSec: Math.max(
              Number(priorHeld.dwell.readableSec) || 0,
              Number(held.dwell.readableSec) || 0,
            ),
          };
        } else {
          operatedHolds.push(Object.assign({}, held, {
            dwell: Object.assign({}, held.dwell),
          }));
        }
      }
      for (var hs = 0; hs < operatedHolds.length; hs += 1) {
        scheduleOperatedHold(operatedHolds[hs]);
      }
      if (openingApproach) {
        tween(timeline, proxy, {
          x: start.x,
          y: start.y,
          z: start.z,
        }, {
          x: entryLandingState.x,
          y: entryLandingState.y,
          z: entryLandingState.z,
          duration: openingApproach.endSec - openingApproach.startSec,
          ease: "seqContinuity",
          onUpdate: apply,
        }, openingApproach.startSec);
      }
      var routeState = entryLandingState;
      var routeTargetKey = routeKey(entryBlock || directedBlocks[0]);
      var routeBlock = entryBlock || directedBlocks[0];
      var routeCursor = entryBlock
        ? Number(entryBlock.dwell && entryBlock.dwell.endSec) ||
          Number(entryBlock.arrivalSec) || segments[0].startSec
        : segments[0].startSec;
      // When the entry block is a connective/supporting overview and the first
      // primary is elsewhere, route to that primary instead of pretending the
      // camera already landed on it. If both name the same station, preserve
      // the held pose and begin at the next distinct target.
      var routeStartIndex = entryMatchesFirst ? 1 : 0;
      for (var b = routeStartIndex; b < directedBlocks.length; b += 1) {
        var block = directedBlocks[b];
        var blockTarget = blockingTargetElement(scene, block);
        if (!blockTarget) continue;
        var blockZoom = block.arrivalPose ? Number(block.arrivalPose.zoom) || 1 : 1;
        var blockState = carriedUnionIndex === b && carriedUnionState
          ? carriedUnionState
          : blockingFrameState(viewport, world, blockTarget, blockZoom, block);
        var preblockedForNext = false;
        var nextBlockTarget = blockingTargetElement(scene, directedBlocks[b + 1]);
        if (nextBlockTarget && shouldPreblockUnion(
          block, directedBlocks[b + 1], blockTarget, nextBlockTarget,
        )) {
            var currentUnion = unionFrameState(
              viewport, world, blockTarget, nextBlockTarget, block, blockTarget,
            );
            var nextUnion = unionFrameState(
              viewport, world, blockTarget, nextBlockTarget, directedBlocks[b + 1], nextBlockTarget,
            );
            blockState = preblockFreeSec(block, directedBlocks[b + 1]) < 0.4
              ? nextUnion
              : currentUnion;
            preblockedForNext = true;
            carriedUnionIndex = b + 1;
            carriedUnionState = nextUnion;
        }
        var blockTargetKey = routeKey(block);
        if (blockTargetKey === routeTargetKey && samePoseIntent(routeBlock, block) && !preblockedForNext) {
          // Repeated attention on the same station is a hold, not a fresh
          // camera instruction. Keeping the prior measured pose prevents the
          // familiar zoom-in / zoom-out / zoom-in oscillation and protects
          // direction-score settle windows owned by the component.
          blockState = routeState;
        }
        var arrival = Number(block.arrivalSec);
        if (!isFinite(arrival)) continue;
        // A directed landing must already be at rest when its cue begins.
        // Ending one ordinary temporal sample early makes that contract
        // measurable instead of counting the final travel interval as dwell.
        var routeArrival = Math.max(segments[0].startSec, arrival - 0.125);
        // The prior readable dwell is the travel gate. Once it ends, the
        // camera may anticipate the next declared primary; waiting for that
        // phrase's local animation start wastes connective time and can turn
        // an otherwise motivated reframe into a late, over-speed lunge.
        var requestedStart = routeCursor;
        // Spend the connective window instead of waiting and lunging. The
        // minimum-jerk curve's derivative maxima and the plan's persisted
        // kinematic limits determine how early a measured route must begin.
        // Dense targets are normally preblocked as a union above; reclaiming a
        // small tail of the prior dwell is the deterministic fallback.
        var requiredDuration = minimumRouteDuration(routeState, blockState);
        var travelStart = routeBlock && routeBlock.importance === "primary"
          ? requestedStart
          : Math.min(requestedStart, routeArrival - requiredDuration);
        // Never borrow time from a primary readable dwell to satisfy the next
        // route's ideal kinematic duration. A short explicit handoff may need
        // to travel decisively, but moving the prior focal while its blocking
        // evidence promises rest is visibly incoherent (RouteBoard Probe 5).
        travelStart = Math.max(segments[0].startSec, travelStart);
        var travelDuration = routeArrival - travelStart;
        // Decimal cue times can represent an intended 150ms window as
        // 0.149999999...; keep a small numeric tolerance so that decisive
        // dense handoff is compiled instead of silently becoming a jump at
        // the following hold/tail tween.
        if (travelDuration >= 0.149 && !nearlySame(routeState, blockState)) {
          tween(timeline, proxy, {
            x: routeState.x,
            y: routeState.y,
            z: routeState.z,
          }, {
            x: blockState.x,
            y: blockState.y,
            z: blockState.z,
            duration: travelDuration,
            ease: "seqContinuity",
            onUpdate: apply,
          }, travelStart);
        }
        routeState = blockState;
        routeTargetKey = blockTargetKey;
        routeBlock = block;
        routeCursor = Math.max(
          arrival,
          Number(block.dwell && block.dwell.endSec) || arrival,
        );
      }
      var routeSceneEnd = segments[segments.length - 1].endSec;
      if (!environmentOwnsAmbient && routeSceneEnd - routeCursor > 0.3) {
        // Free tail after the last readable landing. The old fixed 0.8% zoom
        // was imperceptible over a multi-second tail (and below the temporal
        // liveness contract). Scale the operated drift by duration, with a
        // small diagonal truck, so motion remains visible at 5Hz without
        // challenging the held result or reversing before the cut.
        var tailDuration = routeSceneEnd - routeCursor;
        var tailSign = hashUnit(scenePlan.sceneId + ":tail") < 0.5 ? -1 : 1;
        var tailTravel = Math.min(viewport.w, viewport.h) *
          clamp(0.006 + tailDuration * 0.0022, 0.008, 0.015) /
          Math.max(0.5, routeState.z || 1);
        var tailScale = Math.exp(clamp(
          0.0028 * tailDuration / 0.25,
          Math.log(1.014),
          Math.log(1.05),
        ));
        var tailState = {
          x: routeState.x + tailSign * tailTravel,
          y: routeState.y - tailTravel * 0.28,
          z: clamp(routeState.z * tailScale, ZOOM_MIN, ZOOM_MAX),
        };
        tween(timeline, proxy, {
          x: routeState.x,
          y: routeState.y,
          z: routeState.z,
        }, {
          x: tailState.x,
          y: tailState.y,
          z: tailState.z,
          duration: tailDuration,
          ease: "seqDrift",
          onUpdate: apply,
        }, routeCursor);
      }
      compileFocus(timeline, scene, world, layers, segments);
      apply();
      return {
        sceneId: scenePlan.sceneId,
        world: world,
        layers: layers.length,
        blockingPhrases: directedBlocks.length,
      };
    }

    var state = start;
    for (var s = 0; s < segments.length; s += 1) {
      var segment = segments[s];
      var duration = segment.endSec - segment.startSec;
      var segmentBlocking = blockingFor(scenePlan.sceneId, segment);
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
          viewport, world, diveTarget.element, "part", segment.zoom, segmentBlocking,
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
        var framed = frameState(
          viewport, world, target.element, target.kind, segment.zoom, segmentBlocking,
        );
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
          // Feature-on blocking uses one minimum-jerk spline for measured
          // x/y/zoom travel. Feature-off behavior is byte-for-byte equivalent:
          // without the blocking island, the authored/resolved ease survives.
          ease: segmentBlocking ? "seqContinuity" : segment.ease,
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
        // A lite orbit is a shallow lateral crane/parallax arc. The old
        // implementation rotated the 2D world around Z, which is literally a
        // barrel roll and made product UI/text tilt for no narrative reason.
        var sign = end.x >= state.x ? 1 : -1;
        var half = duration / 2;
        var liteTravel = Math.min(viewport.w, viewport.h) * ORBIT_LITE_TRAVEL_RATIO /
          Math.max(0.5, end.z || state.z || 1);
        tween(timeline, proxy, { ox: 0, oy: 0 }, {
          ox: sign * liteTravel,
          oy: -liteTravel * 0.22,
          duration: half,
          ease: "sine.inOut",
          onUpdate: apply,
        }, segment.startSec);
        tween(timeline, proxy, { ox: sign * liteTravel, oy: -liteTravel * 0.22 }, {
          ox: 0,
          oy: 0,
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
