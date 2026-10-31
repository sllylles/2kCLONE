class_name UIKit
extends RefCounted
## Shared theme and widget helpers so every menu has the same bold,
## broadcast-graphics look and big touch targets.

const BG := Color("0b0d12")
const PANEL := Color("161a22")
const PANEL_HI := Color("222838")
const ACCENT := Color("e8562a")
const ACCENT_2 := Color("ffc23d")
const TEXT := Color("f2f4f8")
const TEXT_DIM := Color("9aa3b5")

static var _theme: Theme
static var _fonts := {}


static func font(weight := 700, italic := false) -> Font:
	var key := "%d_%s" % [weight, italic]
	if not _fonts.has(key):
		var f := SystemFont.new()
		f.font_names = PackedStringArray(["Roboto", "Inter", "Helvetica Neue", "Arial", "sans-serif"])
		f.font_weight = weight
		f.font_italic = italic
		f.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
		f.fallbacks = [ThemeDB.fallback_font]
		_fonts[key] = f
	return _fonts[key]


static func theme() -> Theme:
	if _theme:
		return _theme
	var t := Theme.new()
	t.default_font = font(600)
	t.default_font_size = 26

	var btn := _box(PANEL_HI, 6)
	var btn_hover := _box(PANEL_HI.lightened(0.12), 6)
	var btn_press := _box(ACCENT.darkened(0.15), 6)
	var btn_focus := _box(Color(0, 0, 0, 0), 6)
	btn_focus.border_color = ACCENT_2
	btn_focus.set_border_width_all(3)
	var btn_disabled := _box(PANEL.darkened(0.2), 6)
	for type in ["Button", "OptionButton", "CheckButton"]:
		t.set_stylebox("normal", type, btn)
		t.set_stylebox("hover", type, btn_hover)
		t.set_stylebox("pressed", type, btn_press)
		t.set_stylebox("hover_pressed", type, btn_press)
		t.set_stylebox("focus", type, btn_focus)
		t.set_stylebox("disabled", type, btn_disabled)
		t.set_color("font_color", type, TEXT)
		t.set_color("font_hover_color", type, Color.WHITE)
		t.set_color("font_pressed_color", type, Color.WHITE)
		t.set_color("font_focus_color", type, Color.WHITE)
		t.set_color("font_disabled_color", type, TEXT_DIM.darkened(0.3))
		t.set_font("font", type, font(800))
		t.set_font_size("font_size", type, 26)
	t.set_constant("h_separation", "Button", 12)

	t.set_stylebox("panel", "PanelContainer", _box(PANEL, 10))
	t.set_stylebox("panel", "Panel", _box(PANEL, 10))
	t.set_color("font_color", "Label", TEXT)

	var tab_sel := _box(ACCENT, 0)
	var tab_unsel := _box(Color(0, 0, 0, 0), 0)
	t.set_stylebox("tab_selected", "TabContainer", tab_sel)
	t.set_stylebox("tab_unselected", "TabContainer", tab_unsel)
	t.set_stylebox("tab_hovered", "TabContainer", _box(PANEL_HI, 0))
	t.set_stylebox("tab_focus", "TabContainer", btn_focus)
	t.set_stylebox("panel", "TabContainer", _box(PANEL, 0))
	t.set_font("font", "TabContainer", font(800, true))
	t.set_font_size("font_size", "TabContainer", 26)
	t.set_color("font_selected_color", "TabContainer", Color.WHITE)
	t.set_color("font_unselected_color", "TabContainer", TEXT_DIM)

	var slider := StyleBoxFlat.new()
	slider.bg_color = PANEL_HI.lightened(0.1)
	slider.content_margin_top = 6
	slider.content_margin_bottom = 6
	slider.set_corner_radius_all(4)
	var slider_fill := slider.duplicate()
	slider_fill.bg_color = ACCENT
	t.set_stylebox("slider", "HSlider", slider)
	t.set_stylebox("grabber_area", "HSlider", slider_fill)
	t.set_stylebox("grabber_area_highlight", "HSlider", slider_fill)
	t.set_icon("grabber", "HSlider", _circle_icon(18, Color.WHITE))
	t.set_icon("grabber_highlight", "HSlider", _circle_icon(20, ACCENT_2))

	var line := _box(Color("0e1118"), 6)
	line.set_content_margin_all(10)
	t.set_stylebox("normal", "LineEdit", line)
	t.set_stylebox("focus", "LineEdit", btn_focus)
	t.set_color("font_color", "LineEdit", TEXT)

	t.set_stylebox("panel", "PopupMenu", _box(PANEL_HI, 6))
	t.set_font_size("font_size", "PopupMenu", 26)
	t.set_constant("v_separation", "PopupMenu", 14)
	t.set_stylebox("panel", "AcceptDialog", _box(PANEL, 10))
	t.set_constant("scrollbar_h_separation", "ScrollContainer", 6)
	_theme = t
	return t


static func _box(c: Color, radius: int) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = c
	sb.set_corner_radius_all(radius)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	sb.content_margin_top = 12
	sb.content_margin_bottom = 12
	return sb


static func _circle_icon(size: int, c: Color) -> Texture2D:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var r := size / 2.0
	for y in size:
		for x in size:
			var d := Vector2(x + 0.5 - r, y + 0.5 - r).length()
			img.set_pixel(x, y, Color(c, clampf(r - d, 0.0, 1.0)))
	return ImageTexture.create_from_image(img)


static func label(text: String, size := 26, weight := 700, color := TEXT, italic := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(weight, italic))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func button(text: String, min_size := Vector2(220, 72)) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = min_size
	return b


static func accent_button(text: String, min_size := Vector2(260, 80)) -> Button:
	var b := button(text, min_size)
	var sb := _box(ACCENT, 6)
	b.add_theme_stylebox_override("normal", sb)
	b.add_theme_stylebox_override("hover", _box(ACCENT.lightened(0.1), 6))
	return b


static func panel(color := PANEL, radius := 10) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", _box(color, radius))
	return p


static func full_rect(c: Control) -> Control:
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	return c


## A generated round team badge (used when a team has no logo PNG).
static func team_badge(team: Dictionary, size := 256) -> Texture2D:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var p := DataDB.color(team.get("primary", "#333333"))
	var s := DataDB.color(team.get("secondary", "#ffffff"))
	var a := DataDB.color(team.get("accent", "#ffffff"))
	var r := size / 2.0
	for y in size:
		for x in size:
			var v := Vector2(x + 0.5 - r, y + 0.5 - r)
			var d := v.length() / r
			var c := Color(0, 0, 0, 0)
			if d < 1.0:
				c = s
			if d < 0.92:
				c = p
			if d < 0.80 and d > 0.74:
				c = a
			# diagonal stripe
			if d < 0.74 and absf(v.x * 0.7 + v.y * 0.7) < r * 0.12:
				c = s
			c.a *= clampf((1.0 - d) * r, 0.0, 1.0)
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func team_color(team: Dictionary, key := "primary") -> Color:
	return DataDB.color(team.get(key, "#444444"))
