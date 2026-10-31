extends Control
## Settings overlay. Works from the main menu and from the in-game pause menu.
## Every control writes straight to the Settings autoload, which applies and
## persists the value immediately.

signal closed

var _tabs: TabContainer
var _rebind_buttons := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	theme = UIKit.theme()
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.75)
	add_child(UIKit.full_rect(dim))
	var margin := MarginContainer.new()
	UIKit.fit_safe_area(margin)
	for s in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + s, 56)
	for s in ["top", "bottom"]:
		margin.add_theme_constant_override("margin_" + s, 40)
	add_child(margin)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 16)
	margin.add_child(v)
	var head := HBoxContainer.new()
	v.add_child(head)
	head.add_child(UIKit.label("SETTINGS", 54, 900, UIKit.TEXT, true))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(spacer)
	var done := UIKit.accent_button("DONE", Vector2(220, 68))
	done.pressed.connect(close)
	head.add_child(done)

	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(_tabs)
	_build_graphics()
	_build_camera()
	_build_controls()
	_build_audio()
	_build_gameplay()
	InputRouter.rebind_finished.connect(_on_rebind_finished)
	done.call_deferred("grab_focus")


func close() -> void:
	InputRouter.cancel_rebind()
	Settings.save_now()
	closed.emit()
	queue_free()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") and not InputRouter.is_rebinding():
		get_viewport().set_input_as_handled()
		close()


# --- page helpers -------------------------------------------------------------

func _page(title: String) -> VBoxContainer:
	var scroll := ScrollContainer.new()
	scroll.name = title
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_tabs.add_child(scroll)
	var m := MarginContainer.new()
	m.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for s in ["left", "right", "top", "bottom"]:
		m.add_theme_constant_override("margin_" + s, 24)
	scroll.add_child(m)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	m.add_child(v)
	return v


func _row(page: VBoxContainer, text: String, control: Control, hint := "") -> void:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 24)
	var lv := VBoxContainer.new()
	lv.custom_minimum_size.x = 520
	lv.add_child(UIKit.label(text, 28, 700))
	if hint != "":
		var hl := UIKit.label(hint, 18, 500, UIKit.TEXT_DIM)
		hl.autowrap_mode = TextServer.AUTOWRAP_WORD
		lv.add_child(hl)
	h.add_child(lv)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	control.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	h.add_child(control)
	page.add_child(h)


func _slider(section: String, key: String, lo: float, hi: float, step: float, fmt := "%.0f%%", mult := 100.0) -> Control:
	var h := HBoxContainer.new()
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = float(Settings.get_value(section, key))
	s.custom_minimum_size = Vector2(380, 56)
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var val := UIKit.label(fmt % (s.value * mult), 26, 800, UIKit.ACCENT_2)
	val.custom_minimum_size.x = 120
	s.value_changed.connect(func(x: float):
		val.text = fmt % (x * mult)
		Settings.set_value(section, key, x))
	h.add_child(s)
	h.add_child(val)
	return h


func _options(section: String, key: String, labels: Array, values: Array) -> OptionButton:
	var o := OptionButton.new()
	o.custom_minimum_size = Vector2(380, 64)
	for l in labels:
		o.add_item(l)
	var cur: Variant = Settings.get_value(section, key)
	for i in values.size():
		if str(values[i]) == str(cur):
			o.select(i)
	o.item_selected.connect(func(i: int): Settings.set_value(section, key, values[i]))
	return o


func _toggle(section: String, key: String) -> CheckButton:
	var c := CheckButton.new()
	c.button_pressed = bool(Settings.get_value(section, key))
	c.text = ""
	c.toggled.connect(func(on: bool): Settings.set_value(section, key, on))
	return c


# --- pages ----------------------------------------------------------------------

func _build_graphics() -> void:
	var p := _page("Graphics")
	_row(p, "Frame rate", _options("graphics", "fps_mode", ["30 (Battery saver)", "60", "90", "120"], [30, 60, 90, 120]),
		"30 fps halves GPU work for long sessions.")
	_row(p, "Render scale", _slider("graphics", "render_scale", 0.5, 1.0, 0.05),
		"3D resolution. The HUD always renders at full resolution.")
	_row(p, "Upscaler", _options("graphics", "upscaler", ["Bilinear (fastest)", "FSR 1.0 (sharper)"], ["bilinear", "fsr"]))
	_row(p, "Quality", _options("graphics", "quality", ["Low", "Medium", "High"], ["low", "medium", "high"]),
		"Shadows, reflections and crowd detail. Applies next time an arena loads.")
	_row(p, "Crowd density", _slider("graphics", "crowd_density", 0.0, 1.0, 0.05),
		"Applies next time an arena loads.")
	_row(p, "Anti-aliasing (MSAA 2x)", _toggle("graphics", "msaa"))
	_row(p, "Debug overlay", _toggle("graphics", "show_debug"), "Also: F3, or tap with three fingers.")


func _build_camera() -> void:
	var p := _page("Camera")
	var ids: Array = []
	var names: Array = []
	for c in DataDB.camera_presets:
		ids.append(c.id)
		names.append(c.name)
	var preset := _options("camera", "preset", names, ids)
	_row(p, "Gameplay camera", preset)
	var zoom := HSlider.new()
	var height := HSlider.new()
	for s in [zoom, height]:
		s.min_value = 0
		s.max_value = 10
		s.step = 1
		s.custom_minimum_size = Vector2(380, 56)
	var load_sliders := func():
		var sl := Settings.get_camera_sliders(str(Settings.get_value("camera", "preset")))
		zoom.set_value_no_signal(sl.zoom)
		height.set_value_no_signal(sl.height)
	load_sliders.call()
	preset.item_selected.connect(func(_i): load_sliders.call())
	var save := func(_v):
		Settings.set_camera_sliders(str(Settings.get_value("camera", "preset")), zoom.value, height.value)
	zoom.value_changed.connect(save)
	height.value_changed.connect(save)
	_row(p, "Zoom", zoom, "Each camera remembers its own zoom and height.")
	_row(p, "Height", height)
	_row(p, "Pre-game flyover", _toggle("camera", "intro_flyover"))
	_row(p, "Automatic replays", _toggle("camera", "auto_replays"), "Show a replay after big plays.")


func _build_controls() -> void:
	var p := _page("Controls")
	_row(p, "On-screen controls", _options("controls", "show_touch", ["Auto", "Always", "Never"], ["auto", "on", "off"]),
		"Auto hides them while a controller is in use.")
	_row(p, "Button size", _slider("controls", "button_scale", 0.6, 1.6, 0.05))
	_row(p, "Button opacity", _slider("controls", "button_opacity", 0.15, 1.0, 0.05))
	_row(p, "Vibration", _toggle("controls", "vibration"))
	var edit := UIKit.button("EDIT TOUCH LAYOUT", Vector2(360, 64))
	edit.pressed.connect(func(): SceneManager.open_overlay("touch_layout"))
	_row(p, "Button positions", edit, "Drag any button where your thumbs want it.")
	p.add_child(UIKit.label("BUTTON MAPPING", 26, 800, UIKit.ACCENT_2, true))
	var hint := UIKit.label("Tap a binding, then press the new button or key. Esc cancels.", 20, 500, UIKit.TEXT_DIM)
	p.add_child(hint)
	var header := HBoxContainer.new()
	var hl := UIKit.label("Action", 22, 700, UIKit.TEXT_DIM)
	hl.custom_minimum_size.x = 520
	header.add_child(hl)
	for t in ["Controller", "Keyboard"]:
		var l := UIKit.label(t, 22, 700, UIKit.TEXT_DIM)
		l.custom_minimum_size.x = 260
		header.add_child(l)
	p.add_child(header)
	for action in InputRouter.REMAPPABLE:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 20)
		var name_l := UIKit.label(InputRouter.REMAPPABLE[action], 26, 700)
		name_l.custom_minimum_size.x = 500
		h.add_child(name_l)
		for pad in [true, false]:
			var b := UIKit.button(InputRouter.binding_label(action, pad), Vector2(240, 60))
			b.pressed.connect(func():
				b.text = "Press…"
				InputRouter.start_rebind(action, pad))
			_rebind_buttons[[action, pad]] = b
			h.add_child(b)
		p.add_child(h)
	var reset := UIKit.button("RESET TO DEFAULTS", Vector2(360, 64))
	reset.pressed.connect(func():
		InputRouter.reset_bindings()
		_refresh_bindings())
	p.add_child(reset)


func _refresh_bindings() -> void:
	for k in _rebind_buttons:
		_rebind_buttons[k].text = InputRouter.binding_label(k[0], k[1])


func _on_rebind_finished(_action: String, _ok: bool) -> void:
	_refresh_bindings()


func _build_audio() -> void:
	var p := _page("Audio")
	_row(p, "Master", _slider("audio", "master", 0.0, 1.0, 0.05))
	_row(p, "Music", _slider("audio", "music", 0.0, 1.0, 0.05))
	_row(p, "Effects", _slider("audio", "sfx", 0.0, 1.0, 0.05))
	_row(p, "Crowd", _slider("audio", "crowd", 0.0, 1.0, 0.05))


func _build_gameplay() -> void:
	var p := _page("Gameplay")
	_row(p, "Quarter length", _slider("gameplay", "quarter_minutes", 1, 12, 1, "%d min", 1.0))
	_row(p, "Difficulty", _options("gameplay", "difficulty",
		["Rookie", "Pro", "All-Star", "Superstar", "Hall of Fame"],
		["rookie", "pro", "all_star", "superstar", "hall_of_fame"]), "CPU shooting, defense and decisions, and your shot window.")
	_row(p, "Shot meter", _options("gameplay", "meter_style", ["Arc", "Bar", "Off"], ["arc", "bar", "off"]),
		"Hold Shoot and let go at the top of the jump. Off hides the meter (timing still counts).")
	_row(p, "Real player %", _toggle("gameplay", "real_player_pct"), "Shot success from ratings only, no timing.")
	_row(p, "GOAT builds (offline)", _toggle("gameplay", "goat_builds"), "Unlocks the max-everything MyPlayer preset.")
