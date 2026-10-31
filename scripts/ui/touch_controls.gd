class_name TouchControls
extends Control
## On-screen controls. Everything is drawn in _draw() and multi-touch is
## handled in _input() so several fingers work at once. Pressing a control
## presses the matching InputMap action, so gameplay code is device agnostic.
##
## Left half: floating move stick. Right side: Shoot, Pass, Sprint, plus a
## swipe "pro stick" zone. On defense the buttons relabel to Block / Steal /
## Switch. Top right: camera, replay, pause.

const STICK_RADIUS := 120.0
const SWIPE_MIN := 60.0
const PULSE_TIME := 0.18

var defense := false
## Layout editor: buttons can be dragged and nothing is pressed.
var edit_mode := false
var _dragging := {}          # touch index -> button dict
var _buttons: Array[Dictionary] = []
var _stick_touch := -1
var _stick_origin := Vector2.ZERO
var _stick_pos := Vector2.ZERO
var _pro_touch := -1
var _pro_start := Vector2.ZERO
var _pro_pulse := ""
var _pro_pulse_t := 0.0
var _scale := 1.0
var _opacity := 0.55


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_buttons = [
		{"id": "shoot", "action": "shoot", "def_action": "block", "label": "SHOOT", "def_label": "BLOCK", "r": 100.0, "hold": true},
		{"id": "pass", "action": "pass", "def_action": "steal", "label": "PASS", "def_label": "STEAL", "r": 76.0, "hold": false},
		{"id": "sprint", "action": "sprint", "def_action": "sprint", "label": "SPRINT", "def_label": "SPRINT", "r": 70.0, "hold": true},
		{"id": "switch", "action": "", "def_action": "switch", "label": "", "def_label": "SWITCH", "r": 58.0, "hold": false},
		{"id": "camera", "action": "camera_next", "def_action": "camera_next", "label": "CAM", "def_label": "CAM", "r": 40.0, "hold": false, "top": true},
		{"id": "replay", "action": "replay", "def_action": "replay", "label": "REPLAY", "def_label": "REPLAY", "r": 40.0, "hold": false, "top": true},
		{"id": "pause", "action": "pause", "def_action": "pause", "label": "II", "def_label": "II", "r": 40.0, "hold": false, "top": true},
	]
	for b in _buttons:
		b["touch"] = -1
		b["center"] = Vector2.ZERO
	Settings.changed.connect(func(_s, _k, _v): _refresh_settings())
	InputRouter.device_changed.connect(func(_d): _refresh_settings())
	get_viewport().size_changed.connect(_layout)
	_refresh_settings()
	_layout()


func _refresh_settings() -> void:
	_scale = float(Settings.get_value("controls", "button_scale"))
	_opacity = float(Settings.get_value("controls", "button_opacity"))
	var on := InputRouter.touch_controls_visible() or edit_mode
	if visible and not on:
		release_all()
	visible = on
	set_process_input(on)
	_layout()


func set_defense(on: bool) -> void:
	if on == defense:
		return
	release_all()
	defense = on
	queue_redraw()


func release_all() -> void:
	for b in _buttons:
		if b.touch != -1:
			_release_button(b)
	_stick_touch = -1
	for a in ["move_left", "move_right", "move_up", "move_down"]:
		Input.action_release(a)
	_pro_touch = -1
	queue_redraw()


func _layout() -> void:
	var s := get_viewport_rect().size
	var k := _scale
	var by := s.y - 40.0
	var positions := {
		"shoot": Vector2(s.x - 150.0 * k, by - 130.0 * k),
		"pass": Vector2(s.x - 350.0 * k, by - 70.0 * k),
		"sprint": Vector2(s.x - 330.0 * k, by - 270.0 * k),
		"switch": Vector2(s.x - 140.0 * k, by - 330.0 * k),
		"camera": Vector2(s.x - 290.0, 70.0),
		"replay": Vector2(s.x - 190.0, 70.0),
		"pause": Vector2(s.x - 80.0, 70.0),
	}
	var custom: Dictionary = Settings.get_value("controls", "layout")
	for b in _buttons:
		b.center = positions[b.id]
		if custom.has(b.id):
			var f: Array = custom[b.id]
			b.center = Vector2(float(f[0]) * s.x, float(f[1]) * s.y)
	queue_redraw()


## Saves the current button positions as screen fractions.
func save_layout() -> void:
	var s := get_viewport_rect().size
	var out := {}
	for b in _buttons:
		out[b.id] = [b.center.x / s.x, b.center.y / s.y]
	Settings.set_value("controls", "layout", out)


func reset_layout() -> void:
	Settings.set_value("controls", "layout", {})
	_layout()


func _pro_zone() -> Rect2:
	var s := get_viewport_rect().size
	return Rect2(s.x * 0.52, s.y * 0.16, s.x * 0.48 - 420.0 * _scale, s.y * 0.5)


func _button_at(p: Vector2) -> Dictionary:
	for b in _buttons:
		var action: String = b.def_action if defense else b.action
		if action == "":
			continue
		var r: float = b.r * (1.0 if b.get("top", false) else _scale) * 1.15
		if p.distance_to(b.center) <= r:
			return b
	return {}


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_touch_down(event.index, event.position)
		else:
			_touch_up(event.index, event.position)
	elif event is InputEventScreenDrag:
		_touch_drag(event.index, event.position)


func _touch_down(idx: int, p: Vector2) -> void:
	if edit_mode:
		for eb in _buttons:
			if p.distance_to(eb.center) <= eb.r * 1.2 * (1.0 if eb.get("top", false) else _scale):
				_dragging[idx] = eb
				get_viewport().set_input_as_handled()
				return
		return
	var b := _button_at(p)
	if not b.is_empty():
		b.touch = idx
		var action: String = b.def_action if defense else b.action
		Input.action_press(action)
		if not b.hold:
			# Tap buttons fire once; release on the next frame.
			_release_later(b, idx)
		InputRouter.vibrate(12, 0.3)
		get_viewport().set_input_as_handled()
		queue_redraw()
		return
	if _pro_zone().has_point(p) and _pro_touch == -1:
		_pro_touch = idx
		_pro_start = p
		InputRouter.touch_pro_begin()     # resting finger = jump shot (see InputRouter)
		get_viewport().set_input_as_handled()
		return
	if p.x < get_viewport_rect().size.x * 0.45 and _stick_touch == -1:
		_stick_touch = idx
		_stick_origin = p
		_stick_pos = p
		get_viewport().set_input_as_handled()
		queue_redraw()


func _release_later(b: Dictionary, idx: int) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	if b.touch == idx:
		_release_button(b)


func _release_button(b: Dictionary) -> void:
	b.touch = -1
	Input.action_release(b.action if b.action != "" else b.def_action)
	Input.action_release(b.def_action)
	queue_redraw()


func _touch_up(idx: int, p: Vector2) -> void:
	if edit_mode:
		if _dragging.has(idx):
			_dragging.erase(idx)
			save_layout()
		return
	for b in _buttons:
		if b.touch == idx:
			_release_button(b)
			return
	if idx == _stick_touch:
		_stick_touch = -1
		for a in ["move_left", "move_right", "move_up", "move_down"]:
			Input.action_release(a)
		queue_redraw()
	elif idx == _pro_touch:
		_pro_touch = -1
		_fire_swipe(p - _pro_start)
		InputRouter.touch_pro_end()


func _touch_drag(idx: int, p: Vector2) -> void:
	if edit_mode:
		if _dragging.has(idx):
			var s := get_viewport_rect().size
			_dragging[idx].center = p.clamp(Vector2(40, 40), s - Vector2(40, 40))
			queue_redraw()
		return
	if idx == _stick_touch:
		var r := STICK_RADIUS * _scale
		var v := p - _stick_origin
		if v.length() > r:
			# Drag the base along so the stick never feels stuck at the edge.
			_stick_origin = p - v.normalized() * r
			v = v.normalized() * r
		_stick_pos = _stick_origin + v
		var n := v / r
		_press_axis("move_left", "move_right", n.x)
		_press_axis("move_up", "move_down", n.y)
		queue_redraw()
	elif idx == _pro_touch and (p - _pro_start).length() > SWIPE_MIN:
		_fire_swipe(p - _pro_start)
		_pro_start = p


func _press_axis(neg: String, pos: String, v: float) -> void:
	if v < 0.0:
		Input.action_press(neg, -v)
		Input.action_release(pos)
	elif v > 0.0:
		Input.action_press(pos, v)
		Input.action_release(neg)
	else:
		Input.action_release(neg)
		Input.action_release(pos)


func _fire_swipe(d: Vector2) -> void:
	if d.length() < SWIPE_MIN:
		return
	var dir := ""
	if absf(d.x) > absf(d.y):
		dir = "right" if d.x > 0 else "left"
	else:
		dir = "down" if d.y > 0 else "up"
	_pro_pulse = dir
	_pro_pulse_t = PULSE_TIME
	InputRouter.touch_pro_swipe(dir)
	InputRouter.vibrate(10, 0.25)


func _process(delta: float) -> void:
	if _pro_pulse_t > 0.0:
		_pro_pulse_t -= delta
		if _pro_pulse_t <= 0.0:
			_pro_pulse = ""
		queue_redraw()


func _draw() -> void:
	var a := _opacity
	var font := UIKit.font(900, true)
	# Pro stick zone
	var z := _pro_zone()
	var zc := Color(1, 1, 1, 0.06 * a / 0.55)
	if _pro_pulse != "":
		zc = Color(UIKit.ACCENT_2, 0.25)
	draw_rect(z, zc, true)
	draw_rect(z, Color(1, 1, 1, 0.15 * a), false, 2.0)
	draw_string(font, z.position + Vector2(16, 34), "SWIPE: MOVES  •  HOLD: SHOOT", HORIZONTAL_ALIGNMENT_LEFT, -1, 20,
		Color(1, 1, 1, 0.35 * a))
	# Move stick
	if _stick_touch != -1:
		var r := STICK_RADIUS * _scale
		draw_circle(_stick_origin, r, Color(1, 1, 1, 0.12 * a))
		draw_arc(_stick_origin, r, 0, TAU, 48, Color(1, 1, 1, 0.5 * a), 3.0, true)
		draw_circle(_stick_pos, r * 0.42, Color(1, 1, 1, 0.55 * a))
	else:
		var hint := Vector2(220, get_viewport_rect().size.y - 220) * Vector2(1, 1)
		draw_arc(hint, STICK_RADIUS * _scale, 0, TAU, 48, Color(1, 1, 1, 0.18 * a), 2.0, true)
		draw_string(font, hint + Vector2(-50, 8), "MOVE", HORIZONTAL_ALIGNMENT_LEFT, -1, 22, Color(1, 1, 1, 0.3 * a))
	# Buttons
	for b in _buttons:
		var action: String = b.def_action if defense else b.action
		if action == "" and not edit_mode:
			continue
		var top: bool = b.get("top", false)
		var r: float = b.r * (1.0 if top else _scale)
		var pressed: bool = b.touch != -1
		var fill := Color(UIKit.ACCENT if b.id == "shoot" else Color(0.15, 0.17, 0.22), (0.9 if pressed else 0.55) * a / 0.55 * 0.6)
		if top:
			fill = Color(0.1, 0.1, 0.12, 0.5)
		draw_circle(b.center, r, fill)
		draw_arc(b.center, r, 0, TAU, 48, Color(1, 1, 1, (0.9 if pressed else 0.5) * minf(1.0, a * 1.5)), 3.0, true)
		var text: String = b.def_label if defense else b.label
		if edit_mode:
			text = b.label if b.label != "" else b.def_label
			if b.def_label != b.label and b.label != "":
				text = "%s/%s" % [b.label, b.def_label]
			draw_arc(b.center, r + 6.0, 0, TAU, 48, UIKit.ACCENT_2, 2.0, true)
		var fs := int((18 if top else 24) * (1.0 if top else _scale))
		var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(font, b.center + Vector2(-w / 2.0, fs * 0.35), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs,
			Color(1, 1, 1, minf(1.0, a * 1.6)))
