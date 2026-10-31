class_name DemoScrimmage
extends Node3D
## Phase 1 stand-in for the real game simulation (Phase 4): ten placeholder
## players run a simple motion offense with passes, shots, makes, misses and
## rebounds so the cameras, replays and HUD have live action to show.
## The user controls the home team's ball handler (or the on-ball defender).

signal shot_made(team: int, points: int, shooter: PlaceholderPlayer)
signal shot_missed(team: int)
signal handler_changed(player: PlaceholderPlayer)
signal possession_changed(team: int)
signal announce(text: String)

const FT := CourtSpec.FT
## Seconds without stick/button input before the AI plays for the user.
const AUTO_PLAY_AFTER := 3.0
## Offensive spots: [feet from the attacked baseline, lateral feet].
const SPOTS := [Vector2(31, 0), Vector2(23, 18), Vector2(23, -18), Vector2(4, 22), Vector2(9, -7)]

var state: GameState
var players: Array[PlaceholderPlayer] = []
var ball: Node3D
var holder: PlaceholderPlayer
var user: PlaceholderPlayer
var camera: Camera3D
var paused := false
var stats := {}                     # player id -> {"pts": int}

## Home attacks +X in the first half.
var home_side := 1

var _flight := {}                   # active ball flight
var _poss_time := 0.0
var _next_pass := 2.0
var _shoot_at := 10.0
var _dead_ball := 0.0
var _dribble_t := 0.0
var _idle := 0.0
var _rng := RandomNumberGenerator.new()


func setup(game_state: GameState, home: Dictionary, away: Dictionary) -> void:
	state = game_state
	_rng.randomize()
	var rosters := [DataDB.roster(home.id), DataDB.roster(away.id)]
	for t in 2:
		var team := home if t == 0 else away
		var starters: Array = rosters[t].filter(func(p): return p.get("starter", false))
		if starters.size() < 5:
			starters = rosters[t].slice(0, 5)
		var by_pos := {}
		for p in starters:
			by_pos[p.pos] = p
		var order := ["PG", "SG", "SF", "PF", "C"]
		for i in 5:
			var pdata: Dictionary = by_pos.get(order[i], starters[i])
			var pl := PlaceholderPlayer.new()
			pl.name = "%s_%d" % [team.abbr, i]
			add_child(pl)
			pl.setup(pdata, team, t == 0)
			pl.team_idx = t
			pl.slot = i
			players.append(pl)
			stats[pdata.id] = {"pts": 0}
	ball = Node3D.new()
	ball.name = "Ball"
	var bm := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = CourtSpec.BALL_RADIUS * FT
	sphere.height = CourtSpec.BALL_RADIUS * 2.0 * FT
	bm.mesh = sphere
	bm.material_override = MeshKit.mat(Color(0.85, 0.36, 0.12), 0.75)
	bm.layers = 4
	ball.add_child(bm)
	add_child(ball)
	_tip_off()


func team_players(t: int) -> Array[PlaceholderPlayer]:
	var out: Array[PlaceholderPlayer] = []
	for p in players:
		if p.team_idx == t:
			out.append(p)
	return out


func attack_side(team: int) -> int:
	var s := home_side if team == GameState.HOME else -home_side
	return s if state.period <= 2 else -s


func stat_line(p: PlaceholderPlayer) -> String:
	return "%d PTS" % stats.get(p.data.get("id", ""), {"pts": 0}).pts


# --- Possession flow ---------------------------------------------------------------

func _tip_off() -> void:
	var t := GameState.HOME if _rng.randf() < 0.5 else GameState.AWAY
	_start_possession(t, true)


func _start_possession(team: int, from_center := false) -> void:
	state.change_possession(team)
	_poss_time = 0.0
	_next_pass = _rng.randf_range(1.5, 3.0)
	_shoot_at = _rng.randf_range(7.0, 16.0)
	var side := attack_side(team)
	var offense := team_players(team)
	var defense := team_players(1 - team)
	for i in 5:
		var spot := _spot(i, side)
		var start := spot
		if from_center:
			start = Vector3(-side * (4.0 + i * 3.0), 0, (i - 2) * 6.0)
		else:
			start = Vector3(-side * (2.0 + i * 4.0), 0, (i - 2) * 7.0)
		offense[i].set_pos_ft(start)
		offense[i].velocity = Vector3.ZERO
		defense[i].set_pos_ft(start + Vector3(side * 5.0, 0, 0))
		defense[i].velocity = Vector3.ZERO
	_give_ball(offense[0])
	possession_changed.emit(team)
	_update_user()
	state.running = true


func _give_ball(p: PlaceholderPlayer) -> void:
	holder = p
	_flight = {}
	handler_changed.emit(p)
	_update_user()


func _update_user() -> void:
	var new_user: PlaceholderPlayer = null
	if holder and holder.team_idx == GameState.HOME:
		new_user = holder
	elif holder:
		# On defense the user guards the ball handler.
		new_user = team_players(GameState.HOME)[holder.slot]
	elif user:
		new_user = user
	if new_user != user:
		if user:
			user.set_user(false)
		user = new_user
		if user:
			user.set_user(true)


func switch_defender() -> void:
	if holder == null or holder.team_idx == GameState.HOME:
		return
	var best: PlaceholderPlayer = null
	var best_d := INF
	for p in team_players(GameState.HOME):
		if p == user:
			continue
		var d := p.pos_ft().distance_to(holder.pos_ft())
		if d < best_d:
			best_d = d
			best = p
	if best:
		user.set_user(false)
		user = best
		user.set_user(true)


func _spot(i: int, side: int) -> Vector3:
	var s: Vector2 = SPOTS[i]
	return Vector3(side * (CourtSpec.HALF_LENGTH - s.x), 0, s.y)


# --- Actions ------------------------------------------------------------------------

func try_shoot() -> void:
	if holder == null or not _flight.is_empty() or _dead_ball > 0.0:
		return
	var shooter := holder
	var side := attack_side(shooter.team_idx)
	var p2 := Vector2(shooter.pos_ft().x, shooter.pos_ft().z)
	var dist := CourtSpec.shot_distance_ft(p2, side)
	var three := CourtSpec.is_three_pointer(p2, side)
	var ratings: Dictionary = shooter.data.get("ratings", {})
	var pct := 0.0
	if dist < 6.0:
		pct = 0.45 + float(ratings.get("layup", 70)) / 400.0
	elif three:
		pct = 0.18 + float(ratings.get("three_point", 70)) / 400.0
	else:
		pct = 0.25 + float(ratings.get("mid_range", 70)) / 400.0
	pct -= maxf(0.0, dist - 26.0) * 0.03
	var contest := _nearest_defender_dist(shooter)
	pct -= clampf((6.0 - contest) * 0.04, 0.0, 0.2)
	var made := _rng.randf() < pct
	shooter.jump()
	var from := shooter.hand_position() + Vector3(0, 1.2, 0) * FT
	var rim := CourtSpec.basket_position(side)
	var to := rim
	if not made:
		to = rim + Vector3(_rng.randf_range(-0.6, 0.6), 0.1, _rng.randf_range(-0.7, 0.7)) * FT
	var apex := maxf(from.y, rim.y) + (2.0 + dist * 0.32) * FT
	_flight = {"kind": "shot", "from": from, "to": to, "apex": apex, "t": 0.0,
		"dur": 0.8 + dist * 0.018, "made": made, "three": three, "shooter": shooter, "side": side}
	holder = null
	state.running = true


func try_pass(direction := Vector3.ZERO) -> void:
	if holder == null or not _flight.is_empty() or _dead_ball > 0.0:
		return
	var mates := team_players(holder.team_idx).filter(func(p): return p != holder)
	var target: PlaceholderPlayer = mates[_rng.randi() % mates.size()]
	if direction.length() > 0.2:
		var best := -INF
		for m in mates:
			var to: Vector3 = (m.pos_ft() - holder.pos_ft()).normalized()
			var score := to.dot(direction.normalized())
			if score > best:
				best = score
				target = m
	var from := holder.hand_position()
	var lead := target.velocity * 0.35 * FT
	var to := target.hand_position() + lead
	var dist := from.distance_to(to) / FT
	_flight = {"kind": "pass", "from": from, "to": to, "apex": maxf(from.y, to.y) + 0.6 * FT, "t": 0.0,
		"dur": clampf(dist / 45.0, 0.25, 0.8), "target": target}
	holder = null


func try_steal() -> void:
	if holder == null or holder.team_idx == GameState.HOME or user == null:
		return
	if user.pos_ft().distance_to(holder.pos_ft()) < 5.0 and _rng.randf() < 0.3:
		announce.emit("STEAL!")
		var t := GameState.HOME
		state.change_possession(t)
		_give_ball(user)
		possession_changed.emit(t)


func try_block() -> void:
	if _flight.get("kind", "") != "shot" or user == null:
		return
	var shooter: PlaceholderPlayer = _flight.shooter
	if shooter.team_idx == GameState.HOME or _flight.t > 0.3:
		return
	user.jump()
	if user.pos_ft().distance_to(shooter.pos_ft()) < 6.0 and _rng.randf() < 0.35:
		announce.emit("BLOCKED!")
		_start_rebound(ball.global_position, int(_flight.side))


func _nearest_defender_dist(p: PlaceholderPlayer) -> float:
	var best := INF
	for d in team_players(1 - p.team_idx):
		best = minf(best, d.pos_ft().distance_to(p.pos_ft()))
	return best


# --- Simulation ---------------------------------------------------------------------

func _physics_process(delta: float) -> void:
	if paused:
		return
	state.tick(delta)
	if _dead_ball > 0.0:
		_dead_ball -= delta
	_poss_time += delta
	_ai()
	_user_input()
	for p in players:
		p.step(delta)
	_update_ball(delta)


func _user_input() -> void:
	if user == null:
		return
	var mv := InputRouter.move_vector()
	var dir := Vector3.ZERO
	if camera and mv.length() > 0.0:
		var fwd := -camera.global_basis.z
		fwd.y = 0.0
		fwd = fwd.normalized()
		var right := camera.global_basis.x
		right.y = 0.0
		right = right.normalized()
		dir = right * mv.x + fwd * -mv.y
	var any_input := dir != Vector3.ZERO
	for a in ["shoot", "pass", "sprint", "steal", "block", "switch"]:
		any_input = any_input or Input.is_action_pressed(a)
	_idle = 0.0 if any_input else _idle + get_physics_process_delta_time()
	# Hands off the controls for a few seconds and the AI plays for you.
	user.user_controlled = _idle < AUTO_PLAY_AFTER
	user.manual_input = dir.limit_length(1.0)
	if not user.user_controlled:
		return
	user.sprinting = Input.is_action_pressed("sprint")
	if user == holder:
		if Input.is_action_just_pressed("shoot"):
			try_shoot()
		elif Input.is_action_just_pressed("pass"):
			try_pass(dir)
	elif holder and holder.team_idx == GameState.AWAY:
		if Input.is_action_just_pressed("steal"):
			try_steal()
		if Input.is_action_just_pressed("switch"):
			switch_defender()
	if Input.is_action_just_pressed("block"):
		try_block()


func _ai() -> void:
	if _flight.get("kind", "") == "rebound":
		return
	var team := state.possession
	var side := attack_side(team)
	var offense := team_players(team)
	var defense := team_players(1 - team)
	var basket := Vector3(side * CourtSpec.basket_x(), 0, 0)
	var t := Time.get_ticks_msec() / 1000.0
	for i in 5:
		var o := offense[i]
		var spot := _spot(i, side)
		# Gentle motion around the spot so the offense never stands still.
		spot += Vector3(sin(t * 0.7 + i * 1.7) * 3.0, 0, cos(t * 0.5 + i) * 3.0)
		if o == holder and not o.user_controlled:
			# Handler probes toward the basket late in the possession.
			var drive := clampf((_poss_time - _shoot_at + 4.0) / 4.0, 0.0, 1.0)
			spot = spot.lerp(basket - Vector3(side * 6.0, 0, 0), drive * 0.8)
		o.target = spot
		o.sprinting = false
		o.face_target = basket if o == holder else ball.global_position / FT
		var d := defense[i]
		var guard := o.pos_ft()
		var toward := (basket - guard)
		var gap := 3.5 if o == holder else 6.0
		d.target = guard + toward.normalized() * minf(gap, toward.length() * 0.5)
		d.face_target = guard
		d.sprinting = d.pos_ft().distance_to(d.target) > 8.0
	if holder and not holder.user_controlled and _flight.is_empty() and _dead_ball <= 0.0:
		if _poss_time > _shoot_at or state.shot_clock < 3.0:
			try_shoot()
		elif _poss_time > _next_pass:
			_next_pass = _poss_time + _rng.randf_range(1.6, 3.4)
			try_pass()


func _update_ball(delta: float) -> void:
	if holder:
		_dribble_t += delta * (2.4 + holder.velocity.length() * 0.06)
		var hand := holder.hand_position()
		var r := CourtSpec.BALL_RADIUS * FT
		var bounce := absf(sin(_dribble_t * PI))
		ball.global_position = Vector3(hand.x, lerpf(r, hand.y - 0.1, bounce), hand.z)
		return
	if _flight.is_empty():
		return
	_flight.t += delta
	var u := clampf(_flight.t / _flight.dur, 0.0, 1.0)
	var from: Vector3 = _flight.from
	var to: Vector3 = _flight.to
	var pos := from.lerp(to, u)
	# Parabola through the apex.
	var base := lerpf(from.y, to.y, u)
	var peak: float = _flight.apex - maxf(from.y, to.y)
	pos.y = base + 4.0 * peak * u * (1.0 - u)
	ball.global_position = pos
	if u < 1.0:
		return
	match str(_flight.kind):
		"pass":
			_give_ball(_flight.target)
		"shot":
			_resolve_shot()
		"rebound":
			_flight = {}
			_assign_rebound()
		"drop":
			_flight = {}


func _resolve_shot() -> void:
	var f := _flight
	var shooter: PlaceholderPlayer = f.shooter
	var side := int(f.side)
	if f.made:
		var pts := 3 if f.three else 2
		state.add_points(shooter.team_idx, pts)
		stats[shooter.data.id].pts += pts
		shot_made.emit(shooter.team_idx, pts, shooter)
		var rim := CourtSpec.basket_position(side)
		_flight = {"kind": "drop", "from": rim, "to": rim - Vector3(0, 9.6, 0) * FT, "apex": rim.y, "t": 0.0, "dur": 0.55}
		state.running = false
		_dead_ball = 1.6
		var next_team := 1 - shooter.team_idx
		get_tree().create_timer(1.8, false).timeout.connect(func(): _start_possession(next_team))
	else:
		shot_missed.emit(shooter.team_idx)
		_start_rebound(ball.global_position, side)


func _start_rebound(from: Vector3, side: int) -> void:
	var basket := CourtSpec.basket_position(side) / FT
	var ang := _rng.randf_range(-PI * 0.8, PI * 0.8)
	var dist := _rng.randf_range(5.0, 13.0)
	var land := Vector3(basket.x - side * cos(ang) * dist, 0, sin(ang) * dist)
	_flight = {"kind": "rebound", "from": from, "to": land * FT + Vector3(0, 3.5 * FT, 0),
		"apex": from.y + 2.5 * FT, "t": 0.0, "dur": 0.75, "landing": land}
	holder = null
	# Everyone crashes the glass.
	for p in players:
		p.target = land + Vector3(_rng.randf_range(-3, 3), 0, _rng.randf_range(-3, 3))
		p.sprinting = true


func _assign_rebound() -> void:
	var best: PlaceholderPlayer = null
	var best_d := INF
	for p in players:
		var d := p.global_position.distance_to(ball.global_position) - _rng.randf_range(0.0, 1.5)
		if d < best_d:
			best_d = d
			best = p
	var offense := state.possession
	if best.team_idx == offense:
		state.reset_shot_clock(true)
		_poss_time = 0.0
		_shoot_at = _rng.randf_range(4.0, 10.0)
		_give_ball(best)
	else:
		state.change_possession(best.team_idx)
		_poss_time = 0.0
		_next_pass = 1.5
		_shoot_at = _rng.randf_range(8.0, 15.0)
		_give_ball(best)
		possession_changed.emit(best.team_idx)


func on_shot_clock_violation() -> void:
	announce.emit("SHOT CLOCK VIOLATION")
	var next_team := 1 - state.possession
	_dead_ball = 1.5
	get_tree().create_timer(1.5, false).timeout.connect(func(): _start_possession(next_team))


func on_period_ended(period: int) -> void:
	paused = true
	var label := "END OF %s" % (["1ST", "2ND", "3RD", "4TH"][clampi(period - 1, 0, 3)] if period <= 4 else "OT")
	announce.emit(label if not state.final else "FINAL")
	if state.final:
		return
	get_tree().create_timer(3.0, false).timeout.connect(func():
		paused = false
		_start_possession(GameState.HOME if period % 2 == 1 else GameState.AWAY, true))
