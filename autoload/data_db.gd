extends Node
## Loads the editable JSON game data under res://data. Nothing in here is
## hard-coded so teams, rosters, arenas and camera presets can be tuned
## without touching code.
##
## Local overrides: any file placed at user://data/<name>.json replaces the
## bundled res://data/<name>.json (handy for custom rosters on a device).

const DATA_DIR := "res://data"
const OVERRIDE_DIR := "user://data"

var teams: Array = []          # Array[Dictionary]
var players: Array = []        # Array[Dictionary]
var arenas: Array = []
var camera_presets: Array = []

var _teams_by_id := {}
var _arenas_by_id := {}
var _logo_cache := {}


func _ready() -> void:
	reload()


func reload() -> void:
	teams = load_json("teams").get("teams", [])
	players = load_json("players").get("players", [])
	arenas = load_json("arenas").get("arenas", [])
	camera_presets = load_json("camera_presets").get("presets", [])
	_teams_by_id.clear()
	for t in teams:
		_teams_by_id[t.id] = t
	_arenas_by_id.clear()
	for a in arenas:
		_arenas_by_id[a.id] = a
	_logo_cache.clear()


static func load_json(name: String) -> Dictionary:
	var path := "%s/%s.json" % [OVERRIDE_DIR, name]
	if not FileAccess.file_exists(path):
		path = "%s/%s.json" % [DATA_DIR, name]
	var text := FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_error("DataDB: missing %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(text)
	if parsed is Dictionary:
		return parsed
	push_error("DataDB: %s is not a JSON object" % path)
	return {}


func team(id: String) -> Dictionary:
	return _teams_by_id.get(id, teams[0] if not teams.is_empty() else {})


func arena(id: String) -> Dictionary:
	return _arenas_by_id.get(id, arenas[0] if not arenas.is_empty() else {})


func roster(team_id: String) -> Array:
	var out: Array = []
	for p in players:
		if p.team == team_id:
			out.append(p)
	out.sort_custom(func(a, b): return a.get("overall", 0) > b.get("overall", 0))
	return out


func camera_preset(id: String) -> Dictionary:
	for p in camera_presets:
		if p.id == id:
			return p
	return camera_presets[0] if not camera_presets.is_empty() else {}


static func color(hex: String, fallback := Color.WHITE) -> Color:
	return Color.from_string(hex, fallback)


## Returns the team's logo texture: a PNG from the team's "logo" field if it
## exists (res:// or user://), otherwise null so callers draw a generated badge.
func team_logo(team_id: String) -> Texture2D:
	if _logo_cache.has(team_id):
		return _logo_cache[team_id]
	var tex: Texture2D = null
	var path: String = team(team_id).get("logo", "")
	if not path.is_empty():
		if path.begins_with("res://") and ResourceLoader.exists(path):
			tex = load(path)
		elif FileAccess.file_exists(path):
			var img := Image.load_from_file(path)
			if img:
				tex = ImageTexture.create_from_image(img)
	_logo_cache[team_id] = tex
	return tex
