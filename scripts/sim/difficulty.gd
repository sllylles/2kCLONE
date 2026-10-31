class_name Difficulty
extends RefCounted
## Difficulty levels (Settings > Gameplay > Difficulty). Each level scales how
## well the CPU plays and how forgiving your shot meter is.
##   user_window  – multiplier on your green window
##   cpu_make     – multiplier on the CPU's make chance
##   cpu_defense  – CPU steal/block attempts and how fast its defenders react
##   cpu_iq       – CPU shot selection, help defense and passing reads
##   foul_rate    – fouls called on the CPU's defenders (the user's get the inverse)

const LEVELS := ["rookie", "pro", "all_star", "superstar", "hall_of_fame"]
const NAMES := ["Rookie", "Pro", "All-Star", "Superstar", "Hall of Fame"]
const TABLE := {
	"rookie":       {"user_window": 1.55, "cpu_make": 0.8,  "cpu_defense": 0.55, "cpu_iq": 0.55, "foul_rate": 1.2},
	"pro":          {"user_window": 1.2,  "cpu_make": 0.92, "cpu_defense": 0.8,  "cpu_iq": 0.75, "foul_rate": 1.05},
	"all_star":     {"user_window": 1.0,  "cpu_make": 1.0,  "cpu_defense": 1.0,  "cpu_iq": 0.9,  "foul_rate": 1.0},
	"superstar":    {"user_window": 0.85, "cpu_make": 1.06, "cpu_defense": 1.15, "cpu_iq": 1.0,  "foul_rate": 0.9},
	"hall_of_fame": {"user_window": 0.7,  "cpu_make": 1.12, "cpu_defense": 1.3,  "cpu_iq": 1.1,  "foul_rate": 0.8},
}


static func level() -> String:
	var l := str(Settings.get_value("gameplay", "difficulty"))
	return l if TABLE.has(l) else "pro"


static func value(key: String, lvl := "") -> float:
	return float(TABLE[lvl if lvl != "" else level()].get(key, 1.0))
