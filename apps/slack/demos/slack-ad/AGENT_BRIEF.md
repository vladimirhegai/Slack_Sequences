# Agent brief: Slack ad polish

This folder is the editable source of the 27-second demo film. It is intentionally isolated from the production `.data` project and from `scripts/slackAdFilm.ts`.

Start here:

1. Edit copy/timing in `config.js`.
2. Edit scene DOM in `index.html` and visual design in `style.css`.
3. Edit only the paused GSAP master in `timeline.js`. Use absolute positions; keep `window.__seek(seconds)` deterministic.
4. Preview/render with `npx tsx apps/slack/demos/slack-ad/render.ts` (representative pass) or `--render` from the repository root. If capture is interrupted — or the output directory is held open by another process and `rmSync` fails — clear the directory contents and use `--render --resume`; it fills holes rather than trusting the last frame index.
5. Inspect `apps/slack/demo-output/slack-ad-luna/contact-sheet.jpg`, `temporal-strip.jpg`, and `qa-report.json` before accepting the MP4.

Constraints:

- 1920×1080, 30fps, exactly 27.0 seconds, no audio.
- Local assets only: no network, randomness, timers, external fonts, or runtime fetches.
- Never expose real names/photos from the supplied screenshots. Keep fictional Sarah Bennett, Marcus Webb, and Acme Launch, or replace them with other clearly fictional content.
- Keep Sequences as a restrained one-line cameo.
- Camera moves must be short, motivated commits; the active focal component must stay inside the QA safe frame.
- Do not write any result into `.data`; outputs belong under `apps/slack/demo-output/slack-ad-luna`.
- Do not replace DOM-editable messages with screenshots.

2026-07-11 regrade: the mark is now the official eight-path Slack SVG (hero, orbit, and lockup); the field is Apple-white with the MIT wallpaper desktop behind the modal/workspace scenes; typewriters reveal by width so carets ride the text edge; the 12–16.25s beat contains a 2.3× superzoom with a rightward pan during the reply. Remaining critique targets: consider locally licensed interface SFX only if credits ship with the submission, and check whether the 16.25s proof transition benefits from a subtle shared-channel morph. Preserve the clean end hold.
