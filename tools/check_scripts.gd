extends SceneTree
## Loads every GDScript in the project (autoloads available) and fails if any
## does not compile. Run: godot --headless --path . -s res://tools/check_scripts.gd


func _initialize() -> void:
	var failed := 0
	var count := 0
	for dir in ["res://autoload", "res://scripts", "res://tests"]:
		for path in _scripts(dir):
			count += 1
			var s := load(path) as GDScript
			if s == null or not s.can_instantiate():
				failed += 1
				printerr("FAILED: ", path)
	print("Checked %d scripts, %d failed." % [count, failed])
	quit(1 if failed > 0 else 0)


func _scripts(dir: String) -> PackedStringArray:
	var out := PackedStringArray()
	var d := DirAccess.open(dir)
	if d == null:
		return out
	for f in d.get_files():
		if f.ends_with(".gd"):
			out.append(dir.path_join(f))
	for sub in d.get_directories():
		out.append_array(_scripts(dir.path_join(sub)))
	return out
