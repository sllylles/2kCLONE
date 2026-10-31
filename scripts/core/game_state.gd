class_name GameState
extends RefCounted
## Scoreboard state: score, period, game clock, shot clock, fouls, timeouts.
## Pure logic so it can be unit tested; the full rules engine (Phase 4)
## builds on top of this.

signal period_ended(period: int)
signal game_ended
signal shot_clock_expired(team: int)
signal score_changed(team: int, points: int)

const HOME := 0
const AWAY := 1
const SHOT_CLOCK := 24.0
const SHOT_CLOCK_RESET_SHORT := 14.0
const TIMEOUTS_PER_GAME := 7
const BONUS_FOULS := 5
const OVERTIME_SEC := 300.0

var period_length := 300.0
var regulation_periods := 4
var period := 1
var game_clock := 300.0
var shot_clock := SHOT_CLOCK
var running := false
var final := false
var possession := HOME
var scores := [0, 0]
var team_fouls := [0, 0]
var timeouts := [TIMEOUTS_PER_GAME, TIMEOUTS_PER_GAME]


func _init(quarter_minutes := 5.0) -> void:
	period_length = quarter_minutes * 60.0
	game_clock = period_length


func tick(delta: float) -> void:
	if not running or final:
		return
	game_clock = maxf(0.0, game_clock - delta)
	if shot_clock_active():
		shot_clock = maxf(0.0, shot_clock - delta)
		if shot_clock <= 0.0:
			running = false
			shot_clock_expired.emit(possession)
			return
	if game_clock <= 0.0:
		_end_period()


## The shot clock is switched off when less game time remains than shot time.
func shot_clock_active() -> bool:
	return game_clock > shot_clock


func reset_shot_clock(short := false) -> void:
	shot_clock = SHOT_CLOCK_RESET_SHORT if short else SHOT_CLOCK


func change_possession(team: int) -> void:
	possession = team
	reset_shot_clock()


func add_points(team: int, points: int) -> void:
	scores[team] += points
	score_changed.emit(team, points)


func add_team_foul(team: int) -> void:
	team_fouls[team] += 1


## A team shoots bonus free throws once the *other* team reaches 5 fouls.
func in_bonus(team: int) -> bool:
	return team_fouls[1 - team] >= BONUS_FOULS


func use_timeout(team: int) -> bool:
	if timeouts[team] <= 0:
		return false
	timeouts[team] -= 1
	running = false
	return true


func is_overtime() -> bool:
	return period > regulation_periods


func leader() -> int:
	if scores[HOME] == scores[AWAY]:
		return -1
	return HOME if scores[HOME] > scores[AWAY] else AWAY


func _end_period() -> void:
	running = false
	period_ended.emit(period)
	if period >= regulation_periods and scores[HOME] != scores[AWAY]:
		final = true
		game_ended.emit()
		return
	period += 1
	game_clock = OVERTIME_SEC if is_overtime() else period_length
	reset_shot_clock()
	# Team fouls reset each quarter (each overtime too).
	team_fouls = [0, 0]


func period_label() -> String:
	if period <= regulation_periods:
		return ["1ST", "2ND", "3RD", "4TH"][clampi(period - 1, 0, 3)]
	var ot := period - regulation_periods
	return "OT" if ot == 1 else "%dOT" % ot


## Game clock text: "M:SS" above one minute, "SS.T" inside the last minute.
static func format_clock(seconds: float) -> String:
	seconds = maxf(seconds, 0.0)
	if seconds >= 60.0:
		var s := int(ceilf(seconds))
		return "%d:%02d" % [s / 60, s % 60]
	return "%.1f" % (floorf(seconds * 10.0) / 10.0)


## Shot clock text: whole seconds, tenths under five.
static func format_shot_clock(seconds: float) -> String:
	seconds = maxf(seconds, 0.0)
	if seconds >= 5.0:
		return str(int(ceilf(seconds)))
	return "%.1f" % (floorf(seconds * 10.0) / 10.0)
