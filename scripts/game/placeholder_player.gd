class_name PlaceholderPlayer
extends Node3D
## Stand-in athlete for Phase 1: correct height and proportions, team
## uniform colors and numbers, momentum-based movement and a simple procedural
## run cycle. Phase 2 replaces the visuals with the rigged MakeHuman model.

const FT := CourtSpec.FT
const JOG_SPEED := 12.0        # ft/s
const SPRINT_SPEED := 20.0
const ACCEL := 30.0            # ft/s²
const TURN_RATE := 9.0         # rad/s

var data: Dictionary = {}
var team_idx := 0
var slot := 0
var velocity := Vector3.ZERO   # ft/s
var target := Vector3.ZERO     # ft, on the floor
var face_target := Vector3.INF # ft; INF = face movement direction
var sprinting := false
var manual_input := Vector3.ZERO   # set by the user-control code (unit, ft space)
var user_controlled := false

var height_ft := 6.5
var _legs: Array[Node3D] = []
var _arms: Array[Node3D] = []
var _body: Node3D
var _phase := 0.0
var _jump_t := -1.0
var _ring: MeshInstance3D


func setup(player: Dictionary, team: Dictionary, home_colors: bool) -> void:
	data = player
	height_ft = float(player.get("height_in", 78)) / 12.0
	var jersey := UIKit.team_color(team) if not home_colors else Color(0.96, 0.96, 0.95)
	var trim := UIKit.team_color(team, "secondary") if not home_colors else UIKit.team_color(team)
	# Neutral mannequin tone unless the roster sets one; appearance comes in Phase 2/6.
	var skin := DataDB.color(player.get("skin", "#A58D7A"))
	var k := height_ft / 6.5
	_body = Node3D.new()
	add_child(_body)
	var skin_m := MeshKit.mat(skin, 0.7)
	var jersey_m := MeshKit.mat(jersey, 0.8)
	var trim_m := MeshKit.mat(trim, 0.8)
	var shoe_m := MeshKit.mat(Color(0.1, 0.1, 0.1) if randf() < 0.5 else Color.WHITE, 0.5)
	var hip_y := 3.25 * k
	# Legs pivot at the hip.
	for side in [-1, 1]:
		var pivot := Node3D.new()
		pivot.position = Vector3(side * 0.45 * k, hip_y, 0) * FT
		_body.add_child(pivot)
		_capsule(pivot, 0.27 * k, hip_y * 0.98, Vector3(0, -hip_y / 2.0, 0), skin_m)
		_capsule(pivot, 0.36 * k, 1.35 * k, Vector3(0, -0.55 * k, 0), trim_m)   # shorts leg
		MeshKit.box(pivot, Vector3(0.42, 0.35, 1.0) * k * FT, Vector3(0, -hip_y + 0.17 * k, -0.2 * k) * FT, shoe_m)
		_legs.append(pivot)
	# Torso (jersey) and shorts waist.
	_capsule(_body, 0.78 * k, 2.4 * k, Vector3(0, hip_y + 1.05 * k, 0), jersey_m, Vector3(1.15, 1.0, 0.75))
	_capsule(_body, 0.82 * k, 0.9 * k, Vector3(0, hip_y + 0.05 * k, 0), trim_m, Vector3(1.1, 1.0, 0.8))
	# Arms pivot at the shoulder.
	var shoulder_y := hip_y + 2.05 * k
	for side in [-1, 1]:
		var pivot := Node3D.new()
		pivot.position = Vector3(side * 0.98 * k, shoulder_y, 0) * FT
		_body.add_child(pivot)
		_capsule(pivot, 0.2 * k, 2.6 * k, Vector3(0, -1.25 * k, 0), skin_m)
		_arms.append(pivot)
	# Neck and head.
	_capsule(_body, 0.2 * k, 0.5 * k, Vector3(0, shoulder_y + 0.25 * k, 0), skin_m)
	var head := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.42 * k * FT
	sm.height = 0.95 * k * FT
	sm.radial_segments = 12
	sm.rings = 6
	head.mesh = sm
	head.material_override = skin_m
	head.position = Vector3(0, shoulder_y + 0.85 * k, 0) * FT
	_body.add_child(head)
	# Numbers front and back.
	var num := _jersey(player)
	for back in [false, true]:
		var b := Basis.IDENTITY if back else Basis(Vector3.UP, PI)   # front faces -Z
		MeshKit.label3d(_body, num, 96, 0.0042 * k, trim, Vector3(0, hip_y + 1.25 * k, (0.45 if back else -0.45) * k) * FT, b)
	# Selection ring for the user-controlled player.
	_ring = MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 1.3 * FT
	tm.outer_radius = 1.45 * FT
	tm.rings = 24
	tm.ring_segments = 4
	_ring.mesh = tm
	_ring.scale = Vector3(1, 0.05, 1)
	_ring.position.y = 0.02
	_ring.material_override = MeshKit.emissive(Color(0.2, 0.75, 1.0), 2.0)
	_ring.visible = false
	add_child(_ring)
	for child in find_children("*", "VisualInstance3D", true, false):
		(child as VisualInstance3D).layers = 4


## Jersey numbers are strings so "0" and "00" stay different.
static func _jersey(player: Dictionary) -> String:
	var n: Variant = player.get("number", "0")
	return str(int(n)) if n is float else str(n)


func _capsule(parent: Node3D, radius: float, length: float, pos: Vector3, m: Material, scale_v := Vector3.ONE) -> MeshInstance3D:
	var c := CapsuleMesh.new()
	c.radius = radius * FT
	c.height = maxf(length, radius * 2.0) * FT
	c.radial_segments = 10
	c.rings = 2
	var mi := MeshInstance3D.new()
	mi.mesh = c
	mi.material_override = m
	mi.position = pos * FT
	mi.scale = scale_v
	parent.add_child(mi)
	return mi


func pos_ft() -> Vector3:
	var p := global_position / FT
	p.y = 0.0
	return p


func set_pos_ft(p: Vector3) -> void:
	global_position = Vector3(p.x, 0.0, p.z) * FT


func set_user(on: bool) -> void:
	user_controlled = on
	_ring.visible = on


func hand_position() -> Vector3:
	var fwd := -global_basis.z
	var right := global_basis.x
	return global_position + (fwd * 0.9 + right * 1.0) * FT + Vector3(0, 3.1 * height_ft / 6.5, 0) * FT


func jump() -> void:
	_jump_t = 0.0


func step(delta: float) -> void:
	var p := pos_ft()
	var desired := Vector3.ZERO
	var max_speed := SPRINT_SPEED if sprinting else JOG_SPEED
	if user_controlled:
		desired = manual_input * max_speed
	else:
		var to := target - p
		to.y = 0.0
		var d := to.length()
		if d > 0.4:
			# Ease into the spot instead of overshooting.
			desired = to / d * minf(max_speed, d * 2.2)
	# Momentum: velocity can only change at ACCEL, no instant turns.
	var dv := desired - velocity
	var max_dv := ACCEL * delta
	if dv.length() > max_dv:
		dv = dv.normalized() * max_dv
	velocity += dv
	p += velocity * delta
	p.x = clampf(p.x, -CourtSpec.HALF_LENGTH - 3.0, CourtSpec.HALF_LENGTH + 3.0)
	p.z = clampf(p.z, -CourtSpec.HALF_WIDTH - 3.0, CourtSpec.HALF_WIDTH + 3.0)
	set_pos_ft(p)
	# Facing
	var look_dir := velocity
	if face_target != Vector3.INF:
		look_dir = face_target - p
	look_dir.y = 0.0
	if look_dir.length() > 0.5:
		var want := atan2(-look_dir.x, -look_dir.z)   # -Z is forward
		rotation.y = rotate_toward(rotation.y, want, TURN_RATE * delta)
	# Procedural run cycle.
	var speed := velocity.length()
	_phase += delta * (4.0 + speed * 0.55)
	var swing := clampf(speed / SPRINT_SPEED, 0.0, 1.0) * 0.75
	for i in _legs.size():
		_legs[i].rotation.x = sin(_phase + PI * i) * swing
	for i in _arms.size():
		_arms[i].rotation.x = -sin(_phase + PI * i) * swing * 0.8
	_body.position.y = absf(sin(_phase)) * 0.12 * swing * FT
	if _jump_t >= 0.0:
		_jump_t += delta
		var jt := _jump_t / 0.7
		_body.position.y += 4.0 * jt * (1.0 - jt) * 2.6 * FT
		for a in _arms:
			a.rotation.x = 2.7
		if jt >= 1.0:
			_jump_t = -1.0
