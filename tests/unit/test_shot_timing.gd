extends GutTest
## Shot meter window and grading.


func test_better_shooters_get_bigger_windows() -> void:
	assert_gt(ShotTiming.green_window(95, 0.0, 0.0, 1.0), ShotTiming.green_window(55, 0.0, 0.0, 1.0))


func test_contest_fatigue_and_difficulty_shrink_the_window() -> void:
	var open := ShotTiming.green_window(80, 0.0, 0.0, 1.0)
	assert_lt(ShotTiming.green_window(80, 1.0, 0.0, 1.0), open)
	assert_lt(ShotTiming.green_window(80, 0.0, 1.0, 1.0), open)
	assert_lt(ShotTiming.green_window(80, 0.0, 0.0, ShotTiming.DIFFICULTY.stepback), open)
	assert_gt(ShotTiming.green_window(80, 0.0, 0.0, ShotTiming.DIFFICULTY.layup), open)


func test_grades() -> void:
	var w := 0.03
	assert_eq(ShotTiming.grade(0.0, w), ShotTiming.Grade.EXCELLENT)
	assert_eq(ShotTiming.grade(-0.05, w), ShotTiming.Grade.GOOD)
	assert_eq(ShotTiming.grade(-0.1, w), ShotTiming.Grade.SLIGHTLY_EARLY)
	assert_eq(ShotTiming.grade(0.1, w), ShotTiming.Grade.SLIGHTLY_LATE)
	assert_eq(ShotTiming.grade(0.18, w), ShotTiming.Grade.LATE)
	assert_eq(ShotTiming.grade(-0.5, w), ShotTiming.Grade.VERY_EARLY)


func test_timing_scales_make_chance() -> void:
	var base := 0.4
	assert_gt(ShotTiming.make_chance(base, ShotTiming.Grade.EXCELLENT), base)
	assert_lt(ShotTiming.make_chance(base, ShotTiming.Grade.LATE), base)
	assert_lte(ShotTiming.make_chance(0.9, ShotTiming.Grade.EXCELLENT), ShotTiming.MAX_MAKE)


func test_contest_level() -> void:
	assert_eq(ShotTiming.contest_level(12.0, false, 0.0), 0.0)
	assert_gt(ShotTiming.contest_level(4.0, true, 0.0), ShotTiming.contest_level(4.0, false, 0.0))
	assert_gt(ShotTiming.contest_level(3.0, true, 6.0), ShotTiming.contest_level(3.0, true, -6.0))


func test_base_chance_ordering() -> void:
	var r := {"three_point": 85, "mid_range": 85, "layup": 85, "dunk": 85, "close_shot": 85}
	var dunk := ShotTiming.base_chance("dunk", 2.0, false, r, 0.0)
	var layup := ShotTiming.base_chance("layup", 4.0, false, r, 0.0)
	var mid := ShotTiming.base_chance("jumpshot", 15.0, false, r, 0.0)
	var three := ShotTiming.base_chance("jumpshot", 24.0, true, r, 0.0)
	assert_gt(dunk, layup)
	assert_gt(layup, mid)
	assert_gt(mid, three)
	assert_lt(ShotTiming.base_chance("jumpshot", 24.0, true, r, 1.0), three)


func test_ai_timing_tightens_with_rating() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 3
	var good := 0.0
	var bad := 0.0
	for i in 400:
		good += absf(ShotTiming.ai_offset(95, rng))
		bad += absf(ShotTiming.ai_offset(45, rng))
	assert_lt(good, bad)
