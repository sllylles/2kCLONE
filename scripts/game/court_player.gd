class_name CourtPlayer
extends Node3D
## A player on the court: momentum-based movement (positions in feet, like
## the rest of the sim) driving an animated PlayerAvatar.

const FT := CourtSpec.FT
const JOG_SPEED := 12.0        # ft/s
const SPRINT_SPEED := 20.0
const ACCEL := 30.0            # ft/s²
const TURN_RATE := 9.0         # rad/s
## Actions that pin the player in place (shots keep a little drift).
const ROOTED := ["jumpshot", "floater", "dunk", "rebound", "block", "contest", "chest_pass", "bounce_pass",
	"catch", "celebrate", "bump_l", "bump_r", "bump_front", "stepback", "hesitation", "steal"]

var data: Dictionary = {}
var team_idx := 0
var slot := 0
var velocity := Vector3.ZERO   # ft/s
var target := Vector3.ZERO     # ft, on the floor
var face_target := Vector3.INF # ft; INF = face movement direction
var sprinting := false
var manual_input := Vector3.ZERO   # set by the user-control code (unit, ft space)
var user_controlled := false
var defending := false
var has_ball := false
## Extra travel for moves like stepbacks and layups (ft/s, decays).
var push := Vector3.ZERO
## 1 = fresh, 0 = exhausted. Affects speed and the shot meter window.
var stamina := 1.0

var avatar: PlayerAvatar
var anim: AvatarAnimator
var _ring: MeshInstance3D


func setup(player: Dictionary, team: Dictionary, home_colors: bool) -> void:
	data = player
	avatar = PlayerAvatar.new()
	add_child(avatar)
	avatar.apply(player, team, home_colors)
	anim = AvatarAnimator.new(avatar)
	avatar.add_child(anim)
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
	_ring.layers = 4
	_ring.visible = false
	add_child(_ring)


func pos_ft() -> Vector3:
	var p := global_position / FT
	p.y = 0.0
	return p


func set_pos_ft(p: Vector3) -> void:
	global_position = Vector3(p.x, 0.0, p.z) * FT


func set_user(on: bool) -> void:
	user_controlled = on
	_ring.visible = on


func height_ft() -> float:
	return avatar.height_m / FT


## Where the ball sits while this player controls it.
func hand_position() -> Vector3:
	return anim.ball_anchor()


## Snap to face a court point (feet) before an action.
func look_at_now(point_ft: Vector3) -> void:
	var d := point_ft - pos_ft()
	if d.length() > 0.5:
		rotation.y = atan2(-d.x, -d.z)


func play(clip: String) -> bool:
	return anim.play_action(clip)


func busy() -> bool:
	return anim.is_busy()


## 0..1; 1 = fresh.
func fatigue() -> float:
	return 1.0 - stamina


func _speed_rating() -> float:
	return float(data.get("ratings", {}).get("speed", 75))


func step(delta: float) -> void:
	var p := pos_ft()
	var desired := Vector3.ZERO
	# Faster players run faster; tired players run slower.
	var pace := lerpf(0.9, 1.08, clampf((_speed_rating() - 50.0) / 49.0, 0.0, 1.0)) * lerpf(0.8, 1.0, stamina)
	var max_speed := (SPRINT_SPEED if sprinting and stamina > 0.05 else JOG_SPEED) * pace
	if user_controlled:
		desired = manual_input * max_speed
	else:
		var to := target - p
		to.y = 0.0
		var d := to.length()
		if d > 0.4:
			# Ease into the spot instead of overshooting.
			desired = to / d * minf(max_speed, d * 2.2)
	if anim.action in ROOTED:
		desired *= 0.15
	# At speed you can't turn on a dime: limit how fast the heading changes.
	var speed := velocity.length()
	if speed > JOG_SPEED * 0.85 and desired.length() > 1.0:
		var turn_rate := lerpf(5.0, 2.2, clampf((speed - JOG_SPEED) / (SPRINT_SPEED - JOG_SPEED), 0.0, 1.0))
		var cur := atan2(velocity.x, velocity.z)
		var want := atan2(desired.x, desired.z)
		var heading := rotate_toward(cur, want, turn_rate * delta)
		var keep := desired.length() * cos(clampf(angle_difference(heading, want), -PI / 2, PI / 2))
		desired = Vector3(sin(heading), 0, cos(heading)) * maxf(keep, desired.length() * 0.4)
	# Momentum: velocity can only change at ACCEL, no instant turns.
	var dv := desired - velocity
	var max_dv := ACCEL * delta
	if dv.length() > max_dv:
		dv = dv.normalized() * max_dv
	velocity += dv
	p += (velocity + push) * delta
	push = push.move_toward(Vector3.ZERO, 30.0 * delta)
	p.x = clampf(p.x, -CourtSpec.HALF_LENGTH - 3.0, CourtSpec.HALF_LENGTH + 3.0)
	p.z = clampf(p.z, -CourtSpec.HALF_WIDTH - 3.0, CourtSpec.HALF_WIDTH + 3.0)
	set_pos_ft(p)
	# Facing
	var look_dir := velocity
	if face_target != Vector3.INF:
		look_dir = face_target - p
	look_dir.y = 0.0
	if look_dir.length() > 0.5 and not anim.action.begins_with("spin"):
		var want := atan2(-look_dir.x, -look_dir.z)   # -Z is forward
		rotation.y = rotate_toward(rotation.y, want, TURN_RATE * delta)
	# Stamina: sprinting drains it, standing around gives it back.
	var spd := velocity.length()
	if spd > JOG_SPEED * 1.1:
		stamina -= 0.065 * delta
	elif spd > 4.0:
		stamina -= 0.012 * delta
	else:
		stamina += 0.05 * delta
	stamina = clampf(stamina, 0.0, 1.0)
	if _ring.visible:
		(_ring.material_override as StandardMaterial3D).albedo_color = \
			Color(0.2, 0.75, 1.0).lerp(Color(1.0, 0.25, 0.15), fatigue()) * 2.0
	anim.velocity = velocity * FT
	anim.defending = defending
	anim.has_ball = has_ball
