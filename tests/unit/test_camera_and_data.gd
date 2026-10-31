extends GutTest
## Camera framing math and data file sanity.


func test_every_preset_has_required_fields() -> void:
	assert_true(DataDB.camera_presets.size() >= 6)
	var ids := []
	for p in DataDB.camera_presets:
		for key in ["id", "name", "type", "height", "distance", "fov"]:
			assert_true(p.has(key), "%s missing %s" % [p.get("id", "?"), key])
		ids.append(p.id)
	for want in ["broadcast", "elevated", "drive", "side_court", "end_court", "skybox"]:
		assert_has(ids, want)


func test_zoom_slider_moves_camera_closer() -> void:
	var p := DataDB.camera_preset("broadcast")
	var wide := CameraDirector.preset_pose(p, {"zoom": 0, "height": 5}, Vector3.ZERO, 1)
	var tight := CameraDirector.preset_pose(p, {"zoom": 10, "height": 5}, Vector3.ZERO, 1)
	assert_gt(wide.pos.z, tight.pos.z)
	assert_gt(wide.fov, tight.fov)


func test_height_slider_raises_camera() -> void:
	var p := DataDB.camera_preset("elevated")
	var low := CameraDirector.preset_pose(p, {"zoom": 5, "height": 0}, Vector3.ZERO, 1)
	var high := CameraDirector.preset_pose(p, {"zoom": 5, "height": 10}, Vector3.ZERO, 1)
	assert_gt(high.pos.y, low.pos.y)


func test_sideline_camera_follows_ball() -> void:
	var p := DataDB.camera_preset("side_court")
	var a := CameraDirector.preset_pose(p, {}, Vector3(-30, 0, 0), 1)
	var b := CameraDirector.preset_pose(p, {}, Vector3(30, 0, 0), 1)
	assert_lt(a.pos.x, b.pos.x)


func test_drive_camera_sits_behind_player() -> void:
	var p := DataDB.camera_preset("drive")
	var pose := CameraDirector.preset_pose(p, {}, Vector3.ZERO, 1, Vector3(10, 0, 0), Vector3(1, 0, 0))
	assert_lt(pose.pos.x, 10.0)
	assert_gt(pose.look.x, 10.0)


func test_end_camera_faces_attacked_basket() -> void:
	var p := DataDB.camera_preset("end_court")
	var pose := CameraDirector.preset_pose(p, {}, Vector3(20, 0, 0), 1)
	assert_lt(pose.pos.x, pose.look.x)
	var pose2 := CameraDirector.preset_pose(p, {}, Vector3(-20, 0, 0), -1)
	assert_gt(pose2.pos.x, pose2.look.x)


func test_skybox_stays_below_jumbotron_line_of_sight() -> void:
	var p := DataDB.camera_preset("skybox")
	var pose := CameraDirector.preset_pose(p, {"zoom": 10, "height": 10}, Vector3.ZERO, 1)
	# The ray from the camera to the court must pass under the center-hung board.
	var cam: Vector3 = pose.pos
	var look: Vector3 = pose.look
	var t := (cam.z - 9.0) / (cam.z - look.z)   # where the ray crosses the board's front face
	var y := lerpf(cam.y, look.y, t)
	assert_lt(y, ArenaBuilder.JUMBO_BOTTOM)


func test_teams_have_rosters_and_arenas() -> void:
	assert_true(DataDB.teams.size() >= 2)
	for t in DataDB.teams:
		assert_true(DataDB.roster(t.id).size() >= 5, "%s roster too small" % t.id)
		assert_eq(DataDB.arena(t.arena).get("id", ""), t.arena)
		for key in ["primary", "secondary"]:
			assert_ne(DataDB.color(t[key], Color(0, 0, 0, 0)), Color(0, 0, 0, 0))


func test_input_specs_round_trip() -> void:
	for action in InputRouter.DEFAULT_BINDINGS:
		for spec in InputRouter.DEFAULT_BINDINGS[action]:
			var ev := InputRouter.event_from_spec(spec)
			assert_not_null(ev)
			var back := InputRouter.spec_from_event(ev)
			assert_eq(back.type, spec.type)
