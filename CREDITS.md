# Credits & third-party licenses

Every third-party asset or library in this repository is listed here with its
license. Anything not listed was written for Courtside (code, shaders, data) or is
generated procedurally at runtime (court, arena, crowd, LED boards, logos, UI).

No asset in this project is paid, and no real league, team, player or brand names,
logos or likenesses are bundled.

## Engine & tools

| Item | Where | License | Source |
|---|---|---|---|
| Godot Engine 4.7.2 | runtime / editor (not in repo) | MIT | https://godotengine.org |
| GUT 9.6 (Godot Unit Test) | `addons/gut/` | MIT (`addons/gut/LICENSE.md`) | https://github.com/bitwes/Gut |

## Art assets

| Asset | Where | License | Copyright / source |
|---|---|---|---|
| MakeHuman hair: afro01, bob01, bob02, braid01, long01, ponytail01, short01–short04 (`.obj/.mhclo/.mhmat/.png`) | `hair/` | CC0 1.0 | © 2020 Data Collection AB, Joel Palmius, Jonas Hauquier — released as CC0 in Sept 2020. http://www.makehumancommunity.org |
| MakeHuman eyes: high-poly & low-poly meshes, 10 iris materials | `eyes/` | CC0 1.0 | Same as above |

`hair/` and `eyes/` are pipeline inputs for Blender/MPFB2 (see `docs/ART_PIPELINE.md`)
and carry a `.gdignore` so Godot does not import them into the game directly.

## Fonts

The UI uses the device's system sans-serif font through Godot's `SystemFont`
(Roboto on Android, Apache 2.0). No font files are bundled.

## Planned (not yet added — will be logged here when they are)

- MPFB2 Blender add-on (GPL-3.0 code; the meshes it exports are CC0) — Phase 2 player models.
- Animations — Phase 2. Mixamo clips are free to use inside a game, but Adobe's terms
  don't allow redistributing the raw files, so they must not be committed to a public
  repo. CC0 alternatives (e.g. Quaternius, Kenney) will be preferred; will confirm before adding.
- Crowd/arena audio — Phase 8, CC0 only (e.g. Kenney, freesound CC0).
