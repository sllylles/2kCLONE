extends Control
## Profile / save slot picker: load, create, delete.

var _list: HBoxContainer
var _name_dialog: ConfirmationDialog
var _name_edit: LineEdit
var _confirm_delete: ConfirmationDialog
var _pending_slot := -1


func _ready() -> void:
	theme = UIKit.theme()
	var bg := ColorRect.new()
	bg.color = UIKit.BG
	add_child(UIKit.full_rect(bg))
	var margin := MarginContainer.new()
	UIKit.full_rect(margin)
	for s in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + s, 64)
	add_child(margin)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 30)
	margin.add_child(v)
	var head := HBoxContainer.new()
	v.add_child(head)
	head.add_child(UIKit.label("PROFILES", 60, 900, UIKit.TEXT, true))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(spacer)
	var back := UIKit.button("BACK")
	back.pressed.connect(func(): SceneManager.back())
	head.add_child(back)
	v.add_child(UIKit.label("Each profile keeps its own builds, career and franchise progress.", 24, 500, UIKit.TEXT_DIM))
	_list = HBoxContainer.new()
	_list.add_theme_constant_override("separation", 24)
	_list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(_list)

	_name_dialog = ConfirmationDialog.new()
	_name_dialog.title = "New profile"
	_name_edit = LineEdit.new()
	_name_edit.placeholder_text = "Profile name"
	_name_edit.max_length = 20
	_name_edit.custom_minimum_size = Vector2(420, 60)
	_name_dialog.add_child(_name_edit)
	_name_dialog.register_text_enter(_name_edit)
	_name_dialog.confirmed.connect(_on_name_confirmed)
	add_child(_name_dialog)
	_confirm_delete = ConfirmationDialog.new()
	_confirm_delete.dialog_text = "Delete this profile? This can't be undone."
	_confirm_delete.confirmed.connect(func():
		SaveSystem.delete_slot(_pending_slot)
		_refresh())
	add_child(_confirm_delete)
	_refresh()


func _refresh() -> void:
	for c in _list.get_children():
		c.queue_free()
	var first: Button = null
	for info in SaveSystem.list_slots():
		var card := UIKit.panel(UIKit.PANEL_HI if info.slot == SaveSystem.active_slot else UIKit.PANEL)
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var v := VBoxContainer.new()
		v.add_theme_constant_override("separation", 12)
		card.add_child(v)
		v.add_child(UIKit.label("SLOT %d" % (info.slot + 1), 22, 800, UIKit.ACCENT_2, true))
		if info.exists:
			v.add_child(UIKit.label(str(info.profile_name).to_upper(), 40, 900))
			var when := Time.get_datetime_string_from_unix_time(int(info.updated_at), true)
			v.add_child(UIKit.label("Saved %s" % when, 20, 500, UIKit.TEXT_DIM))
			v.add_child(UIKit.label("Played %s" % _fmt_time(info.playtime_sec), 20, 500, UIKit.TEXT_DIM))
			if info.slot == SaveSystem.active_slot:
				v.add_child(UIKit.label("ACTIVE", 22, 800, UIKit.ACCENT))
		else:
			v.add_child(UIKit.label("EMPTY", 40, 900, UIKit.TEXT_DIM))
		var spacer := Control.new()
		spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
		v.add_child(spacer)
		var main := UIKit.accent_button("LOAD" if info.exists else "CREATE", Vector2(0, 72))
		main.pressed.connect(_on_main.bind(info.slot, info.exists))
		v.add_child(main)
		if first == null:
			first = main
		if info.exists:
			var del := UIKit.button("DELETE", Vector2(0, 60))
			del.pressed.connect(func():
				_pending_slot = info.slot
				_confirm_delete.popup_centered())
			v.add_child(del)
		_list.add_child(card)
	if first:
		first.call_deferred("grab_focus")


func _on_main(slot: int, exists: bool) -> void:
	if exists:
		if SaveSystem.load_slot(slot):
			SceneManager.back()
		return
	_pending_slot = slot
	_name_edit.text = "Player %d" % (slot + 1)
	_name_dialog.popup_centered()
	_name_edit.grab_focus()
	_name_edit.select_all()


func _on_name_confirmed() -> void:
	var n := _name_edit.text.strip_edges()
	if n.is_empty():
		n = "Player %d" % (_pending_slot + 1)
	SaveSystem.create_slot(_pending_slot, n)
	SceneManager.back()


static func _fmt_time(sec: float) -> String:
	var m := int(sec / 60.0)
	return "%dh %02dm" % [m / 60, m % 60]
