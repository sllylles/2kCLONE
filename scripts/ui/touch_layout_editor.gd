extends Control
## Drag the on-screen buttons where you want them. Positions save as you drop
## each button; RESET restores the default layout.

var controls: TouchControls


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	theme = UIKit.theme()
	var bg := ColorRect.new()
	bg.color = Color(0.05, 0.07, 0.1, 0.92)
	add_child(UIKit.full_rect(bg))
	var hint := UIKit.label("DRAG THE BUTTONS  •  LEFT HALF IS THE MOVE STICK  •  SHADED AREA IS THE PRO STICK", 24, 800, UIKit.TEXT_DIM, true)
	hint.position = Vector2(40, 30)
	add_child(hint)
	controls = TouchControls.new()
	controls.edit_mode = true
	add_child(controls)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 16)
	bar.position = Vector2(40, 90)
	add_child(bar)
	var reset := UIKit.button("RESET", Vector2(200, 70))
	reset.pressed.connect(func(): controls.reset_layout())
	bar.add_child(reset)
	var done := UIKit.accent_button("DONE", Vector2(200, 70))
	done.pressed.connect(func(): queue_free())
	bar.add_child(done)
