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
	if anim.action in ROOTED:
		desired *= 0.15
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
	anim.velocity = velocity * FT
	anim.defending = defending
	anim.has_ball = has_ball
