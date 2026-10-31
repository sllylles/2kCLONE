extends CanvasLayer
## Scene switching with a fade, background loading, a back stack, and
## overlays (settings / pause) that sit on top of the current scene.

signal scene_changed(scene_name: String)

const SCENES := {
	"boot": "res://scenes/boot.tscn",
	"main_menu": "res://scenes/main_menu.tscn",
	"save_slots": "res://scenes/save_slots.tscn",
	"arena": "res://scenes/arena_game.tscn",
	"player_lab": "res://scenes/player_lab.tscn",
}
const OVERLAYS := {
	"settings": "res://scenes/settings_menu.tscn",
	"touch_layout": "res://scenes/touch_layout_editor.tscn",
}

var params: Dictionary = {}          # arguments for the scene being opened
var current := ""
var _history: Array[String] = []
var _fade: ColorRect
var _overlay_root: Control
var _busy := false


func _ready() -> void:
	layer = 90
	process_mode = Node.PROCESS_MODE_ALWAYS
	_overlay_root = Control.new()
	_overlay_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_overlay_root)
	_fade = ColorRect.new()
	_fade.color = Color(0.02, 0.02, 0.03, 0.0)
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_fade)
	var scene := get_tree().current_scene
	if scene:
		current = scene.name.to_snake_case()


func goto(scene_name: String, scene_params := {}, remember := true) -> void:
	if _busy or not SCENES.has(scene_name):
		push_warning("SceneManager: cannot open '%s'" % scene_name)
		return
	_busy = true
	if remember and current != "" and current != "boot":
		_history.append(current)
	params = scene_params
	var path: String = SCENES[scene_name]
	ResourceLoader.load_threaded_request(path)
	_fade.mouse_filter = Control.MOUSE_FILTER_STOP
	await _tween_fade(1.0, 0.18)
	close_all_overlays()
	while ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
		await get_tree().process_frame
	var packed := ResourceLoader.load_threaded_get(path) as PackedScene
	get_tree().paused = false
	if packed == null:
		push_error("SceneManager: failed to load %s" % path)
	else:
		get_tree().change_scene_to_packed(packed)
		current = scene_name
		await get_tree().process_frame
		await get_tree().process_frame
		scene_changed.emit(scene_name)
	await _tween_fade(0.0, 0.25)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_busy = false


func back() -> void:
	if _history.is_empty():
		goto("main_menu", {}, false)
	else:
		goto(_history.pop_back(), {}, false)


func open_overlay(overlay_name: String) -> Node:
	var packed: PackedScene = load(OVERLAYS[overlay_name])
	var node := packed.instantiate()
	_overlay_root.add_child(node)
	return node


func has_overlay() -> bool:
	return _overlay_root.get_child_count() > 0


func close_all_overlays() -> void:
	for c in _overlay_root.get_children():
		c.queue_free()


func _tween_fade(alpha: float, time: float) -> void:
	var tw := create_tween()
	tw.tween_property(_fade, "color:a", alpha, time)
	await tw.finished
