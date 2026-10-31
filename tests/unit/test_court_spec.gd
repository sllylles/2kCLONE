extends GutTest
## Regulation geometry checks.


func test_dimensions_are_regulation() -> void:
	assert_eq(CourtSpec.LENGTH, 94.0)
	assert_eq(CourtSpec.WIDTH, 50.0)
	assert_eq(CourtSpec.RIM_HEIGHT, 10.0)
	assert_eq(CourtSpec.THREE_ARC_RADIUS, 23.75)
	assert_eq(CourtSpec.THREE_CORNER_DIST, 22.0)


func test_basket_position_in_meters() -> void:
	var b := CourtSpec.basket_position(1)
	assert_almost_eq(b.x, 41.75 * 0.3048, 0.0001)
	assert_almost_eq(b.y, 3.048, 0.0001)
	assert_eq(CourtSpec.basket_position(-1).x, -b.x)


func test_corner_three_runs_about_fourteen_feet() -> void:
	assert_almost_eq(CourtSpec.corner_three_length(), 14.2, 0.05)


func test_top_of_key_three() -> void:
	var bx := CourtSpec.basket_x()
	assert_true(CourtSpec.is_three_pointer(Vector2(bx - 24.0, 0), 1))
	assert_false(CourtSpec.is_three_pointer(Vector2(bx - 23.5, 0), 1))


func test_corner_three() -> void:
	# 3 ft from the baseline: the 22 ft corner line decides.
	assert_true(CourtSpec.is_three_pointer(Vector2(44.0, 22.3), 1))
	assert_false(CourtSpec.is_three_pointer(Vector2(44.0, 21.7), 1))
	assert_true(CourtSpec.is_three_pointer(Vector2(-44.0, -22.3), -1))


func test_backcourt_is_three() -> void:
	assert_true(CourtSpec.is_three_pointer(Vector2(-10.0, 0), 1))


func test_paint_and_restricted_area() -> void:
	assert_true(CourtSpec.in_paint(Vector2(40.0, 7.0), 1))
	assert_false(CourtSpec.in_paint(Vector2(40.0, 9.0), 1))
	assert_false(CourtSpec.in_paint(Vector2(26.0, 0.0), 1))
	assert_true(CourtSpec.in_restricted_area(Vector2(CourtSpec.basket_x() - 3.5, 0), 1))
	assert_false(CourtSpec.in_restricted_area(Vector2(CourtSpec.basket_x() - 4.5, 0), 1))
