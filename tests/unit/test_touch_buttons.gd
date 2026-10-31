extends GutTest
## Tapping an on-screen button must produce a real input event, so handlers
## like the in-game pause (which listen to events, not polled state) react.

var tc: TouchControls
var seen: Array = []


class Listener extends Node:
	var log: Array
	func _input(event: InputEvent) -> void:
		if event is InputEventAction:
			log.append([str(event.action), event.pressed])


func before_each() -> void:
	seen = []
	Settings.set_value("controls", "show_touch", "on", false)
	Settings.set_value("controls", "layout", {}, false)
	tc = TouchControls.new()
	add_child(tc)
	var l := Listener.new()
	l.log = seen
	add_child(l)
	await wait_physics_frames(2)


func after_each() -> void:
	Settings.set_value("controls", "show_touch", "auto", false)


func _button(id: String) -> Dictionary:
	for b in tc._buttons:
		if b.id == id:
			return b
	return {}


func _tap(at: Vector2) -> void:
	# parse_input_event takes window pixels; the viewport maps them back to canvas units.
	at = tc.get_viewport().get_final_transform() * at
	var down := InputEventScreenTouch.new()
	down.index = 3
	down.position = at
	down.pressed = true
	Input.parse_input_event(down)
	var up := InputEventScreenTouch.new()
	up.index = 3
	up.position = at
	up.pressed = false
	Input.parse_input_event(up)


func test_pause_tap_sends_press_and_release_events() -> void:
	var b := _button("pause")
	assert_false(b.is_empty())
	_tap(b.center)
	await wait_frames(6)
	assert_has(seen, ["pause", true], "pause press event")
	assert_has(seen, ["pause", false], "pause release event")
	assert_false(Input.is_action_pressed("pause"), "pause must not stay held")


func test_pause_button_is_inside_the_safe_area() -> void:
	var sr := UIKit.safe_rect(tc.get_viewport())
	var b := _button("pause")
	assert_true(sr.grow(-20).has_point(b.center), "pause should sit well inside the safe area")


func test_no_camera_or_replay_buttons_on_screen() -> void:
	assert_true(_button("camera").is_empty())
	assert_true(_button("replay").is_empty())
