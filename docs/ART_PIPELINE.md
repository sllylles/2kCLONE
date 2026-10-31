# Art pipeline

Status: **planned for Phase 2.** Phase 1 uses procedural placeholder players
(`scripts/game/placeholder_player.gd`) with correct heights from the roster data.
This document is the contract the Phase 2 tools will follow.

## Inputs already in the repo

| Folder | Content | Notes |
|---|---|---|
| `hair/<style>/` | `.obj` mesh, `.mhclo` fitting data, `.mhmat` material, diffuse (and some normal) `.png` | 10 styles, CC0 |
| `eyes/high-poly`, `eyes/low-poly` | eye meshes + `.mhclo` | CC0 |
| `eyes/materials/` | 10 iris colors (`.mhmat` + `.png`) | CC0 |

Both folders have a `.gdignore`: they are source files for Blender, not game assets.
Exported, game-ready files go to `assets/players/` (to be created in Phase 2).

## Tooling

- Blender 4.2 LTS or newer
- [MPFB2](https://static.makehumancommunity.org/mpfb.html) add-on (the MakeHuman plugin for Blender)
- Scripts live in `tools/blender/` and run headless:
  `blender --background --python tools/blender/<script>.py -- <args>`

## Player model plan

1. **Base body** — MPFB2 new human from the default base mesh, proxy topology
   reduced to the "game engine" level so the full body lands at ~15–25k triangles.
2. **Skeleton** — one shared humanoid rig for every player: MPFB2's *game_engine*
   skeleton (Unity/Godot friendly, ~50 bones, no face bones). Bone names are mapped
   to Godot's `SkeletonProfileHumanoid` on import so retargeted animations work.
3. **Body shape sliders → blend shapes.** The MakeHuman macro targets are baked to
   shape keys and exported as glTF morph targets:
   - `height` (scales the skeleton too — set at runtime from `height_in`)
   - `weight`, `muscle`
   - `wingspan` (arm length targets; set from `wingspan_in - height_in`)
   - `shoulders`, `hips` (secondary)
4. **Faces** — a set of preset heads (MakeHuman face targets saved as presets in
   `tools/blender/face_presets/*.json`) plus a few face sliders exported as morphs.
5. **Hair & eyes** — fitted with MPFB2 from `hair/` and `eyes/` (`.mhclo` gives the
   fitting), exported as separate meshes attached to the head bone so they swap at runtime.
6. **Uniform** — a single jersey + shorts mesh, skinned to the same skeleton.
   Colors, trim and numbers come from a shader (team primary/secondary, number
   texture atlas), so one mesh serves every team.
7. **LODs** — LOD0 as above, LOD1 ≈ 40% via Blender Decimate; Godot's automatic
   mesh LOD covers the rest.
8. **Export** — glTF 2.0 binary (`.glb`) with +Y up, meters, morph targets and
   skins. One file for the body, one per hair style, one for the uniform.

## Animations (Phase 2)

Locomotion, dribbling, shooting, defense and contact animations are retargeted
onto the shared skeleton with Godot's retargeting (BoneMap + SkeletonProfileHumanoid).
Every source and license gets logged in `CREDITS.md` before it is committed.
Raw Mixamo files must not go in a public repo (see CREDITS.md); CC0 sets are preferred.

## Importing custom team logos

Team logos are optional PNGs referenced from `data/teams.json` (`"logo": "res://data/logos/xyz.png"`).
Without one, a badge is generated from the team colors and abbreviation. A logo can
also be loaded from the device at `user://data/logos/` without rebuilding the APK
(see README, "Editing data").
