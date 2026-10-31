extends GutTest
## Clock, shot clock, period and foul rules.

var gs: GameState


func before_each() -> void:
	gs = GameState.new(1.0)   # one-minute quarters


func test_clock_runs_only_when_running() -> void:
	gs.tick(5.0)
	assert_eq(gs.game_clock, 60.0)
	gs.running = true
	gs.tick(5.0)
	assert_almost_eq(gs.game_clock, 55.0, 0.001)
	assert_almost_eq(gs.shot_clock, 19.0, 0.001)


func test_shot_clock_violation_stops_clock() -> void:
	watch_signals(gs)
	gs.running = true
	for i in 25:
		gs.tick(1.0)
	assert_signal_emitted(gs, "shot_clock_expired")
	assert_false(gs.running)


func test_shot_clock_turns_off_late() -> void:
	gs.game_clock = 30.0
	assert_true(gs.shot_clock_active())
	gs.game_clock = 20.0
	assert_false(gs.shot_clock_active())


func test_offensive_rebound_resets_to_14() -> void:
	gs.shot_clock = 3.0
	gs.reset_shot_clock(true)
	assert_eq(gs.shot_clock, 14.0)


func test_period_advances_and_fouls_reset() -> void:
	gs.running = true
	gs.add_team_foul(GameState.HOME)
	gs.shot_clock = 100.0   # keep the shot clock out of the way
	gs.tick(61.0)
	assert_eq(gs.period, 2)
	assert_eq(gs.game_clock, 60.0)
	assert_eq(gs.team_fouls, [0, 0])


func test_tie_goes_to_overtime() -> void:
	gs.period = 4
	gs.running = true
	gs.shot_clock = 100.0
	gs.tick(61.0)
	assert_false(gs.final)
	assert_eq(gs.period, 5)
	assert_eq(gs.period_label(), "OT")
	assert_eq(gs.game_clock, GameState.OVERTIME_SEC)


func test_game_ends_when_not_tied() -> void:
	watch_signals(gs)
	gs.period = 4
	gs.add_points(GameState.AWAY, 3)
	gs.running = true
	gs.shot_clock = 100.0
	gs.tick(61.0)
	assert_true(gs.final)
	assert_signal_emitted(gs, "game_ended")
	assert_eq(gs.leader(), GameState.AWAY)


func test_bonus() -> void:
	for i in 4:
		gs.add_team_foul(GameState.AWAY)
	assert_false(gs.in_bonus(GameState.HOME))
	gs.add_team_foul(GameState.AWAY)
	assert_true(gs.in_bonus(GameState.HOME))
	assert_false(gs.in_bonus(GameState.AWAY))


func test_timeouts() -> void:
	gs.running = true
	assert_true(gs.use_timeout(GameState.HOME))
	assert_false(gs.running)
	assert_eq(gs.timeouts[GameState.HOME], GameState.TIMEOUTS_PER_GAME - 1)
	gs.timeouts[GameState.HOME] = 0
	assert_false(gs.use_timeout(GameState.HOME))


func test_clock_formatting() -> void:
	assert_eq(GameState.format_clock(720.0), "12:00")
	assert_eq(GameState.format_clock(65.2), "1:06")
	assert_eq(GameState.format_clock(59.95), "59.9")
	assert_eq(GameState.format_clock(0.0), "0.0")
	assert_eq(GameState.format_shot_clock(23.2), "24")
	assert_eq(GameState.format_shot_clock(4.25), "4.2")
