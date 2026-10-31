class_name DemoScrimmage
extends Node3D
## Stand-in for the real game simulation (Phase 4): ten animated players run a
## simple motion offense with dribble moves, passes, jump shots, layups,
## floaters, dunks, rebounds, blocks, steals and bumps.
##
## Phase 3: the ball is physical (BallPhysics) once it leaves a player's hands:
## shots, passes and loose balls fly, hit rim/backboard/floor, and whoever
## reaches it gets it. Shots are timed with the shot meter (ShotTiming): hold
## Shoot and let go at the top of the jump.
## The user controls the home team's ball handler (or the on-ball defender).

signal shot_made(team: int, points: int, shooter: CourtPlayer)
signal shot_missed(team: int)
signal handler_changed(player: CourtPlayer)
signal possession_changed(team: int)
signal announce(text: String)
signal meter_started(player: CourtPlayer, window: float, ideal: float)
signal meter_graded(player: CourtPlayer, grade: String, good: bool, offset: float)

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

var phys := BallPhysics.new()       # the ball whenever nobody holds it
var _flight := {}                   # scripted flights (the make drop) only
var _shot := {}                     # the shot currently in the air
var _pass := {}                     # the pass currently in the air
var _last_touch := -1               # team that last touched the ball
var _rebounder: CourtPlayer
var _intercept_rolled := {}
var _thrower: CourtPlayer           # who just let go of the ball (can't re-catch it instantly)
var _contact := {}                  # player -> seconds left of drive contact
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
	_shot = {}
	_pass = {}
	phys.active = false
	_give_ball(offense[0])
	possession_changed.emit(team)
	_update_user()
	state.running = true


func _give_ball(p: CourtPlayer) -> void:
	holder = p
	_flight = {}
	phys.active = false
	_pass = {}
	_rebounder = null
	_last_touch = p.team_idx
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


# --- Shooting ---------------------------------------------------------------------------

func _shot_clip(shooter: CourtPlayer, dist: float) -> String:
	var r: Dictionary = shooter.data.get("ratings", {})
	if dist < 8.0 and (float(r.get("dunk", 60)) > 72 or shooter.height_ft() > 6.7) and _rng.randf() < 0.7:
		return "dunk"
	if dist < 11.0:
		return "layup"
	if dist < 15.0 and _rng.randf() < 0.4:
		return "floater"
	return "jumpshot"


func meter_enabled() -> bool:
	return Settings.get_value("gameplay", "meter_style") != "off" and not Settings.get_value("gameplay", "real_player_pct")


## Starts a shot. `user_timed`: the user releases Shoot to time it (meter).
## `force_clip` picks the shot type (pro stick: "finish" = layup/dunk).
func try_shoot(user_timed := false, force_clip := "") -> void:
	if holder == null or phys.active or not _pending.is_empty() or _dead_ball > 0.0:
		return
	# Shots can come straight out of a stepback; any other action blocks them.
	var from_stepback := holder.anim.action == "stepback"
	if holder.busy() and not from_stepback:
		return
	var shooter := holder
	var side := attack_side(shooter.team_idx)
	var p2 := Vector2(shooter.pos_ft().x, shooter.pos_ft().z)
	var dist := CourtSpec.shot_distance_ft(p2, side)
	var three := CourtSpec.is_three_pointer(p2, side)
	var clip := _shot_clip(shooter, dist)
	if force_clip == "finish":
		clip = "dunk" if dist < 8.0 and clip == "dunk" else ("layup" if dist < 14.0 else clip)
	elif force_clip == "jumpshot" and dist > 6.0:
		clip = "jumpshot"
	var ratings: Dictionary = shooter.data.get("ratings", {})
	var defender := _nearest_defender(shooter)
	var d_dist := defender.pos_ft().distance_to(shooter.pos_ft()) if defender else 99.0
	var hand_up := defender != null and defender.anim.action in ["contest", "block"]
	var h_diff := (defender.height_ft() - shooter.height_ft()) * 12.0 if defender else 0.0
	var contest := ShotTiming.contest_level(d_dist, hand_up, h_diff)
	if _contact.has(shooter):
		contest = minf(1.0, contest + 0.35)        # bumped on the drive
	var kind := clip
	var difficulty: float = ShotTiming.DIFFICULTY.get(clip, 1.0)
	if clip == "jumpshot" and shooter.velocity.length() > 6.0:
		difficulty = ShotTiming.DIFFICULTY.jumpshot_moving
	if from_stepback:
		difficulty = ShotTiming.DIFFICULTY.stepback
	var rating_key: String = {"dunk": "dunk", "layup": "layup", "floater": "close_shot"}.get(clip,
		"three_point" if three else "mid_range")
	var rating := float(ratings.get(rating_key, 70))
	var window := ShotTiming.green_window(rating, contest, shooter.fatigue(), difficulty)
	var basket := Vector3(side * CourtSpec.basket_x(), 0, 0)
	shooter.face_target = basket
	shooter.look_at_now(basket)
	shooter.play(clip)
	var ideal := AnimLibrary.event_time(clip, "release", 0.5)
	if clip in ["dunk", "layup"]:
		# Carry the shooter in to the rim for the finish.
		var to := basket - shooter.pos_ft()
		to.y = 0.0
		var travel := maxf(0.0, to.length() - (2.0 if clip == "dunk" else 3.0))
		shooter.push = to.normalized() * travel / maxf(0.2, ideal * 0.8)
	var timed := user_timed and meter_enabled() and clip != "dunk"
	_pending = {"kind": "shot", "player": shooter, "clip": clip, "three": three, "side": side, "dist": dist,
		"contest": contest, "window": window, "ideal": ideal, "user_timed": timed, "blocked": false,
		"base": ShotTiming.base_chance(kind, dist, three, ratings, contest),
		"offset": null if timed else ShotTiming.ai_offset(rating, _rng) * (0.4 if clip == "dunk" else 1.0)}
	state.running = true
	if timed:
		meter_started.emit(shooter, window, ideal)
	# Closest defender contests (or tries to block) when he is near.
	if defender and d_dist < 8.0 and not defender.busy() and not defender.user_controlled:
		var block_try := d_dist < 4.5 and _rng.randf() < 0.35
		defender.look_at_now(shooter.pos_ft())
		defender.play("block" if block_try else "contest")
		if block_try and clip != "dunk" and _rng.randf() < 0.25:
			_pending.blocked = true


## Called every frame while a shot is pending: reads the user's release,
## then lets the ball go at the right moment.
func _update_pending_shot() -> void:
	var f := _pending
	var shooter: CourtPlayer = f.player
	var t := shooter.anim.action_time if shooter.anim.action == f.clip else 99.0
	if f.offset == null:
		var still_held := Input.is_action_pressed("shoot") or InputRouter.pro_shot_held()
		if not still_held or t > f.ideal + 0.32:
			f.offset = t - f.ideal
	if f.offset != null:
		var release_at: float = f.ideal + clampf(f.offset, 0.0, 0.3)
		if t >= release_at:
			_release_shot()


func _release_shot() -> void:
	var f := _pending
	_pending = {}
	var shooter: CourtPlayer = f.player
	var side := int(f.side)
	var rim := BallPhysics.rim_center(side)
	var from := ball.global_position
	var g := ShotTiming.grade(float(f.offset), float(f.window))
	var chance := ShotTiming.make_chance(float(f.base), g) if f.clip != "dunk" else float(f.base)
	var made := _rng.randf() < chance
	if f.user_timed or (shooter == user and Settings.get_value("gameplay", "meter_style") != "off"):
		meter_graded.emit(shooter, ShotTiming.GRADE_TEXT[g], g <= ShotTiming.Grade.GOOD, float(f.offset))
	holder = null
	_thrower = shooter
	_last_touch = shooter.team_idx
	_shot = {"shooter": shooter, "team": shooter.team_idx, "three": f.three, "side": side, "clip": f.clip}
	_intercept_rolled = {}
	if f.blocked:
		announce.emit("BLOCKED!")
		var away := (from - rim)
		away.y = 0.0
		phys.launch(from, away.normalized() * 4.5 + Vector3(_rng.randf_range(-2, 2), 1.5, _rng.randf_range(-2, 2)))
		_shot = {}
		_plan_rebound()
		return
	if f.clip == "dunk":
		var off := Vector3.ZERO if made else (rim - from) * Vector3(1, 0, 1)
		off = off.normalized() * 0.2 if not made else off
		phys.launch(rim + Vector3(0, 0.3, 0) + off, Vector3(0, -4.0, 0) + (rim - from) * Vector3(0.3, 0, 0.3))
		return
	# Aim error: makes land near the center, misses well off it. Timing biases
	# the miss short (early) or long (late).
	var shot_dir := (rim - from) * Vector3(1, 0, 1)
	shot_dir = shot_dir.normalized()
	var err: Vector3
	if made:
		var a := _rng.randf() * TAU
		err = Vector3(cos(a), 0, sin(a)) * _rng.randf_range(0.0, 0.04)
	else:
		var along := signf(float(f.offset)) if absf(float(f.offset)) > float(f.window) * 2.2 else (1.0 if _rng.randf() < 0.5 else -1.0)
		var side_dir := shot_dir.cross(Vector3.UP)
		err = shot_dir * along * _rng.randf_range(0.14, 0.26) + side_dir * _rng.randf_range(-0.16, 0.16)
	var target := rim + err
	var apex := BallPhysics.shot_apex(from, side)
	match f.clip:
		"layup":
			apex = maxf(from.y, rim.y) + 0.45
		"floater":
			apex = maxf(from.y, rim.y) + 1.3
	phys.launch(from, BallPhysics.solve_launch(from, target, apex))
	if not made:
		_plan_rebound(BallPhysics.flight_time(from, target, apex))


# --- Passing, steals, blocks, moves ------------------------------------------------------

func try_pass(direction := Vector3.ZERO) -> void:
	if holder == null or phys.active or not _pending.is_empty() or _dead_ball > 0.0 or holder.busy():
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


func _release_pass() -> void:
	var f := _pending
	_pending = {}
	var target: CourtPlayer = f.target
	var passer: CourtPlayer = f.player
	var from := ball.global_position
	var lead := target.velocity * 0.4 * FT
	var to := target.global_position + Vector3(0, 1.15 * target.avatar.scale.x, 0) - target.global_basis.z * 0.3 + lead
	var dist := Vector2(from.x, from.z).distance_to(Vector2(to.x, to.z))
	var acc := float(passer.data.get("ratings", {}).get("pass_accuracy", 70))
	var a := _rng.randf() * TAU
	to += Vector3(cos(a), _rng.randf_range(-0.5, 0.5), sin(a)) * (99.0 - acc) / 99.0 * 0.6
	holder = null
	_thrower = passer
	_last_touch = passer.team_idx
	_intercept_rolled = {}
	if f.clip == "bounce_pass":
		var floor_pt := from.lerp(to, 0.62)
		floor_pt.y = BallPhysics.R
		phys.launch(from, BallPhysics.solve_launch(from, floor_pt, from.y + 0.02) * 1.0)
	else:
		phys.launch(from, BallPhysics.solve_launch(from, to, maxf(from.y, to.y) + 0.12 + dist * 0.015))
	_pass = {"target": target, "passer": passer}
	target.look_at_now(passer.pos_ft())
	target.play("catch")


func try_steal(defender: CourtPlayer = null) -> void:
	if defender == null:
		defender = user
	if holder == null or defender == null or holder.team_idx == defender.team_idx or defender.busy():
		return
	defender.look_at_now(holder.pos_ft())
	defender.play("steal")
	var hands := float(defender.data.get("ratings", {}).get("steal", 60))
	var handle := float(holder.data.get("ratings", {}).get("ball_handle", 70))
	var success := defender.pos_ft().distance_to(holder.pos_ft()) < 5.0 and _rng.randf() < 0.15 + (hands - handle) / 200.0 + 0.1
	if _pending.is_empty():
		_pending = {"kind": "steal", "player": defender, "clip": "steal", "success": success}


func try_block() -> void:
	if user == null or user.busy():
		return
	var shooter: CourtPlayer = _pending.get("player") if _pending.get("kind", "") == "shot" else null
	if shooter:
		user.look_at_now(shooter.pos_ft())
	user.play("block")
	if shooter and shooter.team_idx != user.team_idx and user.pos_ft().distance_to(shooter.pos_ft()) < 6.0 \
			and _pending.clip != "dunk" and _rng.randf() < 0.3 + float(user.data.get("ratings", {}).get("block", 60)) / 500.0:
		_pending.blocked = true


## Dribble moves. dir: "left"/"right" are screen directions, "up"/"down".
func try_move(dir: String) -> void:
	if holder == null or holder.busy() or not _pending.is_empty() or phys.active:
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
			if not holder.user_controlled:
				_shoot_at = _poss_time     # AI stepbacks lead straight into a jumper
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
			if _pending.kind == "pass":
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


func _nearest_defender(p: CourtPlayer) -> CourtPlayer:
	var best: CourtPlayer = null
	var best_d := INF
	for d in team_players(1 - p.team_idx):
		var dd := d.pos_ft().distance_to(p.pos_ft())
		if dd < best_d:
			best_d = dd
			best = d
	return best


# --- Rebounds and loose balls --------------------------------------------------------------

## Sends everyone after a missed shot or loose ball, and times the best-placed
## player's rebound jump to the ball's predicted arrival.
func _plan_rebound(min_time := 0.25) -> void:
	var c := phys.predict_catch(2.75, min_time, 4.0)
	if c.is_empty():
		return
	var t: float = c[0]
	var spot: Vector3 = c[1] / FT
	spot.y = 0.0
	_rebounder = null
	var best := INF
	for p in players:
		var reb := float(p.data.get("ratings", {}).get("def_reb" if p.team_idx != state.possession else "off_reb", 60))
		var d := p.pos_ft().distance_to(spot) - reb / 25.0 - _rng.randf_range(0.0, 3.0)
		if d < best:
			best = d
			_rebounder = p
	for p in players:
		p.target = spot + Vector3(_rng.randf_range(-5, 5), 0, _rng.randf_range(-5, 5))
		p.sprinting = true
	_rebounder.target = spot
	var grab := AnimLibrary.event_time("rebound", "grab", 0.55)
	var r := _rebounder
	get_tree().create_timer(maxf(0.0, t - grab), false, true).timeout.connect(func():
		if _rebounder == r and phys.active and not r.busy():
			r.play("rebound"))


## Whoever can reach the loose ball takes it.
func _check_pickups() -> void:
	var ball_pos := phys.pos
	var shot_live := not _shot.is_empty() and not phys.touched_rim and not phys.touched_board and phys.bounces == 0
	for p in players:
		if p == _thrower and phys.time < 0.4:
			continue
		var reach_h := p.avatar.height_m * 1.33 + (0.55 if p.anim.action in ["rebound", "block"] else 0.0)
		var hand_pt := p.global_position + Vector3(0, minf(ball_pos.y, reach_h), 0)
		var horiz := Vector2(ball_pos.x - hand_pt.x, ball_pos.z - hand_pt.z).length()
		if ball_pos.y > reach_h + 0.1 or horiz > 0.75:
			continue
		if shot_live and phys.vel.y > -1.0:
			continue        # no touching a shot on its way up (goaltending comes in Phase 4)
		if shot_live and ball_pos.y > BallPhysics.RIM_Y - 0.3:
			continue
		if not _pass.is_empty():
			var target: CourtPlayer = _pass.target
			if p != target:
				if p.team_idx == target.team_idx or _intercept_rolled.has(p):
					continue
				# Only a defender in the lane, away from the passer's hands, gets a chance.
				var passer: CourtPlayer = _pass.passer
				if horiz > 0.35 or phys.pos.distance_to(passer.global_position + Vector3(0, 1.2, 0)) < 1.8:
					continue
				_intercept_rolled[p] = true
				if _rng.randf() > 0.03 + float(p.data.get("ratings", {}).get("steal", 60)) / 1500.0:
					continue
				announce.emit("INTERCEPTED!")
		_take_loose_ball(p)
		return


func _take_loose_ball(p: CourtPlayer) -> void:
	var was_shot := not _shot.is_empty() and (phys.touched_rim or phys.touched_board)
	var offense := state.possession
	_shot = {}
	_give_ball(p)
	if p.team_idx == offense:
		if was_shot:
			state.reset_shot_clock(true)
			_poss_time = 0.0
			_shoot_at = _rng.randf_range(3.0, 9.0)
	else:
		state.change_possession(p.team_idx)
		_poss_time = 0.0
		_next_pass = 1.5
		_shoot_at = _rng.randf_range(8.0, 15.0)
		possession_changed.emit(p.team_idx)


func _on_score(side: int) -> void:
	var team := GameState.HOME if attack_side(GameState.HOME) == side else GameState.AWAY
	var pts := 3 if (not _shot.is_empty() and _shot.side == side and _shot.three) else 2
	var shooter: CourtPlayer = _shot.get("shooter") if not _shot.is_empty() else null
	if shooter == null:
		shooter = team_players(team)[0]
	state.add_points(team, pts)
	stats[shooter.data.id].pts += pts
	shot_made.emit(team, pts, shooter)
	if not phys.touched_rim and not phys.touched_board and _shot.get("clip", "") == "jumpshot":
		announce.emit("SWISH")
	_shot = {}
	_rebounder = null
	state.running = false
	_dead_ball = 1.8
	if pts == 3:
		get_tree().create_timer(0.7, false).timeout.connect(func():
			if not shooter.busy():
				shooter.play("celebrate"))
	var next_team := 1 - team
	get_tree().create_timer(1.9, false).timeout.connect(func(): _start_possession(next_team))


func _out_of_bounds() -> void:
	announce.emit("OUT OF BOUNDS")
	phys.active = false
	_shot = {}
	_pass = {}
	_dead_ball = 1.4
	var next_team := 1 - _last_touch if _last_touch >= 0 else 1 - state.possession
	state.running = false
	get_tree().create_timer(1.4, false).timeout.connect(func(): _start_possession(next_team))


# --- Simulation ---------------------------------------------------------------------

func _physics_process(delta: float) -> void:
	if paused:
		return
	state.tick(delta)
	if _dead_ball > 0.0:
		_dead_ball -= delta
	_poss_time += delta
	for k in _contact.keys():
		_contact[k] -= delta
		if _contact[k] <= 0.0:
			_contact.erase(k)
	_ai()
	_user_input()
	if _pending.get("kind", "") == "shot":
		_update_pending_shot()
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
	var any_input := dir != Vector3.ZERO or InputRouter.pro_shot_held()
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
			try_shoot(true)
		elif InputRouter.pro_shot_started():
			try_shoot(true, "jumpshot")
		elif Input.is_action_just_pressed("pass"):
			try_pass(dir)
		else:
			var flick := InputRouter.pro_flick()
			if flick == "up" and _toward_basket(user, dir):
				try_shoot(false, "finish")
			elif flick != "":
				try_move(flick)
	elif holder and holder.team_idx != user.team_idx:
		if Input.is_action_just_pressed("steal"):
			try_steal()
		if Input.is_action_just_pressed("switch"):
			switch_defender()
	if Input.is_action_just_pressed("block"):
		try_block()


## True when the player is heading at the basket (pro stick "up" = finish).
func _toward_basket(p: CourtPlayer, dir: Vector3) -> bool:
	var basket := Vector3(attack_side(p.team_idx) * CourtSpec.basket_x(), 0, 0)
	var to := basket - p.pos_ft()
	if to.length() > 16.0:
		return false
	var moving := p.velocity.length() > 5.0 and p.velocity.normalized().dot(to.normalized()) > 0.5
	return moving or (dir.length() > 0.3 and dir.normalized().dot(to.normalized()) > 0.5)


func _ai() -> void:
	if not _shot.is_empty() or (phys.active and _pass.is_empty()):
		return        # everyone is chasing the ball (see _plan_rebound)
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
			o.sprinting = drive > 0.5 and o.stamina > 0.3
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
	if holder and not holder.user_controlled and not phys.active and _pending.is_empty() \
			and _dead_ball <= 0.0 and not holder.busy():
		if _poss_time > _shoot_at or state.shot_clock < 3.0:
			try_shoot()
		elif _poss_time > _next_pass:
			_next_pass = _poss_time + _rng.randf_range(1.6, 3.4)
			try_pass()
		elif _poss_time > _next_move:
			_next_move = _poss_time + _rng.randf_range(2.0, 4.5)
			try_move(["left", "right", "up", "down"][_rng.randi() % 4])


## Keeps bodies from overlapping, plays bump reactions on hard contact, and
## slows a driving ball handler who runs into a defender.
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
			# The bigger, stronger player gives up less ground.
			var wa := _mass(a)
			var wb := _mass(b)
			a.set_pos_ft(a.pos_ft() - n * overlap * wb / (wa + wb))
			b.set_pos_ft(b.pos_ft() + n * overlap * wa / (wa + wb))
			var closing := (a.velocity - b.velocity).dot(n)
			if a.team_idx == b.team_idx:
				continue
			for pair in [[a, b, n], [b, a, -n]]:
				var driver: CourtPlayer = pair[0]
				var wall: CourtPlayer = pair[1]
				if driver == holder and driver.velocity.length() > 9.0 and driver.velocity.normalized().dot(pair[2]) > 0.6 \
						and not _contact.has(driver):
					_drive_contact(driver, wall)
			if closing > 11.0 and not phys.active:
				_bump(a, n)
				_bump(b, -n)


func _mass(p: CourtPlayer) -> float:
	return float(p.data.get("weight_lb", 220)) * (0.7 + float(p.data.get("ratings", {}).get("strength", 60)) / 200.0)


func _drive_contact(driver: CourtPlayer, defender: CourtPlayer) -> void:
	_contact[driver] = 0.7
	var ratio := _mass(driver) / _mass(defender)
	driver.velocity *= clampf(0.35 * ratio, 0.2, 0.7)
	defender.push = driver.velocity.normalized() * 6.0 * ratio
	if not driver.busy():
		driver.play("bump_front")
	if not defender.busy():
		defender.play("bump_front")
	if driver == user or defender == user:
		InputRouter.vibrate(45, 0.7)


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
	if not _flight.is_empty():
		_flight.t += delta
		var u := clampf(_flight.t / _flight.dur, 0.0, 1.0)
		ball.global_position = (_flight.from as Vector3).lerp(_flight.to, u)
		if u >= 1.0:
			_flight = {}
	if not phys.active:
		return
	var was_descending := phys.vel.y < 0.0
	for ev in phys.step(delta):
		match ev.type:
			"score":
				_on_score(int(ev.side))
			"rim", "board":
				if ev.type == "rim" and phys.touched_rim and _rebounder == null and not _shot.is_empty():
					_plan_rebound(0.05)
	ball.global_position = phys.pos
	# Spin the ball mesh with its travel for a bit of life.
	(ball.get_child(0) as Node3D).rotate_x(-phys.vel.length() * delta * 3.0)
	if not _pass.is_empty():
		var target: CourtPlayer = _pass.target
		target.anim.reach_for(phys.pos if phys.time > 0.12 else Vector3.INF)
	if absf(phys.pos.x) > (CourtSpec.HALF_LENGTH + 1.0) * FT or absf(phys.pos.z) > (CourtSpec.HALF_WIDTH + 1.0) * FT:
		if phys.pos.y < 1.2:
			_out_of_bounds()
			return
	if _dead_ball <= 0.0 and phys.active:
		_check_pickups()
	# A missed shot that nobody planned for (e.g. a long carom) still gets chased.
	if _rebounder == null and _pass.is_empty() and was_descending and phys.pos.y < 2.0 and _shot.is_empty() == false:
		_plan_rebound(0.05)


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
