extends GutTest
## Save slots: create, load, list, backups, corruption and migration.

const SaveScript := preload("res://autoload/save_system.gd")
const DIR := "user://test_saves"

var saves: Node


func before_each() -> void:
	_wipe()
	saves = SaveScript.new()
	saves.save_dir = DIR


func after_each() -> void:
	saves.free()
	_wipe()


func _wipe() -> void:
	var d := DirAccess.open(DIR)
	if d:
		for f in d.get_files():
			d.remove(f)


func test_create_and_load() -> void:
	assert_eq(saves.write_slot(1, saves.new_game_data("Ace")), OK)
	assert_true(saves.slot_exists(1))
	assert_true(saves.load_slot(1))
	assert_eq(saves.active_slot, 1)
	assert_eq(saves.data.profile_name, "Ace")


func test_list_slots() -> void:
	saves.write_slot(0, saves.new_game_data("One"))
	saves.write_slot(2, saves.new_game_data("Three"))
	var list: Array = saves.list_slots()
	assert_eq(list.size(), SaveScript.SLOT_COUNT)
	assert_true(list[0].exists)
	assert_false(list[1].exists)
	assert_eq(list[2].profile_name, "Three")


func test_overwrite_keeps_backup() -> void:
	saves.write_slot(0, saves.new_game_data("First"))
	saves.write_slot(0, saves.new_game_data("Second"))
	assert_true(FileAccess.file_exists(saves.slot_path(0) + ".bak"))
	assert_eq(saves.read_slot(0).profile_name, "Second")


func test_corrupt_save_falls_back_to_backup() -> void:
	saves.write_slot(0, saves.new_game_data("Good"))
	saves.write_slot(0, saves.new_game_data("Good2"))
	var f := FileAccess.open(saves.slot_path(0), FileAccess.WRITE)
	f.store_string("{not json")
	f.close()
	assert_eq(saves.read_slot(0).profile_name, "Good")


func test_delete() -> void:
	saves.write_slot(3, saves.new_game_data("Gone"))
	saves.delete_slot(3)
	assert_false(saves.slot_exists(3))


func test_out_of_range_slot_rejected() -> void:
	assert_eq(saves.write_slot(99, {}), ERR_PARAMETER_RANGE_ERROR)


func test_migrates_v0_saves() -> void:
	var d: Dictionary = saves.migrate({"profile_name": "Old"})
	assert_eq(int(d.version), SaveScript.SAVE_VERSION)
	assert_true(d.has("currency"))
	assert_eq(d.profile_name, "Old")


func test_currency_starts_at_zero() -> void:
	assert_eq(saves.new_game_data("X").currency.coins, 0)
