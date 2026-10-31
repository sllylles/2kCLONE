class_name AnimLibrary
extends RefCounted
## Builds Godot Animations from the hand-authored JSON clips in data/animations.
##
## Poses use joint terms instead of raw quaternions, so clips stay readable
## and editable. All angles are degrees in the character's frame (character
## faces -Z, +X is its right, +Y up):
##   spine_*, pelvis, neck_01, head: bend (+ forward), twist (+ turn left), side (+ lean right)
##   upperarm_*, thigh_*:            fwd (+ raise forward), side (+ raise outward), twist (+ turn out)
##                                   upperarm side 0 = arms hanging at the sides, 90 = T-pose
##   clavicle_*:                     up (+ shrug), fwd (+ forward)
##   lowerarm_*, calf_*:             bend (+ flex elbow / knee; 0 = straight)
##   hand_*, foot_*:                 bend (+ wrist back / toes up), side, twist
##   fingers (index/middle/ring/pinky/thumb _01.._03): curl (+ close)
##   "hips": [x, y, z] offset in meters (y < 0 crouches), "turn": whole-body yaw (+ left)
## Left/right mirror automatically: "fwd 40" on upperarm_l and upperarm_r both
## raise the arm forward.
##
## Named poses live under "poses"; a key can start from one with {"pose": "name"}
## or from its left/right mirror with {"mirror": "name"}, then override joints.
## Clip JSON: {"length": s, "loop": bool, "base": "pose", "keys": [[t, {pose}], ...],
##             "events": {"release": t, ...}, "mirror_of": "clip"}

const SKELETON_PATH := "Armature/Skeleton3D"
const FINGERS := ["index", "middle", "ring", "pinky", "thumb"]
const REST_ARM_SIDE := 41.0     # degrees the model's arms are raised in its rest A-pose
const REST_ELBOW_BEND := 46.0   # degrees the rest forearm is already flexed

static var _cache: AnimationLibrary
static var _clips := {}         # name -> clip dictionary (after mirroring/merging)
static var _poses := {}


## Build (once) the AnimationLibrary for a skeleton from the shared model.
static func library(skeleton: Skeleton3D) -> AnimationLibrary:
	if _cache:
		return _cache
	_load_json()
	var lib := AnimationLibrary.new()
	var ctx := _context(skeleton)
	for name in _clips:
		lib.add_animation(name, _build(_clips[name], ctx))
	_cache = lib
	return lib


static func clip(name: String) -> Dictionary:
	_load_json()
	return _clips.get(name, {})


static func clip_names() -> Array:
	_load_json()
	return _clips.keys()


static func event_time(name: String, event: String, fallback := -1.0) -> float:
	return float(clip(name).get("events", {}).get(event, fallback))


static func _load_json() -> void:
	if not _clips.is_empty():
		return
	var dir := DirAccess.open("res://data/animations")
	if dir == null:
		push_error("AnimLibrary: data/animations missing")
		return
	var raw := {}
	for f in dir.get_files():
		if not f.ends_with(".json"):
			continue
		var d := DataDB.load_json("animations/" + f.get_basename())
		_poses.merge(d.get("poses", {}), true)
		raw.merge(d.get("clips", {}), true)
	for name in raw:
		var c: Dictionary = raw[name]
		if c.has("mirror_of"):
			var src: Dictionary = raw[c.mirror_of].duplicate(true)
			src.erase("mirror_of")
			src["keys"] = src.keys.map(func(k): return [k[0], mirror_pose(_resolve(src, k[1]))])
			src.erase("base")
			src.merge(c, true)
			src.erase("mirror_of")
			_clips[name] = src
		else:
			_clips[name] = c


## Expands "base" and "pose" references into a full pose dictionary.
static func _resolve(c: Dictionary, pose: Dictionary) -> Dictionary:
	var out := {}
	var base_name: String = pose.get("pose", c.get("base", ""))
	if pose.has("mirror"):
		out = mirror_pose(_resolve(c, _poses.get(pose.mirror, {})))
	elif base_name != "":
		out = _resolve({}, _poses.get(base_name, {})) if _poses.get(base_name, {}).has("pose") else _deep(_poses.get(base_name, {}))
	for k in pose:
		if k == "pose" or k == "mirror":
			continue
		if pose[k] is Dictionary and out.get(k) is Dictionary:
			var merged: Dictionary = out[k].duplicate()
			merged.merge(pose[k], true)
			out[k] = merged
		else:
			out[k] = pose[k]
	return out


static func _deep(d: Dictionary) -> Dictionary:
	return d.duplicate(true)


static func mirror_pose(pose: Dictionary) -> Dictionary:
	var out := {}
	for k in pose:
		var v: Variant = pose[k]
		var nk: String = k
		if k.ends_with("_l"):
			nk = k.trim_suffix("_l") + "_r"
		elif k.ends_with("_r"):
			nk = k.trim_suffix("_r") + "_l"
		if k == "hips":
			out[nk] = [-float(v[0]), v[1], v[2]]
		elif k == "turn":
			out[nk] = -float(v)
		elif v is Dictionary and not (k.ends_with("_l") or k.ends_with("_r")):
			# central bones: mirror twist and side lean
			var m: Dictionary = v.duplicate()
			for axis in ["twist", "side"]:
				if m.has(axis):
					m[axis] = -float(m[axis])
			out[nk] = m
		else:
			out[nk] = v
	return out


# --- Pose -> bone rotations --------------------------------------------------------

static func _context(sk: Skeleton3D) -> Dictionary:
	# Skeleton space faces +Z; character space faces -Z (model rotated 180°).
	var m := Basis(Vector3.UP, PI)
	var ctx := {"sk": sk, "m": m, "mi": m.inverse(), "global": {}, "local": {}}
	for i in sk.get_bone_count():
		ctx.global[sk.get_bone_name(i)] = sk.get_bone_global_rest(i).basis.orthonormalized()
		ctx.local[sk.get_bone_name(i)] = sk.get_bone_rest(i)
	return ctx


static func _side_sign(bone: String) -> float:
	return -1.0 if bone.ends_with("_l") else 1.0


## Rotation in character space for one bone's joint terms.
static func _joint_rotation(bone: String, j: Dictionary, ctx: Dictionary) -> Basis:
	var s := _side_sign(bone)
	var r := Basis.IDENTITY
	var base := bone.trim_suffix("_l").trim_suffix("_r")
	var deg := func(key: String) -> float: return deg_to_rad(float(j.get(key, 0.0)))
	match base:
		"pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "Root":
			# lean right = top toward +X = rotation about +Z by a negative angle
			r = Basis(Vector3.BACK, -deg.call("side")) * Basis(Vector3.RIGHT, -deg.call("bend")) \
				* Basis(Vector3.UP, deg.call("twist"))
		"upperarm", "thigh":
			var axis := _bone_axis_char(bone, ctx)
			# The rest pose is an A-pose (arms 41° out); make "side 0" mean arms at the sides.
			var side: float = deg.call("side") - (deg_to_rad(REST_ARM_SIDE) if base == "upperarm" else 0.0)
			r = Basis(Vector3.RIGHT, deg.call("fwd")) * Basis(Vector3.BACK, s * side) \
				* Basis(axis, -s * deg.call("twist"))
		"clavicle":
			r = Basis(Vector3.BACK, s * deg.call("up")) * Basis(Vector3.UP, s * deg.call("fwd"))
		"lowerarm":
			# elbow hinge: perpendicular to the arm, roughly the character X axis
			# Hinge from the upper arm (the forearm's rest axis is already bent).
			var arm := _bone_axis_char(bone.replace("lowerarm", "upperarm"), ctx)
			var hinge := arm.cross(Vector3.FORWARD).normalized() if absf(arm.dot(Vector3.FORWARD)) < 0.95 else Vector3.RIGHT
			if hinge.dot(Vector3.RIGHT) < 0:
				hinge = -hinge
			# The rest forearm is already flexed 46°; "bend 0" means a straight arm.
			r = Basis(hinge, deg.call("bend") - deg_to_rad(REST_ELBOW_BEND)) \
				* Basis(_bone_axis_char(bone, ctx), -s * deg.call("twist"))
		"calf":
			r = Basis(Vector3.RIGHT, -deg.call("bend"))
		"hand":
			var ax := _bone_axis_char(bone, ctx)
			r = Basis(Vector3.RIGHT, -deg.call("bend")) * Basis(Vector3.BACK, s * deg.call("side")) \
				* Basis(ax, -s * deg.call("twist"))
		"foot", "ball":
			r = Basis(Vector3.RIGHT, deg.call("bend")) * Basis(Vector3.UP, s * deg.call("twist"))
		_:
			if base.begins_with("thumb") or FINGERS.any(func(f): return base.begins_with(f)):
				var ax := _bone_axis_char(bone, ctx)
				var curl_axis := ax.cross(Vector3.UP).normalized() if absf(ax.dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
				r = Basis(curl_axis, -s * deg.call("curl") * (1.0 if not base.begins_with("thumb") else 0.6))
	return r


static func _bone_axis_char(bone: String, ctx: Dictionary) -> Vector3:
	var g: Basis = ctx.global[bone]
	return (ctx.m * g.y).normalized()


## Local pose rotation for `bone` given its character-space rotation R:
## local = P^-1 * R_skel * P * L_rest   (P = parent global rest)
static func _local_rotation(bone: String, r_char: Basis, ctx: Dictionary) -> Quaternion:
	var sk: Skeleton3D = ctx.sk
	var idx := sk.find_bone(bone)
	var parent := sk.get_bone_parent(idx)
	var p: Basis = ctx.global[sk.get_bone_name(parent)] if parent >= 0 else Basis.IDENTITY
	var r_skel: Basis = ctx.mi * r_char * ctx.m
	var rest: Transform3D = ctx.local[bone]
	return (p.inverse() * r_skel * p * rest.basis.orthonormalized()).get_rotation_quaternion()


static func _expand(pose: Dictionary) -> Dictionary:
	# "fingers_l": {"curl": x} -> every finger joint on that hand
	var out := pose.duplicate()
	for side in ["l", "r"]:
		var key: String = "fingers_" + side
		if pose.has(key):
			out.erase(key)
			for f in FINGERS:
				for n in [1, 2, 3]:
					var b := "%s_%02d_%s" % [f, n, side]
					if not out.has(b):
						out[b] = pose[key]
	return out


static func _build(c: Dictionary, ctx: Dictionary) -> Animation:
	var anim := Animation.new()
	anim.length = float(c.get("length", 1.0))
	anim.loop_mode = Animation.LOOP_LINEAR if c.get("loop", false) else Animation.LOOP_NONE
	var sk: Skeleton3D = ctx.sk
	var keys: Array = c.get("keys", [])
	var poses: Array = []
	var bones := {}
	for k in keys:
		var p := _expand(_resolve(c, k[1]))
		poses.append([float(k[0]), p])
		for b in p:
			if sk.find_bone(b) >= 0:
				bones[b] = true
	# Every clip keys the main body bones so blends never inherit stale poses.
	for b in ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "clavicle_r",
			"upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r", "hand_l", "hand_r",
			"thigh_l", "thigh_r", "calf_l", "calf_r", "foot_l", "foot_r"]:
		bones[b] = true
	for b in bones:
		var t := anim.add_track(Animation.TYPE_ROTATION_3D)
		anim.track_set_path(t, NodePath("%s:%s" % [SKELETON_PATH, b]))
		anim.track_set_interpolation_type(t, Animation.INTERPOLATION_CUBIC)
		for pk in poses:
			var j: Dictionary = pk[1].get(b, {})
			var r := _joint_rotation(b, j, ctx)
			if b == "pelvis":
				r = Basis(Vector3.UP, deg_to_rad(float(pk[1].get("turn", 0.0)))) * r
			anim.rotation_track_insert_key(t, pk[0], _local_rotation(b, r, ctx))
	# Hips offset (crouch, jump, shifts) as a pelvis position track.
	var pt := anim.add_track(Animation.TYPE_POSITION_3D)
	anim.track_set_path(pt, NodePath("%s:pelvis" % SKELETON_PATH))
	anim.track_set_interpolation_type(pt, Animation.INTERPOLATION_CUBIC)
	var pelvis := sk.find_bone("pelvis")
	var root_basis: Basis = ctx.global[sk.get_bone_name(sk.get_bone_parent(pelvis))]
	var rest_origin: Vector3 = (ctx.local["pelvis"] as Transform3D).origin
	for pk in poses:
		var h: Array = pk[1].get("hips", [0, 0, 0])
		var off_skel: Vector3 = ctx.mi * Vector3(float(h[0]), float(h[1]), float(h[2]))
		anim.position_track_insert_key(pt, pk[0], rest_origin + root_basis.inverse() * off_skel)
	return anim
