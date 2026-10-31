extends GutTest
## Body measurements and uniform setup.

var a: PlayerAvatar


func before_each() -> void:
	a = PlayerAvatar.new()
	add_child(a)


func after_each() -> void:
	a.free()


func _player(h: int, w: int, ws: int, num := "23") -> Dictionary:
	return {"id": "T_%d" % h, "first": "Test", "last": "Player", "height_in": h, "weight_lb": w,
		"wingspan_in": ws, "number": num, "ratings": {"strength": 70}}


func test_height_scales_model() -> void:
	a.apply(_player(72, 190, 75), DataDB.teams[0], true)
	var short := a.scale.x
	a.apply(_player(86, 260, 90), DataDB.teams[0], true)
	assert_almost_eq(a.scale.x / short, 86.0 / 72.0, 0.001)
	assert_almost_eq(a.height_m, 86 * 0.0254, 0.001)


func test_wingspan_lengthens_arms() -> void:
	a.apply(_player(80, 220, 78), DataDB.teams[0], true)
	var short := a.skeleton.get_bone_rest(a.skeleton.find_bone("lowerarm_l")).origin.length()
	a.apply(_player(80, 220, 88), DataDB.teams[0], true)
	var long := a.skeleton.get_bone_rest(a.skeleton.find_bone("lowerarm_l")).origin.length()
	assert_gt(long, short)


func test_build_from_bmi() -> void:
	a.apply(_player(80, 290, 84), DataDB.teams[0], true)
	var heavy := a.body.get_blend_shape_value(a.body.find_blend_shape_by_name("build_heavy"))
	assert_gt(heavy, 0.3)
	a.apply(_player(80, 185, 84), DataDB.teams[0], true)
	assert_eq(a.body.get_blend_shape_value(a.body.find_blend_shape_by_name("build_heavy")), 0.0)
	assert_gt(a.body.get_blend_shape_value(a.body.find_blend_shape_by_name("build_light")), 0.0)


func test_garments_follow_build() -> void:
	a.apply(_player(80, 290, 84), DataDB.teams[0], true)
	for mi in a.shape_meshes:
		var idx := mi.find_blend_shape_by_name("build_heavy")
		assert_gt(idx, -1, mi.name)
		assert_gt(mi.get_blend_shape_value(idx), 0.3, mi.name)


func test_jersey_digits() -> void:
	a.apply(_player(80, 220, 84, "00"), DataDB.teams[0], true)
	assert_eq(a.jersey_mat.get_shader_parameter("digit_a"), 0)
	assert_eq(a.jersey_mat.get_shader_parameter("digit_b"), 0)
	a.apply(_player(80, 220, 84, "7"), DataDB.teams[0], true)
	assert_eq(a.jersey_mat.get_shader_parameter("digit_a"), 7)
	assert_eq(a.jersey_mat.get_shader_parameter("digit_b"), -1)
	assert_eq(PlayerAvatar.jersey_number({"number": 11.0}), "11")


func test_one_hair_style_visible() -> void:
	var p := _player(80, 220, 84)
	p["hair"] = "afro01"
	a.apply(p, DataDB.teams[0], true)
	var shown := a.hair.values().filter(func(m): return m.visible)
	assert_eq(shown.size(), 1)
	assert_true(a.hair["afro01"].visible)
