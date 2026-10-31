extends GutTest
## Pro-stick gestures: quick swipe = dribble move, held finger = jump shot.


func before_each() -> void:
	InputRouter.touch_pro_end()
	InputRouter.pro_flick()
	InputRouter.pro_shot_started()


func _tick(seconds: float) -> void:
	var t := 0.0
	while t < seconds:
		InputRouter._physics_process(1.0 / 60.0)
		t += 1.0 / 60.0


func test_swipe_is_a_move_not_a_shot() -> void:
	InputRouter.touch_pro_begin()
	_tick(0.08)
	InputRouter.touch_pro_swipe("left")
	_tick(0.3)
	InputRouter.touch_pro_end()
	assert_eq(InputRouter.pro_flick(), "left")
	assert_false(InputRouter.pro_shot_started())
	assert_eq(InputRouter.pro_flick(), "", "flick is consumed once")


func test_hold_starts_and_release_ends_a_shot() -> void:
	InputRouter.touch_pro_begin()
	_tick(InputRouter.PRO_HOLD_TIME + 0.05)
	assert_true(InputRouter.pro_shot_started())
	assert_false(InputRouter.pro_shot_started(), "start is reported once")
	assert_true(InputRouter.pro_shot_held())
	InputRouter.touch_pro_swipe("up")      # swipes while shooting are ignored
	assert_eq(InputRouter.pro_flick(), "")
	InputRouter.touch_pro_end()
	assert_false(InputRouter.pro_shot_held())


func test_quick_tap_does_nothing() -> void:
	InputRouter.touch_pro_begin()
	_tick(0.1)
	InputRouter.touch_pro_end()
	_tick(0.3)
	assert_false(InputRouter.pro_shot_started())
	assert_eq(InputRouter.pro_flick(), "")
