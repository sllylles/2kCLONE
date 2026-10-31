extends GutTest
## Animation data and joint conventions.

const USED_BY_GAME := ["idle_athletic", "jog", "sprint", "strafe_l", "strafe_r", "backpedal", "def_idle",
	"def_slide_l", "def_slide_r", "def_back", "dribble_r", "dribble_l", "dribble_run_r", "dribble_run_l",
	"jumpshot", "layup", "floater", "dunk", "chest_pass", "bounce_pass", "catch", "rebound", "block",
	"contest", "steal", "bump_l", "bump_r", "bump_front", "celebrate", "crossover_rl", "crossover_lr",
	"between_legs_rl", "between_legs_lr", "behind_back_rl", "behind_back_lr", "spin_r", "spin_l",
	"hesitation", "stepback", "triple_threat", "free_throw", "set_screen"]

var avatar: PlayerAvatar


func before_all() -> void:
	avatar = PlayerAvatar.new()
	add_child(avatar)


func after_all() -> void:
	avatar.free()


func test_every_clip_the_game_uses_exists() -> void:
	for c in USED_BY_GAME:
		assert_false(AnimLibrary.clip(c).is_empty(), "missing clip " + c)


func test_clips_build_and_events_fit() -> void:
	var lib := AnimLibrary.library(avatar.skeleton)
	for name in AnimLibrary.clip_names():
		var a := lib.get_animation(name)
		assert_not_null(a, name)
		assert_gt(a.length, 0.0, name)
		assert_gt(a.get_track_count(), 10, name)
		for ev in AnimLibrary.clip(name).get("events", {}):
			var t: Variant = AnimLibrary.clip(name).events[ev]
			if t is float or t is int:
				assert_between(float(t), 0.0, a.length, "%s event %s" % [name, ev])


func test_mirror_swaps_sides() -> void:
	var m := AnimLibrary.mirror_pose({"upperarm_r": {"fwd": 40}, "spine_01": {"twist": 10, "bend": 5},
		"hips": [0.1, -0.2, 0], "turn": 30})
	assert_eq(m.upperarm_l.fwd, 40)
	assert_false(m.has("upperarm_r"))
	assert_eq(float(m.spine_01.twist), -10.0)
	assert_eq(m.spine_01.bend, 5)
	assert_eq(float(m.hips[0]), -0.1)
	assert_eq(float(m.turn), -30.0)


func _dir(a: String, b: String) -> Vector3:
	var inv := avatar.global_transform.affine_inverse()
	return ((inv * avatar.bone_global(b)) - (inv * avatar.bone_global(a))).normalized()


func test_joint_conventions() -> void:
	var ap := AnimationPlayer.new()
	avatar.model.add_child(ap)
	ap.add_animation_library("", AnimLibrary.library(avatar.skeleton))
	# The jumpshot set point has the shooting arm raised forward and up.
	ap.play("jumpshot")
	ap.seek(0.62, true)
	ap.advance(0)
	var upper := _dir("upperarm_r", "lowerarm_r")
	assert_gt(upper.y, 0.3, "shooting arm should point up")
	# Mid-jog the legs swing in opposite directions along -Z (forward).
	ap.play("jog")
	ap.seek(0.0, true)
	ap.advance(0)
	var right_thigh := _dir("thigh_r", "calf_r")
	var left_thigh := _dir("thigh_l", "calf_l")
	assert_lt(right_thigh.z, -0.2, "right leg forward at contact")
	assert_gt(left_thigh.z, 0.1, "left leg back at contact")
	ap.queue_free()
