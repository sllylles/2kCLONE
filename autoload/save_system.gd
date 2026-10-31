extends Node
## Multi-slot save system. Each slot is one JSON file in user://saves.
## Writes go to a temp file first and the previous save is kept as .bak, so a
## crash mid-write never loses a profile.

signal slot_saved(slot: int)
signal slot_loaded(slot: int)
signal slot_deleted(slot: int)

const SLOT_COUNT := 4
const SAVE_VERSION := 1

var save_dir := "user://saves"
var active_slot := -1
var data: Dictionary = {}
var _session_start_ms := 0


func _ready() -> void:
	var last := int(Settings.get_value("profile", "last_slot")) if has_node("/root/Settings") else -1
	if last >= 0 and slot_exists(last):
		load_slot(last)


func slot_path(slot: int) -> String:
	return "%s/slot_%d.json" % [save_dir, slot]


func new_game_data(profile_name: String) -> Dictionary:
	var now := Time.get_unix_time_from_system()
	return {
		"version": SAVE_VERSION,
		"profile_name": profile_name,
		"created_at": now,
		"updated_at": now,
		"playtime_sec": 0.0,
		"currency": {"coins": 0},   # earned in-game only; there is no store
		"myplayer_builds": [],
		"career": {},
		"franchise": {},
		"stats": {"games_played": 0},
	}


func slot_exists(slot: int) -> bool:
	return FileAccess.file_exists(slot_path(slot)) or FileAccess.file_exists(slot_path(slot) + ".bak")


func create_slot(slot: int, profile_name: String) -> Error:
	var d := new_game_data(profile_name)
	var err := write_slot(slot, d)
	if err == OK:
		_activate(slot, d)
	return err


func write_slot(slot: int, d: Dictionary) -> Error:
	if slot < 0 or slot >= SLOT_COUNT:
		return ERR_PARAMETER_RANGE_ERROR
	DirAccess.make_dir_recursive_absolute(save_dir)
	d["version"] = SAVE_VERSION
	d["updated_at"] = Time.get_unix_time_from_system()
	var final_path := slot_path(slot)
	var tmp_path := final_path + ".tmp"
	var f := FileAccess.open(tmp_path, FileAccess.WRITE)
	if f == null:
		return FileAccess.get_open_error()
	f.store_string(JSON.stringify(d, "\t"))
	f.close()
	var dir := DirAccess.open(save_dir)
	if dir == null:
		return DirAccess.get_open_error()
	if FileAccess.file_exists(final_path):
		dir.copy(final_path, final_path + ".bak")
		dir.remove(final_path)
	var err := dir.rename(tmp_path, final_path)
	if err == OK:
		slot_saved.emit(slot)
	return err


## Saves the active profile, folding in playtime since the last save.
func save_active() -> Error:
	if active_slot < 0:
		return ERR_UNCONFIGURED
	var now := Time.get_ticks_msec()
	data["playtime_sec"] = float(data.get("playtime_sec", 0.0)) + (now - _session_start_ms) / 1000.0
	_session_start_ms = now
	return write_slot(active_slot, data)


func read_slot(slot: int) -> Dictionary:
	for path in [slot_path(slot), slot_path(slot) + ".bak"]:
		if not FileAccess.file_exists(path):
			continue
		var json := JSON.new()
		if json.parse(FileAccess.get_file_as_string(path)) == OK and json.data is Dictionary \
				and json.data.has("version"):
			return migrate(json.data)
		push_warning("SaveSystem: %s is corrupt, trying backup" % path)
	return {}


func load_slot(slot: int) -> bool:
	var d := read_slot(slot)
	if d.is_empty():
		return false
	_activate(slot, d)
	slot_loaded.emit(slot)
	return true


func delete_slot(slot: int) -> void:
	var dir := DirAccess.open(save_dir)
	if dir:
		for suffix in ["", ".bak", ".tmp"]:
			if FileAccess.file_exists(slot_path(slot) + suffix):
				dir.remove(slot_path(slot) + suffix)
	if slot == active_slot:
		active_slot = -1
		data = {}
		_remember_slot(-1)
	slot_deleted.emit(slot)


## Lightweight info for the slot picker.
func list_slots() -> Array:
	var out: Array = []
	for i in SLOT_COUNT:
		var d := read_slot(i)
		out.append({
			"slot": i,
			"exists": not d.is_empty(),
			"profile_name": d.get("profile_name", ""),
			"updated_at": float(d.get("updated_at", 0)),
			"playtime_sec": float(d.get("playtime_sec", 0)),
		})
	return out


## Upgrades older save files in place. Add a step here whenever SAVE_VERSION bumps.
func migrate(d: Dictionary) -> Dictionary:
	var v := int(d.get("version", 0))
	if v < 1:
		var fresh := new_game_data(str(d.get("profile_name", "Player")))
		fresh.merge(d, true)
		d = fresh
		d["version"] = 1
	return d


func _activate(slot: int, d: Dictionary) -> void:
	active_slot = slot
	data = d
	_session_start_ms = Time.get_ticks_msec()
	_remember_slot(slot)


func _remember_slot(slot: int) -> void:
	if is_inside_tree() and has_node("/root/Settings"):
		Settings.set_value("profile", "last_slot", slot)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED:
		if active_slot >= 0:
			save_active()
