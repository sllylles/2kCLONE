extends GutTest
## Rules: 3 seconds, 8 seconds, over-and-back, goaltending, fouls, free throws.


func test_eight_seconds() -> void:
	var r := Referee.new()
	r.new_possession(true)
	var v := ""
	for i in 85:
		v = r.tick_backcourt(Vector3(-20, 0, 0), 1, 0.1, true)
		if v != "":
			break
	assert_eq(v, "8 seconds")


func test_crossing_half_court_stops_the_count_and_over_and_back() -> void:
	var r := Referee.new()
	r.new_possession(true)
	r.tick_backcourt(Vector3(-20, 0, 0), 1, 3.0, true)
	assert_eq(r.tick_backcourt(Vector3(5, 0, 0), 1, 0.1, true), "")
	assert_eq(r.tick_backcourt(Vector3(-3, 0, 0), 1, 0.1, true), "backcourt")
	# a loose ball going back is not a violation
	r.new_possession(false)
	assert_eq(r.tick_backcourt(Vector3(-3, 0, 0), 1, 0.1, false), "")


func test_three_seconds() -> void:
	var r := Referee.new()
	var v := ""
	for i in 31:
		v = r.tick_lane(["big"], 0.1, true)
		if v != "":
			break
	assert_eq(v, "big")
	# stepping out resets the count
	r.tick_lane(["big"], 2.5, true)
	r.tick_lane([], 0.1, true)
	assert_eq(r.lane_seconds("big"), 0.0)
	# shots in the air pause it
	r.tick_lane(["big"], 2.9, true)
	assert_eq(r.tick_lane(["big"], 0.5, false), "")


func test_goaltending() -> void:
	var rim := CourtSpec.basket_position(1)
	assert_true(Referee.is_goaltending(rim + Vector3(-0.5, 0.4, 0), Vector3(2, -3, 0), 1))
	assert_false(Referee.is_goaltending(rim + Vector3(-0.5, 0.4, 0), Vector3(2, 3, 0), 1), "still rising")
	assert_false(Referee.is_goaltending(rim + Vector3(-0.5, -0.3, 0), Vector3(2, -3, 0), 1), "below the rim")


func test_free_throw_counts() -> void:
	assert_eq(Referee.free_throws(true, false, false, false), 2)
	assert_eq(Referee.free_throws(true, false, true, false), 3)
	assert_eq(Referee.free_throws(true, true, true, false), 1)
	assert_eq(Referee.free_throws(false, false, false, true), 2)
	assert_eq(Referee.free_throws(false, false, false, false), 0)


func test_foul_chance_scales() -> void:
	assert_gt(Referee.foul_chance("drive", 50, 0.5), Referee.foul_chance("drive", 95, 0.5))
	assert_gt(Referee.foul_chance("drive", 70, 0.5), Referee.foul_chance("drive", 70, 0.0), "more contact, more fouls")
	assert_lt(Referee.foul_chance("drive", 70, 0.5, 0.5), Referee.foul_chance("drive", 70, 0.5, 1.0))


func test_charge_or_block() -> void:
	assert_eq(Referee.charge_or_block(1.0, Vector3(30, 0, 5), 1), "charge")
	assert_eq(Referee.charge_or_block(8.0, Vector3(30, 0, 5), 1), "blocking")
	assert_eq(Referee.charge_or_block(0.0, Vector3(CourtSpec.basket_x() - 2.0, 0, 0), 1), "blocking", "restricted area")
