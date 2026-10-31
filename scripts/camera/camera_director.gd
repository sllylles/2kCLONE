class_name CameraDirector
extends Node3D
## Owns the single gameplay Camera3D and decides where it goes:
##  * LIVE   – one of the data-driven presets (data/camera_presets.json), each
##             with its own zoom/height sliders, smoothed and blended on change
##  * INTRO  – the pre-game flyover along a spline through the arena
##  * REPLAY – cinematic replay angles around a recorded play
## All framing math is in feet and lives in static functions so it can be
## unit tested without a scene.

signal intro_finished
signal preset_changed(id: String, display_name: String)

enum Mode { LIVE, INTRO, REPLAY }

const FT := CourtSpec.FT
const BLEND_TIME := 0.8
const INTRO_TIME := 11.0
const REPLAY_ANGLES := ["baseline_low", "rim", "orbit", "tele"]

var camera: Camera3D
var mode := Mode.LIVE
var preset: Dictionary = {}
var sliders := {"zoom": 5.0, "height": 5.0}

var focus: Node3D              # usually the ball
var drive_subject: Node3D      # the user-controlled player
var attack_side := 1           # basket the offense is attacking (+1 / -1)

var _focus_s := Vector3.ZERO   # smoothed focus point (feet)
var _pose := {}                # current pose {pos, look, fov} (feet)
var _blend_from := {}
var _blend_t := 1.0
var _intro_curve: Curve3D
var _intro_looks: Array[Vector3] = []
var _intro_t := 0.0
var _replay_t := 0.0
var _replay_len := 1.0
var _replay_angles: Array = []
var _orbit_center := Vector3.ZERO


func _ready() -> void:
	camera = Camera3D.new()
	camera.name = "GameCamera"
	camera.near = 0.1
	camera.far = 260.0
	add_child(camera)
	camera.make_current()
	set_preset(str(Settings.get_value("camera", "preset")), false)
	Settings.changed.connect(_on_settings_changed)


func set_preset(id: String, blend := true) -> void:
	preset = DataDB.camera_preset(id)
	sliders = Settings.get_camera_sliders(preset.get("id", id))
	if blend and not _pose.is_empty():
		_blend_from = _pose.duplicate()
		_blend_t = 0.0
	preset_changed.emit(preset.get("id", id), preset.get("name", id))


func cycle_preset(step := 1) -> void:
	var ids: Array = DataDB.camera_presets.map(func(p): return p.id)
	var i := ids.find(preset.get("id", ""))
	var next: String = ids[posmod(i + step, ids.size())]
	Settings.set_value("camera", "preset", next)   # triggers set_preset via changed


func _on_settings_changed(section: String, key: String, _value: Variant) -> void:
	if section != "camera":
		return
	if key == "preset":
		set_preset(str(Settings.get_value("camera", "preset")))
	elif key == "sliders":
		sliders = Settings.get_camera_sliders(preset.get("id", ""))


# --- Framing math (feet) -----------------------------------------------------------

static func preset_pose(p: Dictionary, s: Dictionary, focus_ft: Vector3, side: int,
		drive_pos_ft := Vector3.ZERO, drive_dir := Vector3.ZERO) -> Dictionary:
	var z01 := clampf(float(s.get("zoom", 5.0)) / 10.0, 0.0, 1.0)
	var h01 := clampf(float(s.get("height", 5.0)) / 10.0, 0.0, 1.0)
	var heights: Array = p.get("height", [20, 30])
	var dists: Array = p.get("distance", [70, 50])
	var fovs: Array = p.get("fov", [40, 30])
	var height := lerpf(heights[0], heights[1], h01)
	var dist := lerpf(dists[0], dists[1], z01)
	var fov := lerpf(fovs[0], fovs[1], z01)
	var look_h := float(p.get("look_height", 2.0))
	var lead := float(p.get("lead", 0.0)) * side
	var track := float(p.get("track", 0.8))
	var pos: Vector3
	var look: Vector3
	match str(p.get("type", "sideline")):
		"drive":
			var dir := drive_dir
			dir.y = 0.0
			if dir.length() < 0.01:
				dir = Vector3(side, 0, 0)
			dir = dir.normalized()
			pos = drive_pos_ft - dir * dist + Vector3(0, height, 0)
			look = drive_pos_ft + dir * float(p.get("lead", 0.0)) + Vector3(0, look_h, 0)
		"end":
			var basket_x := side * CourtSpec.basket_x()
			var cam_x := focus_ft.x - side * (dist + 14.0)
			cam_x = clampf(cam_x, -CourtSpec.HALF_LENGTH - 8.0, CourtSpec.HALF_LENGTH + 8.0)
			pos = Vector3(cam_x, height, focus_ft.z * 0.5)
			look = Vector3(lerpf(focus_ft.x, basket_x, 0.55), look_h, focus_ft.z * 0.35)
		_:
			# Sideline cameras sit on the +Z side, opposite the benches.
			pos = Vector3(focus_ft.x * track, height, focus_ft.z * 0.25 + dist)
			look = Vector3(focus_ft.x + lead, look_h, focus_ft.z * 0.6)
	return {"pos": pos, "look": look, "fov": fov}


static func replay_pose(angle: String, focus_ft: Vector3, side: int, t: float) -> Dictionary:
	match angle:
		"baseline_low":
			return {"pos": Vector3(side * (CourtSpec.HALF_LENGTH + 8.0), 4.0, focus_ft.z * 0.5 + 12.0),
				"look": focus_ft + Vector3(0, 3, 0), "fov": 34.0}
		"rim":
			var b := CourtSpec.basket_position(side) / FT
			return {"pos": b + Vector3(side * 1.2, 3.2, 0.0), "look": focus_ft + Vector3(0, 2, 0), "fov": 58.0}
		"orbit":
			var a := 0.6 + t * 0.35
			return {"pos": focus_ft + Vector3(sin(a) * 24.0, 7.0, cos(a) * 24.0), "look": focus_ft + Vector3(0, 4, 0), "fov": 42.0}
		_:
			return {"pos": Vector3(-side * 30.0, 32.0, 72.0), "look": focus_ft + Vector3(0, 4, 0), "fov": 16.0}


static func lerp_pose(a: Dictionary, b: Dictionary, t: float) -> Dictionary:
	return {"pos": (a.pos as Vector3).lerp(b.pos, t), "look": (a.look as Vector3).lerp(b.look, t),
		"fov": lerpf(a.fov, b.fov, t)}


# --- Modes ----------------------------------------------------------------------------

func start_intro() -> void:
	mode = Mode.INTRO
	_intro_t = 0.0
	_intro_curve = Curve3D.new()
	var pts: Array[Vector3] = [
		Vector3(-95, 88, 75), Vector3(-55, 66, 58), Vector3(-5, 44, 46), Vector3(34, 18, 26),
		Vector3(30, 9, 6), Vector3(10, 11, -22), Vector3(-16, 12, -6), Vector3(0, 26, 72)]
	_intro_looks = [
		Vector3(0, 62, 0), Vector3(0, 50, 0), Vector3(0, 10, 0), Vector3(41, 9, 0),
		Vector3(41, 10, 0), Vector3(0, 0, 0), Vector3(0, 0, 0), Vector3(0, 2, 0)]
	for i in pts.size():
		var prev := pts[maxi(i - 1, 0)]
		var next := pts[mini(i + 1, pts.size() - 1)]
		var tg := (next - prev) / 6.0
		_intro_curve.add_point(pts[i], -tg, tg)


func skip_intro() -> void:
	if mode == Mode.INTRO:
		_end_intro()


func _end_intro() -> void:
	mode = Mode.LIVE
	_blend_from = _pose.duplicate()
	_blend_t = 0.0
	intro_finished.emit()


func start_replay(duration: float, side: int, focus_point_ft: Vector3) -> void:
	mode = Mode.REPLAY
	_replay_t = 0.0
	_replay_len = duration
	attack_side = side
	_orbit_center = focus_point_ft
	var pool := REPLAY_ANGLES.duplicate()
	pool.shuffle()
	_replay_angles = pool.slice(0, 2)


func end_replay() -> void:
	mode = Mode.LIVE
	_blend_t = 1.0
	_pose = {}


func _process(delta: float) -> void:
	var f := _focus_ft()
	var k := 1.0 - exp(-float(preset.get("smooth", 3.0)) * delta)
	_focus_s = f if _pose.is_empty() else _focus_s.lerp(f, k)
	var target: Dictionary
	match mode:
		Mode.INTRO:
			_intro_t += delta
			var u := smoothstep(0.0, 1.0, clampf(_intro_t / INTRO_TIME, 0.0, 1.0))
			var length := _intro_curve.get_baked_length()
			var pos := _intro_curve.sample_baked(u * length, true)
			var seg := u * (_intro_looks.size() - 1)
			var i := mini(int(seg), _intro_looks.size() - 2)
			var look := _intro_looks[i].lerp(_intro_looks[i + 1], smoothstep(0.0, 1.0, seg - i))
			_pose = {"pos": pos, "look": look, "fov": lerpf(55.0, 38.0, u)}
			_apply(_pose)
			if _intro_t >= INTRO_TIME:
				_end_intro()
			return
		Mode.REPLAY:
			_replay_t += delta
			var half := _replay_len / 2.0
			var angle: String = _replay_angles[0 if _replay_t < half else 1]
			_apply(replay_pose(angle, f, attack_side, _replay_t))
			return
	target = preset_pose(preset, sliders, _focus_s, attack_side, _drive_pos_ft(), _drive_dir())
	if _pose.is_empty():
		_pose = target
	else:
		var pk := 1.0 - exp(-float(preset.get("smooth", 3.0)) * 1.4 * delta)
		_pose = lerp_pose(_pose, target, pk)
	var shown := _pose
	if _blend_t < 1.0:
		_blend_t = minf(1.0, _blend_t + delta / BLEND_TIME)
		shown = lerp_pose(_blend_from, _pose, smoothstep(0.0, 1.0, _blend_t))
	_apply(shown)


func _apply(p: Dictionary) -> void:
	var pos: Vector3 = p.pos * FT
	var look: Vector3 = p.look * FT
	camera.fov = p.fov
	if pos.distance_squared_to(look) > 0.0001:
		camera.look_at_from_position(pos, look, Vector3.UP)


func _focus_ft() -> Vector3:
	if focus == null:
		return Vector3.ZERO
	var f := focus.global_position / FT
	f.x = clampf(f.x, -CourtSpec.HALF_LENGTH, CourtSpec.HALF_LENGTH)
	f.z = clampf(f.z, -CourtSpec.HALF_WIDTH, CourtSpec.HALF_WIDTH)
	f.y = 0.0
	return f


func _drive_pos_ft() -> Vector3:
	if drive_subject == null:
		return _focus_s
	var p := drive_subject.global_position / FT
	p.y = 0.0
	return p


func _drive_dir() -> Vector3:
	var p := _drive_pos_ft()
	var basket := Vector3(attack_side * CourtSpec.basket_x(), 0, 0)
	return basket - p
