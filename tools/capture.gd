extends SceneTree
## Dev tool: opens a scene, waits, and saves screenshots. Needs a real
## renderer (not --headless); on a server use xvfb-run with lavapipe.
##   godot --path . -s res://tools/capture.gd -- <scene> <out_dir> [shots] [interval_s] [params_json]
## For the arena, params_json can set {"home": "HCH", "away": "MSD", "camera": "drive"}.


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var scene: String = args[0] if args.size() > 0 else "res://scenes/main_menu.tscn"
	var out_dir: String = args[1] if args.size() > 1 else "user://captures"
	var shots := int(args[2]) if args.size() > 2 else 1
	var interval := float(args[3]) if args.size() > 3 else 2.0
	var params: Dictionary = JSON.parse_string(args[4]) if args.size() > 4 else {}
	DirAccess.make_dir_recursive_absolute(out_dir)
	var sm := root.get_node("SceneManager")
	sm.params = params
	if params.has("camera"):
		root.get_node("Settings").set_value("camera", "preset", params.camera, false)
	if params.has("intro"):
		root.get_node("Settings").set_value("camera", "intro_flyover", bool(params.intro), false)
	change_scene_to_file(scene)
	if params.has("overlay"):
		await create_timer(0.5).timeout
		sm.open_overlay(params.overlay)
	for i in shots:
		await create_timer(interval).timeout
		await process_frame
		var img := root.get_texture().get_image()
		var path := "%s/shot_%02d.png" % [out_dir, i]
		img.save_png(path)
		print("saved ", path)
		if params.has("cameras"):
			var arena := current_scene
			if arena and arena.has_method("start_replay"):
				arena.director.cycle_preset()
	quit()
