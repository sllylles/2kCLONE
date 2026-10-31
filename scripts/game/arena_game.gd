extends Node3D
## Game scene: builds the arena for the chosen matchup, runs the
## pre-game flyover, then a full game (GameSim) with live cameras, replays and
## the broadcast HUD. Also hosts the pause menu.

var home: Dictionary
var away: Dictionary
var arena_data: Dictionary
var state: GameState
var court: CourtBuilder
var arena: ArenaBuilder
var director: CameraDirector
var recorder: ReplayRecorder
var sim: GameSim
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

	sim = GameSim.new()
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

	sim.shot_made.connect(_on_shot_made)
	sim.shot_missed.connect(func(_t): _excitement = maxf(_excitement, 0.45))
	sim.handler_changed.connect(_on_handler_changed)
	sim.possession_changed.connect(_on_possession_changed)
	sim.announce.connect(func(text): hud.toast(text, UIKit.ACCENT_2))
	var meter := ShotMeter.new()
	meter.camera = director.camera
	hud.add_child(meter)
	sim.meter_started.connect(meter.start)
	sim.meter_graded.connect(meter.show_grade)
	director.preset_changed.connect(func(_id, n): hud.show_camera_name(n))
	director.intro_finished.connect(_on_intro_finished)
	sim.play_logged.connect(hud.ticker)
	sim.game_over.connect(_on_game_over)
	sim.timeout_called.connect(func(_t): _excitement = 0.2)
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


## Android back gesture / button pauses (or resumes) the game.
func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and not SceneManager.has_overlay():
		toggle_pause()


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
	var safe := Control.new()
	safe.mouse_filter = Control.MOUSE_FILTER_IGNORE
	pause_menu.add_child(safe)
	UIKit.fit_safe_area(safe)
	var row := HBoxContainer.new()
	UIKit.full_rect(row)
	row.add_theme_constant_override("separation", 30)
	safe.add_child(row)
	var panel := UIKit.panel(Color(0.07, 0.08, 0.11, 0.97), 8)
	panel.custom_minimum_size.x = 520
	row.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	panel.add_child(v)
	v.add_child(UIKit.label("PAUSED", 56, 900, UIKit.TEXT, true))
	var score_l := UIKit.label("", 24, 700, UIKit.TEXT_DIM)
	v.add_child(score_l)
	# One detail panel at a time on the right.
	var panels := {
		"camera": _build_camera_panel(),
		"box": GamePanels.box_score(sim),
		"pbp": GamePanels.play_by_play(sim),
		"subs": GamePanels.substitutions(sim),
	}
	for k in panels:
		var pc: Control = panels[k]
		pc.visible = false
		pc.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(pc)
	var show_panel := func(key: String):
		for k in panels:
			var pc: Control = panels[k]
			pc.visible = k == key and not pc.visible
			if pc.visible and pc.has_meta("refresh"):
				(pc.get_meta("refresh") as Callable).call()
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	v.add_child(grid)
	var ut := sim.user_team
	var timeout_b := UIKit.button("", Vector2(240, 62))
	var play_b := UIKit.button("", Vector2(240, 62))
	var def_b := UIKit.button("", Vector2(240, 62))
	var labels := func():
		timeout_b.text = "TIMEOUT (%d)" % state.timeouts[ut]
		timeout_b.disabled = not sim.can_call_timeout(ut)
		play_b.text = "PLAY: %s" % TeamAI.PLAY_NAMES[sim.ai[ut].play_call].to_upper()
		def_b.text = "DEFENSE: %s" % sim.ai[ut].scheme.to_upper()
		score_l.text = "%s %d  @  %s %d   •   %s %s" % [away.abbr, state.scores[GameState.AWAY], home.abbr,
			state.scores[GameState.HOME], state.period_label(), GameState.format_clock(state.game_clock)]
	timeout_b.pressed.connect(func():
		if sim.call_timeout(ut):
			toggle_pause())
	play_b.pressed.connect(func():
		var opts := ["auto"] + TeamAI.PLAYS
		sim.ai[ut].play_call = opts[(opts.find(sim.ai[ut].play_call) + 1) % opts.size()]
		sim.ai[ut].play = {}
		labels.call())
	def_b.pressed.connect(func():
		sim.ai[ut].scheme = TeamAI.SCHEMES[(TeamAI.SCHEMES.find(sim.ai[ut].scheme) + 1) % TeamAI.SCHEMES.size()]
		labels.call())
	var items := [
		["RESUME", toggle_pause],
		[timeout_b, null],
		["SUBSTITUTIONS", func(): show_panel.call("subs")],
		[play_b, null],
		[def_b, null],
		["BOX SCORE", func(): show_panel.call("box")],
		["PLAY-BY-PLAY", func(): show_panel.call("pbp")],
		["CAMERA", func(): show_panel.call("camera")],
		["INSTANT REPLAY", func():
			toggle_pause()
			start_replay()],
		["SETTINGS", func(): SceneManager.open_overlay("settings")],
		["REPLAY INTRO", func():
			toggle_pause()
			sim.paused = true
			state.running = false
			director.start_intro()
			hud.show_matchup(true)],
		["QUIT TO MENU", _quit],
	]
	var first: Button = null
	for it in items:
		var b: Button
		if it[0] is Button:
			b = it[0]
		else:
			b = UIKit.button(it[0], Vector2(240, 62))
			b.pressed.connect(it[1])
		b.add_theme_font_size_override("font_size", 21)
		grid.add_child(b)
		if first == null:
			first = b
	pause_menu.set_meta("first", first)
	pause_menu.set_meta("panels", panels)
	pause_menu.set_meta("labels", labels)


## Pick any camera angle and set its zoom/height; changes apply live.
func _build_camera_panel() -> Control:
	var p := UIKit.panel(Color(0.07, 0.08, 0.11, 0.97), 8)
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	p.custom_minimum_size.x = 640
	p.visible = false
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	p.add_child(v)
	v.add_child(UIKit.label("CAMERA", 40, 900, UIKit.TEXT, true))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	v.add_child(grid)
	var buttons := {}
	var zoom := HSlider.new()
	var height := HSlider.new()
	var sync := func():
		var cur := str(Settings.get_value("camera", "preset"))
		for id in buttons:
			buttons[id].button_pressed = id == cur
		var sl := Settings.get_camera_sliders(cur)
		zoom.set_value_no_signal(sl.zoom)
		height.set_value_no_signal(sl.height)
	for c in DataDB.camera_presets:
		var b := UIKit.button(str(c.name).to_upper(), Vector2(290, 66))
		b.toggle_mode = true
		b.pressed.connect(func():
			Settings.set_value("camera", "preset", c.id)
			sync.call())
		grid.add_child(b)
		buttons[c.id] = b
	for pair in [["ZOOM", zoom], ["HEIGHT", height]]:
		var h := HBoxContainer.new()
		var l := UIKit.label(pair[0], 24, 800, UIKit.TEXT_DIM)
		l.custom_minimum_size.x = 130
		h.add_child(l)
		var s: HSlider = pair[1]
		s.min_value = 0
		s.max_value = 10
		s.step = 1
		s.custom_minimum_size = Vector2(440, 56)
		s.value_changed.connect(func(_x):
			Settings.set_camera_sliders(str(Settings.get_value("camera", "preset")), zoom.value, height.value))
		h.add_child(s)
		v.add_child(h)
	p.visibility_changed.connect(sync)
	sync.call()
	return p


func toggle_pause() -> void:
	if SceneManager.has_overlay():
		return
	var on := not pause_menu.visible
	pause_menu.visible = on
	get_tree().paused = on
	touch.visible = not on and InputRouter.touch_controls_visible()
	if on:
		touch.release_all()
		for pc in (pause_menu.get_meta("panels") as Dictionary).values():
			(pc as Control).visible = false
		(pause_menu.get_meta("labels") as Callable).call()
		(pause_menu.get_meta("first") as Button).grab_focus()


## Final buzzer: record the result and show the final screen.
func _on_game_over(winner: int) -> void:
	if SaveSystem.active_slot >= 0:
		var stats: Dictionary = SaveSystem.data.get("stats", {})
		stats["games_played"] = int(stats.get("games_played", 0)) + 1
		if winner == sim.user_team:
			stats["wins"] = int(stats.get("wins", 0)) + 1
		SaveSystem.data["stats"] = stats
		SaveSystem.save_active()
	_excitement = 1.0 if winner == sim.user_team else 0.3
	touch.visible = false
	var layer := CanvasLayer.new()
	layer.layer = 60
	layer.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(layer)
	var params := SceneManager.params.duplicate()
	layer.add_child(GamePanels.final_screen(sim, winner,
		func(): SceneManager.goto("arena", params, false), _quit))


func _quit() -> void:
	get_tree().paused = false
	if SaveSystem.active_slot >= 0:
		SaveSystem.save_active()
	SceneManager.goto("main_menu", {}, false)
