class_name BoxScore
extends RefCounted
## Per-player stats, team totals, play-by-play and player of the game.
## Pure data: unit tested in tests/unit/test_box_score.gd.

const STATS := ["sec", "pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "stl",
	"blk", "tov", "pf", "pm"]

var lines := {}          # player id -> Dictionary (info + STATS)
var order: Array = [[], []]   # player ids per team in roster order
var plays: Array = []    # {period, clock, team, text, score}


func add_player(p: Dictionary, team: int, starter: bool) -> void:
	if lines.has(p.id):
		return
	var l := {"id": p.id, "team": team, "starter": starter,
		"name": "%s. %s" % [str(p.get("first", "?")).left(1), p.get("last", "")],
		"full": "%s %s" % [p.get("first", ""), p.get("last", "")],
		"number": str(p.get("number", "")), "pos": p.get("pos", "")}
	for s in STATS:
		l[s] = 0
	l.sec = 0.0
	lines[p.id] = l
	order[team].append(p.id)


func line(pid: String) -> Dictionary:
	return lines.get(pid, {})


func add(pid: String, stat: String, amount := 1) -> void:
	if lines.has(pid):
		lines[pid][stat] += amount


func shot(pid: String, made: bool, three: bool) -> void:
	add(pid, "fga")
	if three:
		add(pid, "tpa")
	if made:
		add(pid, "fgm")
		add(pid, "pts", 3 if three else 2)
		if three:
			add(pid, "tpm")


func free_throw(pid: String, made: bool) -> void:
	add(pid, "fta")
	if made:
		add(pid, "ftm")
		add(pid, "pts")


func rebound(pid: String, offensive: bool) -> void:
	add(pid, "oreb" if offensive else "dreb")


func minutes(pids: Array, seconds: float) -> void:
	for pid in pids:
		if lines.has(pid):
			lines[pid].sec += seconds


## Points scored while each player was on the floor (+/-).
func plus_minus(scoring_team: int, points: int, on_court: Array) -> void:
	for pid in on_court:
		if lines.has(pid):
			lines[pid].pm += points if lines[pid].team == scoring_team else -points


func log_play(period: int, clock: String, team: int, text: String, score: Array) -> void:
	plays.append({"period": period, "clock": clock, "team": team, "text": text, "score": score.duplicate()})


func team_totals(team: int) -> Dictionary:
	var t := {}
	for s in STATS:
		t[s] = 0
	for pid in order[team]:
		for s in STATS:
			t[s] += lines[pid][s]
	return t


static func reb(l: Dictionary) -> int:
	return int(l.oreb) + int(l.dreb)


## Hollinger game score.
static func game_score(l: Dictionary) -> float:
	return l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.oreb + 0.3 * l.dreb \
		+ l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov


## Best game score on the winning team (any team if tied/-1).
func player_of_game(winner: int) -> String:
	var best := ""
	var best_gs := -INF
	for pid in lines:
		var l: Dictionary = lines[pid]
		if winner >= 0 and l.team != winner:
			continue
		var gs := game_score(l)
		if gs > best_gs:
			best_gs = gs
			best = pid
	return best


static func stat_line(l: Dictionary) -> String:
	var parts := ["%d PTS" % l.pts, "%d REB" % reb(l), "%d AST" % l.ast]
	if l.stl >= 2:
		parts.append("%d STL" % l.stl)
	if l.blk >= 2:
		parts.append("%d BLK" % l.blk)
	parts.append("%d-%d FG" % [l.fgm, l.fga])
	return "  ".join(parts)


static func fmt_min(sec: float) -> String:
	return "%d:%02d" % [int(sec) / 60, int(sec) % 60]
