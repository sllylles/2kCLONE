extends CanvasLayer
## FPS / frame time / draw calls overlay. Toggle with F3, a three-finger tap,
## or Settings > Graphics > Debug overlay.

var _panel: PanelContainer
var _label: Label
var _accum := 0.0
var _touches := {}


func _ready() -> void:
	layer = 120
	process_mode = Node.PROCESS_MODE_ALWAYS
	_panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0.55)
	sb.set_content_margin_all(8)
	sb.set_corner_radius_all(6)
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.position = Vector2(12, 12)
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_label = Label.new()
	_label.add_theme_font_size_override("font_size", 18)
	_label.add_theme_color_override("font_color", Color(0.75, 1.0, 0.75))
	_panel.add_child(_label)
	add_child(_panel)
	Settings.changed.connect(_on_settings_changed)
	_set_shown(bool(Settings.get_value("graphics", "show_debug")))


func _on_settings_changed(section: String, key: String, value: Variant) -> void:
	if section == "graphics" and key == "show_debug":
		_set_shown(bool(value))


func _set_shown(on: bool) -> void:
	visible = on
	set_process(on)


func _process(delta: float) -> void:
	_accum += delta
	if _accum < 0.25:
		return
	_accum = 0.0
	var vp := get_viewport()
	var size := vp.get_visible_rect().size
	var scale3d := vp.scaling_3d_scale
	var lines := PackedStringArray([
		"FPS %d  (cap %d)" % [Engine.get_frames_per_second(), Engine.max_fps],
		"Frame %.1f ms  Phys %.1f ms" % [Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
			Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0],
		"Draw calls %d" % Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"Objects %d  Prims %dk" % [Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
			int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME) / 1000.0)],
		"VRAM %.0f MB  RAM %.0f MB" % [Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
			Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0],
		"3D %dx%d (%.0f%%)  %s" % [int(size.x * scale3d), int(size.y * scale3d), scale3d * 100.0,
			Settings.get_value("graphics", "quality")],
		"Input: %s" % InputRouter.device_name(),
		RenderingServer.get_video_adapter_name(),
	])
	_label.text = "\n".join(lines)


func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = true
			if _touches.size() == 3:
				Settings.set_value("graphics", "show_debug", not visible)
		else:
			_touches.erase(event.index)
