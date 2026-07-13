# Studio agent ergonomics — the library must stay easy to author

Current status (2026-07-12): this remains the catalog-authoring charter, but
new components/assets/recipes/looks/camera/plugins are frozen during the active
S6.9-S6.13 hackathon stabilization work. Do not use this backlog to expand the
current sprint or delay the first judge-ready MP4.

**Owner mandate (updated 2026-07-13).** The Studio catalogs — Components,
Assets, Recipes, Looks, Camera patterns, Plugins — are the product's **library**:
the place where capable coding agents make proven, parameterized craft that
the deterministic host and the explicit legacy-provider route can consume.
Luna may choose compatible host contracts, but the Luna-direct route does not
currently receive the legacy catalog inventory. Exposing selected primitives
without turning them into a creative template is later integration work. Two
requirements remain product requirements, not nice-to-haves:

1. **Agent-authorable, always.** Every catalog must stay trivially editable by
   a coding agent — and specifically by a **clean-context subagent**: the
   owner asks the main agent for (say) "more recipes", the main agent spawns a
   subagent whose head isn't messied by the whole codebase, and that subagent
   must be able to succeed from a skill file + a narrow brief alone.
2. **Seamlessly integrated.** A new catalog entry must flow end-to-end with no
   extra wiring: planner vocabulary (retrieval/prompts) → storyboard schema →
   host injection → QA gates → Studio tab. If adding an entry requires
   touching N scattered seams by hand, the ergonomics are broken.

The recipes pipeline is the reference shape: one committed source file
(`recipes/<id>.recipe.html`), one authoring guide (`recipes/README.md`), one
CLI gate (`npm run recipes -- gate/export <id>`) that runs the EXACT
production machinery, thumbnails to eyeball, no hidden state. Every other
catalog should converge on that shape.

## Backlog (audit + build; possibly beyond Codex's MOTION_QUALITY_PLAN scope —
whoever picks this up, keep increments small)

- **E1. A skill/authoring file per Studio tab.** `recipes/README.md` exists;
  write the equivalent for components (add a kind: catalog entry + kit
  CSS/runtime beats + tests), assets (`defineAsset` file + springs + Asset Lab
  proof), looks/dialects, camera patterns, and plugins (params → lowering →
  budget rules). Each file must be sufficient for a clean-context subagent:
  exact files to touch, contracts to register (sentinel.ts!), gate commands to
  run, and what "proven" means for that catalog.
- **E2. Scaffolding commands.** `npm run recipes -- new <id>`-style generators
  for each catalog so a subagent starts from a valid skeleton instead of
  reverse-engineering a sibling.
- **E3. Integration audit.** For each catalog, prove the chain
  entry → retrieval/prompt vocabulary → schema → injection → QA → Studio tab
  with one test or checklist per catalog; file gaps as defects. (This is the
  "integrated seamlessly, and amazingly" bar: G1's recipe-consumption gap —
  planner declines offered recipes — is the known first defect.)
- **E4. Keep `studio/INTEGRATION.md`'s seam table authoritative** — any new
  seam a catalog entry must cross gets a row, so the audit stays mechanical.

Related: `../REFACTOR_HANDOFF.md` defines when proven-library work is in scope;
this charter keeps the AUTHORING PATH cheap. Both matter — the library is only
as good as how easily the next agent can extend it.

## Implemented authoring path (2026-07-10)

The six product tabs now have clean-context skills under `studio/skills/`:
`studio-components`, `studio-assets`, `studio-recipes`, `studio-looks`,
`studio-camera`, and `studio-plugins`. Give a subagent the matching `SKILL.md`
plus a narrow brief; it contains exact source seams, Sentinel obligations,
proof commands, and the catalog-specific definition of done.

Start from a deterministic skeleton:

```powershell
npm run catalog --workspace @sequences/slack -- new components <id>
npm run catalog --workspace @sequences/slack -- new assets <id>
npm run recipes --workspace @sequences/slack -- new <id>
npm run catalog --workspace @sequences/slack -- new looks <id>
npm run catalog --workspace @sequences/slack -- new camera <id>
npm run catalog --workspace @sequences/slack -- new plugins <id>
```

Recipe sources are created directly in `recipes/`; other skeletons go to the
gitignored `.data/studio/scaffolds/` workspace so an agent must apply each
central-catalog edit deliberately. Generators refuse to overwrite work.

`src/engine/studioLibrary.ts` generates a compact inventory from the five typed
catalogs. `skillContext.ts` includes it in the reference shared by the legacy
planning and source-authoring calls; proven recipes retain their separate
scored retrieval path. `test/studioCatalogIntegration.test.ts` mechanically
proves catalog → legacy-provider vocabulary → Studio discovery. It deliberately
does not claim Luna integration. Each catalog skill identifies the
schema/injection/QA tests that complete its chain. The detailed seam matrix
remains in `studio/INTEGRATION.md`.
