# HyperFrames upstream snapshot

This is a deliberately trimmed source snapshot of
[`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes).

- Version: `0.7.17`
- Commit: `3351fb1a6d7f0202d07db9bf9ad335fd0d1ec344`
- Commit date: 2026-06-27
- Imported: 2026-06-28

Kept here:

- runtime source used or studied by Slack: `core`, `engine`, `player`,
  `producer`, `cli`, `lint`, `parsers`, and `studio-server`;
- authoring, animation, rendering, schema, and package-reference docs;
- upstream license, credits, design notes, README, and skills manifest.

All 19 agent skills were moved intact to [`../../skills`](../../skills), where
the explicit legacy-provider route and coding agents can retrieve them locally.
The Luna-direct route uses its compact director prompt instead of this legacy
skill committee.

Omitted as unrelated to the Slack runtime: editor/plugin metadata
(`.claude*`, `.codex*`, `.cursor*`), GitHub/release automation, cloud deployment
packages, studio UI packages, showcases, registries, and heavyweight upstream
test/render fixtures. Upstream `*.test.*` / `*.spec.*` files are also omitted;
this snapshot is reference/runtime source, not a second CI surface.

The production Slack renderer remains pinned to its currently verified npm
substrate until the `0.7.x` runtime migration is tested separately. This
snapshot and its skills are the local source of truth for that migration.

Local compatibility patch: the vendored browser contrast audit decodes its
host-owned PNG through `createImageBitmap` instead of navigating an `<img>` to
a data URL. This preserves the audit under Luna's strict `img-src 'self'` CSP
without weakening the authored document policy.
