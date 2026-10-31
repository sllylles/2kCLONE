class_name BallPhysics
extends RefCounted
## Basketball flight and contact, in world meters (court center at the origin,
## baskets at x = ±basket_x). Fixed sub-steps for stable collisions against:
##  * the rim  – a torus (9" radius, 5/8" tube)
##  * the backboard face (6' × 3.5', glass)
##  * the floor – bounces with friction, then rolls
##  * the net  – drags the ball after it drops through
## A make is the ball's center passing down through the rim plane inside the
## ring. Pure logic, no nodes: unit tested in tests/unit/test_ball_physics.gd.

const FT := CourtSpec.FT
const G := 9.81
const R := CourtSpec.BALL_RADIUS * FT                      # 0.119 m
const RIM_R := CourtSpec.RIM_RADIUS * FT                   # 0.229 m
const RIM_TUBE := 0.008
const RIM_Y := CourtSpec.RIM_HEIGHT * FT
const RIM_E := 0.5          # rim restitution (normal)
const RIM_KEEP := 0.82      # tangential speed kept on rim contact
const BOARD_E := 0.62
const FLOOR_E := 0.76
const FLOOR_KEEP := 0.9
const DRAG := 0.0           # per second; 0 keeps solve_launch exact (real drag is minor at these speeds)
const SUBSTEPS := 4

var pos := Vector3.ZERO
var vel := Vector3.ZERO
var active := false
var time := 0.0
var scored_side := 0                 # basket the ball last went through (±1), 0 = none
var touched_rim := false
var touched_board := false
var bounces := 0
var _in_net := 0.0


func launch(from: Vector3, velocity: Vector3) -> void:
	pos = from
	vel = velocity
	active = true
	time = 0.0
	scored_side = 0
	touched_rim = false
	touched_board = false
	bounces = 0
	_in_net = 0.0


func copy() -> BallPhysics:
	var b := BallPhysics.new()
	b.pos = pos
	b.vel = vel
	b.active = active
	b.time = time
	b.scored_side = scored_side
	b.touched_rim = touched_rim
	b.touched_board = touched_board
	b.bounces = bounces
	b._in_net = _in_net
	return b


static func rim_center(side: int) -> Vector3:
	return CourtSpec.basket_position(side)


## Velocity that leaves `from`, peaks at height `apex` (m) and comes down
## through `to`. apex must be above both points.
static func solve_launch(from: Vector3, to: Vector3, apex: float) -> Vector3:
	apex = maxf(apex, maxf(from.y, to.y) + 0.05)
	var vy := sqrt(2.0 * G * (apex - from.y))
	var fall := sqrt(2.0 * (apex - to.y) / G)
	var t := vy / G + fall
	var h := Vector3(to.x - from.x, 0.0, to.z - from.z) / t
	return Vector3(h.x, vy, h.z)


## Flight time for solve_launch's arc.
static func flight_time(from: Vector3, to: Vector3, apex: float) -> float:
	apex = maxf(apex, maxf(from.y, to.y) + 0.05)
	return sqrt(2.0 * (apex - from.y) / G) + sqrt(2.0 * (apex - to.y) / G)


## A natural shooting arc: higher for longer shots (~45-50° entry).
static func shot_apex(from: Vector3, side: int) -> float:
	var d := Vector2(from.x, from.z).distance_to(Vector2(rim_center(side).x, 0.0))
	return maxf(from.y, RIM_Y) + 0.55 + d * 0.22


## Advance the simulation. Returns events: [{"type": "rim"|"board"|"floor"|"score", "side": ±1}]
func step(delta: float) -> Array:
	var events: Array = []
	if not active:
		return events
	var h := delta / SUBSTEPS
	for i in SUBSTEPS:
		time += h
		var prev := pos
		vel.y -= G * h
		vel *= 1.0 - DRAG * h
		if _in_net > 0.0:
			_in_net -= h
			var hz := Vector3(vel.x, 0, vel.z) * pow(0.02, h)   # net soaks up sideways speed
			vel = Vector3(hz.x, maxf(vel.y, -5.0) * (1.0 - 1.5 * h), hz.z)
		pos += vel * h
		for side in [-1, 1]:
			_rim(side, events)
			_board(side, prev, events)
			_score(side, prev, events)
		_floor(events)
	return events


func _rim(side: int, events: Array) -> void:
	var c := rim_center(side)
	var q := pos - c
	if absf(q.y) > R + RIM_TUBE + 0.01 or Vector2(q.x, q.z).length() > RIM_R + R + RIM_TUBE + 0.01:
		return
	var hz := Vector3(q.x, 0.0, q.z)
	var dir := hz.normalized() if hz.length() > 0.0001 else Vector3.RIGHT
	var closest := c + dir * RIM_R
	var d := pos - closest
	var dist := d.length()
	var min_d := R + RIM_TUBE
	if dist >= min_d or dist < 0.0001:
		return
	var n := d / dist
	pos += n * (min_d - dist)
	var vn := vel.dot(n)
	if vn < 0.0:
		var vt := vel - n * vn
		vel = vt * RIM_KEEP - n * vn * RIM_E
		if not touched_rim or absf(vn) > 0.6:
			events.append({"type": "rim", "side": side, "speed": absf(vn)})
		touched_rim = true


func _board(side: int, prev: Vector3, events: Array) -> void:
	var face_x := float(side) * (CourtSpec.HALF_LENGTH - CourtSpec.BACKBOARD_FROM_BASELINE) * FT
	var y0 := CourtSpec.BACKBOARD_BOTTOM * FT
	var y1 := y0 + CourtSpec.BACKBOARD_HEIGHT * FT
	var half_w := CourtSpec.BACKBOARD_WIDTH / 2.0 * FT
	if pos.y < y0 - R * 0.5 or pos.y > y1 + R * 0.5 or absf(pos.z) > half_w + R * 0.5:
		return
	# Signed distance in front of the glass (positive = court side).
	var s := float(side)
	var front := (face_x - pos.x) * s
	if front < R and (face_x - prev.x) * s >= R - 0.05 and vel.x * s > 0.0:
		pos.x = face_x - s * R
		vel.x = -vel.x * BOARD_E
		vel.y *= 0.92
		vel.z *= 0.92
		touched_board = true
		events.append({"type": "board", "side": side})


func _score(side: int, prev: Vector3, events: Array) -> void:
	var c := rim_center(side)
	if prev.y >= c.y and pos.y < c.y and vel.y < 0.0:
		var hd := Vector2(pos.x - c.x, pos.z - c.z).length()
		if hd < RIM_R - R * 0.35 and scored_side == 0:
			scored_side = side
			_in_net = 0.35
			events.append({"type": "score", "side": side})


func _floor(events: Array) -> void:
	if pos.y >= R:
		return
	pos.y = R
	if vel.y < 0.0:
		var speed := -vel.y
		vel.y = speed * FLOOR_E if speed > 0.6 else 0.0
		vel.x *= FLOOR_KEEP
		vel.z *= FLOOR_KEEP
		bounces += 1
		if speed > 0.6:
			events.append({"type": "floor", "speed": speed})
	else:
		# rolling
		vel.x *= 0.99
		vel.z *= 0.99


## Simulates ahead on a copy. Returns positions every `dt` for `seconds`.
func predict(seconds: float, dt := 1.0 / 30.0) -> PackedVector3Array:
	var b := copy()
	var out := PackedVector3Array()
	var t := 0.0
	while t < seconds:
		b.step(dt)
		out.append(b.pos)
		t += dt
	return out


## First predicted point where the ball comes down to `height` (m) after
## `min_time` seconds — where a rebounder should go. Returns [time, point]
## or [] if it never happens within `seconds`.
func predict_catch(height: float, min_time: float, seconds := 3.0) -> Array:
	var b := copy()
	var dt := 1.0 / 60.0
	var t := 0.0
	while t < seconds:
		b.step(dt)
		t += dt
		if t >= min_time and b.vel.y < 0.0 and b.pos.y <= height:
			return [t, b.pos]
		if t >= min_time and b.pos.y <= R + 0.01:
			return [t, b.pos]
	return []
