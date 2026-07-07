// Browser-side WCAG contrast audit.
// Loaded as a raw string and injected via page.addScriptTag to avoid
// esbuild mangling (page.evaluate serializes functions; __name helpers break).
//
// NOTE: WCAG math (relLum, wcagRatio, parseColor, median) is duplicated in
// skills/hyperframes/scripts/contrast-report.mjs — keep in sync.

/* eslint-disable */
window.__contrastAudit = async function (imgBase64, time) {
  function relLum(r, g, b) {
    function ch(v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }

  function wcagRatio(r1, g1, b1, r2, g2, b2) {
    var l1 = relLum(r1, g1, b1),
      l2 = relLum(r2, g2, b2);
    var hi = l1 > l2 ? l1 : l2,
      lo = l1 > l2 ? l2 : l1;
    return (hi + 0.05) / (lo + 0.05);
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    var r;
    var g;
    var b;
    if (s === 0) {
      r = g = b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hueToRgb(p, q, h + 1 / 3);
      g = hueToRgb(p, q, h);
      b = hueToRgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function contrastRepairColor(fgR, fgG, fgB, bgR, bgG, bgB, required) {
    var hsl = rgbToHsl(fgR, fgG, fgB);
    var originalL = hsl[2];
    var candidates = [];
    function test(direction) {
      var low = direction < 0 ? 0 : originalL;
      var high = direction < 0 ? originalL : 1;
      var best = null;
      for (var i = 0; i < 18; i++) {
        var mid = (low + high) / 2;
        var rgb = hslToRgb(hsl[0], hsl[1], mid);
        var ratio = wcagRatio(rgb[0], rgb[1], rgb[2], bgR, bgG, bgB);
        if (ratio >= required) {
          best = { rgb: rgb, ratio: ratio, delta: Math.abs(mid - originalL) };
          if (direction < 0) low = mid;
          else high = mid;
        } else if (direction < 0) {
          high = mid;
        } else {
          low = mid;
        }
      }
      if (best) candidates.push(best);
    }
    test(-1);
    test(1);
    var blackRatio = wcagRatio(0, 0, 0, bgR, bgG, bgB);
    if (blackRatio >= required) {
      candidates.push({ rgb: [0, 0, 0], ratio: blackRatio, delta: originalL });
    }
    var whiteRatio = wcagRatio(255, 255, 255, bgR, bgG, bgB);
    if (whiteRatio >= required) {
      candidates.push({ rgb: [255, 255, 255], ratio: whiteRatio, delta: 1 - originalL });
    }
    candidates.sort(function (a, b) {
      return a.delta - b.delta || b.ratio - a.ratio;
    });
    var picked = candidates[0];
    return picked
      ? "rgb(" + picked.rgb[0] + "," + picked.rgb[1] + "," + picked.rgb[2] + ")"
      : undefined;
  }

  function parseColor(c) {
    var m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    var p = m[1].split(",").map(function (s) {
      return parseFloat(s.trim());
    });
    return [p[0], p[1], p[2], p[3] != null ? p[3] : 1];
  }

  function selectorOf(el) {
    if (el.id) return "#" + el.id;
    var cls = Array.from(el.classList).slice(0, 2).join(".");
    return cls ? el.tagName.toLowerCase() + "." + cls : el.tagName.toLowerCase();
  }

  function median(arr) {
    var s = arr.slice().sort(function (a, b) {
      return a - b;
    });
    return s[Math.floor(s.length / 2)];
  }

  // Decode screenshot into canvas pixel data
  var img = new Image();
  await new Promise(function (resolve) {
    img.onload = resolve;
    img.onerror = function () {
      resolve();
    };
    img.src = "data:image/png;base64," + imgBase64;
  });
  if (!img.naturalWidth) return [];
  var canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1920;
  canvas.height = img.naturalHeight || 1080;
  var ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0);
  var px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  var w = canvas.width;
  var h = canvas.height;

  // Walk DOM for text elements
  var out = [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  var node;
  while ((node = walker.nextNode())) {
    var el = node;

    // Must have a direct text node child
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      if (
        el.childNodes[i].nodeType === 3 &&
        (el.childNodes[i].textContent || "").trim().length > 0
      ) {
        hasText = true;
        break;
      }
    }
    if (!hasText) continue;

    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (parseFloat(cs.opacity) <= 0.01) continue;
    // Also skip when an ANCESTOR is effectively invisible (opacity≈0 / hidden / display:none).
    // Karaoke captions keep every word at opacity 1 but toggle the GROUP's opacity per beat,
    // so an inactive word's OWN opacity is 1 — only an ancestor reveals it's hidden. Without
    // this, the hidden caption words flood the audit with false ~1:1 contrast warnings.
    var anc = el.parentElement,
      ancHidden = false;
    while (anc && anc !== document.body) {
      var acs = getComputedStyle(anc);
      if (
        acs.visibility === "hidden" ||
        acs.display === "none" ||
        parseFloat(acs.opacity) <= 0.01
      ) {
        ancHidden = true;
        break;
      }
      anc = anc.parentElement;
    }
    if (ancHidden) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= w || rect.top >= h) continue;

    var fg = parseColor(cs.color);
    if (fg[3] <= 0.01) continue;

    // Sample 4px ring outside bbox for background color
    var rr = [],
      gg = [],
      bb = [];
    var x0 = Math.max(0, Math.floor(rect.x) - 4);
    var x1 = Math.min(w - 1, Math.ceil(rect.x + rect.width) + 4);
    var y0 = Math.max(0, Math.floor(rect.y) - 4);
    var y1 = Math.min(h - 1, Math.ceil(rect.y + rect.height) + 4);
    var sample = function (sx, sy) {
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;
      var idx = (sy * w + sx) * 4;
      rr.push(px[idx]);
      gg.push(px[idx + 1]);
      bb.push(px[idx + 2]);
    };
    for (var x = x0; x <= x1; x++) {
      sample(x, y0);
      sample(x, y1);
    }
    for (var y = y0; y <= y1; y++) {
      sample(x0, y);
      sample(x1, y);
    }

    if (rr.length === 0) continue;

    var bgR = median(rr),
      bgG = median(gg),
      bgB = median(bb);

    // Composite foreground alpha over measured background
    var compR = Math.round(fg[0] * fg[3] + bgR * (1 - fg[3]));
    var compG = Math.round(fg[1] * fg[3] + bgG * (1 - fg[3]));
    var compB = Math.round(fg[2] * fg[3] + bgB * (1 - fg[3]));

    var ratio = +wcagRatio(compR, compG, compB, bgR, bgG, bgB).toFixed(2);
    var fontSize = parseFloat(cs.fontSize);
    var fontWeight = Number(cs.fontWeight) || 400;
    var large = fontSize >= 24 || (fontSize >= 19 && fontWeight >= 700);
    var required = large ? 3 : 4.5;

    out.push({
      time: time,
      selector: selectorOf(el),
      text: (el.textContent || "").trim().slice(0, 50),
      ratio: ratio,
      required: required,
      wcagAA: ratio >= required,
      large: large,
      fg: "rgb(" + compR + "," + compG + "," + compB + ")",
      bg: "rgb(" + bgR + "," + bgG + "," + bgB + ")",
      suggestedColor: contrastRepairColor(compR, compG, compB, bgR, bgG, bgB, required),
    });
  }
  return out;
};
