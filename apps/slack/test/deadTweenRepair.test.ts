import { describe, expect, it } from "vitest";
import {
  auditDeadGsapDataflow,
  stripDeadGsapTweens,
} from "../src/engine/deadTweenRepair.ts";

function html(script: string): string {
  return `<!doctype html><html><body>
<main data-composition-id="dead-tween-test"><div id="present"></div></main>
<script>${script}</script></body></html>`;
}

describe("dead GSAP target repair", () => {
  it("strips line-start missing selectors even when the preceding line is a comment", () => {
    const result = stripDeadGsapTweens(html(`
// This comment used to make the following call look expression-embedded.
tl.fromTo("#missing .child:last-child", { opacity: 0 }, { opacity: 1 }, 1);
tl.to("#present", { opacity: 1 }, 2);`));

    expect(result.repairs).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.neutralized).toBe(0);
    expect(result.html).not.toContain("#missing .child:last-child");
    expect(result.html).toContain('tl.to("#present"');
  });

  it("repairs empty, null, invalid, and literal querySelector targets", () => {
    const result = stripDeadGsapTweens(html(`
tl.to("", { opacity: 1 }, 0);
tl.set(null, { opacity: 0 }, 0);
tl.from("#bad[", { x: 10 }, 0);
tl.to(document.querySelector("#also-missing"), { y: 10 }, 0);`));

    expect(result.repairs).toBe(4);
    expect(result.removed).toBe(4);
    expect(result.selectors).toEqual(expect.arrayContaining(["", "null", "#bad[", "#also-missing"]));
  });

  it("inert-retargets embedded and chained no-ops without breaking their program shape", () => {
    const result = stripDeadGsapTweens(html(`
const returned = tl.to("#missing", { opacity: 1, onComplete: done }, 1);
tl.to("#missing-chain", { x: 20 }, 1).to("#present", { x: 0 }, 2);
tl.to(dynamicTarget, { y: 10 }, 3);`));

    expect(result.removed).toBe(0);
    expect(result.neutralized).toBe(2);
    expect(result.html).toContain(
      'const returned = tl.to(document.createElement("i"), { opacity: 1, onComplete: done }, 1)',
    );
    expect(result.html).toContain(
      'tl.to(document.createElement("i"), { x: 20 }, 1).to("#present"',
    );
    expect(result.html).toContain("tl.to(dynamicTarget");
  });

  it("does not rewrite GSAP examples inside comments or strings", () => {
    const source = `
// tl.to("#missing-comment", { opacity: 0 });
const docs = 'gsap.to("#missing-string", { opacity: 0 })';
tl.to("#present", { opacity: 1 }, 1);`;
    const result = stripDeadGsapTweens(html(source));
    expect(result.repairs).toBe(0);
    expect(result.html).toContain("#missing-comment");
    expect(result.html).toContain("#missing-string");
  });

  it("flags one-hop pseudo-element and absent-selector dataflow at the static gate", () => {
    const result = auditDeadGsapDataflow(html(`
const pseudo = document.querySelector(".cmp-value::after");
tl.to(pseudo, { opacity: 1 }, 0);
const absent = document.querySelector(".not-in-the-dom");
tl.to(absent, { x: 10 }, 1);
const live = document.querySelector("#present");
tl.to(live, { x: 10 }, 2);`));

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]).toContain("dead_gsap_target:");
    expect(result.findings[0]).toContain(".cmp-value::after");
    expect(result.findings[1]).toContain(".not-in-the-dom");
    expect(result.findings.join("\n")).not.toContain("#present");
  });

  it("does not guess through a second assignment or dynamic selector", () => {
    const result = auditDeadGsapDataflow(html(`
const query = document.querySelector(".not-in-the-dom");
const target = query;
tl.to(target, { x: 10 }, 0);
const dynamic = document.querySelector(selector);
tl.to(dynamic, { x: 10 }, 1);`));

    expect(result.findings).toEqual([]);
  });
});
