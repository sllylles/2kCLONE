class_name ShotMeter
extends Control
## The shot meter drawn beside the shooter. It fills from the start of the
## shot to the ideal release; the green band is the timing window (bigger for
## better, more open, fresher shooters). After the release it shows where you
## let go and the grade. Style comes from Settings > Gameplay > Shot meter.

const FILL_PAST := 1.25        # meter keeps filling a bit past perfect

var camera: Camera3D
var _player: CourtPlayer
var _window := 0.03
var _ideal := 0.6
var _active := false
var _released_at := -1.0      # fill fraction where the player let go
var _grade := ""
var _grade_good := false
var _fade := 0.0


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func start(player: CourtPlayer, window: float, ideal: float) -> void:
	_player = player
	_window = window
	_ideal = maxf(0.1, ideal)
	_active = true
	_released_at = -1.0
	_grade = ""
	_fade = 1.0


func show_grade(player: CourtPlayer, grade: String, good: bool, offset: float) -> void:
	_player = player
	_released_at = clampf((_ideal + offset) / _ideal, 0.0, FILL_PAST)
	_grade = grade
	_grade_good = good
	_active = false
	_fade = 1.6


func _style() -> String:
	return str(Settings.get_value("gameplay", "meter_style"))


func _fill() -> float:
	if _player == null or _player.anim.action == "":
		return _released_at if _released_at >= 0.0 else 0.0
	return clampf(_player.anim.action_time / _ideal, 0.0, FILL_PAST)


func _process(delta: float) -> void:
	if not _active:
		_fade = maxf(0.0, _fade - delta)
	queue_redraw()


func _anchor() -> Vector2:
	if camera == null or _player == null or not is_instance_valid(_player):
		return Vector2(-1000, -1000)
	var head := _player.global_position + Vector3(0, _player.avatar.height_m + 0.25, 0)
	if camera.is_position_behind(head):
		return Vector2(-1000, -1000)
	return camera.unproject_position(head)


func _draw() -> void:
	if _fade <= 0.0 or _player == null:
		return
	var a := clampf(_fade, 0.0, 1.0)
	var p := _anchor()
	var style := _style()
	if style != "off":
		var fill := _fill() if _active else _released_at
		var green := clampf(_window / _ideal, 0.015, 0.25)
		if style == "bar":
			_draw_bar(p + Vector2(70, -10), fill, green, a)
		else:
			_draw_arc(p + Vector2(0, 30), fill, green, a)
	if _grade != "":
		var font := UIKit.font(900, true)
		var col := Color(0.35, 1.0, 0.45, a) if _grade_good else Color(1.0, 0.55, 0.2, a)
		var size := 30
		var w := font.get_string_size(_grade, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		var tp := p + Vector2(-w / 2.0, -46)
		draw_string_outline(font, tp, _grade, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 8, Color(0, 0, 0, a * 0.8))
		draw_string(font, tp, _grade, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)


## Arc on the right of the player: bottom = start, top = past perfect.
func _draw_arc(c: Vector2, fill: float, green: float, a: float) -> void:
	var r := 62.0
	var a0 := deg_to_rad(80.0)       # bottom
	var a1 := deg_to_rad(-80.0)      # top
	var to_angle := func(f: float) -> float: return lerpf(a0, a1, f / FILL_PAST)
	draw_arc(c, r, a0, a1, 40, Color(0, 0, 0, 0.55 * a), 16.0, true)
	draw_arc(c, r, to_angle.call(1.0 - green), to_angle.call(1.0 + green), 12, Color(0.3, 1.0, 0.4, 0.9 * a), 12.0, true)
	if fill > 0.0:
		var col := Color(1, 1, 1, 0.95 * a)
		draw_arc(c, r, a0, to_angle.call(minf(fill, FILL_PAST)), 32, col, 8.0, true)
	if _released_at >= 0.0:
		var ang: float = to_angle.call(_released_at)
		var dir := Vector2(cos(ang), sin(ang))
		var tick := Color(0.35, 1.0, 0.45, a) if _grade_good else Color(1.0, 0.45, 0.2, a)
		draw_line(c + dir * (r - 14), c + dir * (r + 14), tick, 5.0, true)


func _draw_bar(o: Vector2, fill: float, green: float, a: float) -> void:
	var h := 150.0
	var w := 16.0
	var rect := Rect2(o + Vector2(0, -h), Vector2(w, h))
	draw_rect(rect.grow(3), Color(0, 0, 0, 0.6 * a))
	var y_of := func(f: float) -> float: return o.y - h * (f / FILL_PAST)
	var gy0: float = y_of.call(1.0 + green)
	var gy1: float = y_of.call(1.0 - green)
	draw_rect(Rect2(o.x, gy0, w, gy1 - gy0), Color(0.3, 1.0, 0.4, 0.9 * a))
	if fill > 0.0:
		var fy: float = y_of.call(minf(fill, FILL_PAST))
		draw_rect(Rect2(o.x + 3, fy, w - 6, o.y - fy), Color(1, 1, 1, 0.9 * a))
	if _released_at >= 0.0:
		var ty: float = y_of.call(_released_at)
		var tick := Color(0.35, 1.0, 0.45, a) if _grade_good else Color(1.0, 0.45, 0.2, a)
		draw_line(Vector2(o.x - 8, ty), Vector2(o.x + w + 8, ty), tick, 5.0)
