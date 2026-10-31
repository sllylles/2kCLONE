extends Control
## Main hub: top navigation bar with tabs, big mode tiles, profile chip.

const TABS := [
	{"id": "play_now", "name": "PLAY NOW"},
	{"id": "career", "name": "CAREER"},
	{"id": "myplayer", "name": "MYPLAYER"},
	{"id": "franchise", "name": "FRANCHISE"},
	{"id": "blacktop", "name": "BLACKTOP"},
	{"id": "options", "name": "OPTIONS"},
]

const TILES := {
	"play_now": [
		{"id": "quick_game", "title": "QUICK GAME", "sub": "Real rosters, live demo game", "phase": 0},
		{"id": "player_lab", "title": "PLAYER LAB", "sub": "Every player & animation up close", "phase": 0},
		{"id": "season", "title": "SEASON", "sub": "Play a full season", "phase": 5},
		{"id": "playoffs", "title": "PLAYOFFS", "sub": "Jump into the bracket", "phase": 5},
		{"id": "all_star", "title": "ALL-STAR", "sub": "3-point & dunk contests", "phase": 5},
		{"id": "practice", "title": "PRACTICE", "sub": "Freestyle on an empty court", "phase": 5},
	],
	"career": [{"id": "career", "title": "CAREER", "sub": "Your rise to stardom", "phase": 7}],
	"myplayer": [{"id": "builder", "title": "PLAYER BUILDER", "sub": "Create & save builds", "phase": 6}],
	"franchise": [{"id": "franchise", "title": "FRANCHISE", "sub": "Draft, trade, build a dynasty", "phase": 5}],
	"blacktop": [{"id": "blacktop", "title": "BLACKTOP", "sub": "1v1 to 5v5 outdoors", "phase": 5}],
	"options": [
		{"id": "settings", "title": "SETTINGS", "sub": "Graphics, controls, camera, audio", "phase": 0},
		{"id": "profiles", "title": "PROFILES", "sub": "Save slots", "phase": 0},
	],
}

var _tab := "play_now"
var _tab_buttons := {}
var _content: Control
var _profile_btn: Button
var _stripe: Polygon2D
var _away_idx := 1
var _home_idx := 0


func _ready() -> void:
	theme = UIKit.theme()
	_build_background()
	var root := VBoxContainer.new()
	UIKit.full_rect(root)
	root.add_theme_constant_override("separation", 0)
	add_child(root)
	root.add_child(_build_top_bar())
	var margin := MarginContainer.new()
	margin.size_flags_vertical = Control.SIZE_EXPAND_FILL
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 72)
	margin.add_theme_constant_override("margin_top", 40)
	margin.add_theme_constant_override("margin_bottom", 40)
	root.add_child(margin)
	_content = VBoxContainer.new()
	margin.add_child(_content)
	_select_tab(SceneManager.params.get("tab", "play_now"))
	SaveSystem.slot_loaded.connect(func(_s): _refresh_profile())
	_refresh_profile()


func _build_background() -> void:
	var bg := ColorRect.new()
	bg.color = UIKit.BG
	add_child(UIKit.full_rect(bg))
	_stripe = Polygon2D.new()
	_stripe.color = Color(UIKit.ACCENT, 0.16)
	_stripe.polygon = PackedVector2Array([Vector2(900, 0), Vector2(1300, 0), Vector2(700, 1200), Vector2(300, 1200)])
	add_child(_stripe)
	var stripe2 := Polygon2D.new()
	stripe2.color = Color(UIKit.ACCENT_2, 0.06)
	stripe2.polygon = PackedVector2Array([Vector2(1380, 0), Vector2(1460, 0), Vector2(860, 1200), Vector2(780, 1200)])
	add_child(stripe2)
	var tw := create_tween().set_loops()
	tw.tween_property(_stripe, "position:x", 160.0, 6.0).set_trans(Tween.TRANS_SINE)
	tw.tween_property(_stripe, "position:x", 0.0, 6.0).set_trans(Tween.TRANS_SINE)


func _build_top_bar() -> Control:
	var bar := UIKit.panel(Color(0, 0, 0, 0.55), 0)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 8)
	bar.add_child(h)
	var logo := UIKit.label("COURTSIDE", 44, 900, UIKit.ACCENT, true)
	logo.custom_minimum_size.x = 340
	h.add_child(logo)
	for t in TABS:
		var b := Button.new()
		b.text = t.name
		b.flat = true
		b.toggle_mode = true
		b.custom_minimum_size = Vector2(0, 64)
		b.add_theme_font_override("font", UIKit.font(800, true))
		b.add_theme_font_size_override("font_size", 26)
		b.add_theme_color_override("font_color", UIKit.TEXT_DIM)
		b.add_theme_color_override("font_pressed_color", Color.WHITE)
		b.pressed.connect(_select_tab.bind(t.id))
		h.add_child(b)
		_tab_buttons[t.id] = b
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(spacer)
	_profile_btn = UIKit.button("", Vector2(260, 60))
	_profile_btn.pressed.connect(func(): SceneManager.goto("save_slots"))
	h.add_child(_profile_btn)
	return bar


func _refresh_profile() -> void:
	if SaveSystem.active_slot >= 0:
		_profile_btn.text = "PROFILE: %s" % str(SaveSystem.data.get("profile_name", "?")).to_upper()
	else:
		_profile_btn.text = "CREATE PROFILE"


func _select_tab(id: String) -> void:
	_tab = id
	for k in _tab_buttons:
		_tab_buttons[k].button_pressed = k == id
	for c in _content.get_children():
		c.queue_free()
	if id == "play_now":
		_content.add_child(_build_news())
	var grid := HFlowContainer.new()
	grid.add_theme_constant_override("h_separation", 20)
	grid.add_theme_constant_override("v_separation", 20)
	_content.add_child(grid)
	var first: Button = null
	for tile in TILES[id]:
		var b := _make_tile(tile)
		grid.add_child(b)
		if first == null and not b.disabled:
			first = b
	if first:
		first.call_deferred("grab_focus")


func _build_news() -> Control:
	var p := UIKit.panel(Color(0.06, 0.07, 0.1, 0.85))
	p.custom_minimum_size = Vector2(0, 150)
	var v := VBoxContainer.new()
	p.add_child(v)
	v.add_child(UIKit.label("WHAT'S NEW", 22, 800, UIKit.ACCENT_2, true))
	v.add_child(UIKit.label("Phase 3: shot meter, real ball physics, pro-stick shooting", 34, 800))
	v.add_child(UIKit.label("Hold Shoot (or rest a finger in the swipe zone) and let go at the top. Rosters: %s." % DataDB.roster_source, 22, 500, UIKit.TEXT_DIM))
	var spacer := Control.new()
	spacer.custom_minimum_size.y = 24
	var wrap := VBoxContainer.new()
	wrap.add_child(p)
	wrap.add_child(spacer)
	return wrap


func _make_tile(tile: Dictionary) -> Button:
	var b := Button.new()
	b.custom_minimum_size = Vector2(380, 230)
	b.text = ""
	var locked: bool = tile.phase > 1
	b.disabled = locked
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 24
	v.offset_top = 20
	v.offset_right = -24
	v.offset_bottom = -20
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(v)
	var title := UIKit.label(tile.title, 40, 900, UIKit.TEXT if not locked else UIKit.TEXT_DIM, true)
	title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(title)
	var sub := UIKit.label(tile.sub, 22, 500, UIKit.TEXT_DIM)
	sub.autowrap_mode = TextServer.AUTOWRAP_WORD
	sub.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(sub)
	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(spacer)
	if locked:
		var tag := UIKit.label("COMING IN PHASE %d" % tile.phase, 18, 800, UIKit.ACCENT_2)
		tag.mouse_filter = Control.MOUSE_FILTER_IGNORE
		v.add_child(tag)
	else:
		var bar := ColorRect.new()
		bar.color = UIKit.ACCENT
		bar.custom_minimum_size = Vector2(0, 6)
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		v.add_child(bar)
	b.pressed.connect(_on_tile.bind(tile.id))
	return b


func _on_tile(id: String) -> void:
	match id:
		"quick_game":
			_show_quick_game()
		"player_lab":
			SceneManager.goto("player_lab")
		"settings":
			SceneManager.open_overlay("settings")
		"profiles":
			SceneManager.goto("save_slots")


# --- Quick Game setup -----------------------------------------------------------

func _show_quick_game() -> void:
	for c in _content.get_children():
		c.queue_free()
	_content.add_child(UIKit.label("QUICK GAME", 54, 900, UIKit.TEXT, true))
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 40)
	row.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_child(row)
	row.add_child(_team_picker(true))
	var vs := UIKit.label("@", 80, 900, UIKit.TEXT_DIM, true)
	vs.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(vs)
	row.add_child(_team_picker(false))
	var actions := HBoxContainer.new()
	actions.alignment = BoxContainer.ALIGNMENT_END
	actions.add_theme_constant_override("separation", 20)
	_content.add_child(actions)
	var back := UIKit.button("BACK")
	back.pressed.connect(_select_tab.bind("play_now"))
	actions.add_child(back)
	var go := UIKit.accent_button("TIP OFF")
	go.pressed.connect(_start_quick_game)
	actions.add_child(go)
	go.call_deferred("grab_focus")


func _team_picker(away: bool) -> Control:
	var p := UIKit.panel()
	p.custom_minimum_size = Vector2(560, 470)
	var v := VBoxContainer.new()
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 10)
	p.add_child(v)
	v.add_child(UIKit.label("AWAY" if away else "HOME", 24, 800, UIKit.ACCENT_2, true))
	var badge := TextureRect.new()
	badge.custom_minimum_size = Vector2(190, 190)
	badge.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	badge.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	v.add_child(badge)
	var city := UIKit.label("", 28, 600, UIKit.TEXT_DIM)
	var name_l := UIKit.label("", 48, 900, UIKit.TEXT, true)
	var arena_l := UIKit.label("", 20, 500, UIKit.TEXT_DIM)
	for l in [city, name_l, arena_l]:
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(l)
	var arrows := HBoxContainer.new()
	arrows.alignment = BoxContainer.ALIGNMENT_CENTER
	arrows.add_theme_constant_override("separation", 20)
	v.add_child(arrows)
	var prev := UIKit.button("◀", Vector2(110, 64))
	var next := UIKit.button("▶", Vector2(110, 64))
	arrows.add_child(prev)
	arrows.add_child(next)
	var refresh := func():
		var t: Dictionary = DataDB.teams[_away_idx if away else _home_idx]
		var logo := DataDB.team_logo(t.id)
		badge.texture = logo if logo else UIKit.team_badge(t, 192)
		city.text = t.city.to_upper()
		name_l.text = t.name.to_upper()
		name_l.add_theme_color_override("font_color", UIKit.team_color(t, "secondary").lightened(0.1))
		arena_l.text = "" if away else DataDB.arena(t.arena).get("name", "")
	var step := func(d: int):
		var n := DataDB.teams.size()
		if away:
			_away_idx = posmod(_away_idx + d, n)
		else:
			_home_idx = posmod(_home_idx + d, n)
		refresh.call()
	prev.pressed.connect(step.bind(-1))
	next.pressed.connect(step.bind(1))
	refresh.call()
	return p


func _start_quick_game() -> void:
	var home: Dictionary = DataDB.teams[_home_idx]
	var away: Dictionary = DataDB.teams[_away_idx]
	SceneManager.goto("arena", {"home": home.id, "away": away.id, "arena": home.arena})
