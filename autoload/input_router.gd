extends Node
## Single input abstraction for touch, Bluetooth/USB controllers and keyboard.
##
## Every device feeds the same InputMap actions: the touch overlay presses
## actions via Input.action_press(), controllers and keys come through the
## InputMap events registered here. Gameplay code only ever asks
## InputRouter.move_vector() / Input.is_action_*(), never about devices.

signal device_changed(device: String)   # "touch", "gamepad", "keyboard"
signal rebind_finished(action: String, ok: bool)

enum Device { TOUCH, GAMEPAD, KEYBOARD }

## Default bindings. Gamepad uses the Xbox face-button layout
## (A = bottom, B = right, X = left, Y = top).
const DEFAULT_BINDINGS := {
	"move_left":   [{"type": "key", "code": KEY_A}, {"type": "key", "code": KEY_LEFT}, {"type": "axis", "axis": JOY_AXIS_LEFT_X, "value": -1.0}],
	"move_right":  [{"type": "key", "code": KEY_D}, {"type": "key", "code": KEY_RIGHT}, {"type": "axis", "axis": JOY_AXIS_LEFT_X, "value": 1.0}],
	"move_up":     [{"type": "key", "code": KEY_W}, {"type": "key", "code": KEY_UP}, {"type": "axis", "axis": JOY_AXIS_LEFT_Y, "value": -1.0}],
	"move_down":   [{"type": "key", "code": KEY_S}, {"type": "key", "code": KEY_DOWN}, {"type": "axis", "axis": JOY_AXIS_LEFT_Y, "value": 1.0}],
	"pro_left":    [{"type": "key", "code": KEY_J}, {"type": "axis", "axis": JOY_AXIS_RIGHT_X, "value": -1.0}],
	"pro_right":   [{"type": "key", "code": KEY_L}, {"type": "axis", "axis": JOY_AXIS_RIGHT_X, "value": 1.0}],
	"pro_up":      [{"type": "key", "code": KEY_I}, {"type": "axis", "axis": JOY_AXIS_RIGHT_Y, "value": -1.0}],
	"pro_down":    [{"type": "key", "code": KEY_K}, {"type": "axis", "axis": JOY_AXIS_RIGHT_Y, "value": 1.0}],
	"shoot":       [{"type": "key", "code": KEY_SPACE}, {"type": "button", "button": JOY_BUTTON_X}],
	"pass":        [{"type": "key", "code": KEY_E}, {"type": "button", "button": JOY_BUTTON_A}],
	"sprint":      [{"type": "key", "code": KEY_SHIFT}, {"type": "axis", "axis": JOY_AXIS_TRIGGER_RIGHT, "value": 1.0}],
	"steal":       [{"type": "key", "code": KEY_Q}, {"type": "button", "button": JOY_BUTTON_X}],
	"block":       [{"type": "key", "code": KEY_R}, {"type": "button", "button": JOY_BUTTON_Y}],
	"switch":      [{"type": "key", "code": KEY_TAB}, {"type": "button", "button": JOY_BUTTON_A}],
	"camera_next": [{"type": "key", "code": KEY_C}, {"type": "button", "button": JOY_BUTTON_BACK}],
	"replay":      [{"type": "key", "code": KEY_V}, {"type": "button", "button": JOY_BUTTON_DPAD_DOWN}],
	"pause":       [{"type": "key", "code": KEY_ESCAPE}, {"type": "key", "code": KEY_P}, {"type": "button", "button": JOY_BUTTON_START}],
	"debug_toggle": [{"type": "key", "code": KEY_F3}],
}

## Actions shown on the remap screen, with display names.
const REMAPPABLE := {
	"shoot": "Shoot", "pass": "Pass", "sprint": "Sprint",
	"steal": "Steal", "block": "Block", "switch": "Switch Player",
	"camera_next": "Change Camera", "replay": "Instant Replay", "pause": "Pause",
}

const STICK_DEADZONE := 0.18
## Pro stick: a quick flick is a dribble move; holding past this many seconds
## starts a jump shot that releases when the stick (or finger) lets go.
const PRO_HOLD_TIME := 0.22

var device: Device = Device.KEYBOARD
var _pro_t := -1.0           # seconds the pro stick has been deflected, -1 = neutral
var _pro_dir := Vector2.ZERO
var _pro_shooting := false
var _flick := ""
var _shot_started := false
var _touch_hold_t := -1.0     # finger resting in the touch pro-stick zone
var _touch_shooting := false
var _rebinding_action := ""
var _rebinding_gamepad := true


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	register_actions()
	if is_touch_device():
		device = Device.TOUCH
	elif not Input.get_connected_joypads().is_empty():
		device = Device.GAMEPAD
	Input.joy_connection_changed.connect(_on_joy_connection_changed)


func is_touch_device() -> bool:
	return OS.has_feature("mobile") or DisplayServer.is_touchscreen_available()


func device_name() -> String:
	return ["touch", "gamepad", "keyboard"][device]


## Whether the on-screen controls should be drawn right now.
func touch_controls_visible() -> bool:
	match str(Settings.get_value("controls", "show_touch")):
		"on":
			return true
		"off":
			return false
	return device == Device.TOUCH


func move_vector() -> Vector2:
	return Input.get_vector("move_left", "move_right", "move_up", "move_down", STICK_DEADZONE)


func pro_stick_vector() -> Vector2:
	return Input.get_vector("pro_left", "pro_right", "pro_up", "pro_down", STICK_DEADZONE)


## Pro-stick gesture tracking (gamepad right stick, IJKL keys, touch zone).
func _physics_process(delta: float) -> void:
	if _touch_hold_t >= 0.0:
		_touch_hold_t += delta
		if _touch_hold_t >= PRO_HOLD_TIME and not _touch_shooting:
			_touch_shooting = true
			_shot_started = true
	var v := pro_stick_vector()
	if v.length() > 0.55:
		if _pro_t < 0.0:
			_pro_t = 0.0
		_pro_t += delta
		_pro_dir = v
		if _pro_t >= PRO_HOLD_TIME and not _pro_shooting:
			_pro_shooting = true
			_shot_started = true
	elif _pro_t >= 0.0:
		if not _pro_shooting:
			var d := _pro_dir
			if absf(d.x) > absf(d.y):
				_flick = "right" if d.x > 0.0 else "left"
			else:
				_flick = "down" if d.y > 0.0 else "up"
		_pro_t = -1.0
		_pro_shooting = false


## Touch pro-stick zone: finger down / swipe / finger up.
func touch_pro_begin() -> void:
	_touch_hold_t = 0.0


func touch_pro_swipe(dir: String) -> void:
	if not _touch_shooting:
		_flick = dir
		_touch_hold_t = -1.0


func touch_pro_end() -> void:
	_touch_hold_t = -1.0
	_touch_shooting = false


## A completed quick flick since the last call ("left"/"right"/"up"/"down"), or "".
func pro_flick() -> String:
	var f := _flick
	_flick = ""
	return f


## True once when a held pro stick starts a shot.
func pro_shot_started() -> bool:
	var s := _shot_started
	_shot_started = false
	return s


## Still holding the pro-stick shot (release = let go of the shot).
func pro_shot_held() -> bool:
	return _pro_shooting or _touch_shooting


func vibrate(ms: int, amplitude := 0.5) -> void:
	if not Settings.get_value("controls", "vibration"):
		return
	if device == Device.TOUCH:
		Input.vibrate_handheld(ms, amplitude)
	else:
		for id in Input.get_connected_joypads():
			Input.start_joy_vibration(id, amplitude * 0.6, amplitude, ms / 1000.0)


# --- Bindings -----------------------------------------------------------------

func register_actions() -> void:
	var saved: Dictionary = Settings.get_value("controls", "bindings")
	for action in DEFAULT_BINDINGS:
		if not InputMap.has_action(action):
			InputMap.add_action(action, 0.2)
		InputMap.action_erase_events(action)
		var list: Array = saved.get(action, DEFAULT_BINDINGS[action])
		for spec in list:
			var ev := event_from_spec(spec)
			if ev:
				InputMap.action_add_event(action, ev)


func reset_bindings() -> void:
	Settings.set_value("controls", "bindings", {})
	register_actions()


## Waits for the next key (keyboard) or button/trigger (gamepad) and binds it.
func start_rebind(action: String, gamepad: bool) -> void:
	_rebinding_action = action
	_rebinding_gamepad = gamepad


func cancel_rebind() -> void:
	if _rebinding_action != "":
		var a := _rebinding_action
		_rebinding_action = ""
		rebind_finished.emit(a, false)


func is_rebinding() -> bool:
	return _rebinding_action != ""


func binding_label(action: String, gamepad: bool) -> String:
	for ev in InputMap.action_get_events(action):
		var spec := spec_from_event(ev)
		var is_pad: bool = spec.get("type", "") in ["button", "axis"]
		if is_pad == gamepad:
			return describe_spec(spec)
	return "—"


static func event_from_spec(spec: Dictionary) -> InputEvent:
	match str(spec.get("type", "")):
		"key":
			var k := InputEventKey.new()
			k.physical_keycode = int(spec.get("code", 0))
			return k
		"button":
			var b := InputEventJoypadButton.new()
			b.button_index = int(spec.get("button", 0))
			b.device = -1
			return b
		"axis":
			var m := InputEventJoypadMotion.new()
			m.axis = int(spec.get("axis", 0))
			m.axis_value = float(spec.get("value", 1.0))
			m.device = -1
			return m
	return null


static func spec_from_event(ev: InputEvent) -> Dictionary:
	if ev is InputEventKey:
		var code: int = ev.physical_keycode if ev.physical_keycode != 0 else ev.keycode
		return {"type": "key", "code": code}
	if ev is InputEventJoypadButton:
		return {"type": "button", "button": ev.button_index}
	if ev is InputEventJoypadMotion:
		return {"type": "axis", "axis": ev.axis, "value": signf(ev.axis_value)}
	return {}


static func describe_spec(spec: Dictionary) -> String:
	match str(spec.get("type", "")):
		"key":
			return OS.get_keycode_string(int(spec.code))
		"button":
			var names := {JOY_BUTTON_A: "A", JOY_BUTTON_B: "B", JOY_BUTTON_X: "X", JOY_BUTTON_Y: "Y",
				JOY_BUTTON_LEFT_SHOULDER: "LB", JOY_BUTTON_RIGHT_SHOULDER: "RB",
				JOY_BUTTON_BACK: "View", JOY_BUTTON_START: "Menu", JOY_BUTTON_LEFT_STICK: "L3",
				JOY_BUTTON_RIGHT_STICK: "R3", JOY_BUTTON_DPAD_UP: "D-Up", JOY_BUTTON_DPAD_DOWN: "D-Down",
				JOY_BUTTON_DPAD_LEFT: "D-Left", JOY_BUTTON_DPAD_RIGHT: "D-Right"}
			return names.get(int(spec.button), "Btn %d" % int(spec.button))
		"axis":
			var axis := int(spec.axis)
			if axis == JOY_AXIS_TRIGGER_LEFT:
				return "LT"
			if axis == JOY_AXIS_TRIGGER_RIGHT:
				return "RT"
			return "Axis %d%s" % [axis, "+" if float(spec.value) > 0 else "-"]
	return "?"


func _apply_rebind(ev: InputEvent) -> void:
	var action := _rebinding_action
	_rebinding_action = ""
	var new_spec := spec_from_event(ev)
	var specs: Array = []
	for old in InputMap.action_get_events(action):
		var s := spec_from_event(old)
		var is_pad: bool = s.get("type", "") in ["button", "axis"]
		if is_pad != _rebinding_gamepad:
			specs.append(s)      # keep the other device's bindings
	specs.append(new_spec)
	var all: Dictionary = Settings.get_value("controls", "bindings").duplicate(true)
	all[action] = specs
	Settings.set_value("controls", "bindings", all)
	register_actions()
	rebind_finished.emit(action, true)


# --- Device tracking ----------------------------------------------------------

func _input(event: InputEvent) -> void:
	if _rebinding_action != "" and event.is_pressed() and not event.is_echo():
		var ok := false
		if _rebinding_gamepad:
			ok = event is InputEventJoypadButton or (event is InputEventJoypadMotion and absf(event.axis_value) > 0.6)
		else:
			ok = event is InputEventKey
		if event is InputEventKey and event.physical_keycode == KEY_ESCAPE:
			cancel_rebind()
		elif ok:
			_apply_rebind(event)
		get_viewport().set_input_as_handled()
		return

	var new_device := device
	if event is InputEventScreenTouch or event is InputEventScreenDrag:
		new_device = Device.TOUCH
	elif event is InputEventJoypadButton or (event is InputEventJoypadMotion and absf(event.axis_value) > 0.4):
		new_device = Device.GAMEPAD
	elif event is InputEventKey:
		new_device = Device.KEYBOARD
	if new_device != device:
		device = new_device
		device_changed.emit(device_name())

	if event.is_action_pressed("debug_toggle"):
		Settings.set_value("graphics", "show_debug", not Settings.get_value("graphics", "show_debug"))


func _on_joy_connection_changed(_id: int, connected: bool) -> void:
	if connected:
		device = Device.GAMEPAD
	elif Input.get_connected_joypads().is_empty() and is_touch_device():
		device = Device.TOUCH
	device_changed.emit(device_name())
