class_name DemoScrimmage
extends Node3D
## Stand-in for the real game simulation (Phase 4): ten animated players run a
## simple motion offense with dribble moves, passes, jump shots, layups,
## floaters, dunks, rebounds, blocks, steals and bumps, so the cameras,
## replays, animations and HUD have live action to show. Every action plays
## its animation and the ball leaves the hands on the clip's release event.
## The user controls the home team's ball handler (or the on-ball defender).

signal shot_made(team: int, points: int, shooter: CourtPlayer)
signal shot_missed(team: int)
signal handler_changed(player: CourtPlayer)
signal possession_changed(team: int)
signal announce(text: String)

const FT := CourtSpec.FT
## Seconds without stick/button input before the AI plays for the user.
const AUTO_PLAY_AFTER := 3.0
## Offensive spots: [feet from the attacked baseline, lateral feet].
const SPOTS := [Vector2(31, 0), Vector2(23, 18), Vector2(23, -18), Vector2(4, 22), Vector2(9, -7)]

var state: GameState
var players: Array[CourtPlayer] = []
var ball: Node3D
var holder: CourtPlayer
var user: CourtPlayer
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
var _idle := 0.0
var _pending := {}                  # action waiting for its release event
var _next_move := 3.0
var _bump_cooldown := {}
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
		# Shortest to tallest fills the PG..C spots, so two centers never share a slot.
		starters = starters.slice(0, 5)
		starters.sort_custom(func(a, b): return a.get("height_in", 78) < b.get("height_in", 78))
		for i in 5:
			var pdata: Dictionary = starters[i]
			var pl := CourtPlayer.new()
			pl.name = "%s_%d" % [team.abbr, i]
			add_child(pl)
			pl.setup(pdata, team, t == 0)
			pl.team_idx = t
			pl.slot = i
			pl.anim.action_event.connect(_on_action_event.bind(pl))
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


func team_players(t: int) -> Array[CourtPlayer]:
	var out: Array[CourtPlayer] = []
	for p in players:
		if p.team_idx == t:
			out.append(p)
	return out


func attack_side(team: int) -> int:
	var s := home_side if team == GameState.HOME else -home_side
	return s if state.period <= 2 else -s


func stat_line(p: CourtPlayer) -> String:
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
	_pending = {}
	_give_ball(offense[0])
	possession_changed.emit(team)
	_update_user()
	state.running = true


func _give_ball(p: CourtPlayer) -> void:
	holder = p
	_flight = {}
	for q in players:
		q.anim.reach_for(Vector3.INF)
	handler_changed.emit(p)
	_update_user()


func _update_user() -> void:
	var new_user: CourtPlayer = null
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
	var best: CourtPlayer = null
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

func _shot_clip(shooter: CourtPlayer, dist: float) -> String:
	var r: Dictionary = shooter.data.get("ratings", {})
	if dist < 8.0 and (float(r.get("dunk", 60)) > 72 or shooter.height_ft() > 6.7) and _rng.randf() < 0.7:
		return "dunk"
	if dist < 11.0:
		return "layup"
	if dist < 15.0 and _rng.randf() < 0.4:
		return "floater"
	return "jumpshot"


func try_shoot() -> void:
	if holder == null or not _flight.is_empty() or not _pending.is_empty() or _dead_ball > 0.0 or holder.busy():
		return
	var shooter := holder
	var side := attack_side(shooter.team_idx)
	var p2 := Vector2(shooter.pos_ft().x, shooter.pos_ft().z)
	var dist := CourtSpec.shot_distance_ft(p2, side)
	var three := CourtSpec.is_three_pointer(p2, side)
	var clip := _shot_clip(shooter, dist)
	var ratings: Dictionary = shooter.data.get("ratings", {})
	var pct := 0.0
	match clip:
		"dunk":
			pct = 0.85 + float(ratings.get("dunk", 70)) / 1000.0
		"layup":
			pct = 0.45 + float(ratings.get("layup", 70)) / 400.0
		"floater":
			pct = 0.25 + float(ratings.get("close_shot", 70)) / 400.0
		_:
			pct = (0.18 + float(ratings.get("three_point", 70)) / 400.0) if three \
				else (0.25 + float(ratings.get("mid_range", 70)) / 400.0)
	pct -= maxf(0.0, dist - 26.0) * 0.03
	var defender := _nearest_defender(shooter)
	var contest := defender.pos_ft().distance_to(shooter.pos_ft()) if defender else 99.0
	pct -= clampf((6.0 - contest) * 0.04, 0.0, 0.2)
	var basket := Vector3(side * CourtSpec.basket_x(), 0, 0)
	shooter.face_target = basket
	shooter.look_at_now(basket)
	shooter.play(clip)
	var release := AnimLibrary.event_time(clip, "release", 0.5)
	if clip in ["dunk", "layup"]:
		# Carry the shooter in to the rim for the finish.
		var to := basket - shooter.pos_ft()
		to.y = 0.0
		var travel := maxf(0.0, to.length() - (2.0 if clip == "dunk" else 3.0))
		shooter.push = to.normalized() * travel / maxf(0.2, release * 0.8)
	_pending = {"kind": "shot", "player": shooter, "clip": clip, "made": _rng.randf() < pct,
		"three": three, "side": side, "dist": dist, "blocked": false}
	state.running = true
	# Closest defender contests (or tries to block) when he is near.
	if defender and contest < 8.0 and not defender.busy() and not defender.user_controlled:
		var block_try := contest < 4.5 and _rng.randf() < 0.35
		defender.play("block" if block_try else "contest")
		if block_try and clip != "dunk" and _rng.randf() < 0.3:
			_pending.blocked = true


func try_pass(direction := Vector3.ZERO) -> void:
	if holder == null or not _flight.is_empty() or not _pending.is_empty() or _dead_ball > 0.0 or holder.busy():
		return
	var mates := team_players(holder.team_idx).filter(func(p): return p != holder)
	var target: CourtPlayer = mates[_rng.randi() % mates.size()]
	if direction.length() > 0.2:
		var best := -INF
		for m in mates:
			var to: Vector3 = (m.pos_ft() - holder.pos_ft()).normalized()
			var score := to.dot(direction.normalized())
			if score > best:
				best = score
				target = m
	holder.look_at_now(target.pos_ft())
	var clip := "bounce_pass" if _rng.randf() < 0.3 else "chest_pass"
	holder.play(clip)
	_pending = {"kind": "pass", "player": holder, "clip": clip, "target": target}


func try_steal(defender: CourtPlayer = null) -> void:
	if defender == null:
		defender = user
	if holder == null or defender == null or holder.team_idx == defender.team_idx or defender.busy():
		return
	defender.look_at_now(holder.pos_ft())
	defender.play("steal")
	var success := defender.pos_ft().distance_to(holder.pos_ft()) < 5.0 and _rng.randf() < 0.3
	_pending = {"kind": "steal", "player": defender, "clip": "steal", "success": success} if _pending.is_empty() else _pending


func try_block() -> void:
	if user == null or user.busy() or _pending.get("kind", "") != "shot":
		return
	var shooter: CourtPlayer = _pending.player
	if shooter.team_idx == user.team_idx:
		return
	user.look_at_now(shooter.pos_ft())
	user.play("block")
	if user.pos_ft().distance_to(shooter.pos_ft()) < 6.0 and _pending.clip != "dunk" and _rng.randf() < 0.35:
		_pending.blocked = true


## Dribble moves. dir: "left"/"right" are screen directions, "up"/"down".
func try_move(dir: String) -> void:
	if holder == null or holder.busy() or not _pending.is_empty() or not _flight.is_empty():
		return
	var hand := holder.anim.dribble_hand
	var other := "l" if hand == "r" else "r"
	var clip := ""
	match dir:
		"left", "right":
			# Screen direction -> the player's own left/right.
			var right_on_screen := camera.global_basis.x if camera else Vector3.RIGHT
			var toward_right := (dir == "right") == (holder.global_basis.x.dot(right_on_screen) > 0.0)
			var toward_off_hand := toward_right == (hand == "l")
			if toward_off_hand:
				clip = ("spin_" + hand) if holder.sprinting else "crossover_%s%s" % [hand, other]
			else:
				clip = "behind_back_%s%s" % [hand, other]
		"down":
			clip = "stepback" if holder.velocity.length() < 8.0 else "between_legs_%s%s" % [hand, other]
		"up":
			clip = "hesitation"
	if clip == "" or not holder.play(clip):
		return
	var fwd := -holder.global_basis.z
	match clip:
		"stepback":
			holder.push = -fwd * 13.0
		"spin_r", "spin_l":
			holder.push = fwd * 9.0
		_:
			if clip.begins_with("crossover"):
				holder.push = holder.global_basis.x * (6.0 if clip.ends_with("r") else -6.0)


func _on_action_event(clip: String, ev: String, p: CourtPlayer) -> void:
	if _pending.is_empty() or _pending.player != p or _pending.clip != clip:
		return
	match ev:
		"release":
			if _pending.kind == "shot":
				_release_shot()
			elif _pending.kind == "pass":
				_release_pass()
		"reach":
			if _pending.kind == "steal":
				var d: CourtPlayer = _pending.player
				var ok: bool = _pending.success and holder != null and holder.team_idx != d.team_idx and not holder.busy()
				_pending = {}
				if ok:
					announce.emit("STEAL!")
					state.change_possession(d.team_idx)
					_give_ball(d)
					possession_changed.emit(d.team_idx)


func _release_shot() -> void:
	var f := _pending
	_pending = {}
	var shooter: CourtPlayer = f.player
	var side := int(f.side)
	var from := ball.global_position
	var rim := CourtSpec.basket_position(side)
	holder = null
	if f.blocked:
		announce.emit("BLOCKED!")
		_start_rebound(from, side)
		return
	var to := rim
	if not f.made:
		to = rim + Vector3(_rng.randf_range(-0.6, 0.6), 0.1, _rng.randf_range(-0.7, 0.7)) * FT
	var dist: float = f.dist
	var apex := maxf(from.y, rim.y) + (2.0 + dist * 0.32) * FT
	var dur := 0.8 + dist * 0.018
	if f.clip == "dunk":
		apex = maxf(from.y, rim.y) + 0.05
		dur = 0.12
	elif f.clip == "layup":
		dur = 0.45
		apex = maxf(from.y, rim.y) + 0.35
	_flight = {"kind": "shot", "from": from, "to": to, "apex": apex, "t": 0.0, "dur": dur,
		"made": f.made, "three": f.three, "shooter": shooter, "side": side}


func _release_pass() -> void:
	var f := _pending
	_pending = {}
	var target: CourtPlayer = f.target
	var from := ball.global_position
	var lead := target.velocity * 0.35 * FT
	var to := target.global_position + Vector3(0, 1.15 * target.avatar.scale.x, 0) - target.global_basis.z * 0.35 + lead
	var dist := from.distance_to(to) / FT
	var dur := clampf(dist / 45.0, 0.28, 0.8)
	var apex := maxf(from.y, to.y) + 0.15
	if f.clip == "bounce_pass":
		apex = maxf(from.y, to.y) + 0.05
	_flight = {"kind": "pass", "from": from, "to": to, "apex": apex, "t": 0.0, "dur": dur, "target": target,
		"bounce": f.clip == "bounce_pass"}
	holder = null
	target.look_at_now((f.player as CourtPlayer).pos_ft())
	target.play("catch")


func _nearest_defender(p: CourtPlayer) -> CourtPlayer:
	var best: CourtPlayer = null
	var best_d := INF
	for d in team_players(1 - p.team_idx):
		var dd := d.pos_ft().distance_to(p.pos_ft())
		if dd < best_d:
			best_d = dd
			best = d
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
		p.defending = p.team_idx != state.possession and _dead_ball <= 0.0
		p.has_ball = p == holder and _pending.is_empty()
		p.step(delta)
	_collisions(delta)
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
	for a in ["shoot", "pass", "sprint", "steal", "block", "switch", "pro_left", "pro_right", "pro_up", "pro_down"]:
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
		for pair in [["pro_left", "left"], ["pro_right", "right"], ["pro_up", "up"], ["pro_down", "down"]]:
			if Input.is_action_just_pressed(pair[0]):
				try_move(pair[1])
	elif holder and holder.team_idx != user.team_idx:
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
			o.sprinting = drive > 0.5
		else:
			o.sprinting = false
		o.target = spot
		o.face_target = basket if o == holder else ball.global_position / FT
		var d := defense[i]
		var guard := o.pos_ft()
		var toward := (basket - guard)
		var gap := 3.5 if o == holder else 6.0
		d.target = guard + toward.normalized() * minf(gap, toward.length() * 0.5)
		d.face_target = guard
		d.sprinting = d.pos_ft().distance_to(d.target) > 8.0
		# Occasional reach on the ball handler.
		if o == holder and not d.user_controlled and not d.busy() and _pending.is_empty() \
				and d.pos_ft().distance_to(guard) < 4.0 and _rng.randf() < 0.002:
			try_steal(d)
	if holder and not holder.user_controlled and _flight.is_empty() and _pending.is_empty() \
			and _dead_ball <= 0.0 and not holder.busy():
		if _poss_time > _shoot_at or state.shot_clock < 3.0:
			try_shoot()
		elif _poss_time > _next_pass:
			_next_pass = _poss_time + _rng.randf_range(1.6, 3.4)
			try_pass()
		elif _poss_time > _next_move:
			_next_move = _poss_time + _rng.randf_range(2.0, 4.5)
			try_move(["left", "right", "up", "down"][_rng.randi() % 4])


## Keeps bodies from overlapping and plays bump reactions on hard contact.
func _collisions(delta: float) -> void:
	for k in _bump_cooldown.keys():
		_bump_cooldown[k] -= delta
		if _bump_cooldown[k] <= 0.0:
			_bump_cooldown.erase(k)
	for i in players.size():
		for j in range(i + 1, players.size()):
			var a := players[i]
			var b := players[j]
			var d := b.pos_ft() - a.pos_ft()
			var dist := d.length()
			if dist > 2.1 or dist < 0.01:
				continue
			var n := d / dist
			var overlap := 2.1 - dist
			a.set_pos_ft(a.pos_ft() - n * overlap * 0.5)
			b.set_pos_ft(b.pos_ft() + n * overlap * 0.5)
			var closing := (a.velocity - b.velocity).dot(n)
			if closing > 11.0 and a.team_idx != b.team_idx and _flight.get("kind", "") != "rebound":
				_bump(a, n)
				_bump(b, -n)


func _bump(p: CourtPlayer, toward_other: Vector3) -> void:
	if _bump_cooldown.has(p) or p.busy() or p == (_pending.get("player") if not _pending.is_empty() else null):
		return
	_bump_cooldown[p] = 3.0
	var local := p.global_basis.inverse() * toward_other
	var clip := "bump_front"
	if absf(local.x) > absf(local.z):
		clip = "bump_r" if local.x > 0.0 else "bump_l"
	p.play(clip)
	p.push = -toward_other * 4.0
	if p == user:
		InputRouter.vibrate(30, 0.4)


func _update_ball(delta: float) -> void:
	if holder:
		ball.global_position = holder.hand_position()
		return
	if _flight.is_empty():
		return
	_flight.t += delta
	var u := clampf(_flight.t / _flight.dur, 0.0, 1.0)
	var from: Vector3 = _flight.from
	var to: Vector3 = _flight.to
	var pos := from.lerp(to, u)
	if _flight.get("bounce", false):
		# Bounce pass: straight to the floor at 60%, then up to the hands.
		var bp := from.lerp(to, 0.6)
		bp.y = CourtSpec.BALL_RADIUS * FT
		pos = from.lerp(bp, u / 0.6) if u < 0.6 else bp.lerp(to, (u - 0.6) / 0.4)
	else:
		# Parabola through the apex.
		var base := lerpf(from.y, to.y, u)
		var peak: float = _flight.apex - maxf(from.y, to.y)
		pos.y = base + 4.0 * peak * u * (1.0 - u)
	ball.global_position = pos
	if _flight.kind == "pass":
		(_flight.target as CourtPlayer).anim.reach_for(pos if u > 0.4 else Vector3.INF)
	if u < 1.0:
		return
	match str(_flight.kind):
		"pass":
			_give_ball(_flight.target)
		"shot":
			_resolve_shot()
		"rebound":
			var r: CourtPlayer = _flight.get("rebounder")
			_flight = {}
			_assign_rebound(r)
		"drop":
			_flight = {}


func _resolve_shot() -> void:
	var f := _flight
	var shooter: CourtPlayer = f.shooter
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
		if pts == 3:
			get_tree().create_timer(0.7, false).timeout.connect(func():
				if not shooter.busy():
					shooter.play("celebrate"))
		var next_team := 1 - shooter.team_idx
		get_tree().create_timer(1.8, false).timeout.connect(func(): _start_possession(next_team))
	else:
		shot_missed.emit(shooter.team_idx)
		_start_rebound(ball.global_position, side)


func _start_rebound(from: Vector3, side: int) -> void:
	var basket := CourtSpec.basket_position(side) / FT
	var ang := _rng.randf_range(-PI * 0.8, PI * 0.8)
	var dist := _rng.randf_range(5.0, 12.0)
	var land := Vector3(basket.x - side * cos(ang) * dist, 0, sin(ang) * dist)
	# Whoever is closest (with a bit of luck) goes up for it; the grab in the
	# rebound animation lines up with the ball's arrival.
	var rebounder: CourtPlayer = null
	var best := INF
	for p in players:
		var d := p.pos_ft().distance_to(land) - _rng.randf_range(0.0, 4.0) \
			- float(p.data.get("ratings", {}).get("def_reb", 60)) / 40.0
		if d < best:
			best = d
			rebounder = p
	var dur := 0.95
	_flight = {"kind": "rebound", "from": from, "to": land * FT + Vector3(0, 2.9, 0),
		"apex": from.y + 2.5 * FT, "t": 0.0, "dur": dur, "rebounder": rebounder}
	holder = null
	_pending = {}
	for p in players:
		p.target = land + Vector3(_rng.randf_range(-4, 4), 0, _rng.randf_range(-4, 4))
		p.sprinting = true
	rebounder.target = land
	var grab := AnimLibrary.event_time("rebound", "grab", 0.55)
	get_tree().create_timer(maxf(0.0, dur - grab), false, true).timeout.connect(func():
		if _flight.get("rebounder") == rebounder and not rebounder.busy():
			rebounder.play("rebound"))


func _assign_rebound(best: CourtPlayer) -> void:
	if best == null:
		best = players[0]
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
	_pending = {}
	get_tree().create_timer(1.5, false).timeout.connect(func(): _start_possession(next_team))


func on_period_ended(period: int) -> void:
	paused = true
	_pending = {}
	var label := "END OF %s" % (["1ST", "2ND", "3RD", "4TH"][clampi(period - 1, 0, 3)] if period <= 4 else "OT")
	announce.emit(label if not state.final else "FINAL")
	if state.final:
		return
	get_tree().create_timer(3.0, false).timeout.connect(func():
		paused = false
		_start_possession(GameState.HOME if period % 2 == 1 else GameState.AWAY, true))
