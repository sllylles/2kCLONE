class_name UniformTextures
extends RefCounted
## Text textures for jerseys, rendered once into SubViewports and cached:
## a "0123456789" digit atlas and one wordmark per team name.

static var _digits: Texture2D
static var _wordmarks := {}
static var _holder: Node


static func _host() -> Node:
	if _holder == null or not is_instance_valid(_holder):
		_holder = Node.new()
		_holder.name = "UniformTextures"
		(Engine.get_main_loop() as SceneTree).root.add_child.call_deferred(_holder)
	return _holder


static func _render(text: String, size: Vector2i, font_size: int, cell_count := 1) -> Texture2D:
	var vp := SubViewport.new()
	vp.size = size
	vp.transparent_bg = true
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	if cell_count == 1:
		var l := _label(text, Vector2(size), font_size)
		vp.add_child(l)
	else:
		var w := float(size.x) / cell_count
		for i in cell_count:
			var l := _label(text[i], Vector2(w, size.y), font_size)
			l.position.x = i * w
			vp.add_child(l)
	_host().add_child(vp)
	return vp.get_texture()


static func _label(text: String, box: Vector2, font_size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.size = box
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.add_theme_font_override("font", UIKit.font(900))
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_color", Color.WHITE)
	return l


static func digits() -> Texture2D:
	if _digits == null:
		_digits = _render("0123456789", Vector2i(640, 112), 104, 10)
	return _digits


static func wordmark(text: String) -> Texture2D:
	if not _wordmarks.has(text):
		var fs := clampi(int(980.0 / maxf(1.0, text.length())), 40, 110)
		_wordmarks[text] = _render(text, Vector2i(512, 128), fs)
	return _wordmarks[text]
