class_name TeamAI
extends RefCounted
## One team's brain. On offense it brings the ball up, runs a play
## (pick-and-roll, isolation, post-up or motion; fast breaks when the defense
## isn't back) and decides when to shoot or pass from the shot value, shot
## clock and its IQ. On defense it plays man (with help and switches on
## screens) or a 2-3 zone, contests shots and boxes out.
## The player the user controls is never moved by the AI.

const PLAYS := ["pnr", "iso", "post", "motion"]
const PLAY_NAMES := {"auto": "Auto", "pnr": "Pick & Roll", "iso": "Isolation", "post": "Post Up", "motion": "Motion"}
const SCHEMES := ["man", "switch", "zone"]
## Offensive spots: [feet from the attacked baseline, lateral feet], by slot PG..C.
const SPOTS := [Vector2(30, 0), Vector2(22, 17), Vector2(5, -21), Vector2(19, -16), Vector2(8, 10)]
const ISO_SPOTS := [Vector2(30, 0), Vector2(4, 22), Vector2(4, -22), Vector2(24, -18), Vector2(24, 18)]

var sim: GameSim
var team: int
var play := {}
var play_call := "auto"            # user's team: chosen play (pause menu)
var scheme := "man"
var assign := {}                   # defender pid -> offensive pid
var _decide_cd := 0.0
var _rng := RandomNumberGenerator.new()
var _smooth := {}                  # defender -> smoothed target
var _cut := {}                     # cutting player -> seconds left


func _init(game: GameSim, t: int) -> void:
	sim = game
	team = t
	_rng.randomize()


func iq() -> float:
	return Difficulty.value("cpu_iq") if sim.is_cpu(team) else 0.9


func new_possession() -> void:
	play = {}
	_cut = {}
	assign = {}
	_decide_cd = 0.6
	if sim.is_cpu(team) and _rng.randf() < 0.12:
		scheme = SCHEMES[_rng.randi() % SCHEMES.size()]


func _side() -> int:
	return sim.attack_side(team)


func _basket() -> Vector3:
	return sim.basket_ft(team)


func _court_pt(s: Vector2, side: int) -> Vector3:
	return Vector3(side * (CourtSpec.HALF_LENGTH - s.x), 0, s.y)


## Where this offensive player stands by default.
func spot_for(p: CourtPlayer) -> Vector3:
	var spots := ISO_SPOTS if play.get("type", "") == "iso" else SPOTS
	return _court_pt(spots[p.slot], sim.attack_side(p.team_idx))


## Where this defender lines up when play starts (between his man and the basket).
func guard_spot(d: CourtPlayer) -> Vector3:
	var off_team := 1 - d.team_idx
	var man: CourtPlayer = sim.lineup(off_team)[d.slot]
	var basket := sim.basket_ft(off_team)
	var m := sim.ai[off_team].spot_for(man)
	return m + (basket - m).normalized() * 6.0


func _move(p: CourtPlayer, target: Vector3, sprint := false, face := Vector3.INF) -> void:
	if p.user_controlled:
		return
	p.target = target
	p.sprinting = sprint and p.stamina > 0.2
	p.face_target = face


# --- Offense ---------------------------------------------------------------------------------

func offense(delta: float) -> void:
	var lu := sim.lineup(team)
	var side := _side()
	var basket := _basket()
	var handler := sim.holder if sim.holder and sim.holder.team_idx == team else null
	var t := Time.get_ticks_msec() / 1000.0
	for p in lu:
		p.max_speed_cap = INF
	# Ball in the air: crash the glass with the bigs, guards get back.
	if handler == null:
		if sim.phys.active and not sim._shot.is_empty():
			var spot := sim.rebound_spot()
			for p in lu:
				if p.slot >= 3 and spot != Vector3.INF:
					_move(p, spot + Vector3(_rng.randf_range(-3, 3), 0, _rng.randf_range(-3, 3)), true)
				elif p.slot <= 1:
					_move(p, Vector3(-side * 10.0, 0, (p.slot - 0.5) * 12.0), false)
		return
	var frontcourt := Referee.in_frontcourt(handler.pos_ft(), side)
	# Default spacing with a little drift so nobody stands still.
	for p in lu:
		if p == handler:
			continue
		var s := spot_for(p) + Vector3(sin(t * 0.6 + p.slot * 1.7) * 2.5, 0, cos(t * 0.45 + p.slot) * 2.5)
		if _cut.has(p):
			_cut[p] -= delta
			s = basket - Vector3(side * 3.0, 0, 0)
			if _cut[p] <= 0.0:
				_cut.erase(p)
		# Never camp in the lane: step out before 3 seconds.
		if sim.ref.lane_seconds(p.pid()) > 2.0:
			s = _court_pt(Vector2(17, 13 if p.pos_ft().z >= 0 else -13), side)
		var far := p.pos_ft().distance_to(s) > 15.0
		_move(p, s, far, sim.ball.global_position / CourtSpec.FT)
	if sim.phase != GameSim.Phase.LIVE:
		return
	if not frontcourt or handler.pos_ft().x * side < 4.0:
		_bring_up(handler, lu)
		_clear_lane(lu, handler)
		return
	if play.is_empty():
		_choose_play(lu, handler)
	play.t = float(play.get("t", 0.0)) + delta
	match str(play.type):
		"pnr":
			_run_pnr(handler, lu)
		"iso":
			_run_iso(handler)
		"post":
			_run_post(handler, lu)
		_:
			_run_motion(handler, lu, delta)
	_clear_lane(lu, handler)
	if handler.user_controlled:
		return
	_decide_cd -= delta
	if _decide_cd > 0.0:
		return
	_decide_cd = 0.25
	_decide(handler, lu)


## Nobody without the ball camps in the lane: step out before 3 seconds.
func _clear_lane(lu: Array[CourtPlayer], handler: CourtPlayer) -> void:
	var side := _side()
	for p in lu:
		if p == handler or p.user_controlled:
			continue
		if sim.ref.lane_seconds(p.pid()) > 1.6:
			_move(p, _court_pt(Vector2(17, 13 if p.pos_ft().z >= 0 else -13), side), true)
			_cut.erase(p)


## Bring the ball up; attack right away if the defense isn't back.
func _bring_up(handler: CourtPlayer, lu: Array[CourtPlayer]) -> void:
	var side := _side()
	if handler.user_controlled:
		return
	var defenders_back := 0
	for d in sim.lineup(1 - team):
		if (d.pos_ft().x - handler.pos_ft().x) * side > 0.0:
			defenders_back += 1
	if defenders_back <= 2 and handler.stamina > 0.25:
		# Fast break
		play = {"type": "break", "t": 0.0}
		_move(handler, _basket() - Vector3(side * 2.0, 0, 0), true)
		for p in lu:
			if p != handler and p.slot <= 2:
				_move(p, _court_pt(Vector2(8, 16 if p.slot % 2 == 0 else -16), side), true)
		if handler.pos_ft().distance_to(_basket()) < 9.0:
			sim.try_shoot(false, "finish")
		return
	var top := _court_pt(Vector2(30, handler.pos_ft().z * 0.5), side)
	_move(handler, top, sim.ref.backcourt_time > 2.5, _basket())


func _choose_play(lu: Array[CourtPlayer], handler: CourtPlayer) -> void:
	var choice := play_call if play_call != "auto" and not sim.is_cpu(team) else ""
	if choice == "":
		var star := lu[0]
		for p in lu:
			if float(p.data.get("overall", 60)) > float(star.data.get("overall", 60)):
				star = p
		var big := lu[4]
		var w := {
			"pnr": 3.0,
			"iso": 1.0 + maxf(0.0, (float(star.data.get("overall", 70)) - 82.0) / 4.0),
			"post": 0.6 + maxf(0.0, (big.rating("strength") + big.rating("close_shot") - 150.0) / 15.0),
			"motion": 2.0,
		}
		var total := 0.0
		for k in w:
			total += w[k]
		var r := _rng.randf() * total
		for k in w:
			r -= w[k]
			if r <= 0.0:
				choice = k
				break
	play = {"type": choice, "t": 0.0, "stage": 0}
	match choice:
		"pnr":
			var screener := lu[4] if handler != lu[4] else lu[3]
			play.screener = screener
			play.dir = 1.0 if handler.pos_ft().z <= 0.0 else -1.0
		"iso":
			var star := handler
			for p in lu:
				if float(p.data.get("overall", 60)) > float(star.data.get("overall", 60)):
					star = p
			play.star = star
		"post":
			var big := lu[4]
			for p in lu:
				if p.slot >= 3 and p.rating("strength") + p.rating("close_shot") > big.rating("strength") + big.rating("close_shot"):
					big = p
			play.big = big


func _run_pnr(handler: CourtPlayer, lu: Array[CourtPlayer]) -> void:
	var screener: CourtPlayer = play.screener
	if screener == handler:
		play = {"type": "motion", "t": 0.0}
		return
	var side := _side()
	var basket := _basket()
	var to_basket := (basket - handler.pos_ft()).normalized()
	var perp := to_basket.cross(Vector3.UP) * float(play.dir)
	match int(play.stage):
		0:
			var d := sim.nearest_defender(handler)
			var anchor := d.pos_ft() if d else handler.pos_ft() + to_basket * 3.0
			var screen_spot: Vector3 = anchor + perp * 1.8 - to_basket * 0.5
			_move(screener, screen_spot, true, handler.pos_ft())
			if screener.pos_ft().distance_to(screen_spot) < 2.5 or play.t > 3.0:
				play.stage = 1
				play.t1 = play.t
				if not screener.user_controlled:
					screener.play("set_screen")
		1:
			var since: float = play.t - float(play.t1)
			_move(handler, handler.pos_ft() - perp * 7.0 + to_basket * 6.0, true, basket)
			if since > 0.7:
				_move(screener, basket - Vector3(side * 5.0, 0, 0), true, handler.pos_ft())    # roll
			else:
				_move(screener, screener.pos_ft(), false, handler.pos_ft())


func _run_iso(handler: CourtPlayer) -> void:
	var star: CourtPlayer = play.get("star", handler)
	if star != handler:
		return                     # get the ball to the star (see _decide)
	var basket := _basket()
	if play.t > 1.2:
		var d := sim.nearest_defender(handler)
		var lane_open := d == null or (d.pos_ft().distance_to(basket) > handler.pos_ft().distance_to(basket) + 1.0)
		if lane_open or play.t > 3.0:
			_move(handler, basket - (basket - handler.pos_ft()).normalized() * 3.0, true, basket)
	if int(play.stage) == 0 and play.t > 0.5 and not handler.user_controlled:
		play.stage = 1
		sim.try_move(["left", "right", "up"][_rng.randi() % 3])


func _run_post(handler: CourtPlayer, lu: Array[CourtPlayer]) -> void:
	var big: CourtPlayer = play.big
	var side := _side()
	var basket := _basket()
	var block := _court_pt(Vector2(7, 9.5 if handler.pos_ft().z >= 0.0 else -9.5), side)   # just outside the lane
	if handler != big:
		_move(big, block, true, sim.ball.global_position / CourtSpec.FT)
		return
	# Backing down: slow, facing away from the basket.
	big.max_speed_cap = 4.5
	_move(big, basket - (basket - big.pos_ft()).normalized() * 3.0, false, big.pos_ft() * 2.0 - basket)


func _run_motion(handler: CourtPlayer, lu: Array[CourtPlayer], _delta: float) -> void:
	# Someone cuts backdoor every few seconds.
	if play.t > float(play.get("next_cut", 2.0)):
		play.next_cut = play.t + _rng.randf_range(2.5, 4.0)
		var options := lu.filter(func(p): return p != handler and not p.user_controlled)
		if not options.is_empty():
			_cut[options[_rng.randi() % options.size()]] = 1.6


## The AI ball handler's choice: shoot, drive-finish, pass or keep running the play.
func _decide(handler: CourtPlayer, lu: Array[CourtPlayer]) -> void:
	if handler.busy() or not sim._pending.is_empty():
		return
	var basket := _basket()
	var dist := handler.pos_ft().distance_to(basket)
	var urgency := clampf((8.0 - sim.state.shot_clock) / 8.0, 0.0, 1.0) if sim.state.shot_clock_active() else 0.0
	if sim.state.game_clock < sim.state.shot_clock and sim.state.game_clock < 6.0:
		urgency = maxf(urgency, clampf((6.0 - sim.state.game_clock) / 5.0, 0.0, 1.0))
	# Get a shot off with time to spare (a jumper takes ~0.7 s to leave the hands).
	if (sim.state.shot_clock_active() and sim.state.shot_clock < 2.3) or urgency >= 0.95:
		sim.try_shoot()
		return
	# Don't get called for 3 seconds with the ball: score or kick it out.
	if sim.ref.lane_seconds(handler.pid()) > 2.0:
		if sim.openness(handler) > 3.0 or dist < 6.0:
			sim.try_shoot(false, "floater" if dist > 6.0 else "finish")
		else:
			_pass_best(handler, lu)
		return
	if dist < 8.5 and sim.openness(handler) > 2.5:
		sim.try_shoot(false, "finish")
		return
	var value := sim.shot_value(handler)
	var need := lerpf(1.1, 0.7, urgency) * lerpf(0.9, 1.08, clampf(iq() - 0.5, 0.0, 0.6) / 0.6)
	if play.get("type", "") == "post" and handler == play.get("big") and play.t > 1.5:
		var doubled := 0
		for d in sim.lineup(1 - team):
			if d.pos_ft().distance_to(handler.pos_ft()) < 6.0:
				doubled += 1
		if doubled >= 2:
			_pass_best(handler, lu)
		else:
			sim.try_shoot(false, "floater" if dist > 5.0 else "finish")
		return
	if value >= need and play.t > 0.6:
		sim.try_shoot()
		return
	# Read the play.
	match str(play.get("type", "")):
		"pnr":
			if int(play.stage) == 1:
				var screener: CourtPlayer = play.screener
				var since: float = play.t - float(play.t1)
				if since > 0.9 and sim.openness(screener) > 6.0 and screener.pos_ft().distance_to(basket) < 14.0 \
						and _rng.randf() < iq():
					sim.try_pass_to(screener)
					return
				if since > 3.0:
					_pass_best(handler, lu)
					play = {"type": "motion", "t": 0.0}
					return
		"iso":
			var star: CourtPlayer = play.get("star", handler)
			if star != handler:
				sim.try_pass_to(star)
				return
			if play.t > 4.5:
				_pass_best(handler, lu)
				play = {"type": "motion", "t": 0.0}
				return
		"post":
			var big: CourtPlayer = play.big
			if handler != big:
				var front := sim.nearest_defender(big)
				var fronted := front != null and front.pos_ft().distance_to(basket) > big.pos_ft().distance_to(basket)
				if absf(big.pos_ft().x - _court_pt(Vector2(7, 0), _side()).x) < 4.0 and absf(big.pos_ft().z) < 12.0 and not fronted:
					sim.try_pass_to(big)
					return
				if play.t > 4.0:
					play = {"type": "motion", "t": 0.0}
		_:
			for c in _cut:
				if sim.openness(c) > 5.0 and _rng.randf() < iq() * 0.8:
					sim.try_pass_to(c)
					return
			if play.t > float(play.get("next_pass", 1.8)):
				play.next_pass = play.t + _rng.randf_range(1.4, 2.6)
				_pass_best(handler, lu)
				return
	if play.t > 7.0:
		play = {}


## Pass to the open teammate with the best shot (or, failing that, anyone open).
func _pass_best(handler: CourtPlayer, lu: Array[CourtPlayer]) -> void:
	var best: CourtPlayer = null
	var best_v := -INF
	var side := _side()
	for p in lu:
		if p == handler:
			continue
		# Never pass back into the backcourt once across half court.
		if sim.ref.crossed and not Referee.in_frontcourt(p.pos_ft(), side):
			continue
		var v := sim.shot_value(p) + sim.openness(p) * 0.05 - p.pos_ft().distance_to(handler.pos_ft()) * 0.01
		if v > best_v:
			best_v = v
			best = p
	if best:
		sim.try_pass_to(best)


# --- Defense ---------------------------------------------------------------------------------

func defense(delta: float) -> void:
	var defs := sim.lineup(team)
	var offs := sim.lineup(1 - team)
	var basket := sim.basket_ft(1 - team)          # the basket we protect
	var ball_ft := sim.ball.global_position / CourtSpec.FT
	ball_ft.y = 0.0
	var handler := sim.holder if sim.holder and sim.holder.team_idx != team else null
	_assignments(defs, offs, handler)
	var react := 6.0 * (Difficulty.value("cpu_defense") if sim.is_cpu(team) else 1.0)
	var shot_up := not sim._shot.is_empty() and sim.phys.active
	var helper := _helper(defs, handler, basket)
	for d in defs:
		d.max_speed_cap = INF
		if d.user_controlled:
			continue
		var man := _man_of(d, offs)
		var want: Vector3
		var face := ball_ft
		if shot_up:
			# Box out: get between your man and the rim.
			want = man.pos_ft() + (basket - man.pos_ft()).normalized() * 2.6
			var spot := sim.rebound_spot()
			if spot != Vector3.INF and d.pos_ft().distance_to(spot) < 8.0:
				want = spot
		elif scheme == "zone":
			want = _zone_spot(d.slot, ball_ft, basket)
			if handler and handler.pos_ft().distance_to(want) < 9.0:
				want = handler.pos_ft() + (basket - handler.pos_ft()).normalized() * 4.0
		elif d == helper and handler:
			want = handler.pos_ft() + (basket - handler.pos_ft()).normalized() * 3.5
		else:
			want = _man_spot(d, man, handler, ball_ft, basket)
			face = man.pos_ft()
		var r: float = clampf(react * d.rating("perimeter_d" if man.slot <= 2 else "interior_d", 60) / 80.0, 2.0, 10.0)
		var cur: Vector3 = _smooth.get(d, want)
		cur = cur.lerp(want, 1.0 - exp(-r * delta))
		_smooth[d] = cur
		d.target = cur
		d.face_target = face
		d.sprinting = d.pos_ft().distance_to(cur) > 7.0
	# CPU on-ball pressure.
	if handler and sim.is_cpu(team) and sim.phase == GameSim.Phase.LIVE:
		var on_ball := _defender_of(handler, defs)
		if on_ball and not on_ball.busy() and on_ball.pos_ft().distance_to(handler.pos_ft()) < 4.0 \
				and _rng.randf() < 0.0012 * Difficulty.value("cpu_defense"):
			sim.try_steal(on_ball)


func _man_of(d: CourtPlayer, offs: Array[CourtPlayer]) -> CourtPlayer:
	var pid: String = assign.get(d.pid(), "")
	for o in offs:
		if o.pid() == pid:
			return o
	return offs[d.slot]


func _defender_of(o: CourtPlayer, defs: Array[CourtPlayer]) -> CourtPlayer:
	for d in defs:
		if assign.get(d.pid(), "") == o.pid():
			return d
	return defs[o.slot]


func _assignments(defs: Array[CourtPlayer], offs: Array[CourtPlayer], handler: CourtPlayer) -> void:
	var valid := assign.size() == 5
	if valid:
		var off_ids := offs.map(func(o): return o.pid())
		for d in defs:
			if not assign.get(d.pid(), "") in off_ids:
				valid = false
	if not valid:
		assign = {}
		for d in defs:
			assign[d.pid()] = offs[d.slot].pid()
	# Switch on screens: if another defender is closer to the ball handler than
	# his own man's defender and both are tight, swap.
	if scheme == "switch" and handler:
		var mine := _defender_of(handler, defs)
		for d in defs:
			if d == mine or d.user_controlled or mine.user_controlled:
				continue
			if d.pos_ft().distance_to(handler.pos_ft()) < 4.0 and mine.pos_ft().distance_to(handler.pos_ft()) > 5.0:
				var a: String = assign[d.pid()]
				assign[d.pid()] = assign[mine.pid()]
				assign[mine.pid()] = a
				break


func _man_spot(d: CourtPlayer, man: CourtPlayer, handler: CourtPlayer, ball_ft: Vector3, basket: Vector3) -> Vector3:
	var m := man.pos_ft()
	var to_b := (basket - m)
	var dist := to_b.length()
	# Ball still in their backcourt: retreat and give space, no full-court bodying.
	if handler and not Referee.in_frontcourt(handler.pos_ft(), signf(basket.x)):
		if man == handler:
			return m + to_b.normalized() * 9.0
		return m.lerp(basket, 0.45)
	if man == handler:
		# Tighter on shooters out high, a bit off non-shooters, never beyond the rim.
		var gap := lerpf(3.0, 5.0, clampf((70.0 - man.rating("three_point")) / 30.0, 0.0, 1.0))
		if dist > 26.0:
			gap += 2.0
		return m + to_b.normalized() * minf(gap, dist * 0.5)
	# Off the ball: sag toward the ball and the basket.
	var sag := m.lerp(ball_ft, 0.28)
	return sag + (basket - sag).normalized() * minf(5.0, dist * 0.4)


## A help defender when the ball handler has beaten his man into the paint.
func _helper(defs: Array[CourtPlayer], handler: CourtPlayer, basket: Vector3) -> CourtPlayer:
	if handler == null or scheme == "zone":
		return null
	var hd := handler.pos_ft().distance_to(basket)
	if hd > 16.0:
		return null
	var mine := _defender_of(handler, defs)
	if mine.pos_ft().distance_to(basket) < hd - 1.0:
		return null                 # still in front of him
	if _rng.randf() > iq():
		return null
	var best: CourtPlayer = null
	var best_d := INF
	for d in defs:
		if d == mine or d.user_controlled:
			continue
		var dd := d.pos_ft().distance_to(basket)
		if dd < best_d:
			best_d = dd
			best = d
	return best


## 2-3 zone: two guards up top, forwards on the blocks, center in the middle,
## all shifting toward the ball.
func _zone_spot(slot: int, ball_ft: Vector3, basket: Vector3) -> Vector3:
	var side := signf(basket.x)
	var spots := [Vector2(19, -7), Vector2(19, 7), Vector2(7, -13), Vector2(7, 13), Vector2(5, 0)]
	var s: Vector2 = spots[slot]
	var shift := clampf(ball_ft.z * 0.35, -6.0, 6.0)
	var p := Vector3(side * (CourtSpec.HALF_LENGTH - s.x), 0, s.y + shift)
	return p.lerp(ball_ft, 0.08)
