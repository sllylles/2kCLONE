extends GutTest
## Ball flight, rim/backboard/floor contact and make detection.

const FT := CourtSpec.FT


func _shoot(from: Vector3, target: Vector3, apex: float, seconds := 3.0) -> BallPhysics:
	var b := BallPhysics.new()
	b.launch(from, BallPhysics.solve_launch(from, target, apex))
	var t := 0.0
	while t < seconds:
		b.step(1.0 / 60.0)
		t += 1.0 / 60.0
	return b


func test_launch_solver_hits_target() -> void:
	var from := Vector3(5, 2.5, 3)
	var to := Vector3(12.7, 3.05, 0)
	var v := BallPhysics.solve_launch(from, to, 4.5)
	var t := BallPhysics.flight_time(from, to, 4.5)
	# Ideal (drag-free) projectile position at t
	var p := from + v * t + Vector3(0, -0.5 * BallPhysics.G * t * t, 0)
	assert_almost_eq(p.distance_to(to), 0.0, 0.01)


func test_swish_from_the_top_of_the_key() -> void:
	var rim := BallPhysics.rim_center(1)
	var from := rim + Vector3(-7.2, -0.65, 0)          # ~24 ft out, release ~2.4 m high
	var b := _shoot(from, rim, BallPhysics.shot_apex(from, 1))
	assert_eq(b.scored_side, 1, "centered shot should go in")


func test_badly_short_shot_misses_and_lands() -> void:
	var rim := BallPhysics.rim_center(1)
	var from := rim + Vector3(-7.2, -0.65, 0)
	var b := _shoot(from, rim + Vector3(-0.45, 0, 0), BallPhysics.shot_apex(from, 1))
	assert_eq(b.scored_side, 0)
	assert_gt(b.bounces, 0, "ball should reach the floor")


func test_shot_off_the_rim_bounces() -> void:
	var rim := BallPhysics.rim_center(1)
	var from := rim + Vector3(-5.0, -0.7, 0)
	var b := _shoot(from, rim + Vector3(0, 0, BallPhysics.RIM_R + 0.02), BallPhysics.shot_apex(from, 1), 1.6)
	assert_true(b.touched_rim)


func test_bank_shot_uses_backboard() -> void:
	var rim := BallPhysics.rim_center(1)
	var face_x := (CourtSpec.HALF_LENGTH - CourtSpec.BACKBOARD_FROM_BASELINE) * FT
	var from := rim + Vector3(-3.0, -0.6, 2.0)
	var spot := Vector3(face_x, rim.y + 0.35, 0.25)
	var b := _shoot(from, spot, spot.y + 0.6, 2.0)
	assert_true(b.touched_board)


func test_floor_bounces_lose_energy_then_roll() -> void:
	var b := BallPhysics.new()
	b.launch(Vector3(0, 2.0, 0), Vector3(1, 0, 0))
	var peaks: Array[float] = []
	var rising := false
	var top := 0.0
	for i in 600:
		b.step(1.0 / 60.0)
		if b.vel.y > 0.0:
			rising = true
			top = maxf(top, b.pos.y)
		elif rising:
			peaks.append(top)
			rising = false
			top = 0.0
	assert_gt(peaks.size(), 2)
	assert_lt(peaks[1], peaks[0])
	assert_almost_eq(b.pos.y, BallPhysics.R, 0.01)


func test_accurate_shots_mostly_go_in() -> void:
	# Calibration for the game's aim error: within ~2" of center should make.
	var rim := BallPhysics.rim_center(1)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var made := 0
	for i in 60:
		var from := rim + Vector3(-rng.randf_range(4.0, 7.5), -0.7, rng.randf_range(-3.0, 3.0))
		var a := rng.randf() * TAU
		var err := Vector3(cos(a), 0, sin(a)) * rng.randf_range(0.0, 0.05)
		if _shoot(from, rim + err, BallPhysics.shot_apex(from, 1), 2.5).scored_side == 1:
			made += 1
	assert_gt(made, 50, "made %d/60" % made)


func test_wild_shots_mostly_miss() -> void:
	var rim := BallPhysics.rim_center(1)
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	var made := 0
	for i in 60:
		var from := rim + Vector3(-rng.randf_range(4.0, 7.5), -0.7, rng.randf_range(-3.0, 3.0))
		var a := rng.randf() * TAU
		var err := Vector3(cos(a), 0, sin(a)) * rng.randf_range(0.16, 0.3)
		if _shoot(from, rim + err, BallPhysics.shot_apex(from, 1), 2.5).scored_side == 1:
			made += 1
	assert_lt(made, 12, "made %d/60" % made)


func test_predict_catch_finds_landing() -> void:
	var b := BallPhysics.new()
	b.launch(Vector3(0, 3.0, 0), Vector3(2, 2, 0))
	var c := b.predict_catch(2.5, 0.2)
	assert_eq(c.size(), 2)
	assert_lt(float(c[0]), 2.0)
	assert_gt((c[1] as Vector3).x, 0.5)
