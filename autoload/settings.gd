extends Node
## Persistent user settings (user://settings.cfg). Every value has a default in
## DEFAULTS; unknown keys are ignored and bad types fall back to the default.

signal changed(section: String, key: String, value: Variant)

const PATH := "user://settings.cfg"

const DEFAULTS := {
	"graphics": {
		"render_scale": 0.85,      # 3D resolution multiplier (0.5 – 1.0)
		"fps_mode": 60,            # 30 = battery mode, 60, 90, 120
		"quality": "medium",       # low / medium / high
		"crowd_density": 0.7,      # 0 – 1
		"msaa": true,
		"upscaler": "bilinear",    # bilinear / fsr
		"show_debug": false,
	},
	"audio": {
		"master": 0.8,
		"music": 0.6,
		"sfx": 0.9,
		"crowd": 0.8,
	},
	"controls": {
		"show_touch": "auto",      # auto / on / off
		"button_scale": 1.0,       # 0.6 – 1.6
		"button_opacity": 0.55,    # 0.15 – 1.0
		"vibration": true,
		"bindings": {},            # action -> Array of serialized events (InputRouter)
	},
	"camera": {
		"preset": "broadcast",
		"sliders": {},             # preset id -> {"zoom": 0-10, "height": 0-10}
		"intro_flyover": true,
		"auto_replays": true,
	},
	"gameplay": {
		"quarter_minutes": 5,
		"difficulty": "pro",       # rookie / pro / all_star / superstar / hall_of_fame
		"meter_style": "arc",
		"real_player_pct": false,
		"goat_builds": false,      # offline-only toggle used by the MyPlayer builder
	},
	"profile": {
		"last_slot": -1,
	},
}

const QUALITY_LEVELS := ["low", "medium", "high"]
const FPS_MODES := [30, 60, 90, 120]

var _cfg := ConfigFile.new()
var _save_queued := false
var path := PATH


func _ready() -> void:
	load_settings()
	apply_all()


func load_settings() -> void:
	_cfg = ConfigFile.new()
	if FileAccess.file_exists(path):
		var err := _cfg.load(path)
		if err != OK:
			push_warning("Settings: could not read %s (%s); using defaults" % [path, error_string(err)])
			_cfg = ConfigFile.new()


func get_value(section: String, key: String) -> Variant:
	var def: Variant = DEFAULTS.get(section, {}).get(key)
	var v: Variant = _cfg.get_value(section, key, def)
	if def != null and not _same_kind(v, def):
		return def
	return v


func set_value(section: String, key: String, value: Variant, persist := true) -> void:
	var def: Variant = DEFAULTS.get(section, {}).get(key)
	if def != null and not _same_kind(value, def):
		push_warning("Settings: wrong type for %s/%s" % [section, key])
		return
	value = _sanitize(section, key, value)
	_cfg.set_value(section, key, value)
	_apply(section, key)
	changed.emit(section, key, value)
	if persist:
		_queue_save()


func reset_section(section: String) -> void:
	if _cfg.has_section(section):
		_cfg.erase_section(section)
	for key in DEFAULTS.get(section, {}):
		_apply(section, key)
		changed.emit(section, key, get_value(section, key))
	_queue_save()


func save_now() -> Error:
	_save_queued = false
	return _cfg.save(path)


## Camera sliders are stored per preset so each camera remembers its own framing.
func get_camera_sliders(preset_id: String) -> Dictionary:
	var all: Dictionary = get_value("camera", "sliders")
	var s: Dictionary = all.get(preset_id, {})
	return {"zoom": float(s.get("zoom", 5.0)), "height": float(s.get("height", 5.0))}


func set_camera_sliders(preset_id: String, zoom: float, height: float) -> void:
	var all: Dictionary = get_value("camera", "sliders").duplicate(true)
	all[preset_id] = {"zoom": clampf(zoom, 0.0, 10.0), "height": clampf(height, 0.0, 10.0)}
	set_value("camera", "sliders", all)


func is_battery_mode() -> bool:
	return int(get_value("graphics", "fps_mode")) <= 30


func apply_all() -> void:
	for section in DEFAULTS:
		for key in DEFAULTS[section]:
			_apply(section, key)


## Called by 3D scenes when they enter the tree so viewport settings stick.
func apply_viewport(vp: Viewport) -> void:
	if vp == null:
		return
	vp.scaling_3d_scale = float(get_value("graphics", "render_scale"))
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR if get_value("graphics", "upscaler") == "fsr" \
			else Viewport.SCALING_3D_MODE_BILINEAR
	vp.msaa_3d = Viewport.MSAA_2X if get_value("graphics", "msaa") else Viewport.MSAA_DISABLED


func _apply(section: String, key: String) -> void:
	if not is_inside_tree():
		return
	match section:
		"graphics":
			match key:
				"render_scale", "upscaler", "msaa":
					apply_viewport(get_viewport())
				"fps_mode":
					Engine.max_fps = int(get_value("graphics", "fps_mode"))
		"audio":
			_apply_audio(key)


func _apply_audio(key: String) -> void:
	var bus_name: String = {"master": "Master", "music": "Music", "sfx": "SFX", "crowd": "Crowd"}.get(key, "")
	if bus_name.is_empty():
		return
	var idx := AudioServer.get_bus_index(bus_name)
	if idx < 0:
		AudioServer.add_bus()
		idx = AudioServer.bus_count - 1
		AudioServer.set_bus_name(idx, bus_name)
		AudioServer.set_bus_send(idx, "Master")
	var lin := clampf(float(get_value("audio", key)), 0.0, 1.0)
	AudioServer.set_bus_volume_db(idx, linear_to_db(maxf(lin, 0.0001)))
	AudioServer.set_bus_mute(idx, lin <= 0.001)


func _sanitize(section: String, key: String, value: Variant) -> Variant:
	match section + "/" + key:
		"graphics/render_scale":
			return clampf(float(value), 0.5, 1.0)
		"graphics/fps_mode":
			var best := 60
			for m in FPS_MODES:
				if absi(m - int(value)) < absi(best - int(value)):
					best = m
			return best
		"graphics/quality":
			return value if value in QUALITY_LEVELS else "medium"
		"graphics/crowd_density":
			return clampf(float(value), 0.0, 1.0)
		"controls/button_scale":
			return clampf(float(value), 0.6, 1.6)
		"controls/button_opacity":
			return clampf(float(value), 0.15, 1.0)
		"gameplay/quarter_minutes":
			return clampi(int(value), 1, 12)
	return value


func _same_kind(a: Variant, b: Variant) -> bool:
	var ta := typeof(a)
	var tb := typeof(b)
	if ta == tb:
		return true
	# ConfigFile/JSON may turn floats into ints and back.
	return (ta == TYPE_INT or ta == TYPE_FLOAT) and (tb == TYPE_INT or tb == TYPE_FLOAT)


func _queue_save() -> void:
	if not is_inside_tree():
		save_now()
		return
	if _save_queued:
		return
	_save_queued = true
	# Coalesce slider drags into one disk write.
	await get_tree().create_timer(0.4).timeout
	if _save_queued:
		save_now()


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED:
		if _save_queued:
			save_now()
