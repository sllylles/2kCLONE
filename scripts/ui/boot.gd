extends Control
## Splash screen. Autoloads have already loaded settings and data by now.


func _ready() -> void:
	theme = UIKit.theme()
	var bg := ColorRect.new()
	bg.color = UIKit.BG
	add_child(UIKit.full_rect(bg))
	var center := CenterContainer.new()
	add_child(UIKit.full_rect(center))
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(box)
	var title := UIKit.label("COURTSIDE", 120, 900, UIKit.TEXT, true)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	var bar := ColorRect.new()
	bar.color = UIKit.ACCENT
	bar.custom_minimum_size = Vector2(0, 8)
	box.add_child(bar)
	var sub := UIKit.label("BASKETBALL SIMULATION", 28, 700, UIKit.TEXT_DIM)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(sub)

	title.modulate.a = 0.0
	var tw := create_tween()
	tw.tween_property(title, "modulate:a", 1.0, 0.5)
	tw.parallel().tween_property(bar, "custom_minimum_size:x", 760.0, 0.6).from(0.0) \
			.set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	tw.tween_interval(0.7)
	tw.tween_callback(func(): SceneManager.goto("main_menu", {}, false))
