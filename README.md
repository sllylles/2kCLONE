# Courtside

A broadcast-style basketball simulation for Android (target: Pixel 10 Pro),
built with Godot 4.7 (Mobile renderer, Vulkan, landscape only).

Status and next steps live in **[ROADMAP.md](ROADMAP.md)**. Third-party assets and
licenses are in **[CREDITS.md](CREDITS.md)**.

---

## Install on your phone

### Option A — download the APK from GitHub Actions
Every push builds a debug APK. On GitHub open **Actions → "Test & build Android APK"
→ latest run → Artifacts → `courtside-debug-apk`**, download and unzip it.

### Option B — build it yourself
```bash
# needs Godot 4.7.2 + export templates, Android SDK (platform-tools, build-tools), JDK 17+
GODOT=/path/to/Godot_v4.7.2 ANDROID_SDK_ROOT=~/Android/Sdk tools/build_android.sh
# -> build/android/courtside-debug.apk
```

### Sideload with adb
1. On the phone: **Settings → About phone → tap "Build number" 7×** to unlock
   Developer options, then **Settings → System → Developer options → USB debugging: on**.
2. Plug the phone in and accept the "Allow USB debugging" prompt.
3. On the computer:
   ```bash
   adb devices                                   # phone should be listed as "device"
   adb install -r courtside-debug.apk            # -r keeps your saves when updating
   adb shell monkey -p com.courtside.game 1      # launch it
   adb logcat -s godot                           # live engine log (errors show here)
   ```
   No computer? Copy the APK to the phone and open it from Files; allow
   "Install unknown apps" for the Files app when asked.

The debug build is signed with a throwaway debug key. If you ever switch to a
differently signed build, uninstall first (`adb uninstall com.courtside.game`).

---

## What to test (Phases 0–4)

| Area | How |
|---|---|
| Boot → menu | Splash, then the hub. Top tabs; most modes show "Coming in Phase N". |
| Profiles | Top-right **CREATE PROFILE** → 4 save slots: create, load, delete. Survives app restarts. |
| Settings | **OPTIONS → SETTINGS**: frame rate (30 = battery mode, 60/90/120), render scale, FSR, quality, crowd density, MSAA, debug overlay; camera preset + zoom/height; touch button size/opacity; controller remapping; audio; gameplay. |
| Debug overlay | Settings toggle, **three-finger tap**, or F3 on a keyboard: FPS, frame ms, draw calls, primitives, VRAM, 3D resolution. |
| Quick Game | **PLAY NOW → QUICK GAME**, pick away/home, **TIP OFF**. |
| Intro flyover | Plays before tip-off; tap to skip. |
| Cameras | **Pause (II) → CAMERA**: pick Broadcast, Elevated Sideline, Drive, Side Court, End Court or Skybox and set its zoom/height. Controllers: View button cycles cameras; keyboard: C. |
| Replays | **Pause (II) → INSTANT REPLAY** (D-pad down / V) replays the last 5 s with cinematic angles; auto-replays on made threes. Tap to skip. |
| HUD | Scorebug with game/shot clock, period, fouls, timeouts, bonus, possession; player name cards; backboard shot clocks and the jumbotron mirror the score. |
| Controls | Left half: floating stick. Right: SHOOT / PASS / SPRINT (BLOCK / STEAL / SWITCH on defense), swipe zone for the pro stick. Leave the controls for 3 s and the AI plays for you. Bluetooth controllers work with no setup (Xbox layout: X shoot, A pass, RT sprint). |
| Pause | **II** button (top right) / Menu / Esc: resume, camera, instant replay, replay intro, settings, quit. |
| Players | Rigged players at their real height, weight and wingspan, in team uniforms with their numbers and the team name. Watch dribbling, jump shots, layups, floaters, dunks, passes and catches, rebounds, blocks, contests, steals, bumps and celebrations. |
| Dribble moves | With the ball, swipe in the **pro stick zone** (or flick the right stick): toward your off hand = crossover (spin while sprinting), toward your ball hand = behind the back, down = stepback (between the legs while moving), up = hesitation (or a layup/dunk when you're driving at the rim). |
| Shooting | **Hold SHOOT** (or rest a finger in the pro-stick zone / hold the right stick) and **let go at the top of the jump**. The meter beside the shooter fills toward the release point; the green band is your timing window, bigger for better shooters and open looks, smaller when contested, tired or off a stepback. You get a grade (Excellent, Good, Slightly Early/Late, Early/Late, Very Early/Late). Settings → Gameplay: meter Arc / Bar / Off, or **Real player %** (no timing; ratings only). |
| Ball physics | Shots, passes and loose balls are physical: rim and backboard bounces, swishes, bank shots, long rebounds, deflections, out of bounds. Whoever reaches the ball gets it. |
| Movement | Momentum: sprinting players can't cut on a dime. Stamina drains while sprinting (the ring under your player turns red), which slows you and shrinks your shot window. Driving into a defender causes contact: you slow down and your shot is more contested. |
| Touch layout | Settings → Controls → **EDIT TOUCH LAYOUT**: drag any button anywhere; RESET restores the defaults. |
| Full games | Jump ball, inbounds, transition and the half-court game for 4 quarters (+ OT). Rules: 24-second shot clock, 8 seconds, over-and-back, offensive 3 seconds, out of bounds, goaltending, shooting / reach / blocking fouls, charges, and-ones, bonus free throws, 6 fouls and you're out. Quarter length and difficulty in Settings → Gameplay. |
| Free throws | Your team's free throws use the meter: press SHOOT (or rest a finger in the swipe zone) to start, let go at the top. |
| Team AI | Both teams run pick-and-roll, isolation, post-ups, motion and fast breaks, and defend in man, switch or a 2-3 zone with help and box-outs. Ratings drive shots, passes, steals, blocks, rebounds and fouls. |
| Pause menu | Timeout (7 per team; the CPU also calls them to stop runs), Substitutions (or auto), Play call (Auto / Pick & Roll / Isolation / Post Up / Motion), Defense (Man / Switch / Zone), Box score, Play-by-play. |
| Final | Final screen with the score, player of the game and box score; Play again / Main menu. Wins and games played are saved to your profile. |
| Player Lab | **PLAY NOW → PLAYER LAB**: any player from any team, every animation, turntable, playback speed. |

---

## Project layout

```
autoload/        global services (registered in project.godot)
  settings.gd      persistent settings, applies render scale / fps / audio
  data_db.gd       loads /data JSON (with user:// overrides)
  save_system.gd   4 save slots, atomic writes + .bak fallback, versioned migration
  input_router.gd  touch + controller + keyboard -> one InputMap, remapping
  scene_manager.gd fades, threaded loading, back stack, overlays
  debug_overlay.gd fps / draw calls overlay
data/            teams, players, arenas, camera presets (edit freely)
scenes/          thin .tscn roots; UI and 3D are built in code
scripts/core/    CourtSpec (regulation dimensions), GameState (clocks, fouls, score)
scripts/arena/   CourtBuilder, ArenaBuilder, MeshKit
scripts/camera/  CameraDirector (presets, intro, replay cams), ReplayRecorder
scripts/hud/     BroadcastHUD
scripts/game/    arena scene, GameSim (game flow + rules), CourtPlayer (movement + avatar)
scripts/sim/     Referee, Rotation, BoxScore, TeamAI, Difficulty
scripts/player/  PlayerAvatar (model, body sliders, uniform), AvatarAnimator (AnimationTree, ball, IK), AnimLibrary
scripts/dev/     Player Lab
assets/players/  player.glb (built by tools/blender/build_player.py) + extracted hair textures
scripts/ui/      menus, settings, touch controls, UIKit theme
shaders/         court floor, LED ribbons, crowd, net
tests/unit/      GUT tests
tools/           build/test/capture scripts, roster generator
docs/            ART_PIPELINE.md (player model + animation pipeline)
hair/, eyes/     MakeHuman CC0 source assets for the Blender pipeline (.gdignore'd)
```

Coordinates: X along the 94 ft court, Z across, Y up, origin at center court.
`CourtSpec` works in feet; Godot units are meters (`CourtSpec.FT = 0.3048`).

## Running on a desktop

Open the folder in Godot 4.7 and press Play, or `godot --path .`. Mouse clicks
emulate touch, so the on-screen controls work; WASD/arrows + Space/E/Shift also work.

## Tests

```bash
godot --headless --path . --import                                   # first time only
godot --headless --path . -s res://tools/check_scripts.gd            # every script compiles
godot --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://tests/unit -gexit
```
CI runs all of these plus a headless smoke run of the arena on every push.

Screenshots without a GPU (used during development):
```bash
xvfb-run -a godot --path . --rendering-method mobile -s res://tools/capture.gd -- \
  res://scenes/arena_game.tscn /tmp/shots 3 4 '{"home":"BOS","away":"LAL","intro":false}'
```

## Editing data

Everything about teams, rosters, arenas and cameras is JSON under `data/`:

- `teams.json`: the 30 real teams with city, name, abbreviation, colors, home arena and court paint
- `players.json`: rosters with number, position, height, weight and ratings
- `arenas.json`: real arena names, seat color, ribbon-board text, bowl size, light color
- `camera_presets.json`: every camera's height/distance/FOV ranges and smoothing
- `animations/*.json`: every animation as readable poses (see docs/ART_PIPELINE.md)

Per-player appearance goes in `data/appearance.json`, keyed by full name, and is
merged into the rosters every time they're rebuilt (so CI roster refreshes keep it):
`"skin": "#8D5524"`, `"hair": "afro01"` (any folder in `hair/`, or `"none"`),
`"hair_color"`, and `"face": {"jaw_wide": 0.4, "nose_wide": 0.3, ...}` (blend shape
names in `assets/players/player_meta.json`). Run `python3 tools/build_rosters.py`
after editing.

`teams.json`, `arenas.json` and `players.json` are generated by `tools/build_rosters.py`:
```bash
python3 tools/build_rosters.py                 # bundled 2025-26 opening-night rosters (offline)
python3 tools/build_rosters.py --espn --logos  # current rosters + team logos from ESPN
```
CI runs the `--espn --logos` version before every APK build, so each build carries
that day's rosters and the real logos (center court and stanchions). Logos go to
`data/logos/`, which is git-ignored: they end up in your APK but never in the repo.
Star overalls come from the table in the script; edit it to tune ratings.
You can also drop any `<TEAM>.png` into `data/logos/` yourself (e.g. `BOS.png`).

To change data on the phone without rebuilding, put a file with the same name in
the app's `user://data/` folder. It replaces the bundled one. With a debug build:
```bash
adb push teams.json /data/local/tmp/
adb shell run-as com.courtside.game mkdir -p files/data
adb shell run-as com.courtside.game cp /data/local/tmp/teams.json files/data/
```

## Ground rules

- Personal build for one phone, not for distribution. It uses real team and player names;
  logos are fetched at build time and not stored in the repo. Keep the GitHub repo private.
- No league wordmark or branding in the UI; the game's own name is Courtside.
- Only CC0 or free, redistributable assets, each logged in CREDITS.md.
- No real-money purchases. In-game currency is earned only.
