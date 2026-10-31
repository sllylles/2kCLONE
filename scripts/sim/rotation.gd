class_name Rotation
extends RefCounted
## One team's lineup: who is on the floor, bench stamina, and when to sub.
## Subs happen at dead balls: tired players, foul trouble, foul-outs, and
## rested starters coming back. Pure logic: tests/unit/test_rotation.gd.

const SLOT_POS := ["PG", "SG", "SF", "PF", "C"]
const TIRED := 0.42
const RESTED := 0.82
const BENCH_RECOVERY := 0.012     # stamina per second on the bench
const MIN_STINT := 150.0          # seconds a player stays in (or out) before a voluntary sub
const MAX_SWAPS := 1              # voluntary subs per team per dead ball

var roster: Array = []            # player dictionaries
var on_court: Array = []          # 5 player ids, slot order PG..C
var stamina := {}                 # id -> 0..1
var starters: Array = []
var last_change := {}             # id -> time of the last sub in/out


func setup(team_roster: Array) -> void:
	roster = team_roster.duplicate()
	for p in roster:
		stamina[p.id] = 1.0
	var picks: Array = roster.filter(func(p): return p.get("starter", false)).slice(0, 5)
	if picks.size() < 5:
		picks = roster.slice(0, 5)
	# Shortest to tallest fills the PG..C slots.
	picks.sort_custom(func(a, b): return a.get("height_in", 78) < b.get("height_in", 78))
	on_court = picks.map(func(p): return p.id)
	starters = on_court.duplicate()


func player(pid: String) -> Dictionary:
	for p in roster:
		if p.id == pid:
			return p
	return {}


func bench() -> Array:
	return roster.filter(func(p): return not p.id in on_court).map(func(p): return p.id)


func rest_bench(seconds: float) -> void:
	for pid in bench():
		stamina[pid] = minf(1.0, float(stamina[pid]) + BENCH_RECOVERY * seconds)


## How well a bench player fits a slot (0 = perfect).
func _fit(pid: String, slot: int) -> float:
	var pos: String = player(pid).get("pos", "SF")
	var i := SLOT_POS.find(pos)
	return absf(float(i - slot)) if i >= 0 else 2.0


func _settled(pid: String, now: float) -> bool:
	return now - float(last_change.get(pid, -INF)) >= MIN_STINT


## Suggested swaps as [[out_id, in_id], ...]. `fouls` = id -> personal fouls.
## `now` (seconds) enforces a minimum stint so players don't ping-pong.
func suggest(period: int, fouls: Dictionary, forced_only := false, now := INF) -> Array:
	var swaps: Array = []
	var used := {}
	var voluntary := 0
	for slot in on_court.size():
		var out_id: String = on_court[slot]
		var pf_out := int(fouls.get(out_id, 0))
		if pf_out < Referee.PERSONAL_FOUL_LIMIT and (voluntary >= MAX_SWAPS or not _settled(out_id, now)):
			continue
		var pf := int(fouls.get(out_id, 0))
		var fouled_out := pf >= Referee.PERSONAL_FOUL_LIMIT
		var trouble := period <= 3 and pf >= period + 1
		var tired := float(stamina.get(out_id, 1.0)) < TIRED
		var rested_starter := ""
		if not out_id in starters and not forced_only:
			# A rested starter for this slot comes back in.
			for s in starters:
				if not s in on_court and float(stamina.get(s, 0.0)) >= RESTED and not used.has(s) \
						and int(fouls.get(s, 0)) < Referee.PERSONAL_FOUL_LIMIT and _fit(s, slot) <= 1.0:
					rested_starter = s
					break
		if not (fouled_out or (not forced_only and (trouble or tired))) and rested_starter == "":
			continue
		var best := rested_starter
		var best_score := INF
		if best == "":
			for pid in bench():
				if used.has(pid) or int(fouls.get(pid, 0)) >= Referee.PERSONAL_FOUL_LIMIT:
					continue
				if float(stamina.get(pid, 0.0)) < RESTED and not fouled_out:
					continue
				var score := _fit(pid, slot) * 10.0 - float(player(pid).get("overall", 60)) * 0.1
				if score < best_score:
					best_score = score
					best = pid
		if best != "":
			used[best] = true
			swaps.append([out_id, best])
			if not fouled_out:
				voluntary += 1
	return swaps


func apply_sub(out_id: String, in_id: String, now := 0.0) -> int:
	last_change[out_id] = now
	last_change[in_id] = now
	var slot := on_court.find(out_id)
	if slot >= 0:
		on_court[slot] = in_id
	return slot
