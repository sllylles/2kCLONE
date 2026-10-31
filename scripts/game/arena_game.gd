extends Node3D
## Phase 1 game scene: builds the arena for the chosen matchup, runs the
## pre-game flyover, then the demo scrimmage with live cameras, replays and
## the broadcast HUD. Also hosts the pause menu.

var home: Dictionary
var away: Dictionary
var arena_data: Dictionary
var state: GameState
var court: CourtBuilder
var arena: ArenaBuilder
var director: CameraDirector
var recorder: ReplayRecorder
var sim: DemoScrimmage
var hud: BroadcastHUD
var touch: TouchControls
var pause_menu: Control

var _excitement := 0.25
var _last_card_ms := -100000
var _jumbo_accum := 0.0
var _in_replay := false
var _replay_last := {}


func _ready() -> void:
	var params := SceneManager.params
	home = DataDB.team(params.get("home", DataDB.teams[0].id))
	away = DataDB.team(params.get("away", DataDB.teams[1].id))
	arena_data = DataDB.arena(params.get("arena", home.get("arena", "")))
	var quality := str(Settings.get_value("graphics", "quality"))
	Settings.apply_viewport(get_viewport())

	state = GameState.new(float(Settings.get_value("gameplay", "quarter_minutes")))

	court = CourtBuilder.new()
	court.name = "Court"
	add_child(court)
	court.build(home, quality)

	arena = ArenaBuilder.new()
	arena.name = "Arena"
	add_child(arena)
	arena.build(home, away, arena_data, quality, float(Settings.get_value("graphics", "crowd_density")))

	director = CameraDirector.new()
	director.name = "Cameras"
	add_child(director)

	sim = DemoScrimmage.new()
	sim.name = "Scrimmage"
	add_child(sim)
	sim.camera = director.camera
	sim.setup(state, home, away)
	director.focus = sim.ball

	recorder = ReplayRecorder.new()
	recorder.name = "Replay"
	add_child(recorder)
	for p in sim.players:
		recorder.track(p)
	recorder.track(sim.ball)
	recorder.playback_finished.connect(_on_replay_finished)

	hud = BroadcastHUD.new()
	add_child(hud)
	hud.setup(state, home, away, arena_data.get("name", ""))

	var touch_layer := CanvasLayer.new()
	touch_layer.layer = 20
	add_child(touch_layer)
	touch = TouchControls.new()
	touch_layer.add_child(touch)

	# The root keeps running while paused so it can unpause; everything else stops.
	process_mode = Node.PROCESS_MODE_ALWAYS
	for c in get_children():
		c.process_mode = Node.PROCESS_MODE_PAUSABLE
	_build_pause_menu()

	state.shot_clock_expired.connect(func(_t): sim.on_shot_clock_violation())
	state.period_ended.connect(sim.on_period_ended)
	sim.shot_made.connect(_on_shot_made)
	sim.shot_missed.connect(func(_t): _excitement = maxf(_excitement, 0.45))
	sim.handler_changed.connect(_on_handler_changed)
	sim.possession_changed.connect(_on_possession_changed)
	sim.announce.connect(func(text): hud.toast(text, UIKit.ACCENT_2))
	director.preset_changed.connect(func(_id, n): hud.show_camera_name(n))
	director.intro_finished.connect(_on_intro_finished)
	_on_possession_changed(state.possession)

	if Settings.get_value("camera", "intro_flyover"):
		sim.paused = true
		state.running = false
		director.start_intro()
		hud.show_matchup(true)
	else:
		hud.show_matchup(false)


func _on_intro_finished() -> void:
	hud.show_matchup(false)
	sim.paused = false
	state.running = true
	hud.show_camera_name(director.preset.get("name", ""))


func _on_possession_changed(team: int) -> void:
	director.attack_side = sim.attack_side(team)
	touch.set_defense(team != GameState.HOME)
	director.drive_subject = sim.user


func _on_handler_changed(p: CourtPlayer) -> void:
	director.drive_subject = sim.user
	var now := Time.get_ticks_msec()
	if now - _last_card_ms > 9000 and director.mode == CameraDirector.Mode.LIVE:
		_last_card_ms = now
		hud.show_player_card(p.data, home if p.team_idx == GameState.HOME else away, sim.stat_line(p))


func _on_shot_made(team: int, points: int, shooter: CourtPlayer) -> void:
	court.swish(sim.attack_side(team))
	_excitement = 1.0 if team == GameState.HOME else 0.5
	if points == 3:
		hud.toast("3-POINTER!", UIKit.ACCENT_2)
	InputRouter.vibrate(40, 0.6)
	if points == 3 and Settings.get_value("camera", "auto_replays"):
		get_tree().create_timer(0.9, false).timeout.connect(start_replay)
	_last_card_ms = 0
	hud.show_player_card(shooter.data, home if team == GameState.HOME else away, sim.stat_line(shooter))


func start_replay() -> void:
	if _in_replay or director.mode != CameraDirector.Mode.LIVE:
		return
	var duration := recorder.play(5.0)
	if duration <= 0.0:
		return
	_in_replay = true
	sim.paused = true
	director.start_replay(duration, director.attack_side, sim.ball.global_position / CourtSpec.FT)
	hud.set_replay(true)


func stop_replay() -> void:
	if _in_replay:
		recorder.stop()


func _on_replay_finished() -> void:
	_in_replay = false
	director.end_replay()
	hud.set_replay(false)
	sim.paused = get_tree().paused


func _process(delta: float) -> void:
	if _in_replay and delta > 0.0:
		# Drive the legs from the replayed movement so players don't skate.
		for p in sim.players:
			var last: Vector3 = _replay_last.get(p, p.global_position)
			p.anim.velocity = (p.global_position - last) / delta
			_replay_last[p] = p.global_position
	var live := director.mode == CameraDirector.Mode.LIVE and not get_tree().paused
	touch.visible = live and InputRouter.touch_controls_visible()
	# Crowd energy decays back to a murmur; louder late in close games.
	var base := 0.25 + (0.25 if state.period >= 4 and absi(state.scores[0] - state.scores[1]) < 6 else 0.0)
	_excitement = lerpf(_excitement, base, 1.0 - exp(-0.6 * delta))
	arena.set_excitement(_excitement)
	court.set_clock_text(GameState.format_clock(state.game_clock), GameState.format_shot_clock(state.shot_clock),
		state.shot_clock_active())
	_jumbo_accum += delta
	if _jumbo_accum > 0.5:
		_jumbo_accum = 0.0
		arena.update_jumbotron(state.scores[GameState.AWAY], state.scores[GameState.HOME],
			"%s  %s" % [state.period_label(), GameState.format_clock(state.game_clock)])


func _unhandled_input(event: InputEvent) -> void:
	if get_tree().paused:
		if event.is_action_pressed("pause") or (event.is_action_pressed("ui_cancel") and pause_menu.visible):
			toggle_pause()
			get_viewport().set_input_as_handled()
		return
	if director.mode == CameraDirector.Mode.INTRO:
		if event.is_pressed() and not event.is_echo() and not (event is InputEventMouseMotion):
			director.skip_intro()
			get_viewport().set_input_as_handled()
		return
	if _in_replay and event.is_pressed() and not event.is_action("pause"):
		if event is InputEventScreenTouch or event is InputEventJoypadButton or event is InputEventKey:
			stop_replay()
			get_viewport().set_input_as_handled()
			return
	if event.is_action_pressed("pause"):
		toggle_pause()
	elif event.is_action_pressed("camera_next"):
		director.cycle_preset()
	elif event.is_action_pressed("replay"):
		start_replay()


# --- Pause menu ------------------------------------------------------------------------

func _build_pause_menu() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 50
	layer.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(layer)
	pause_menu = Control.new()
	pause_menu.theme = UIKit.theme()
	UIKit.full_rect(pause_menu)
	pause_menu.visible = false
	layer.add_child(pause_menu)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.6)
	pause_menu.add_child(UIKit.full_rect(dim))
	var panel := UIKit.panel(Color(0.07, 0.08, 0.11, 0.97), 0)
	panel.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	panel.custom_minimum_size.x = 560
	pause_menu.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	panel.add_child(v)
	v.add_child(UIKit.label("PAUSED", 60, 900, UIKit.TEXT, true))
	v.add_child(UIKit.label("%s @ %s" % [away.abbr, home.abbr], 26, 700, UIKit.TEXT_DIM))
	var items := [
		["RESUME", toggle_pause],
		["CHANGE CAMERA", func(): director.cycle_preset()],
		["INSTANT REPLAY", func():
			toggle_pause()
			start_replay()],
		["REPLAY INTRO", func():
			toggle_pause()
			sim.paused = true
			state.running = false
			director.start_intro()
			hud.show_matchup(true)],
		["SETTINGS", func(): SceneManager.open_overlay("settings")],
		["QUIT TO MENU", _quit],
	]
	var first: Button = null
	for it in items:
		var b := UIKit.button(it[0], Vector2(460, 76))
		b.pressed.connect(it[1])
		v.add_child(b)
		if first == null:
			first = b
	pause_menu.set_meta("first", first)


func toggle_pause() -> void:
	if SceneManager.has_overlay():
		return
	var on := not pause_menu.visible
	pause_menu.visible = on
	get_tree().paused = on
	touch.visible = not on and InputRouter.touch_controls_visible()
	if on:
		touch.release_all()
		(pause_menu.get_meta("first") as Button).grab_focus()


func _quit() -> void:
	get_tree().paused = false
	if SaveSystem.active_slot >= 0:
		SaveSystem.save_active()
	SceneManager.goto("main_menu", {}, false)
