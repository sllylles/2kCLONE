class_name AvatarAnimator
extends Node
## Drives one PlayerAvatar: an AnimationTree with locomotion blend spaces
## (offense and defense), an upper-body dribble layer and one-shot actions,
## plus the ball anchor (where the ball should be this frame) and IK for
## planted feet and ball-catching hands.
##
## Game code sets `velocity` (m/s, world), `defending`, `has_ball`, and calls
## play_action(). It reads ball_anchor() and polls action events.

signal action_event(clip: String, event: String)
signal action_finished(clip: String)

const UPPER_BODY := ["spine_03", "clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r", "lowerarm_l",
	"lowerarm_r", "hand_l", "hand_r"]
const FINGER_PREFIXES := ["index", "middle", "ring", "pinky", "thumb"]
const JOG_SPEED := 3.6      # m/s that the jog cycle was authored for
const SPRINT_SPEED := 6.4
const BALL_R := CourtSpec.BALL_RADIUS * CourtSpec.FT

var avatar: PlayerAvatar
var tree: AnimationTree
var player: AnimationPlayer
var velocity := Vector3.ZERO
var defending := false
var has_ball := false
var dribble_hand := "r"
var action := ""                 # current one-shot clip, "" if none
var action_time := 0.0

var _dribble_clip := "dribble_r"
var _dribble_t := 0.0
var _events_fired := {}
var _move_ball := {}            # ball path during dribble moves
var _feet_ik: TwoBoneIK3D
var _hands_ik: TwoBoneIK3D
var _foot_targets: Array[Node3D] = []
var _hand_targets: Array[Node3D] = []
var _planted := 0.0
var _catch_target := Vector3.INF


func _init(target: PlayerAvatar) -> void:
	avatar = target
	name = "Animator"


func _ready() -> void:
	player = AnimationPlayer.new()
	player.name = "AnimPlayer"
	avatar.model.add_child(player)
	player.add_animation_library("", AnimLibrary.library(avatar.skeleton))
	tree = AnimationTree.new()
	tree.name = "AnimTree"
	avatar.model.add_child(tree)
	tree.anim_player = tree.get_path_to(player)
	tree.tree_root = _build_tree()
	tree.active = true
	_setup_ik()


func _anim(clip: String) -> AnimationNodeAnimation:
	var a := AnimationNodeAnimation.new()
	a.animation = clip
	return a


func _build_tree() -> AnimationNodeBlendTree:
	var bt := AnimationNodeBlendTree.new()
	var loco := AnimationNodeBlendSpace2D.new()
	loco.min_space = Vector2(-1.5, -1.5)
	loco.max_space = Vector2(1.5, 2.2)
	loco.sync = true
	for p in [["idle_athletic", Vector2.ZERO], ["jog", Vector2(0, 1)], ["sprint", Vector2(0, 2)],
			["strafe_l", Vector2(-1, 0)], ["strafe_r", Vector2(1, 0)], ["backpedal", Vector2(0, -1)]]:
		loco.add_blend_point(_anim(p[0]), p[1])
	var dloco := AnimationNodeBlendSpace2D.new()
	dloco.min_space = Vector2(-1.5, -1.5)
	dloco.max_space = Vector2(1.5, 2.2)
	dloco.sync = true
	for p in [["def_idle", Vector2.ZERO], ["def_slide_l", Vector2(-1, 0)], ["def_slide_r", Vector2(1, 0)],
			["def_back", Vector2(0, -1)], ["jog", Vector2(0, 1)], ["sprint", Vector2(0, 2)]]:
		dloco.add_blend_point(_anim(p[0]), p[1])
	bt.add_node("loco", loco, Vector2(0, 0))
	bt.add_node("dloco", dloco, Vector2(0, 200))
	bt.add_node("loco_ts", AnimationNodeTimeScale.new(), Vector2(200, 0))
	bt.add_node("dloco_ts", AnimationNodeTimeScale.new(), Vector2(200, 200))
	bt.connect_node("loco_ts", 0, "loco")
	bt.connect_node("dloco_ts", 0, "dloco")
	bt.add_node("stance", AnimationNodeBlend2.new(), Vector2(400, 100))
	bt.connect_node("stance", 0, "loco_ts")
	bt.connect_node("stance", 1, "dloco_ts")
	# Upper-body dribble layer, phase-locked to the ball through a seek node.
	bt.add_node("dribble", _anim("dribble_r"), Vector2(200, 400))
	bt.add_node("dribble_seek", AnimationNodeTimeSeek.new(), Vector2(400, 400))
	bt.connect_node("dribble_seek", 0, "dribble")
	var hold := AnimationNodeBlend2.new()
	hold.filter_enabled = true
	for b in _upper_body_paths():
		hold.set_filter_path(b, true)
	bt.add_node("hold", hold, Vector2(600, 200))
	bt.connect_node("hold", 0, "stance")
	bt.connect_node("hold", 1, "dribble_seek")
	# Full-body one-shots.
	var oneshot := AnimationNodeOneShot.new()
	oneshot.fadein_time = 0.08
	oneshot.fadeout_time = 0.18
	bt.add_node("action", oneshot, Vector2(800, 200))
	bt.add_node("action_anim", _anim("jumpshot"), Vector2(600, 400))
	bt.connect_node("action", 0, "hold")
	bt.connect_node("action", 1, "action_anim")
	bt.connect_node("output", 0, "action")
	return bt


func _upper_body_paths() -> Array[NodePath]:
	var out: Array[NodePath] = []
	var sk := avatar.skeleton
	for i in sk.get_bone_count():
		var n := sk.get_bone_name(i)
		if n in UPPER_BODY or FINGER_PREFIXES.any(func(f): return n.begins_with(f)):
			out.append(NodePath("%s:%s" % [AnimLibrary.SKELETON_PATH, n]))
	return out


# --- IK -------------------------------------------------------------------------------

func _setup_ik() -> void:
	_feet_ik = TwoBoneIK3D.new()
	_feet_ik.name = "FeetIK"
	_hands_ik = TwoBoneIK3D.new()
	_hands_ik.name = "HandsIK"
	avatar.skeleton.add_child(_feet_ik)
	avatar.skeleton.add_child(_hands_ik)
	_feet_ik.set_setting_count(2)
	_hands_ik.set_setting_count(2)
	var i := 0
	for side in ["l", "r"]:
		var ft := Node3D.new()
		var fp := Node3D.new()
		avatar.add_child(ft)
		avatar.add_child(fp)
		_foot_targets.append(ft)
		_feet_ik.set_root_bone_name(i, "thigh_" + side)
		_feet_ik.set_middle_bone_name(i, "calf_" + side)
		_feet_ik.set_end_bone_name(i, "foot_" + side)
		_feet_ik.set_target_node(i, _feet_ik.get_path_to(ft))
		_feet_ik.set_pole_node(i, _feet_ik.get_path_to(fp))
		fp.set_meta("pole_for", side)
		var ht := Node3D.new()
		var hp := Node3D.new()
		avatar.add_child(ht)
		avatar.add_child(hp)
		_hand_targets.append(ht)
		_hands_ik.set_root_bone_name(i, "upperarm_" + side)
		_hands_ik.set_middle_bone_name(i, "lowerarm_" + side)
		_hands_ik.set_end_bone_name(i, "hand_" + side)
		_hands_ik.set_target_node(i, _hands_ik.get_path_to(ht))
		_hands_ik.set_pole_node(i, _hands_ik.get_path_to(hp))
		hp.set_meta("pole_for", side)
		i += 1
	_feet_ik.influence = 0.0
	_hands_ik.influence = 0.0


## Feet lock to the floor while the player stands; hands reach for an
## incoming ball during a catch.
func _update_ik(delta: float) -> void:
	var still := velocity.length() < 0.35 and action == "" and absf(_hips_air()) < 0.02
	var want := 1.0 if still else 0.0
	if want > 0.5 and _planted < 0.05:
		# Just stopped: plant the feet where they are now.
		for i in 2:
			var p := avatar.bone_global("foot_" + ["l", "r"][i])
			p.y = maxf(p.y, 0.09 * avatar.scale.x)
			_foot_targets[i].global_position = p
	_planted = move_toward(_planted, want, delta * 6.0)
	_feet_ik.influence = _planted * 0.85
	var fwd := -avatar.global_basis.z
	for i in 2:
		var side: String = ["l", "r"][i]
		var knee := avatar.bone_global("calf_" + side)
		(_feet_ik.get_node(_feet_ik.get_pole_node(i)) as Node3D).global_position = knee + fwd * 0.5
		var elbow := avatar.bone_global("lowerarm_" + side)
		(_hands_ik.get_node(_hands_ik.get_pole_node(i)) as Node3D).global_position = elbow - fwd * 0.4 \
			+ avatar.global_basis.x * (0.4 if side == "r" else -0.4)
	if _catch_target != Vector3.INF:
		for i in 2:
			var off := avatar.global_basis.x * (0.11 if i == 1 else -0.11)
			_hand_targets[i].global_position = _catch_target + off
		_hands_ik.influence = move_toward(_hands_ik.influence, 0.8, delta * 8.0)
	else:
		_hands_ik.influence = move_toward(_hands_ik.influence, 0.0, delta * 6.0)


## Lets game code pull both hands toward a ball (catches). INF clears it.
func reach_for(point: Vector3) -> void:
	_catch_target = point


func _hips_air() -> float:
	return 0.0 if action == "" else maxf(0.0, avatar.bone_global("pelvis").y / avatar.scale.x - 1.38)


# --- Per-frame update ---------------------------------------------------------------------

func _process(delta: float) -> void:
	var s := maxf(0.5, avatar.scale.x)
	var local := avatar.global_basis.inverse() * velocity / s
	var v := Vector2(local.x, -local.z)
	var speed := v.length()
	var blend := Vector2.ZERO
	if speed > 0.05:
		var forward := v.y
		var strafe := v.x
		var fwd_amt := forward / JOG_SPEED if forward < JOG_SPEED else 1.0 + (forward - JOG_SPEED) / (SPRINT_SPEED - JOG_SPEED)
		blend = Vector2(clampf(strafe / 2.4, -1.0, 1.0), clampf(fwd_amt, -1.0, 2.0))
	tree.set("parameters/loco/blend_position", blend)
	tree.set("parameters/dloco/blend_position", blend)
	var ts := clampf(maxf(speed / JOG_SPEED, 0.75), 0.75, 1.6) if speed > 0.3 else 1.0
	tree.set("parameters/loco_ts/scale", ts)
	tree.set("parameters/dloco_ts/scale", ts)
	tree.set("parameters/stance/blend_amount", move_toward(float(tree.get("parameters/stance/blend_amount")),
		1.0 if defending else 0.0, delta * 4.0))
	# Dribble layer
	var dribbling := has_ball and action == ""
	var want_clip := ("dribble_run_" if speed > 2.2 else "dribble_") + dribble_hand
	if want_clip != _dribble_clip:
		var node := (tree.tree_root as AnimationNodeBlendTree).get_node("dribble") as AnimationNodeAnimation
		node.animation = want_clip
		_dribble_t = fmod(_dribble_t / AnimLibrary.clip(_dribble_clip).get("length", 0.5) \
			* AnimLibrary.clip(want_clip).get("length", 0.5), AnimLibrary.clip(want_clip).get("length", 0.5))
		_dribble_clip = want_clip
	var dlen := float(AnimLibrary.clip(_dribble_clip).get("length", 0.5))
	_dribble_t = fmod(_dribble_t + delta, dlen)
	tree.set("parameters/dribble_seek/seek_request", _dribble_t)
	tree.set("parameters/hold/blend_amount", move_toward(float(tree.get("parameters/hold/blend_amount")),
		1.0 if dribbling else 0.0, delta * 8.0))
	# Action events
	if action != "":
		action_time += delta
		var c := AnimLibrary.clip(action)
		for ev in c.get("events", {}):
			var t: Variant = c.events[ev]
			if (t is float or t is int) and not _events_fired.has(ev) and action_time >= float(t):
				_events_fired[ev] = true
				_on_event(ev, c)
				action_event.emit(action, ev)
		if action_time >= float(c.get("length", 1.0)):
			var done := action
			action = ""
			_move_ball = {}
			action_finished.emit(done)
	_update_ik(delta)


func play_action(clip: String) -> bool:
	if AnimLibrary.clip(clip).is_empty():
		push_warning("AvatarAnimator: no clip %s" % clip)
		return false
	var node := (tree.tree_root as AnimationNodeBlendTree).get_node("action_anim") as AnimationNodeAnimation
	node.animation = clip
	tree.set("parameters/action/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)
	action = clip
	action_time = 0.0
	_events_fired = {}
	_move_ball = {}
	var ev: Dictionary = AnimLibrary.clip(clip).get("events", {})
	if ev.has("bounce") and ev.has("to_hand"):
		_move_ball = {"from": ball_anchor(), "bounce": float(ev.bounce), "catch": float(ev.get("catch", ev.bounce + 0.2)),
			"at": ev.get("bounce_at", [0, 0, -0.3]), "to": str(ev.to_hand)}
	return true


func _on_event(ev: String, c: Dictionary) -> void:
	if ev == "catch" and _move_ball.has("to"):
		dribble_hand = _move_ball.to
		_dribble_t = 0.0
	if ev == "bounce" and not c.get("events", {}).has("to_hand") and c.get("events", {}).has("hold"):
		_dribble_t = 0.0


func is_busy() -> bool:
	return action != ""


# --- Ball anchor ------------------------------------------------------------------------

## Where the ball should be this frame while this player controls it.
func ball_anchor() -> Vector3:
	var ev: Dictionary = AnimLibrary.clip(action).get("events", {}) if action != "" else {}
	if action != "":
		if not _move_ball.is_empty():
			return _move_ball_point()
		var hand: String = ev.get("hand", dribble_hand)
		var hold: Array = ev.get("hold", [])
		var released := ev.has("release") and action_time >= float(ev.release)
		if released:
			return _palm("r")
		if hand == "both" or ev.has("gather") or ev.has("release") or ev.has("grab"):
			if ev.has("grab") and action_time < float(ev.grab):
				return _dribble_point()
			return _two_hand_point()
		if not hold.is_empty() and action_time >= float(hold[0]) and action_time <= float(hold[1]):
			return _palm(hand)
	if not has_ball:
		return _palm(dribble_hand)
	return _dribble_point()


func _palm(side: String) -> Vector3:
	var h := avatar.bone_global("hand_" + side)
	var m := avatar.bone_global("middle_01_" + side)
	var down := Vector3.DOWN * BALL_R * 0.9
	return h.lerp(m, 0.6) + down


func _two_hand_point() -> Vector3:
	var a := avatar.bone_global("middle_01_l")
	var b := avatar.bone_global("middle_01_r")
	return (a + b) * 0.5 - avatar.global_basis.z * 0.04


## Ball between hand and floor, phase-locked to the dribble animation.
func _dribble_point() -> Vector3:
	var c := AnimLibrary.clip(_dribble_clip)
	var length := float(c.get("length", 0.5))
	var bounce := float(c.get("events", {}).get("bounce", length * 0.5))
	var palm := _palm(dribble_hand)
	var floor_pt := palm - avatar.global_basis.z * 0.05
	floor_pt.y = BALL_R
	var t := _dribble_t
	var y: float
	if t < bounce:
		var u := t / bounce
		y = lerpf(palm.y, BALL_R, u * u)                 # accelerating down
	else:
		var u := (t - bounce) / maxf(0.01, length - bounce)
		y = lerpf(BALL_R, palm.y, 1.0 - (1.0 - u) * (1.0 - u))   # slowing on the way up
	var p := palm.lerp(floor_pt, 0.5)
	p.y = y
	return p


func _move_ball_point() -> Vector3:
	var m := _move_ball
	var at: Array = m.at
	var floor_pt: Vector3 = avatar.global_transform * (Vector3(float(at[0]), 0, float(at[2])) / avatar.scale.x)
	floor_pt.y = BALL_R
	if action_time < m.bounce:
		var u: float = action_time / m.bounce
		var from: Vector3 = _palm("l" if m.to == "r" else "r")
		var p := from.lerp(floor_pt, u)
		p.y = lerpf(from.y, BALL_R, u * u)
		return p
	var u2: float = clampf((action_time - m.bounce) / maxf(0.01, m.catch - m.bounce), 0.0, 1.0)
	var to: Vector3 = _palm(m.to)
	var q := floor_pt.lerp(to, u2)
	q.y = lerpf(BALL_R, to.y, 1.0 - (1.0 - u2) * (1.0 - u2))
	return q
