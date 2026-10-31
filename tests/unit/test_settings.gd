extends GutTest
## Settings defaults, clamping, type safety and persistence.

const SettingsScript := preload("res://autoload/settings.gd")
const PATH := "user://test_settings.cfg"

var s: Node


func before_each() -> void:
	if FileAccess.file_exists(PATH):
		DirAccess.remove_absolute(PATH)
	s = SettingsScript.new()
	s.path = PATH


func after_each() -> void:
	s.free()
	if FileAccess.file_exists(PATH):
		DirAccess.remove_absolute(PATH)


func test_defaults() -> void:
	assert_eq(s.get_value("graphics", "fps_mode"), 60)
	assert_eq(s.get_value("camera", "preset"), "broadcast")
	assert_false(s.get_value("gameplay", "goat_builds"))


func test_render_scale_is_clamped() -> void:
	s.set_value("graphics", "render_scale", 3.0, false)
	assert_eq(s.get_value("graphics", "render_scale"), 1.0)
	s.set_value("graphics", "render_scale", 0.1, false)
	assert_eq(s.get_value("graphics", "render_scale"), 0.5)


func test_fps_snaps_to_supported_mode() -> void:
	s.set_value("graphics", "fps_mode", 45, false)
	assert_true(s.get_value("graphics", "fps_mode") in [30, 60])
	s.set_value("graphics", "fps_mode", 30, false)
	assert_true(s.is_battery_mode())


func test_wrong_type_is_rejected() -> void:
	s.set_value("graphics", "quality", 5, false)
	assert_eq(s.get_value("graphics", "quality"), "medium")
	s.set_value("graphics", "quality", "ultra", false)
	assert_eq(s.get_value("graphics", "quality"), "medium")


func test_camera_sliders_per_preset() -> void:
	s.set_camera_sliders("drive", 2.0, 9.0)
	var d: Dictionary = s.get_camera_sliders("drive")
	assert_eq(d.zoom, 2.0)
	assert_eq(d.height, 9.0)
	assert_eq(s.get_camera_sliders("broadcast").zoom, 5.0)


func test_persists_to_disk() -> void:
	s.set_value("audio", "music", 0.25, false)
	assert_eq(s.save_now(), OK)
	var s2: Node = SettingsScript.new()
	s2.path = PATH
	s2.load_settings()
	assert_almost_eq(float(s2.get_value("audio", "music")), 0.25, 0.0001)
	s2.free()
