class_name GamePanels
extends RefCounted
## Builders for the in-game info panels: box score, play-by-play and
## substitutions. Each returns a Control with a refresh() callable stored in
## its "refresh" meta so the pause menu can update it when shown.

const COLS := [["PLAYER", 230], ["MIN", 70], ["PTS", 58], ["REB", 58], ["AST", 58], ["STL", 52], ["BLK", 52],
	["FG", 76], ["3PT", 70], ["FT", 70], ["TO", 48], ["PF", 48], ["+/-", 56]]


static func _cell(text: String, w: int, size := 20, color := UIKit.TEXT, bold := false) -> Label:
	var l := UIKit.label(text, size, 800 if bold else 600, color)
	l.custom_minimum_size.x = w
	l.clip_text = true
	return l


static func _row(values: Array, size := 20, color := UIKit.TEXT, bold := false) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 4)
	for i in values.size():
		h.add_child(_cell(str(values[i]), COLS[i][1], size, color, bold))
	return h


static func _line_values(l: Dictionary, on_court: bool) -> Array:
	var name := ("● " if on_court else "   ") + "%s %s" % [l.get("number", ""), l.get("name", "")]
	return [name, BoxScore.fmt_min(l.sec), l.pts, BoxScore.reb(l), l.ast, l.stl, l.blk,
		"%d-%d" % [l.fgm, l.fga], "%d-%d" % [l.tpm, l.tpa], "%d-%d" % [l.ftm, l.fta], l.tov, l.pf,
		("+%d" % l.pm) if l.pm > 0 else str(l.pm)]


## Box score with a team toggle.
static func box_score(sim: GameSim) -> Control:
	var p := UIKit.panel(Color(0.07, 0.08, 0.11, 0.97), 8)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	p.add_child(v)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	v.add_child(head)
	head.add_child(UIKit.label("BOX SCORE", 34, 900, UIKit.TEXT, true))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(spacer)
	var shown := [GameState.HOME]
	var buttons := []
	for t in [GameState.AWAY, GameState.HOME]:
		var b := UIKit.button(str(sim.teams[t].abbr), Vector2(110, 54))
		b.toggle_mode = true
		head.add_child(b)
		buttons.append([t, b])
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(1060, 520)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	v.add_child(scroll)
	var table := VBoxContainer.new()
	table.add_theme_constant_override("separation", 2)
	scroll.add_child(table)
	var refresh := func():
		for c in table.get_children():
			c.queue_free()
		var t: int = shown[0]
		for pair in buttons:
			pair[1].button_pressed = pair[0] == t
		table.add_child(_row(COLS.map(func(c): return c[0]), 18, UIKit.TEXT_DIM, true))
		var on_court: Array = sim.rot[t].on_court
		for pid in sim.box.order[t]:
			var l: Dictionary = sim.box.line(pid)
			var played: bool = l.sec > 0.0 or pid in on_court
			var row := _row(_line_values(l, pid in on_court) if played else
				["   %s %s" % [l.number, l.name], "DNP"] + ["", "", "", "", "", "", "", "", "", "", ""], 20,
				UIKit.TEXT if played else UIKit.TEXT_DIM)
			table.add_child(row)
		var tt := sim.box.team_totals(t)
		tt["name"] = "TEAM"
		tt["number"] = ""
		var tv := _line_values(tt, false)
		tv[0] = "TOTALS"
		tv[1] = ""
		tv[12] = ""
		table.add_child(_row(tv, 20, UIKit.ACCENT_2, true))
		var pct := func(m, a): return "%.1f%%" % (100.0 * m / a) if a > 0 else "-"
		table.add_child(_row(["", "", "", "", "", "", "", pct.call(tt.fgm, tt.fga), pct.call(tt.tpm, tt.tpa),
			pct.call(tt.ftm, tt.fta), "", "", ""], 18, UIKit.TEXT_DIM))
	for pair in buttons:
		pair[1].pressed.connect(func():
			shown[0] = pair[0]
			refresh.call())
	p.set_meta("refresh", refresh)
	refresh.call()
	return p


static func play_by_play(sim: GameSim) -> Control:
	var p := UIKit.panel(Color(0.07, 0.08, 0.11, 0.97), 8)
	var v := VBoxContainer.new()
	p.add_child(v)
	v.add_child(UIKit.label("PLAY-BY-PLAY", 34, 900, UIKit.TEXT, true))
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(900, 540)
	v.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 4)
	scroll.add_child(list)
	var refresh := func():
		for c in list.get_children():
			c.queue_free()
		var plays: Array = sim.box.plays
		for i in range(plays.size() - 1, maxi(-1, plays.size() - 81), -1):
			var pl: Dictionary = plays[i]
			var h := HBoxContainer.new()
			h.add_theme_constant_override("separation", 12)
			var q := "Q%d" % pl.period if pl.period <= 4 else "OT"
			h.add_child(_cell("%s %s" % [q, pl.clock], 110, 18, UIKit.TEXT_DIM))
			var team: int = pl.team
			var tag := _cell(str(sim.teams[team].abbr) if team >= 0 else "", 60, 18,
				UIKit.team_color(sim.teams[team], "secondary").lightened(0.2) if team >= 0 else UIKit.TEXT, true)
			h.add_child(tag)
			h.add_child(_cell(pl.text, 540, 20))
			h.add_child(_cell("%d-%d" % [pl.score[1], pl.score[0]], 90, 18, UIKit.TEXT_DIM))
			list.add_child(h)
	p.set_meta("refresh", refresh)
	refresh.call()
	return p


## Tap a player on the floor, then one on the bench. Applied at the next dead ball.
static func substitutions(sim: GameSim) -> Control:
	var p := UIKit.panel(Color(0.07, 0.08, 0.11, 0.97), 8)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	p.add_child(v)
	var t := sim.user_team
	v.add_child(UIKit.label("SUBSTITUTIONS", 34, 900, UIKit.TEXT, true))
	var hint := UIKit.label("Tap a player on the floor, then one on the bench.", 18, 600, UIKit.TEXT_DIM)
	v.add_child(hint)
	var auto := CheckButton.new()
	auto.text = "Auto substitutions"
	auto.button_pressed = sim.auto_subs_user
	auto.toggled.connect(func(on): sim.auto_subs_user = on)
	v.add_child(auto)
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 20)
	v.add_child(cols)
	var floor_col := VBoxContainer.new()
	var bench_col := VBoxContainer.new()
	cols.add_child(floor_col)
	cols.add_child(bench_col)
	var picked := [""]
	var refresh: Callable
	var describe := func(pid: String) -> String:
		var pl := sim.rot[t].player(pid)
		var l := sim.box.line(pid)
		var stam := float(sim.rot[t].stamina.get(pid, 1.0))
		for cp in sim.lineup(t):
			if cp.pid() == pid:
				stam = cp.stamina
		return "%s %s  %s   ⚡%d%%  PF %d" % [pl.get("number", ""), pl.get("last", ""), pl.get("pos", ""),
			roundi(stam * 100.0), int(l.get("pf", 0))]
	refresh = func():
		for c in floor_col.get_children() + bench_col.get_children():
			c.queue_free()
		floor_col.add_child(UIKit.label("ON THE FLOOR", 20, 800, UIKit.ACCENT_2))
		bench_col.add_child(UIKit.label("BENCH", 20, 800, UIKit.ACCENT_2))
		for pid in sim.rot[t].on_court:
			var b := UIKit.button(describe.call(pid), Vector2(470, 56))
			b.toggle_mode = true
			b.button_pressed = picked[0] == pid
			b.pressed.connect(func():
				picked[0] = pid
				refresh.call())
			floor_col.add_child(b)
		for pid in sim.rot[t].bench():
			var out := Referee.fouled_out(int(sim.box.line(pid).get("pf", 0)))
			var b := UIKit.button(describe.call(pid) + ("  OUT" if out else ""), Vector2(470, 56))
			b.disabled = out or picked[0] == ""
			b.pressed.connect(func():
				sim.queue_sub(t, picked[0], pid)
				picked[0] = ""
				refresh.call())
			bench_col.add_child(b)
	p.set_meta("refresh", refresh)
	refresh.call()
	return p


## Final screen: score, player of the game, box score.
static func final_screen(sim: GameSim, winner: int, on_again: Callable, on_menu: Callable) -> Control:
	var root := Control.new()
	root.theme = UIKit.theme()
	UIKit.full_rect(root)
	var bg := ColorRect.new()
	bg.color = Color(0.03, 0.04, 0.06, 0.94)
	root.add_child(UIKit.full_rect(bg))
	var safe := MarginContainer.new()
	root.add_child(safe)
	UIKit.fit_safe_area(safe)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	safe.add_child(v)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 24)
	v.add_child(top)
	top.add_child(UIKit.label("FINAL", 64, 900, UIKit.ACCENT, true))
	for t in [GameState.AWAY, GameState.HOME]:
		var chip := UIKit.panel(UIKit.team_color(sim.teams[t]), 6)
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 16)
		chip.add_child(h)
		h.add_child(UIKit.label(str(sim.teams[t].abbr), 40, 900, UIKit.team_color(sim.teams[t], "secondary").lightened(0.25), true))
		h.add_child(UIKit.label(str(sim.state.scores[t]), 52, 900, Color.WHITE, true))
		top.add_child(chip)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(spacer)
	var again := UIKit.accent_button("PLAY AGAIN", Vector2(240, 70))
	again.pressed.connect(on_again)
	top.add_child(again)
	var menu := UIKit.button("MAIN MENU", Vector2(220, 70))
	menu.pressed.connect(on_menu)
	top.add_child(menu)
	var pog_id := sim.box.player_of_game(winner)
	if pog_id != "":
		var l := sim.box.line(pog_id)
		var card := UIKit.panel(Color(0.1, 0.11, 0.15, 0.97), 8)
		var ch := HBoxContainer.new()
		ch.add_theme_constant_override("separation", 20)
		card.add_child(ch)
		ch.add_child(UIKit.label("PLAYER OF THE GAME", 22, 900, UIKit.ACCENT_2, true))
		ch.add_child(UIKit.label("%s  #%s" % [str(l.full).to_upper(), l.number], 32, 900, UIKit.TEXT, true))
		ch.add_child(UIKit.label(BoxScore.stat_line(l), 24, 700, UIKit.TEXT_DIM))
		v.add_child(card)
	var bs := box_score(sim)
	v.add_child(bs)
	return root
