extends GutTest
## Box score bookkeeping and player of the game.

var b: BoxScore


func before_each() -> void:
	b = BoxScore.new()
	b.add_player({"id": "a", "first": "Steph", "last": "Curry", "number": "30"}, 0, true)
	b.add_player({"id": "c", "first": "Draymond", "last": "Green", "number": "23"}, 0, true)
	b.add_player({"id": "x", "first": "Jayson", "last": "Tatum", "number": "0"}, 1, true)


func test_shots_and_points() -> void:
	b.shot("a", true, true)
	b.shot("a", false, true)
	b.shot("a", true, false)
	b.free_throw("a", true)
	b.free_throw("a", false)
	var l := b.line("a")
	assert_eq(l.pts, 6)
	assert_eq([l.fgm, l.fga, l.tpm, l.tpa, l.ftm, l.fta], [2, 3, 1, 2, 1, 2])
	assert_eq(l.name, "S. Curry")


func test_totals_and_plus_minus() -> void:
	b.shot("a", true, false)
	b.add("c", "ast")
	b.plus_minus(0, 2, ["a", "c", "x"])
	var t := b.team_totals(0)
	assert_eq(t.pts, 2)
	assert_eq(t.ast, 1)
	assert_eq(b.line("x").pm, -2)
	assert_eq(b.line("a").pm, 2)


func test_player_of_the_game_comes_from_the_winner() -> void:
	b.shot("x", true, true)
	b.shot("x", true, true)
	b.shot("a", true, false)
	assert_eq(b.player_of_game(0), "a")
	assert_eq(b.player_of_game(1), "x")


func test_play_by_play_log() -> void:
	b.log_play(1, "11:42", 0, "Curry makes 26-ft three", [3, 0])
	assert_eq(b.plays.size(), 1)
	assert_eq(b.plays[0].score, [3, 0])


func test_minutes_format() -> void:
	b.minutes(["a"], 125.4)
	assert_eq(BoxScore.fmt_min(b.line("a").sec), "2:05")
