# Courtside roadmap

Single source of truth for status. Updated at the end of every phase.

**Current build:** v0.3.0, Phases 0–2 done (real teams and rosters, rigged and animated players). **Waiting for device testing before Phase 3.**

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation | ✅ Done |
| 1 | Arena & cameras | ✅ Done (placeholder players) |
| 2 | Players & animation | ✅ Done |
| 3 | Controls & gameplay feel | ⏭ Next |
| 4 | Game simulation & AI | Planned |
| 5 | Play Now hub | Planned |
| 6 | MyPlayer builder | Planned |
| 7 | Career mode | Planned |
| 8 | Polish | Planned |

---

## Phase 0: Foundation ✅
- [x] Godot 4.7.2 project, Mobile renderer (Vulkan), landscape (sensor), 1920×1080 base UI that stretches to the phone's aspect
- [x] Android export preset (arm64, immersive), `tools/build_android.sh`, CI workflow that tests and uploads a debug APK on every push
- [x] Input abstraction (`InputRouter`): touch, Bluetooth/USB controller and keyboard all drive one InputMap; device auto-detect; controller and keyboard remapping saved in settings
- [x] Scene manager: fades, threaded loading, back stack, overlays
- [x] Save system: 4 slots, JSON, atomic write + `.bak` fallback, version migration, playtime
- [x] Settings menu: graphics (render scale 50–100%, 30/60/90/120 fps, FSR, quality, crowd density, MSAA), camera, controls (button size/opacity, remapping), audio buses, gameplay
- [x] Debug overlay: FPS, frame/physics ms, draw calls, objects, primitives, VRAM, 3D resolution
- [x] Data-driven JSON under `/data` (teams, rosters, arenas, camera presets) with on-device overrides
- [x] GUT unit tests (40 passing): court geometry, clocks/fouls/periods, save slots, settings, camera math, data sanity

## Phase 1: Arena & cameras ✅
- [x] Regulation court in one shader: 94×50 ft, 23'9" arc / 22' corners (straights run 14.2 ft), 16 ft lane, FT line and circle (dashed inside the lane), 4 ft restricted area, center circles, hash marks, 2" lines
- [x] Glossy hardwood (procedural planks/grain) with a box-projected reflection probe; team paint and apron; center-court logo (team PNG, or a generated badge)
- [x] Baskets: glass backboard 6×3.5 ft with shooter's square, rim at 10 ft, animated net, padded stanchion, backboard shot clocks with live times
- [x] Arena: two-tier seating bowl, ~9k instanced spectators in culled chunks (animated by crowd energy), LED ribbon and baseline boards, scorer's table, team benches, center-hung jumbotron with live score, ceiling light banks, broadcast-style lighting
- [x] Cameras: Broadcast, Elevated Sideline, Drive, Side Court, End Court, Skybox, each with its own zoom/height sliders; smooth blends between them
- [x] Pre-game flyover (spline path) with a matchup card; skippable
- [x] Replays: 10 s ring buffer, slow-motion playback with cinematic angles (rim, baseline, orbit, long lens); auto-replay on made threes
- [x] Broadcast HUD: scorebug (scores, period, game clock, shot clock that turns red under 5 s and off late in periods), fouls, timeouts, bonus, possession; player name cards; event toasts; camera chip; replay bug
- [x] Demo scrimmage with placeholder players so all of the above can be tested live

### How to test Phase 1
See README, "What to test". Things worth checking on the Pixel 10 Pro:
1. FPS with the debug overlay at the default (Medium, 85% render scale, 60 fps), then High at 100%.
2. Battery mode (30 fps) for a few quarters: does the phone stay cool?
3. All six cameras plus zoom/height sliders: is any framing off?
4. Touch layout: button sizes and positions, the stick feel, and a Bluetooth controller.
5. Save slots survive force-closing the app.

### Known limitations (intentional for this phase)
- Players are procedural mannequins with a simple run cycle; ball flight is scripted, not physics. Phases 2 and 3 replace both.
- The demo scrimmage is not the game sim. Rules and AI come in Phase 4.
- Replays move players along their recorded paths but don't replay limb animation yet.
- No audio yet (the buses and volume settings exist). Audio is Phase 8.
- FPS has only been measured on desktop/software rendering so far. Device numbers are needed from you.

---

## v0.2: Real teams ✅
- [x] All 30 teams with real names, colors and arenas; court paint and seats in team colors
- [x] 283 players from 2025-26 opening-night rosters bundled as an offline fallback
- [x] `tools/build_rosters.py --espn --logos` pulls current rosters and logos; CI runs it before every build
- [x] Logos appear at center court automatically when present (`data/logos/<TEAM>.png`)
- [ ] Ratings are rough: star overalls are hand-set and everyone else is estimated from experience. Stat-based ratings come in Phase 4.
- [ ] Player appearance (skin, hair, faces) stays neutral until the Phase 2/6 appearance system; it will be editable per player

## Phase 2: Players & animation ✅
- [x] Blender/MPFB2 pipeline (`tools/blender/build_player.py`, headless): CC0 MakeHuman base athlete at 6'7", shared 53-bone `game_engine` skeleton, glTF export ([docs/ART_PIPELINE.md](docs/ART_PIPELINE.md))
- [x] Body build blend shapes (heavy/light/muscular/slim) driven by roster weight, height and strength; height scales the model; wingspan lengthens the arm bones
- [x] 16 face sliders + 3 ancestry face blends, stable per-player variation, editable per player in `data/appearance.json`
- [x] Hair from `/hair` (10 styles) and eyes from `/eyes`, fitted with MPFB2's .mhclo fitting
- [x] Generated jersey, shorts and high-top shoes that share the body's skin weights and blend shapes; uniform shader with team colors, trim, team name and front/back numbers ("0" vs "00" kept)
- [x] Body ~18.8k triangles (skin under the uniform removed), ~28–35k per dressed player; Godot auto-LODs
- [x] 40+ original animations as editable JSON poses (`data/animations`): idle, athletic stance, jog, sprint, strafes, backpedal, defensive stance, slides and backpedal, dribbles (standing and running, both hands), triple threat, crossover, between the legs, behind the back, spin, hesitation, stepback, jump shot, layup, floater, dunk, chest and bounce pass, catch, rebound, block, contest, steal, three bumps, celebration
- [x] AnimationTree per player: offense and defense locomotion blend spaces with speed matching, upper-body dribble layer phase-locked to the ball, one-shot actions with event timing (release, gather, grab, reach, land)
- [x] Ball handling: the ball rides the dribbling hand and bounces in sync with the arm, moves between hands on crossovers, between the legs and behind the back, sits in both hands for shots and passes, and leaves on the release frame
- [x] IK: feet plant when standing (TwoBoneIK3D), hands reach for incoming passes
- [x] Collisions: bodies can't overlap; hard contact plays bump reactions
- [x] Demo game uses all of it; replays drive the legs from the replayed movement
- [x] Player Lab (PLAY NOW → PLAYER LAB): any player, any animation, turntable, speed
- [x] Tests: 50 passing (adds animation data/conventions and avatar measurements)

### How to test Phase 2
1. **Player Lab**: flip through teams, players and animations. Do heights, builds and uniforms look right?
2. **Quick Game** in Side Court or Drive camera: watch the dribble, shots, dunks, passes, rebounds.
3. Try dribble moves with swipes in the pro-stick zone (or the right stick).
4. Watch FPS with the debug overlay. Desktop measurement at Medium is ~300 draw calls, ~320k triangles with 10 players.

### Known limitations
- Animations are hand-keyed poses, so they're stiffer than motion capture. They're data, so every clip can be refined, and better CC0 mocap can replace any of them later.
- Faces are generic: no per-player likeness yet. Set skin, hair and face sliders per player in `data/appearance.json`; the Phase 6 builder adds a UI.
- Replays move players along their recorded paths with matching leg motion; shot and dribble actions aren't re-played inside replays yet.
- Ball flight is still scripted. Physics is Phase 3.

## Phase 3: Controls & gameplay feel
- [ ] Full touch layout editor (drag buttons), contextual defense actions
- [ ] Shot meter with a timing window from rating/contest/fatigue/difficulty; meter style; real player %
- [ ] Physical ball flight, rim and backboard collisions, momentum movement, contact on drives

## Phase 4: Game simulation & AI
- [ ] Full rules: 24 s / 8 s / 3 s, fouls and free throws, bonus, goaltending, out of bounds, timeouts
- [ ] Difficulty Rookie → Hall of Fame; team AI plays (PnR, iso, motion, post), defenses (man, zone, help, switch)
- [ ] Substitutions, fatigue, box score, play-by-play, player of the game

## Phase 5: Play Now hub
- [ ] Quick Game (uniforms, arena picker), Season, Playoffs, Franchise, Blacktop, All-Star events, Practice; local 2-player if feasible

## Phase 6: MyPlayer builder
- [ ] Position, body measurements, attribute budget with caps, tiered badges, archetype presets + GOAT toggle, appearance, 3D turntable, multiple builds

## Phase 7: Career mode
- [ ] Original story in `/data/story` JSON: path choice, combine, draft night, rookie season, rival, MVP push; agent/coach dialogue, press conferences, chemistry, earned currency, endorsements, practice facility hub

## Phase 8: Polish
- [ ] Menu motion and team theming, crowd/arena audio, caption commentary (+TTS), Pixel 10 Pro performance and thermal pass

---

## Decisions log
- **Engine:** Godot 4.7.2 stable (latest 4.x at project start), Mobile renderer.
- **Geometry in code:** court, arena and HUD are generated procedurally, so there are no binary scene files to merge and everything follows the data.
- **Units:** court math in feet (`CourtSpec`), scene in meters.
- **Render layers:** 1 court/hoops, 2 stands/crowd (dimmer light), 3 players/ball.
- **Teams & players (v0.2):** real teams, arenas and rosters for a personal build. Rosters are refreshed from ESPN in CI; logos are downloaded at build time and git-ignored, never committed.
- **Animations (Phase 2):** CC0 sources only (approved).
