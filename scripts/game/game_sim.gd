class_name GameSim
extends Node3D
## A full game: tip-off, inbounds, live play, shots, fouls and free throws,
## violations, timeouts, substitutions and stats, with both teams run by
## TeamAI except the player the user controls (home team).
##
##  * rules      – Referee (3/8 seconds, backcourt, goaltending, fouls, FT counts)
##  * lineups    – Rotation per team (stamina, foul trouble, subs at dead balls)
##  * stats      – BoxScore (box score, play-by-play, player of the game)
##  * AI         – TeamAI per team (plays on offense, schemes on defense)
##  * difficulty – Difficulty (CPU quality and the user's meter window)
## The ball is physical (BallPhysics) whenever nobody holds it.

signal shot_made(team: int, points: int, shooter: CourtPlayer)
signal shot_missed(team: int)
signal handler_changed(player: CourtPlayer)
signal possession_changed(team: int)
signal announce(text: String)
signal play_logged(text: String)
signal meter_started(player: CourtPlayer, window: float, ideal: float)
signal meter_graded(player: CourtPlayer, grade: String, good: bool, offset: float)
signal game_over(winner: int)
signal timeout_called(team: int)

const FT := CourtSpec.FT
const HOME := GameState.HOME
const AWAY := GameState.AWAY
## Seconds without stick/button input before the AI plays for the user.
const AUTO_PLAY_AFTER := 3.0

enum Phase { TIPOFF, INBOUND, LIVE, FREE_THROWS, DEAD }

var state: GameState
var teams: Array = [{}, {}]
var rot: Array[Rotation] = [Rotation.new(), Rotation.new()]
var ai: Array[TeamAI] = []
var box := BoxScore.new()
var ref := Referee.new()
var players: Array[CourtPlayer] = []
var ball: Node3D
var holder: CourtPlayer
var user: CourtPlayer
var camera: Camera3D
var paused := false
var phase := Phase.DEAD
var phys := BallPhysics.new()
var user_team := HOME
var auto_subs_user := true

## Home attacks +X in the first half.
var home_side := 1

var _pending := {}                  # action waiting for its release event
var _shot := {}                     # the shot currently in the air
var _pass := {}                     # the pass currently in the air
var _last_touch := -1
var _thrower: CourtPlayer
var _rebounder: CourtPlayer
var _intercept_rolled := {}
var _contact := {}                  # player -> seconds left of drive contact
var _bump_cooldown := {}
var _idle := 0.0
var _rng := RandomNumberGenerator.new()
var _dead_t := 0.0
var _after_dead: Callable
var _clock_in_dead := false
var _inbound := {}
var _ft := {}
var _tip := {}
var _tip_winner := -1
var _last_catch := {}               # {player, passer, time} for assists
var _game_time := 0.0
var _run := [0, 0]                  # consecutive points per team
var _pending_period_end := -1
var _subs_due := false
var _sub_queue: Array = []          # user subs waiting for a dead ball: [team, out, in]


# --- Setup ------------------------------------------------------------------------------

func setup(game_state: GameState, home: Dictionary, away: Dictionary) -> void:
	state = game_state
	_rng.randomize()
	teams = [home, away]
	var drain := clampf(12.0 / maxf(1.0, state.period_length / 60.0), 1.0, 2.2)
	for t in 2:
		rot[t].setup(DataDB.roster(teams[t].id))
		for p in rot[t].roster:
			box.add_player(p, t, p.id in rot[t].on_court)
		for slot in 5:
			var pdata: Dictionary = rot[t].player(rot[t].on_court[slot])
			var pl := CourtPlayer.new()
			pl.name = "%s_%d" % [teams[t].abbr, slot]
			add_child(pl)
			pl.setup(pdata, teams[t], t == HOME)
			pl.team_idx = t
			pl.slot = slot
			pl.drain_scale = drain
			pl.anim.action_event.connect(_on_action_event.bind(pl))
			players.append(pl)
		var a := TeamAI.new(self, t)
		ai.append(a)
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
	state.period_ended.connect(_on_period_ended)
	state.shot_clock_expired.connect(func(_t): _violation("SHOT CLOCK VIOLATION"))
	_setup_tipoff()


func lineup(t: int) -> Array[CourtPlayer]:
	var out: Array[CourtPlayer] = []
	for p in players:
		if p.team_idx == t:
			out.append(p)
	out.sort_custom(func(a, b): return a.slot < b.slot)
	return out


func team_players(t: int) -> Array[CourtPlayer]:
	return lineup(t)


func attack_side(team: int) -> int:
	var s := home_side if team == HOME else -home_side
	return s if state.period <= 2 else -s


func basket_ft(team: int) -> Vector3:
	return Vector3(attack_side(team) * CourtSpec.basket_x(), 0, 0)


func stat_line(p: CourtPlayer) -> String:
	var l := box.line(p.pid())
	if l.is_empty():
		return ""
	var s := "%d PTS" % l.pts
	if BoxScore.reb(l) >= 3:
		s += "  %d REB" % BoxScore.reb(l)
	if l.ast >= 3:
		s += "  %d AST" % l.ast
	return s


func team_name(t: int) -> String:
	return str(teams[t].get("name", "?"))


func clock_text() -> String:
	return GameState.format_clock(state.game_clock)


func _log(team: int, text: String) -> void:
	box.log_play(state.period, clock_text(), team, text, [state.scores[HOME], state.scores[AWAY]])
	play_logged.emit(text)


func _on_court_ids() -> Array:
	var out := []
	for p in players:
		out.append(p.pid())
	return out


func meter_enabled() -> bool:
	return Settings.get_value("gameplay", "meter_style") != "off" and not Settings.get_value("gameplay", "real_player_pct")


func is_cpu(team: int) -> bool:
	return team != user_team


# --- Phases --------------------------------------------------------------------------------

func _dead(seconds: float, then: Callable, clock_runs := false) -> void:
	phase = Phase.DEAD
	_dead_t = seconds
	_after_dead = then
	_clock_in_dead = clock_runs
	state.running = clock_runs
	_pending = {}
	_subs_due = true


func _set_possession(team: int) -> void:
	if state.possession != team:
		state.possession = team
		ai[team].new_possession()
		ai[1 - team].new_possession()
		possession_changed.emit(team)
	_update_user()


## Jump ball at center court.
func _setup_tipoff() -> void:
	phase = Phase.TIPOFF
	state.running = false
	holder = null
	var centers := [lineup(HOME)[4], lineup(AWAY)[4]]
	for t in 2:
		var lu := lineup(t)
		var s := -attack_side(t)          # each team starts on its own (defensive) half
		for i in 5:
			var p := lu[i]
			if i == 4:
				p.set_pos_ft(Vector3(s * 1.6, 0, 0))
			else:
				var a := (i - 1.5) * 0.9
				p.set_pos_ft(Vector3(s * (8.0 + absf(a) * 2.0), 0, (i - 1.5) * 7.0))
			p.velocity = Vector3.ZERO
			p.target = p.pos_ft()
			p.face_target = Vector3.ZERO
	phys.launch(Vector3(0, 2.3, 0), Vector3(0, 5.4, 0))
	_tip = {"t": 0.0, "jumped": false, "centers": centers}


func _update_tipoff(delta: float) -> void:
	_tip.t += delta
	var centers: Array = _tip.centers
	if not _tip.jumped and _tip.t > 0.05:
		_tip.jumped = true
		for c in centers:
			c.play("rebound")
	if _tip.t >= 0.55 and not _tip.has("won"):
		var score := [0.0, 0.0]
		for i in 2:
			var c: CourtPlayer = centers[i]
			score[i] = c.rating("vertical") + c.height_ft() * 6.0 + _rng.randf_range(0.0, 25.0)
		var w := 0 if score[0] >= score[1] else 1
		_tip.won = w
		_tip_winner = w
		var pg: CourtPlayer = lineup(w)[0]
		var to := pg.global_position + Vector3(0, 1.3 * pg.avatar.scale.x, 0)
		phys.launch(phys.pos, BallPhysics.solve_launch(phys.pos, to, phys.pos.y + 0.3))
		_pass = {"target": pg, "passer": centers[w]}
		_thrower = centers[w]
		_last_touch = w
		_set_possession(w)
		ref.new_possession(true)
		_log(w, "%s wins the tip" % centers[w].short_name())
		phase = Phase.LIVE
		state.running = true


## Puts `team` in possession with an inbound pass from `spot` (feet, out of bounds).
func _setup_inbound(team: int, spot: Vector3, reset_clock := true) -> void:
	phase = Phase.INBOUND
	state.running = false
	_shot = {}
	_pass = {}
	phys.active = false
	_set_possession(team)
	if reset_clock:
		state.reset_shot_clock()
	var side := attack_side(team)
	var frontcourt := Referee.in_frontcourt(spot, side)
	ref.new_possession(not frontcourt)
	var lu := lineup(team)
	var baseline := absf(spot.x) > CourtSpec.HALF_LENGTH
	var inbounder: CourtPlayer = lu[4] if baseline else lu[2]
	var receiver: CourtPlayer = lu[0] if inbounder != lu[0] else lu[1]
	inbounder.set_pos_ft(spot)
	inbounder.velocity = Vector3.ZERO
	inbounder.target = spot
	var into := Vector3(-signf(spot.x) * 10.0, 0, 0) if baseline else Vector3(0, 0, -signf(spot.z) * 10.0)
	inbounder.face_target = spot + into
	var recv_spot := spot + into + Vector3(0, 0, 6.0 if spot.z <= 0.0 else -6.0)
	receiver.set_pos_ft(recv_spot)
	receiver.target = recv_spot
	receiver.velocity = Vector3.ZERO
	# Everyone else heads for their spots; defenders find their men.
	for p in players:
		if p == inbounder or p == receiver:
			continue
		p.velocity = Vector3.ZERO
		var home_spot: Vector3 = ai[p.team_idx].spot_for(p) if p.team_idx == team else \
			ai[p.team_idx].guard_spot(p)
		if not frontcourt and p.team_idx == team:
			home_spot = Vector3(spot.x + (-signf(spot.x) * (12.0 + p.slot * 4.0) if baseline else 0.0), 0, (p.slot - 2) * 9.0)
		p.set_pos_ft(home_spot.lerp(p.pos_ft(), 0.3))
		p.target = home_spot
	_give_ball(inbounder)
	_inbound = {"t": 1.1, "inbounder": inbounder, "receiver": receiver}


func _update_inbound(delta: float) -> void:
	_inbound.t -= delta
	if _inbound.t <= 0.0 and _pending.is_empty() and holder == _inbound.inbounder and not holder.busy():
		try_pass_to(_inbound.receiver)


## Free throws for `shooter`. After the last one the ball is live (miss) or
## the other team inbounds (make).
func _start_free_throws(shooter: CourtPlayer, count: int) -> void:
	phase = Phase.FREE_THROWS
	state.running = false
	_shot = {}
	_pass = {}
	phys.active = false
	_set_possession(shooter.team_idx)
	var side := attack_side(shooter.team_idx)
	var line_x := side * (CourtSpec.HALF_LENGTH - CourtSpec.FREE_THROW_LINE_FROM_BASELINE - 1.0)
	shooter.set_pos_ft(Vector3(line_x, 0, 0))
	shooter.velocity = Vector3.ZERO
	shooter.target = shooter.pos_ft()
	shooter.face_target = basket_ft(shooter.team_idx)
	# Lane spots: defenders closest to the basket, then alternating.
	var lane := [[7.0, -1], [7.0, 1], [11.0, -1], [11.0, 1], [14.0, -1], [14.0, 1]]
	var def_team := 1 - shooter.team_idx
	var order: Array[CourtPlayer] = []
	var defs := lineup(def_team)
	defs.sort_custom(func(a, b): return a.slot > b.slot)
	var offs := lineup(shooter.team_idx).filter(func(p): return p != shooter)
	offs.sort_custom(func(a, b): return a.slot > b.slot)
	order.append_array([defs[0], defs[1], offs[0], offs[1], defs[2]])
	for i in order.size():
		var p := order[i]
		var spot: Vector3
		if i < lane.size():
			spot = Vector3(side * (CourtSpec.HALF_LENGTH - lane[i][0]), 0, lane[i][1] * 8.7)
		p.set_pos_ft(spot)
		p.target = spot
		p.velocity = Vector3.ZERO
		p.face_target = basket_ft(shooter.team_idx)
	for p in players:
		if p != shooter and not p in order:
			var spot := Vector3(side * (CourtSpec.HALF_LENGTH - 30.0), 0, (p.slot - 2) * 8.0)
			p.set_pos_ft(spot)
			p.target = spot
			p.velocity = Vector3.ZERO
			p.face_target = basket_ft(shooter.team_idx)
	_give_ball(shooter)
	_ft = {"shooter": shooter, "total": count, "n": 1, "wait": 1.0, "started": false, "idle": 0.0}
	announce.emit("FREE THROW 1 OF %d" % count if count > 1 else "FREE THROW")


func _update_free_throws(delta: float) -> void:
	if _ft.started:
		return
	_ft.wait -= delta
	var shooter: CourtPlayer = _ft.shooter
	if shooter.team_idx == user_team and meter_enabled():
		_ft.idle += delta
		var pressed := Input.is_action_just_pressed("shoot") or InputRouter.pro_shot_started()
		if pressed and _ft.wait <= 0.0:
			_shoot_free_throw(true)
		elif _ft.idle > 6.0:
			_shoot_free_throw(false)
	elif _ft.wait <= 0.0:
		_shoot_free_throw(false)


func _shoot_free_throw(user_timed: bool) -> void:
	_ft.started = true
	var shooter: CourtPlayer = _ft.shooter
	var ftr := shooter.rating("free_throw")
	var window := ShotTiming.green_window(ftr, 0.0, shooter.fatigue(), 0.85)
	if user_timed:
		window *= Difficulty.value("user_window")
	shooter.play("free_throw")
	var ideal := AnimLibrary.event_time("free_throw", "release", 0.95)
	var base := clampf(0.3 + ftr / 165.0, 0.3, 0.92)
	if is_cpu(shooter.team_idx):
		base *= Difficulty.value("cpu_make")
	_pending = {"kind": "shot", "player": shooter, "clip": "free_throw", "three": false,
		"side": attack_side(shooter.team_idx), "dist": 15.0, "contest": 0.0, "window": window, "ideal": ideal,
		"user_timed": user_timed, "blocked": false, "base": base, "ft": true, "foul": {},
		"offset": null if user_timed else ShotTiming.ai_offset(ftr, _rng)}
	if user_timed:
		meter_started.emit(shooter, window, ideal)


func _ft_result(made: bool) -> void:
	var shooter: CourtPlayer = _ft.shooter
	var t := shooter.team_idx
	box.free_throw(shooter.pid(), made)
	if made:
		state.add_points(t, 1)
		box.plus_minus(t, 1, _on_court_ids())
		_count_run(t, 1)
	_log(t, "%s %s free throw %d of %d" % [shooter.short_name(), "makes" if made else "misses", _ft.n, _ft.total])
	var last: bool = _ft.n >= _ft.total
	if not last:
		_ft.n += 1
		_ft.started = false
		_ft.wait = 0.9
		_ft.idle = 0.0
		_shot = {}
		phys.active = false
		_give_ball(shooter)
		announce.emit("FREE THROW %d OF %d" % [_ft.n, _ft.total])
		return
	_ft = {}
	if made:
		_shot = {}                     # the ball drops through; nothing left to resolve
		var s := attack_side(t)
		_dead(1.0, func(): _setup_inbound(1 - t, Vector3(s * (CourtSpec.HALF_LENGTH + 1.5), 0, -5.0)))
	else:
		# Live rebound off the last miss.
		phase = Phase.LIVE
		state.running = true
		_plan_rebound(0.05)


func _update_dead(delta: float) -> void:
	_dead_t -= delta
	if _subs_due:
		_subs_due = false
		_apply_sub_queue()
		_run_subs()
	if _dead_t <= 0.0 and _after_dead.is_valid():
		var f := _after_dead
		_after_dead = Callable()
		f.call()


# --- Substitutions & timeouts -----------------------------------------------------------

func _run_subs(forced_only := false) -> void:
	var fouls := {}
	for pid in box.lines:
		fouls[pid] = int(box.lines[pid].pf)
	for t in 2:
		for p in lineup(t):
			rot[t].stamina[p.pid()] = p.stamina
		var only_forced := forced_only or (t == user_team and not auto_subs_user)
		for swap in rot[t].suggest(state.period, fouls, only_forced, _game_time):
			substitute(t, swap[0], swap[1])


## The user's subs check in at the next dead ball (or right away if the ball is dead).
func queue_sub(t: int, out_id: String, in_id: String) -> void:
	if out_id == "" or in_id == "":
		return
	_sub_queue.append([t, out_id, in_id])
	announce.emit("SUB AT NEXT DEAD BALL" if phase == Phase.LIVE else "SUBSTITUTION")
	if phase != Phase.LIVE:
		_apply_sub_queue()


func _apply_sub_queue() -> void:
	for q in _sub_queue:
		substitute(q[0], q[1], q[2])
	_sub_queue.clear()


func substitute(t: int, out_id: String, in_id: String) -> void:
	var cp: CourtPlayer = null
	for p in lineup(t):
		if p.pid() == out_id:
			cp = p
	if cp == null or in_id in rot[t].on_court:
		return
	rot[t].stamina[out_id] = cp.stamina
	rot[t].apply_sub(out_id, in_id, _game_time)
	var pdata := rot[t].player(in_id)
	cp.data = pdata
	cp.stamina = float(rot[t].stamina.get(in_id, 1.0))
	cp.avatar.apply(pdata, teams[t], t == HOME)
	if holder == cp:
		handler_changed.emit(cp)
	_log(t, "SUB: %s in for %s" % [pdata.get("last", "?"), rot[t].player(out_id).get("last", "?")])


func can_call_timeout(t: int) -> bool:
	if state.timeouts[t] <= 0 or state.final or phase == Phase.TIPOFF or phase == Phase.FREE_THROWS:
		return false
	if phase == Phase.LIVE and (holder == null or holder.team_idx != t or phys.active):
		return false
	return true


func call_timeout(t: int) -> bool:
	if not can_call_timeout(t):
		return false
	state.use_timeout(t)
	_log(t, "Timeout: %s" % team_name(t))
	announce.emit("TIMEOUT %s" % team_name(t).to_upper())
	timeout_called.emit(t)
	_run = [0, 0]
	var ball_ft := ball.global_position / FT
	var poss := state.possession
	var spot := _sideline_spot(ball_ft)
	var pending: Callable = _after_dead if phase == Phase.DEAD else Callable()
	# Rest: everyone gets some legs back during a timeout.
	for p in players:
		p.stamina = minf(1.0, p.stamina + 0.15)
	if pending.is_valid():
		_dead(2.5, pending)
	else:
		_dead(2.5, func(): _setup_inbound(poss, spot, false))
	return true


func _count_run(team: int, pts: int) -> void:
	_run[team] += pts
	_run[1 - team] = 0


## The CPU stops an opponent run with a timeout.
func _cpu_timeout_check(scoring_team: int) -> void:
	var cpu := 1 - user_team
	if scoring_team == user_team and _run[user_team] >= 8 and state.timeouts[cpu] > 2:
		_dead_t += 0.1
		call_deferred("call_timeout", cpu)


func _sideline_spot(p: Vector3) -> Vector3:
	var z := (CourtSpec.HALF_WIDTH + 1.5) * (1.0 if p.z >= 0.0 else -1.0)
	return Vector3(clampf(p.x, -40.0, 40.0), 0, z)


# --- Ball possession helpers --------------------------------------------------------------

func _give_ball(p: CourtPlayer) -> void:
	holder = p
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
	if holder and holder.team_idx == user_team:
		new_user = holder
	elif holder:
		new_user = lineup(user_team)[holder.slot]
	elif user:
		new_user = user
	if new_user != user:
		if user:
			user.set_user(false)
		user = new_user
		if user:
			user.set_user(true)


func switch_defender() -> void:
	if holder == null or holder.team_idx == user_team:
		return
	var best: CourtPlayer = null
	var best_d := INF
	for p in lineup(user_team):
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


func nearest_defender(p: CourtPlayer) -> CourtPlayer:
	var best: CourtPlayer = null
	var best_d := INF
	for d in lineup(1 - p.team_idx):
		var dd := d.pos_ft().distance_to(p.pos_ft())
		if dd < best_d:
			best_d = dd
			best = d
	return best


func openness(p: CourtPlayer) -> float:
	var d := nearest_defender(p)
	return d.pos_ft().distance_to(p.pos_ft()) if d else 99.0


# --- Shooting ---------------------------------------------------------------------------

func _shot_clip(shooter: CourtPlayer, dist: float) -> String:
	if dist < 8.0 and (shooter.rating("dunk", 60) > 72 or shooter.height_ft() > 6.7) and _rng.randf() < 0.7:
		return "dunk"
	if dist < 11.0:
		return "layup"
	if dist < 15.0 and _rng.randf() < 0.4:
		return "floater"
	return "jumpshot"


## Expected points of a shot from where `p` stands right now.
func shot_value(p: CourtPlayer) -> float:
	var side := attack_side(p.team_idx)
	var p2 := Vector2(p.pos_ft().x, p.pos_ft().z)
	var dist := CourtSpec.shot_distance_ft(p2, side)
	if dist > 30.0:
		return 0.0
	var three := CourtSpec.is_three_pointer(p2, side)
	var kind := "layup" if dist < 8.0 else ("floater" if dist < 13.0 else "jumpshot")
	var d := nearest_defender(p)
	var contest := ShotTiming.contest_level(d.pos_ft().distance_to(p.pos_ft()) if d else 99.0, false, 0.0)
	return ShotTiming.base_chance(kind, dist, three, p.data.get("ratings", {}), contest) * (3.0 if three else 2.0)


## Starts a shot. `user_timed`: the user releases Shoot to time it (meter).
## `force_clip`: "finish" = layup/dunk, "jumpshot", "floater".
func try_shoot(user_timed := false, force_clip := "") -> void:
	if phase != Phase.LIVE or holder == null or phys.active or not _pending.is_empty():
		return
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
	elif force_clip == "floater" and dist < 16.0:
		clip = "floater"
	elif force_clip == "jumpshot" and dist > 6.0:
		clip = "jumpshot"
	var ratings: Dictionary = shooter.data.get("ratings", {})
	var defender := nearest_defender(shooter)
	var d_dist := defender.pos_ft().distance_to(shooter.pos_ft()) if defender else 99.0
	var hand_up := defender != null and defender.anim.action in ["contest", "block"]
	var h_diff := (defender.height_ft() - shooter.height_ft()) * 12.0 if defender else 0.0
	var contest := ShotTiming.contest_level(d_dist, hand_up, h_diff)
	var contact := _contact.has(shooter)
	if contact:
		contest = minf(1.0, contest + 0.35)
	var difficulty: float = ShotTiming.DIFFICULTY.get(clip, 1.0)
	if clip == "jumpshot" and shooter.velocity.length() > 6.0:
		difficulty = ShotTiming.DIFFICULTY.jumpshot_moving
	if from_stepback:
		difficulty = ShotTiming.DIFFICULTY.stepback
	var rating_key: String = {"dunk": "dunk", "layup": "layup", "floater": "close_shot"}.get(clip,
		"three_point" if three else "mid_range")
	var rating := float(ratings.get(rating_key, 70))
	var window := ShotTiming.green_window(rating, contest, shooter.fatigue(), difficulty)
	var timed := user_timed and meter_enabled() and clip != "dunk"
	if timed:
		window *= Difficulty.value("user_window")
	var base := ShotTiming.base_chance(clip, dist, three, ratings, contest)
	if is_cpu(shooter.team_idx):
		base *= Difficulty.value("cpu_make")
	var basket := basket_ft(shooter.team_idx)
	shooter.face_target = basket
	shooter.look_at_now(basket)
	shooter.play(clip)
	var ideal := AnimLibrary.event_time(clip, "release", 0.5)
	if clip in ["dunk", "layup"]:
		var to := basket - shooter.pos_ft()
		to.y = 0.0
		var travel := maxf(0.0, to.length() - (2.0 if clip == "dunk" else 3.0))
		shooter.push = to.normalized() * travel / maxf(0.2, ideal * 0.8)
	_pending = {"kind": "shot", "player": shooter, "clip": clip, "three": three, "side": side, "dist": dist,
		"contest": contest, "window": window, "ideal": ideal, "user_timed": timed, "blocked": false,
		"base": base, "ft": false, "foul": {},
		"offset": null if timed else ShotTiming.ai_offset(rating, _rng) * (0.4 if clip == "dunk" else 1.0)}
	box.shot(shooter.pid(), false, three)        # attempt now; the make is added on score
	if timed:
		meter_started.emit(shooter, window, ideal)
	# Defense: the closest defender contests or tries to block.
	if defender and d_dist < 8.0 and not defender.busy() and not defender.user_controlled:
		var aggression := Difficulty.value("cpu_defense") if is_cpu(defender.team_idx) else 1.0
		var block_try := d_dist < 4.5 and _rng.randf() < 0.3 * aggression
		defender.look_at_now(shooter.pos_ft())
		defender.play("block" if block_try else "contest")
		if block_try and clip != "dunk" and _rng.randf() < 0.12 + defender.rating("block", 50) / 600.0:
			_pending.blocked = true
			_pending.blocker = defender
	# Shooting foul?
	if defender and d_dist < 6.0:
		var kind := "drive" if contact else "shot"
		var discipline := defender.rating("interior_d" if dist < 10.0 else "perimeter_d", 60)
		if _rng.randf() < Referee.foul_chance(kind, discipline, 0.5 if contact else 0.0, _foul_rate(defender)):
			_pending.foul = {"defender": defender}
			_pending.blocked = false


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
	# The meter only changes the odds for shots the user times; AI and
	# "real player %" shots use the rating-based chance directly.
	var chance := ShotTiming.make_chance(float(f.base), g) if f.user_timed else float(f.base)
	if not f.foul.is_empty():
		chance *= 0.55                     # fouled shots go in less often
	var made := _rng.randf() < chance
	if f.user_timed or (shooter == user and Settings.get_value("gameplay", "meter_style") != "off"):
		meter_graded.emit(shooter, ShotTiming.GRADE_TEXT[g], g <= ShotTiming.Grade.GOOD, float(f.offset))
	holder = null
	_thrower = shooter
	_last_touch = shooter.team_idx
	_shot = {"shooter": shooter, "team": shooter.team_idx, "three": f.three, "side": side, "clip": f.clip,
		"ft": f.ft, "foul": f.foul, "dist": f.dist, "released_at": _game_time, "clock": state.game_clock}
	_intercept_rolled = {}
	if f.blocked:
		var blocker: CourtPlayer = f.get("blocker")
		if blocker:
			box.add(blocker.pid(), "blk")
		_log(1 - shooter.team_idx, "%s blocks %s" % [blocker.short_name() if blocker else "?", shooter.short_name()])
		announce.emit("BLOCKED!")
		var away := (from - rim)
		away.y = 0.0
		phys.launch(from, away.normalized() * 4.5 + Vector3(_rng.randf_range(-2, 2), 1.5, _rng.randf_range(-2, 2)))
		_shot.blocked = true
		_plan_rebound()
		return
	if not f.foul.is_empty():
		var d: CourtPlayer = f.foul.defender
		_call_foul(d, shooter, true)
	if f.clip == "dunk":
		var off := Vector3.ZERO if made else ((rim - from) * Vector3(1, 0, 1)).normalized() * 0.2
		phys.launch(rim + Vector3(0, 0.3, 0) + off, Vector3(0, -4.0, 0) + (rim - from) * Vector3(0.3, 0, 0.3))
		return
	var shot_dir := ((rim - from) * Vector3(1, 0, 1)).normalized()
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
	if not made and not f.ft and f.foul.is_empty():
		_plan_rebound(BallPhysics.flight_time(from, target, apex))


# --- Fouls ---------------------------------------------------------------------------------

## Lower difficulties whistle the CPU's defenders more and the user's less.
func _foul_rate(defender: CourtPlayer) -> float:
	var r := Difficulty.value("foul_rate")
	return r if is_cpu(defender.team_idx) else 1.0 / r


## Calls a defensive foul. Shooting fouls award free throws after the shot.
func _call_foul(defender: CourtPlayer, fouled: CourtPlayer, shooting: bool) -> void:
	var t := defender.team_idx
	box.add(defender.pid(), "pf")
	state.add_team_foul(t)
	var pf: int = box.line(defender.pid()).pf
	_log(t, "%s foul on %s (%d)" % ["Shooting" if shooting else "Personal", defender.short_name(), pf])
	announce.emit("FOUL ON %s" % defender.short_name().to_upper())
	if fouled == user or defender == user:
		InputRouter.vibrate(60, 0.6)
	if Referee.fouled_out(pf):
		announce.emit("%s FOULS OUT" % defender.short_name().to_upper())
		_log(t, "%s has fouled out" % defender.short_name())
	if shooting:
		return
	var offense := fouled.team_idx
	if state.in_bonus(offense):
		_dead(1.3, func(): _start_free_throws(fouled, 2))
	else:
		var spot := _sideline_spot(fouled.pos_ft())
		var keep := maxf(state.shot_clock, GameState.SHOT_CLOCK_RESET_SHORT)
		_dead(1.3, func():
			_setup_inbound(offense, spot, false)
			state.shot_clock = keep)


func _offensive_foul(offender: CourtPlayer, defender: CourtPlayer) -> void:
	box.add(offender.pid(), "pf")
	box.add(offender.pid(), "tov")
	_log(offender.team_idx, "Offensive foul (charge) on %s" % offender.short_name())
	announce.emit("CHARGE!")
	defender.play("bump_front")
	_turnover_to(1 - offender.team_idx, _sideline_spot(offender.pos_ft()))


# --- Violations & turnovers ------------------------------------------------------------------

func _violation(text: String, offender_id := "") -> void:
	if phase != Phase.LIVE and phase != Phase.INBOUND:
		return
	var team := state.possession
	if offender_id != "":
		box.add(offender_id, "tov")
	elif holder:
		box.add(holder.pid(), "tov")
	_log(team, text.capitalize())
	announce.emit(text)
	var spot := _sideline_spot(ball.global_position / FT)
	_turnover_to(1 - team, spot)


func _turnover_to(team: int, spot: Vector3) -> void:
	phys.active = false
	_shot = {}
	_pass = {}
	holder = null
	_dead(1.3, func(): _setup_inbound(team, spot))


func _out_of_bounds() -> void:
	var to := 1 - _last_touch if _last_touch >= 0 else 1 - state.possession
	var spot := ball.global_position / FT
	if absf(spot.x) > CourtSpec.HALF_LENGTH:
		spot = Vector3(signf(spot.x) * (CourtSpec.HALF_LENGTH + 1.5), 0, clampf(spot.z, -20, 20))
	else:
		spot = _sideline_spot(spot)
	if _shot.is_empty() and _last_touch == state.possession:
		box.add(_thrower.pid() if _thrower else "", "tov")
	announce.emit("OUT OF BOUNDS")
	var why := "loose ball" if not _shot.is_empty() else ("pass" if not _pass.is_empty() else "")
	_log(to, "Out of bounds (%s), %s ball" % [why, team_name(to)])
	_turnover_to(to, spot)


# --- Passing, steals, blocks, moves ------------------------------------------------------

func try_pass(direction := Vector3.ZERO) -> void:
	if holder == null:
		return
	var mates := lineup(holder.team_idx).filter(func(p): return p != holder)
	var target: CourtPlayer = mates[_rng.randi() % mates.size()]
	if direction.length() > 0.2:
		var best := -INF
		for m in mates:
			var to: Vector3 = (m.pos_ft() - holder.pos_ft()).normalized()
			var score := to.dot(direction.normalized())
			if score > best:
				best = score
				target = m
	else:
		# No direction: the most open teammate.
		var best := -INF
		for m in mates:
			var score: float = openness(m) - m.pos_ft().distance_to(holder.pos_ft()) * 0.15
			if score > best:
				best = score
				target = m
	try_pass_to(target)


func try_pass_to(target: CourtPlayer) -> void:
	if holder == null or target == null or target == holder or phys.active or not _pending.is_empty():
		return
	if phase != Phase.LIVE and phase != Phase.INBOUND:
		return
	if holder.busy():
		return
	holder.look_at_now(target.pos_ft())
	var clip := "bounce_pass" if _rng.randf() < 0.25 and phase == Phase.LIVE else "chest_pass"
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
	var acc := passer.rating("pass_accuracy")
	var a := _rng.randf() * TAU
	to += Vector3(cos(a), _rng.randf_range(-0.5, 0.5), sin(a)) * (99.0 - acc) / 99.0 * 0.6
	holder = null
	_thrower = passer
	_last_touch = passer.team_idx
	_intercept_rolled = {}
	if f.clip == "bounce_pass":
		var floor_pt := from.lerp(to, 0.62)
		floor_pt.y = BallPhysics.R
		phys.launch(from, BallPhysics.solve_launch(from, floor_pt, from.y + 0.02))
	else:
		phys.launch(from, BallPhysics.solve_launch(from, to, maxf(from.y, to.y) + 0.12 + dist * 0.015))
	_pass = {"target": target, "passer": passer}
	target.look_at_now(passer.pos_ft())
	target.play("catch")


func try_steal(defender: CourtPlayer = null) -> void:
	if defender == null:
		defender = user
	if phase != Phase.LIVE or holder == null or defender == null or holder.team_idx == defender.team_idx or defender.busy():
		return
	defender.look_at_now(holder.pos_ft())
	defender.play("steal")
	var hands := defender.rating("steal", 60)
	var handle := holder.rating("ball_handle", 70)
	var close := defender.pos_ft().distance_to(holder.pos_ft()) < 5.0
	var success := close and _rng.randf() < 0.12 + (hands - handle) / 220.0 + 0.08
	var foul := close and not success and _rng.randf() < Referee.foul_chance("reach", defender.rating("perimeter_d", 60), 0.0,
		_foul_rate(defender))
	if _pending.is_empty():
		_pending = {"kind": "steal", "player": defender, "clip": "steal", "success": success, "foul": foul,
			"victim": holder}


func try_block() -> void:
	if user == null or user.busy():
		return
	var shooter: CourtPlayer = _pending.get("player") if _pending.get("kind", "") == "shot" else null
	if shooter:
		user.look_at_now(shooter.pos_ft())
	user.play("block")
	if shooter and shooter.team_idx != user.team_idx and user.pos_ft().distance_to(shooter.pos_ft()) < 6.0 \
			and _pending.clip != "dunk":
		if _rng.randf() < 0.3 + user.rating("block", 60) / 500.0:
			_pending.blocked = true
			_pending.blocker = user
		elif _rng.randf() < 0.25:
			_pending.foul = {"defender": user}
	elif not _shot.is_empty() and phys.active and Referee.is_goaltending(phys.pos, phys.vel, int(_shot.side)) \
			and user.global_position.distance_to(Vector3(phys.pos.x, 0, phys.pos.z)) < 1.5:
		_goaltend(user)


func _goaltend(defender: CourtPlayer) -> void:
	var shooter: CourtPlayer = _shot.shooter
	_log(defender.team_idx, "Goaltending on %s" % defender.short_name())
	announce.emit("GOALTENDING")
	_on_score(int(_shot.side), true)


## Dribble moves. dir: "left"/"right" are screen directions, "up"/"down".
func try_move(dir: String) -> void:
	if phase != Phase.LIVE or holder == null or holder.busy() or not _pending.is_empty() or phys.active:
		return
	var hand := holder.anim.dribble_hand
	var other := "l" if hand == "r" else "r"
	var clip := ""
	match dir:
		"left", "right":
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
	# A good move can shake the defender for a moment.
	var d := nearest_defender(holder)
	if d and not d.user_controlled and _rng.randf() < (holder.rating("ball_handle") - d.rating("perimeter_d", 60) + 30.0) / 120.0:
		d.push = (d.pos_ft() - holder.pos_ft()).normalized() * 7.0


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
				var victim: CourtPlayer = _pending.victim
				var ok: bool = _pending.success and holder == victim and not holder.busy()
				var foul: bool = _pending.foul and holder == victim
				_pending = {}
				if ok:
					box.add(d.pid(), "stl")
					box.add(victim.pid(), "tov")
					_log(d.team_idx, "%s steals from %s" % [d.short_name(), victim.short_name()])
					announce.emit("STEAL!")
					_set_possession(d.team_idx)
					ref.new_possession(not Referee.in_frontcourt(d.pos_ft(), attack_side(d.team_idx)))
					state.reset_shot_clock()
					_give_ball(d)
				elif foul:
					_call_foul(d, victim, false)


# --- Rebounds and loose balls --------------------------------------------------------------

func _plan_rebound(min_time := 0.25) -> void:
	var c := phys.predict_catch(2.75, min_time, 4.0)
	if c.is_empty():
		return
	var t: float = c[0]
	var spot: Vector3 = c[1] / FT
	spot.y = 0.0
	_rebounder = null
	var best := INF
	var offense := state.possession
	for p in players:
		var reb := p.rating("def_reb" if p.team_idx != offense else "off_reb", 60)
		var d := p.pos_ft().distance_to(spot) - reb / 22.0 - p.height_ft() * 1.5 - _rng.randf_range(0.0, 3.0)
		if p.team_idx != offense:
			d -= 1.5                      # defenders have inside position
		if d < best:
			best = d
			_rebounder = p
	_rebounder.target = spot
	_rebounder.sprinting = true
	var grab := AnimLibrary.event_time("rebound", "grab", 0.55)
	var r := _rebounder
	get_tree().create_timer(maxf(0.0, t - grab), false, true).timeout.connect(func():
		if _rebounder == r and phys.active and not r.busy():
			r.play("rebound"))


func rebound_spot() -> Vector3:
	return _rebounder.target if _rebounder else Vector3.INF


func _check_pickups() -> void:
	var ball_pos := phys.pos
	var shot_live := not _shot.is_empty() and not phys.touched_rim and not phys.touched_board and phys.bounces == 0
	if phase == Phase.TIPOFF and not _tip.has("won"):
		return                       # nobody catches the jump ball before the tip
	for p in players:
		if p == _thrower and phys.time < 0.4:
			continue
		var reach_h := p.avatar.height_m * 1.33 + (0.55 if p.anim.action in ["rebound", "block"] else 0.0)
		var hand_pt := p.global_position + Vector3(0, minf(ball_pos.y, reach_h), 0)
		var horiz := Vector2(ball_pos.x - hand_pt.x, ball_pos.z - hand_pt.z).length()
		var reach := 1.1 if not _pass.is_empty() and p == _pass.target else 0.75
		if ball_pos.y > reach_h + 0.1 or horiz > reach:
			continue
		if shot_live:
			# Touching a shot on its way down near the rim is goaltending.
			if p.team_idx != _shot.team and Referee.is_goaltending(ball_pos, phys.vel, int(_shot.side)) \
					and p.anim.action == "block":
				_goaltend(p)
				return
			if phys.vel.y > -1.0 or ball_pos.y > BallPhysics.RIM_Y - 0.3:
				continue
		if not _pass.is_empty():
			var target: CourtPlayer = _pass.target
			if p != target:
				if p.team_idx == target.team_idx or _intercept_rolled.has(p):
					continue
				var passer: CourtPlayer = _pass.passer
				if horiz > 0.35 or phys.pos.distance_to(passer.global_position + Vector3(0, 1.2, 0)) < 1.8:
					continue
				_intercept_rolled[p] = true
				var odds := 0.045 + p.rating("steal", 60) / 1200.0
				if is_cpu(p.team_idx):
					odds *= Difficulty.value("cpu_defense")
				if _rng.randf() > odds:
					continue
				box.add(p.pid(), "stl")
				box.add(passer.pid(), "tov")
				_log(p.team_idx, "%s intercepts the pass" % p.short_name())
				announce.emit("INTERCEPTED!")
		_take_loose_ball(p)
		return


func _take_loose_ball(p: CourtPlayer) -> void:
	var was_shot := not _shot.is_empty()
	var offense := state.possession
	var passing := not _pass.is_empty()
	var passer: CourtPlayer = _pass.get("passer") if passing else null
	_shot = {}
	if was_shot:
		box.rebound(p.pid(), p.team_idx == offense)
		_log(p.team_idx, "%s %s rebound" % [p.short_name(), "offensive" if p.team_idx == offense else "defensive"])
	_give_ball(p)
	if passing and passer and passer.team_idx == p.team_idx:
		_last_catch = {"player": p, "passer": passer, "time": _game_time}
	if phase == Phase.INBOUND:
		phase = Phase.LIVE
		state.running = true
		return
	if phase == Phase.TIPOFF:
		phase = Phase.LIVE
	if p.team_idx == offense:
		if was_shot:
			state.reset_shot_clock(true)
	else:
		_set_possession(p.team_idx)
		state.reset_shot_clock()
		ref.new_possession(not Referee.in_frontcourt(p.pos_ft(), attack_side(p.team_idx)))


func _on_score(side: int, goaltended := false) -> void:
	var team := HOME if attack_side(HOME) == side else AWAY
	# A buzzer-beater can land after the period (and the sides) changed.
	if not _shot.is_empty() and int(_shot.side) == side:
		team = int(_shot.team)
	if _shot.get("ft", false):
		_ft_result(true)
		return
	var pts := 3 if (not _shot.is_empty() and _shot.side == side and _shot.three) else 2
	var shooter: CourtPlayer = _shot.get("shooter") if not _shot.is_empty() else lineup(team)[0]
	var foul: Dictionary = _shot.get("foul", {})
	state.add_points(team, pts)
	box.add(shooter.pid(), "fgm")
	box.add(shooter.pid(), "pts", pts)
	if pts == 3:
		box.add(shooter.pid(), "tpm")
	box.plus_minus(team, pts, _on_court_ids())
	_count_run(team, pts)
	# Assist: a teammate's pass caught within the last 4 seconds.
	var assist := ""
	if not _last_catch.is_empty() and _last_catch.player == shooter and _game_time - float(_last_catch.time) < 4.0:
		var passer: CourtPlayer = _last_catch.passer
		box.add(passer.pid(), "ast")
		assist = " (%s assists)" % passer.short_name()
	_last_catch = {}
	var what := "dunk" if _shot.get("clip", "") == "dunk" else ("layup" if _shot.get("clip", "") == "layup" else
		"%d-ft %s" % [roundi(float(_shot.get("dist", 0.0))), "three" if pts == 3 else "jumper"])
	_log(team, "%s makes %s%s" % [shooter.short_name(), what, assist])
	shot_made.emit(team, pts, shooter)
	if not phys.touched_rim and not phys.touched_board and _shot.get("clip", "") == "jumpshot":
		announce.emit("SWISH")
	var buzzer := not _shot.is_empty() and state.game_clock <= 0.0
	if buzzer:
		announce.emit("BUZZER BEATER!")
	_shot = {}
	_rebounder = null
	if pts == 3:
		get_tree().create_timer(0.7, false).timeout.connect(func():
			if not shooter.busy():
				shooter.play("celebrate"))
	if _pending_period_end >= 0:
		_finish_period()
		return
	if not foul.is_empty():
		announce.emit("AND ONE!")
		_dead(1.6, func(): _start_free_throws(shooter, 1))
		return
	# The clock keeps running after a make except in the last 2 minutes of the 4th / OT.
	var late := state.period >= state.regulation_periods and state.game_clock < 120.0
	var s := side
	_dead(1.7, func(): _setup_inbound(1 - team, Vector3(s * (CourtSpec.HALF_LENGTH + 1.5), 0, -5.0)), not late)
	_cpu_timeout_check(team)


## A shot that drew a shooting foul and missed: free throws instead of a rebound.
func _resolve_fouled_miss() -> void:
	var shooter: CourtPlayer = _shot.shooter
	var n := Referee.free_throws(true, false, bool(_shot.three), false)
	_log(shooter.team_idx, "%s misses (fouled)" % shooter.short_name())
	_shot = {}
	phys.active = false
	_dead(1.2, func(): _start_free_throws(shooter, n))


# --- Period / game end ------------------------------------------------------------------

func _on_period_ended(period: int) -> void:
	_pending_period_end = period
	# Let a shot already in the air finish (buzzer beaters count).
	if not _shot.is_empty() and phys.active:
		get_tree().create_timer(2.5, false).timeout.connect(func():
			if _pending_period_end >= 0:
				_finish_period())
		return
	_finish_period()


func _finish_period() -> void:
	var period := _pending_period_end
	_pending_period_end = -1
	phys.active = false
	_shot = {}
	_pass = {}
	_pending = {}
	holder = null
	paused = true
	var label := "END OF %s" % (["1ST", "2ND", "3RD", "4TH"][clampi(period - 1, 0, 3)] if period <= 4 else "OT")
	if state.scores[HOME] == state.scores[AWAY] and period >= state.regulation_periods:
		state.final = false
	if period >= state.regulation_periods and state.scores[HOME] != state.scores[AWAY]:
		state.final = true
	_log(-1, label.capitalize() if not state.final else "Final")
	announce.emit(label if not state.final else "FINAL")
	if state.final:
		var winner := HOME if state.scores[HOME] > state.scores[AWAY] else AWAY
		get_tree().create_timer(2.0, false).timeout.connect(func(): game_over.emit(winner))
		return
	# Breaks rest everyone; the next period starts with an inbound.
	for p in players:
		p.stamina = minf(1.0, p.stamina + 0.3)
	for t in 2:
		rot[t].rest_bench(60.0)
	get_tree().create_timer(3.0, false).timeout.connect(func():
		paused = false
		_run_subs()
		var next_period := period + 1
		# Q2 and Q3 go to the team that lost the tip, Q4/OT to the winner.
		var winner := maxi(_tip_winner, 0)
		var team := (1 - winner) if next_period in [2, 3] else winner
		if next_period > 4:
			_setup_tipoff()
			return
		var s := -attack_side(team)
		_setup_inbound(team, Vector3(s * (CourtSpec.HALF_LENGTH + 1.5), 0, -5.0)))


# --- Simulation loop ---------------------------------------------------------------------

func _physics_process(delta: float) -> void:
	if paused:
		return
	if phase == Phase.LIVE or (phase == Phase.DEAD and _clock_in_dead):
		state.tick(delta)
		if state.running:
			box.minutes(_on_court_ids(), delta)
	_game_time += delta
	for k in _contact.keys():
		_contact[k] -= delta
		if _contact[k] <= 0.0:
			_contact.erase(k)
	for t in 2:
		rot[t].rest_bench(delta * players[0].drain_scale * 0.5)
	match phase:
		Phase.DEAD:
			_update_dead(delta)
		Phase.TIPOFF:
			_update_tipoff(delta)
		Phase.INBOUND:
			_update_inbound(delta)
			_ai_tick(delta)
		Phase.FREE_THROWS:
			_update_free_throws(delta)
		Phase.LIVE:
			_ai_tick(delta)
			_user_input()
			_rules(delta)
	if _pending.get("kind", "") == "shot":
		_update_pending_shot()
	for p in players:
		p.defending = p.team_idx != state.possession and phase == Phase.LIVE
		p.has_ball = p == holder and _pending.is_empty() and phase == Phase.LIVE
		p.step(delta)
	if phase == Phase.LIVE:
		_collisions(delta)
	_update_ball(delta)


func _ai_tick(delta: float) -> void:
	var off := state.possession
	ai[off].offense(delta)
	ai[1 - off].defense(delta)


func _rules(delta: float) -> void:
	var side := attack_side(state.possession)
	# 8 seconds / over-and-back (only while someone holds the ball or it's a pass)
	var ball_ft: Vector3 = (holder.pos_ft() if holder else ball.global_position / FT)
	if _shot.is_empty():
		var v := ref.tick_backcourt(ball_ft, side, delta, holder != null and holder.team_idx == state.possession)
		if v == "8 seconds":
			_violation("8-SECOND VIOLATION")
			return
		if v == "backcourt":
			_violation("BACKCOURT VIOLATION")
			return
	# Offensive 3 seconds
	var paint := []
	for p in lineup(state.possession):
		if CourtSpec.in_paint(Vector2(p.pos_ft().x, p.pos_ft().z), side):
			paint.append(p.pid())
	var live := _shot.is_empty() and Referee.in_frontcourt(ball_ft, side)
	var lane := ref.tick_lane(paint, delta, live)
	if lane != "":
		_violation("3 SECONDS", lane)


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


func _toward_basket(p: CourtPlayer, dir: Vector3) -> bool:
	var to := basket_ft(p.team_idx) - p.pos_ft()
	if to.length() > 16.0:
		return false
	var moving := p.velocity.length() > 5.0 and p.velocity.normalized().dot(to.normalized()) > 0.5
	return moving or (dir.length() > 0.3 and dir.normalized().dot(to.normalized()) > 0.5)


## Keeps bodies from overlapping; contact on drives can draw fouls or charges.
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
			var wa := _mass(a)
			var wb := _mass(b)
			a.set_pos_ft(a.pos_ft() - n * overlap * wb / (wa + wb))
			b.set_pos_ft(b.pos_ft() + n * overlap * wa / (wa + wb))
			if a.team_idx == b.team_idx:
				continue
			for pair in [[a, b, n], [b, a, -n]]:
				var driver: CourtPlayer = pair[0]
				var wall: CourtPlayer = pair[1]
				if driver == holder and driver.velocity.length() > 9.0 and driver.velocity.normalized().dot(pair[2]) > 0.6 \
						and not _contact.has(driver) and _pending.is_empty():
					_drive_contact(driver, wall)
					if phase != Phase.LIVE:
						return
			var closing := (a.velocity - b.velocity).dot(n)
			if closing > 11.0 and not phys.active:
				_bump(a, n)
				_bump(b, -n)


func _mass(p: CourtPlayer) -> float:
	return float(p.data.get("weight_lb", 220)) * (0.7 + p.rating("strength", 60) / 200.0)


func _drive_contact(driver: CourtPlayer, defender: CourtPlayer) -> void:
	_contact[driver] = 0.7
	var ratio := _mass(driver) / _mass(defender)
	var def_speed := defender.velocity.length()
	driver.velocity *= clampf(0.35 * ratio, 0.2, 0.7)
	defender.push = driver.velocity.normalized() * 6.0 * ratio
	if not driver.busy():
		driver.play("bump_front")
	if not defender.busy():
		defender.play("bump_front")
	if driver == user or defender == user:
		InputRouter.vibrate(45, 0.7)
	# Whistle? Charge on a set defender outside the restricted area, else blocking.
	if _rng.randf() < Referee.foul_chance("drive", defender.rating("interior_d", 60), 0.3, _foul_rate(defender)):
		if Referee.charge_or_block(def_speed, defender.pos_ft(), attack_side(driver.team_idx)) == "charge" \
				and _rng.randf() < 0.55:
			_offensive_foul(driver, defender)
		else:
			_call_foul(defender, driver, false)


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
	if not phys.active:
		return
	for ev in phys.step(delta):
		match ev.type:
			"score":
				_on_score(int(ev.side))
				return
			"rim":
				if _rebounder == null and not _shot.is_empty() and not _shot.ft and _shot.foul.is_empty():
					_plan_rebound(0.05)
	ball.global_position = phys.pos
	(ball.get_child(0) as Node3D).rotate_x(-phys.vel.length() * delta * 3.0)
	if not _pass.is_empty():
		var target: CourtPlayer = _pass.target
		target.anim.reach_for(phys.pos if phys.time > 0.12 else Vector3.INF)
	# Missed free throws and fouled misses resolve as soon as the ball is clearly off.
	if not _shot.is_empty() and ((_shot.ft and not _ft.is_empty()) or not _shot.foul.is_empty()) and phys.time > 0.4:
		var rim := BallPhysics.rim_center(int(_shot.side))
		var off_rim := phys.vel.y < 0.0 and phys.pos.y < rim.y - 0.35
		if off_rim or phys.bounces > 0:
			if _shot.ft:
				var last: bool = _ft.n >= _ft.total
				var shooter: CourtPlayer = _ft.shooter
				_ft_result(false)
				if last:
					# The miss is now a live rebound like any other shot.
					_shot = {"shooter": shooter, "team": shooter.team_idx, "three": false,
						"side": attack_side(shooter.team_idx), "clip": "free_throw", "ft": false, "foul": {}}
			else:
				_resolve_fouled_miss()
			return
	# Only a live ball can go out of bounds (a made shot rolling away is dead).
	var inbounding: bool = phase != Phase.LIVE or (not _pass.is_empty() and _thrower == _inbound.get("inbounder") and phys.time < 1.0)
	if not inbounding and (absf(phys.pos.x) > (CourtSpec.HALF_LENGTH + 1.0) * FT or absf(phys.pos.z) > (CourtSpec.HALF_WIDTH + 1.0) * FT):
		if phys.pos.y < 1.2:
			_out_of_bounds()
			return
	if phase == Phase.LIVE or phase == Phase.TIPOFF or phase == Phase.INBOUND:
		_check_pickups()
	if _rebounder == null and _pass.is_empty() and not _shot.is_empty() and phys.vel.y < 0.0 and phys.pos.y < 2.0:
		_plan_rebound(0.05)
