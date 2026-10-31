class_name BroadcastHUD
extends CanvasLayer
## TV-style overlay: bottom scorebug with clocks, fouls, timeouts and bonus;
## lower-third player name cards; event toasts; replay bug; camera chip; and
## the pre-game matchup card.

const BUG_H := 64.0

var state: GameState
var home: Dictionary
var away: Dictionary

var _score_labels: Array[Label] = []
var _foul_labels: Array[Label] = []
var _bonus_labels: Array[Label] = []
var _timeout_bars: Array = []      # per team: Array[ColorRect]
var _possession_marks: Array[ColorRect] = []
var _period_label: Label
var _clock_label: Label
var _shot_label: Label
var _shot_box: PanelContainer
var _card: PanelContainer
var _card_number: Label
var _card_name: Label
var _card_line: Label
var _card_stripe: ColorRect
var _toast: Label
var _camera_chip: Label
var _replay_bug: PanelContainer
var _matchup: Control
var _bug: Control
var _card_tween: Tween


func setup(game_state: GameState, home_team: Dictionary, away_team: Dictionary, arena_name: String) -> void:
	state = game_state
	home = home_team
	away = away_team
	layer = 10
	_build_scorebug()
	_build_name_card()
	_build_toast()
	_build_camera_chip()
	_build_replay_bug()
	_build_matchup(arena_name)


func _panel(color: Color, radius := 0) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 2
	sb.content_margin_bottom = 2
	p.add_theme_stylebox_override("panel", sb)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p


## Anchors `c` at a point of the screen (0..1) and offsets it by `r` in pixels.
func _place(c: Control, anchor: Vector2, r: Rect2) -> void:
	c.anchor_left = anchor.x
	c.anchor_right = anchor.x
	c.anchor_top = anchor.y
	c.anchor_bottom = anchor.y
	c.offset_left = r.position.x
	c.offset_top = r.position.y
	c.offset_right = r.position.x + r.size.x
	c.offset_bottom = r.position.y + r.size.y


func _lbl(text: String, size: int, color := Color.WHITE, weight := 900, italic := true) -> Label:
	var l := UIKit.label(text, size, weight, color, italic)
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


# --- Scorebug ----------------------------------------------------------------------

func _build_scorebug() -> void:
	_bug = Control.new()
	_bug.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_bug.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_bug)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bug.add_child(row)
	for i in 2:
		var team := away if i == 0 else home
		row.add_child(_team_block(team, i))
	var period := _panel(Color(0.08, 0.09, 0.12, 0.95))
	period.custom_minimum_size = Vector2(90, BUG_H)
	_period_label = _lbl("1ST", 28)
	period.add_child(_period_label)
	row.add_child(period)
	var clock := _panel(Color(0.08, 0.09, 0.12, 0.95))
	clock.custom_minimum_size = Vector2(130, BUG_H)
	_clock_label = _lbl("12:00", 34)
	clock.add_child(_clock_label)
	row.add_child(clock)
	_shot_box = _panel(Color(0.95, 0.75, 0.15, 1.0))
	_shot_box.custom_minimum_size = Vector2(76, BUG_H)
	_shot_label = _lbl("24", 34, Color(0.08, 0.08, 0.1))
	_shot_box.add_child(_shot_label)
	row.add_child(_shot_box)
	row.reset_size()
	await get_tree().process_frame
	row.reset_size()
	row.position = Vector2(-row.size.x / 2.0, -BUG_H - 44)


func _team_block(team: Dictionary, idx: int) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 0)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 0)
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(h)
	var name_p := _panel(UIKit.team_color(team))
	name_p.custom_minimum_size = Vector2(130, BUG_H)
	var abbr := _lbl(team.abbr, 34, UIKit.team_color(team, "secondary").lightened(0.25))
	name_p.add_child(abbr)
	h.add_child(name_p)
	var score_p := _panel(Color(0.95, 0.95, 0.96, 0.97))
	score_p.custom_minimum_size = Vector2(96, BUG_H)
	var score := _lbl("0", 40, Color(0.06, 0.06, 0.08))
	score_p.add_child(score)
	h.add_child(score_p)
	_score_labels.append(score)
	# Strip under the team: possession arrow, timeouts, fouls / bonus.
	var strip := _panel(Color(0.05, 0.05, 0.07, 0.92))
	strip.custom_minimum_size = Vector2(226, 26)
	var sh := HBoxContainer.new()
	sh.add_theme_constant_override("separation", 5)
	sh.mouse_filter = Control.MOUSE_FILTER_IGNORE
	strip.add_child(sh)
	var poss := ColorRect.new()
	poss.custom_minimum_size = Vector2(10, 10)
	poss.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	poss.color = UIKit.ACCENT_2
	sh.add_child(poss)
	_possession_marks.append(poss)
	var bars: Array = []
	for t in GameState.TIMEOUTS_PER_GAME:
		var b := ColorRect.new()
		b.custom_minimum_size = Vector2(12, 5)
		b.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		b.color = Color(1, 1, 1, 0.85)
		sh.add_child(b)
		bars.append(b)
	_timeout_bars.append(bars)
	var fouls := _lbl("F 0", 16, Color(0.8, 0.82, 0.88), 800, false)
	sh.add_child(fouls)
	_foul_labels.append(fouls)
	var bonus := _lbl("BONUS", 16, UIKit.ACCENT_2, 900, false)
	bonus.visible = false
	sh.add_child(bonus)
	_bonus_labels.append(bonus)
	v.add_child(strip)
	return v


func _process(_delta: float) -> void:
	if state == null:
		return
	for i in 2:
		var team_idx := GameState.AWAY if i == 0 else GameState.HOME
		_score_labels[i].text = str(state.scores[team_idx])
		_foul_labels[i].text = "F %d" % state.team_fouls[team_idx]
		_bonus_labels[i].visible = state.in_bonus(team_idx)
		_possession_marks[i].modulate.a = 1.0 if state.possession == team_idx else 0.0
		for t in _timeout_bars[i].size():
			_timeout_bars[i][t].modulate.a = 1.0 if t < state.timeouts[team_idx] else 0.15
	_period_label.text = state.period_label()
	_clock_label.text = GameState.format_clock(state.game_clock)
	var sc_on := state.shot_clock_active()
	_shot_box.visible = sc_on
	_shot_label.text = GameState.format_shot_clock(state.shot_clock)
	var urgent := sc_on and state.shot_clock < 5.0
	_shot_box.self_modulate = Color(1.0, 0.35, 0.3) if urgent else Color.WHITE


func set_scorebug_visible(on: bool) -> void:
	_bug.visible = on


# --- Player name card -----------------------------------------------------------------

func _build_name_card() -> void:
	_card = _panel(Color(0.06, 0.07, 0.1, 0.92), 4)
	_place(_card, Vector2(0, 0), Rect2(-700, 110, 0, 0))
	add_child(_card)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 16)
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card.add_child(h)
	_card_stripe = ColorRect.new()
	_card_stripe.custom_minimum_size = Vector2(10, 0)
	h.add_child(_card_stripe)
	_card_number = _lbl("0", 64, Color.WHITE)
	_card_number.custom_minimum_size = Vector2(96, 110)
	h.add_child(_card_number)
	var v := VBoxContainer.new()
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	h.add_child(v)
	_card_name = _lbl("", 34, Color.WHITE)
	_card_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	v.add_child(_card_name)
	_card_line = _lbl("", 22, UIKit.TEXT_DIM, 700, false)
	_card_line.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	v.add_child(_card_line)
	var pad := Control.new()
	pad.custom_minimum_size = Vector2(16, 0)
	h.add_child(pad)


func show_player_card(player: Dictionary, team: Dictionary, stat_line: String) -> void:
	_card_number.text = PlaceholderPlayer._jersey(player)
	_card_name.text = ("%s %s" % [player.get("first", ""), player.get("last", "")]).to_upper()
	var ht := int(player.get("height_in", 78))
	_card_line.text = "%s  •  %d'%d\"  •  %s    %s" % [player.get("pos", ""), ht / 12, ht % 12, team.abbr, stat_line]
	_card_stripe.color = UIKit.team_color(team, "secondary")
	_card_number.add_theme_color_override("font_color", UIKit.team_color(team, "secondary").lightened(0.2))
	if _card_tween:
		_card_tween.kill()
	_card_tween = create_tween()
	_card_tween.tween_property(_card, "position:x", 40.0, 0.35).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
	_card_tween.tween_interval(3.5)
	_card_tween.tween_property(_card, "position:x", -700.0, 0.3).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)


# --- Toast, camera chip, replay bug ------------------------------------------------------

func _build_toast() -> void:
	_toast = _lbl("", 64, Color.WHITE)
	_place(_toast, Vector2(0.5, 0), Rect2(-600, 90, 1200, 90))
	_toast.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	_toast.add_theme_constant_override("outline_size", 12)
	_toast.modulate.a = 0.0
	add_child(_toast)


func toast(text: String, color := Color.WHITE) -> void:
	_toast.text = text
	_toast.add_theme_color_override("font_color", color)
	var tw := create_tween()
	_toast.scale = Vector2(1.25, 1.25)
	_toast.pivot_offset = _toast.size / 2.0
	tw.tween_property(_toast, "modulate:a", 1.0, 0.12)
	tw.parallel().tween_property(_toast, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_interval(1.4)
	tw.tween_property(_toast, "modulate:a", 0.0, 0.3)


func _build_camera_chip() -> void:
	_camera_chip = _lbl("", 26, Color.WHITE, 800, true)
	_place(_camera_chip, Vector2(1, 0), Rect2(-520, 24, 480, 40))
	_camera_chip.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_camera_chip.modulate.a = 0.0
	add_child(_camera_chip)


func show_camera_name(text: String) -> void:
	_camera_chip.text = "CAMERA: " + text.to_upper()
	var tw := create_tween()
	tw.tween_property(_camera_chip, "modulate:a", 1.0, 0.15)
	tw.tween_interval(1.6)
	tw.tween_property(_camera_chip, "modulate:a", 0.0, 0.4)


func _build_replay_bug() -> void:
	_replay_bug = _panel(Color(0.85, 0.1, 0.1, 0.95), 4)
	_replay_bug.position = Vector2(40, 30)
	var l := _lbl("REPLAY", 34)
	_replay_bug.add_child(l)
	_replay_bug.visible = false
	add_child(_replay_bug)


func set_replay(on: bool) -> void:
	_replay_bug.visible = on
	if on:
		var tw := create_tween().set_loops(3)
		tw.tween_property(_replay_bug, "modulate:a", 0.4, 0.3)
		tw.tween_property(_replay_bug, "modulate:a", 1.0, 0.3)


# --- Pre-game matchup card --------------------------------------------------------------

func _build_matchup(arena_name: String) -> void:
	_matchup = Control.new()
	_matchup.set_anchors_preset(Control.PRESET_FULL_RECT)
	_matchup.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_matchup.visible = false
	add_child(_matchup)
	var center := VBoxContainer.new()
	_place(center, Vector2(0.5, 1), Rect2(-560, -330, 1120, 260))
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_matchup.add_child(center)
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_theme_constant_override("separation", 0)
	h.mouse_filter = Control.MOUSE_FILTER_IGNORE
	center.add_child(h)
	for i in 3:
		if i == 1:
			var at := _panel(Color(0.05, 0.05, 0.07, 0.95))
			at.custom_minimum_size = Vector2(110, 120)
			at.add_child(_lbl("@", 54, UIKit.TEXT_DIM))
			h.add_child(at)
			continue
		var team := away if i == 0 else home
		var p := _panel(UIKit.team_color(team))
		p.custom_minimum_size = Vector2(500, 120)
		var tv := VBoxContainer.new()
		tv.alignment = BoxContainer.ALIGNMENT_CENTER
		tv.mouse_filter = Control.MOUSE_FILTER_IGNORE
		tv.add_child(_lbl(team.city.to_upper(), 24, Color(1, 1, 1, 0.8), 700, false))
		tv.add_child(_lbl(team.name.to_upper(), 52, UIKit.team_color(team, "secondary").lightened(0.25)))
		p.add_child(tv)
		h.add_child(p)
	var arena_l := _lbl("LIVE FROM %s" % arena_name.to_upper(), 28, Color.WHITE, 800)
	center.add_child(arena_l)
	var skip := _lbl("Tap or press any button to skip", 20, UIKit.TEXT_DIM, 600, false)
	center.add_child(skip)


func show_matchup(on: bool) -> void:
	_matchup.visible = true
	var tw := create_tween()
	tw.tween_property(_matchup, "modulate:a", 1.0 if on else 0.0, 0.4).from(0.0 if on else 1.0)
	if not on:
		tw.tween_callback(func(): _matchup.visible = false)
	set_scorebug_visible(not on)
