extends GutTest
## Substitution logic.

var r: Rotation


func _p(id: String, pos: String, h: int, starter: bool, ovr := 75) -> Dictionary:
	return {"id": id, "pos": pos, "height_in": h, "starter": starter, "overall": ovr}


func before_each() -> void:
	r = Rotation.new()
	r.setup([_p("pg", "PG", 74, true), _p("sg", "SG", 77, true), _p("sf", "SF", 79, true),
		_p("pf", "PF", 81, true), _p("c", "C", 84, true),
		_p("bpg", "PG", 73, false), _p("bsf", "SF", 79, false), _p("bc", "C", 83, false, 70)])


func test_starters_fill_slots_by_height() -> void:
	assert_eq(r.on_court, ["pg", "sg", "sf", "pf", "c"])
	assert_eq(r.bench().size(), 3)


func test_tired_player_subbed_by_same_position() -> void:
	r.stamina["c"] = 0.3
	var swaps := r.suggest(1, {})
	assert_eq(swaps, [["c", "bc"]])


func test_foul_trouble_and_foul_out() -> void:
	assert_eq(r.suggest(1, {"pg": 2}), [["pg", "bpg"]])
	assert_eq(r.suggest(4, {"pg": 6}, true), [["pg", "bpg"]], "fouled out")
	assert_eq(r.suggest(4, {"pg": 5}, true), [], "5 fouls in the 4th plays on")


func test_rested_starter_returns() -> void:
	r.apply_sub("c", "bc")
	r.stamina["c"] = 0.5
	assert_eq(r.suggest(2, {}), [])
	r.rest_bench(30.0)
	assert_eq(r.suggest(2, {}), [["bc", "c"]])


func test_fouled_out_players_never_come_back() -> void:
	r.apply_sub("c", "bc")
	r.stamina["bc"] = 0.2
	for swap in r.suggest(2, {"c": 6}):
		assert_ne(swap[1], "c", "a fouled-out starter must not come back")
