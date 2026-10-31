class_name ArenaBuilder
extends Node3D
## Builds everything around the court: two-tier seating bowl, instanced
## crowd, LED ribbon and baseline boards, scorer's table, team benches,
## center-hung jumbotron, ceiling light banks, and broadcast lighting.
##
## Render layers: 1 = court & hoops, 2 = stands & crowd, 3 = players & ball.

const FT := CourtSpec.FT
const LAYER_STANDS := 2

const BOWL_HALF := Vector2(62.0, 41.0)   # inner edge of the lower bowl, feet
const BOWL_RADIUS := 18.0
const LOWER_START_H := 3.5
const LOWER_DEPTH := 2.8
const LOWER_RISE := 1.25
const CLUB_SETBACK := 7.0
const CLUB_RISE := 11.0
const UPPER_DEPTH := 2.7
const UPPER_RISE := 1.75
const SEAT_SPACING := 2.0
const AISLE_EVERY := 34.0
const JUMBO_BOTTOM := 58.0

var home: Dictionary
var away: Dictionary
var arena: Dictionary
var quality := "medium"
var crowd_density := 0.7

var crowd_material: ShaderMaterial
var ribbon_materials: Array[ShaderMaterial] = []
var jumbo_viewport: SubViewport
var jumbo_labels := {}
var _rng := RandomNumberGenerator.new()


func build(home_team: Dictionary, away_team: Dictionary, arena_data: Dictionary, quality_level: String, density: float) -> void:
	home = home_team
	away = away_team
	arena = arena_data
	quality = quality_level
	crowd_density = density * {"low": 0.45, "medium": 0.8, "high": 1.0}.get(quality, 0.8)
	_rng.seed = hash(arena.get("id", "arena"))
	crowd_material = ShaderMaterial.new()
	crowd_material.shader = preload("res://shaders/crowd.gdshader")
	_build_bowl()
	_build_courtside()
	_build_jumbotron()
	_build_ceiling()
	_build_lighting()


# --- Seating bowl ---------------------------------------------------------------

func _build_bowl() -> void:
	var lower_rows := int(arena.get("lower_rows", 18))
	var upper_rows := int(arena.get("upper_rows", 22))
	var seat := DataDB.color(arena.get("seat_color", "#333333"))
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var crowd: Array = []   # [pos_ft Vector3, inward Vector2]

	# Front wall of the lower bowl.
	var off := 0.0
	var h := 0.0
	_ring_wall(st, off, 0.0, LOWER_START_H, Color(0.08, 0.08, 0.1))
	h = LOWER_START_H
	for r in lower_rows:
		_ring_step(st, off, h, LOWER_DEPTH, LOWER_RISE, seat, crowd)
		off += LOWER_DEPTH
		h += LOWER_RISE
	var ribbon_off := off
	var ribbon_h := h
	# Club level fascia, then the upper bowl.
	_ring_tread(st, off, h, CLUB_SETBACK, Color(0.06, 0.06, 0.07))
	off += CLUB_SETBACK
	_ring_wall(st, off, h, h + CLUB_RISE, Color(0.04, 0.04, 0.05))
	h += CLUB_RISE
	for r in upper_rows:
		_ring_step(st, off, h, UPPER_DEPTH, UPPER_RISE, seat.darkened(0.15), crowd)
		off += UPPER_DEPTH
		h += UPPER_RISE
	_ring_wall(st, off, h, h + 30.0, Color(0.03, 0.03, 0.035))
	st.generate_normals()
	var mi := MeshInstance3D.new()
	mi.name = "Bowl"
	mi.mesh = st.commit()
	var m := MeshKit.mat(Color.WHITE, 0.85)
	m.vertex_color_use_as_albedo = true
	mi.material_override = m
	mi.layers = LAYER_STANDS
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

	_spawn_crowd(crowd, "BowlCrowd")
	_build_ribbon(ribbon_off, ribbon_h + 0.6, 3.0)
	_build_ribbon(ribbon_off + CLUB_SETBACK, ribbon_h + CLUB_RISE * 0.45, 4.0)


func _loop(offset: float) -> PackedVector2Array:
	return MeshKit.rounded_rect(BOWL_HALF, BOWL_RADIUS, offset, 6)


func _ring_wall(st: SurfaceTool, offset: float, y0: float, y1: float, c: Color) -> void:
	var pts := _loop(offset)
	for i in pts.size():
		var a := pts[i]
		var b := pts[(i + 1) % pts.size()]
		_quad(st, Vector3(a.x, y0, a.y), Vector3(b.x, y0, b.y), Vector3(b.x, y1, b.y), Vector3(a.x, y1, a.y), c)


func _ring_tread(st: SurfaceTool, offset: float, y: float, depth: float, c: Color) -> void:
	var inner := _loop(offset)
	var outer := _loop(offset + depth)
	for i in inner.size():
		var j := (i + 1) % inner.size()
		_quad(st, Vector3(inner[i].x, y, inner[i].y), Vector3(outer[i].x, y, outer[i].y),
			Vector3(outer[j].x, y, outer[j].y), Vector3(inner[j].x, y, inner[j].y), c)


func _ring_step(st: SurfaceTool, offset: float, y: float, depth: float, rise: float, seat: Color, crowd: Array) -> void:
	var tone := seat.darkened(_rng.randf_range(0.0, 0.12))
	_ring_tread(st, offset, y, depth, tone)
	_ring_wall(st, offset + depth, y, y + rise, seat.darkened(0.55))
	# Seats along the middle of the tread.
	var pts := _loop(offset + depth * 0.45)
	var lens := MeshKit.loop_lengths(pts)
	var total := lens[lens.size() - 1]
	var d := _rng.randf_range(0.0, SEAT_SPACING)
	var seg := 0
	while d < total:
		while lens[seg + 1] < d:
			seg += 1
		var a := pts[seg]
		var b := pts[(seg + 1) % pts.size()]
		var t := (d - lens[seg]) / maxf(0.001, lens[seg + 1] - lens[seg])
		var p := a.lerp(b, t)
		var tangent := (b - a).normalized()
		var inward := Vector2(tangent.y, -tangent.x)   # loop runs counter-clockwise
		if inward.dot(-p) < 0.0:
			inward = -inward
		if fmod(d, AISLE_EVERY) > 3.0:
			crowd.append([Vector3(p.x, y, p.y), inward])
		d += SEAT_SPACING


func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, col: Color) -> void:
	for v in [a, c, b, a, d, c]:
		st.set_color(col)
		st.add_vertex(v * FT)


# --- Crowd ----------------------------------------------------------------------

## One spectator: torso + head + arms (arms flagged with UV.x = 1 so the
## shader can raise them). About 30 triangles.
static func make_person_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_add_box(st, Vector3(0, 0.40, 0), Vector3(0.44, 0.48, 0.26), 0.0)    # torso
	_add_box(st, Vector3(0, 0.75, 0.01), Vector3(0.20, 0.22, 0.21), 0.0)  # head
	_add_box(st, Vector3(0, 0.50, 0.08), Vector3(0.54, 0.09, 0.10), 1.0)  # arms
	st.generate_normals()
	return st.commit()


static func _add_box(st: SurfaceTool, c: Vector3, s: Vector3, flag: float) -> void:
	var h := s / 2.0
	var corners := [
		Vector3(-h.x, -h.y, -h.z), Vector3(h.x, -h.y, -h.z), Vector3(h.x, h.y, -h.z), Vector3(-h.x, h.y, -h.z),
		Vector3(-h.x, -h.y, h.z), Vector3(h.x, -h.y, h.z), Vector3(h.x, h.y, h.z), Vector3(-h.x, h.y, h.z)]
	# faces: front(+z), back, left, right, top (no bottom)
	var faces := [[4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3], [5, 1, 2, 6], [7, 6, 2, 3]]
	for f in faces:
		for idx in [0, 2, 1, 0, 3, 2]:
			st.set_uv(Vector2(flag, 0))
			st.add_vertex(c + corners[f[idx]])


func _spawn_crowd(seats: Array, node_name: String, palette: Array = []) -> void:
	if seats.is_empty() or crowd_density <= 0.01:
		return
	var shirts := palette
	if shirts.is_empty():
		var p := UIKit.team_color(home)
		var s := UIKit.team_color(home, "secondary")
		shirts = [p, p, p, s, s, Color.WHITE, Color(0.12, 0.12, 0.14), Color(0.25, 0.25, 0.3),
			Color(0.6, 0.12, 0.1), Color(0.75, 0.75, 0.72), UIKit.team_color(away), Color(0.15, 0.3, 0.55)]
	# Split into angular sectors so off-screen chunks get frustum culled.
	var sectors := 8
	var buckets: Array = []
	for i in sectors:
		buckets.append([])
	for s in seats:
		if _rng.randf() > crowd_density:
			continue
		var p: Vector3 = s[0]
		var k := int(floor((atan2(p.z, p.x) + PI) / TAU * sectors)) % sectors
		buckets[k].append(s)
	var mesh := make_person_mesh()
	for k in sectors:
		var list: Array = buckets[k]
		if list.is_empty():
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.use_custom_data = true
		mm.mesh = mesh
		mm.instance_count = list.size()
		for i in list.size():
			var pos: Vector3 = list[i][0]
			var inward: Vector2 = list[i][1]
			var fwd := Vector3(inward.x, 0, inward.y).normalized()
			var basis := Basis.looking_at(-fwd, Vector3.UP)   # mesh front is +Z
			basis = basis.scaled(Vector3.ONE * _rng.randf_range(0.92, 1.08))
			mm.set_instance_transform(i, Transform3D(basis, pos * FT))
			mm.set_instance_color(i, shirts[_rng.randi() % shirts.size()])
			mm.set_instance_custom_data(i, Color(_rng.randf(), _rng.randf(), _rng.randf(), _rng.randf_range(0.75, 1.1)))
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "%s%d" % [node_name, k]
		mmi.multimesh = mm
		mmi.material_override = crowd_material
		mmi.layers = LAYER_STANDS
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)


func set_excitement(v: float) -> void:
	crowd_material.set_shader_parameter("excitement", clampf(v, 0.0, 1.0))
	for m in ribbon_materials:
		m.set_shader_parameter("hype", clampf((v - 0.6) * 2.5, 0.0, 1.0))


# --- LED boards -----------------------------------------------------------------

func _ribbon_material(height_ft: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = preload("res://shaders/led_ribbon.gdshader")
	m.set_shader_parameter("text_tex", _text_texture(str(arena.get("ribbon_text", "COURTSIDE"))))
	m.set_shader_parameter("text_aspect", 16.0)
	m.set_shader_parameter("board_height_ft", height_ft)
	m.set_shader_parameter("color_a", UIKit.team_color(home))
	m.set_shader_parameter("color_b", UIKit.team_color(home, "secondary"))
	m.set_shader_parameter("mode_period", _rng.randf_range(7.0, 11.0))
	ribbon_materials.append(m)
	return m


var _text_tex_cache: Texture2D

func _text_texture(text: String) -> Texture2D:
	if _text_tex_cache:
		return _text_tex_cache
	var vp := SubViewport.new()
	vp.size = Vector2i(2048, 128)
	vp.transparent_bg = true
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	var l := Label.new()
	l.text = ("   " + text + "   •")
	l.size = Vector2(2048, 128)
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_override("font", UIKit.font(900, true))
	l.add_theme_font_size_override("font_size", 92)
	vp.add_child(l)
	add_child(vp)
	_text_tex_cache = vp.get_texture()
	return _text_tex_cache


## A vertical LED band following the bowl at the given offset.
func _build_ribbon(offset: float, y: float, height_ft: float) -> void:
	var pts := _loop(offset - 0.05)
	var lens := MeshKit.loop_lengths(pts)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in pts.size():
		var a := pts[i]
		var b := pts[(i + 1) % pts.size()]
		var ua := lens[i]
		var ub := lens[i + 1]
		var v := [[Vector3(a.x, y, a.y), Vector2(ua, 0)], [Vector3(b.x, y, b.y), Vector2(ub, 0)],
			[Vector3(b.x, y + height_ft, b.y), Vector2(ub, 1)], [Vector3(a.x, y + height_ft, a.y), Vector2(ua, 1)]]
		for idx in [0, 1, 2, 0, 2, 3]:
			st.set_uv(v[idx][1])
			st.add_vertex(v[idx][0] * FT)
	st.generate_normals()
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = _ribbon_material(height_ft)
	mi.layers = LAYER_STANDS
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


## A flat LED board centered at `center` (feet), facing `facing` (unit XZ).
func _led_board(center: Vector3, length_ft: float, height_ft: float, facing: Vector3) -> void:
	var q := QuadMesh.new()
	q.size = Vector2(length_ft, height_ft) * FT
	q.center_offset = Vector3(0, height_ft / 2.0, 0) * FT
	var mi := MeshInstance3D.new()
	mi.mesh = q
	var m := _ribbon_material(height_ft)
	mi.material_override = m
	m.set_shader_parameter("uv_scale", length_ft)   # QuadMesh UVs are 0..1, top-down
	m.set_shader_parameter("v_down", true)
	mi.position = center * FT
	mi.basis = Basis.looking_at(-facing, Vector3.UP)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	# Back/frame
	MeshKit.box(self, Vector3(length_ft, height_ft, 0.6) * FT if absf(facing.z) > 0.5 else Vector3(0.6, height_ft, length_ft) * FT,
		center * FT + Vector3(0, height_ft / 2.0, 0) * FT - facing * 0.35 * FT, MeshKit.mat(Color(0.05, 0.05, 0.06)))


# --- Courtside: table, benches, baseline boards, floor seats -------------------

func _build_courtside() -> void:
	var dark := MeshKit.mat(Color(0.07, 0.07, 0.08), 0.6)
	# Scorer's table on the far sideline (benches side), LED front facing the court.
	var table_z := -(CourtSpec.HALF_WIDTH + 6.5)
	MeshKit.box(self, Vector3(32.0, 2.6, 2.5) * FT, Vector3(0, 1.3, table_z) * FT, dark)
	_led_board(Vector3(0, 0.1, table_z + 1.3), 31.5, 2.3, Vector3(0, 0, 1))
	# Officials behind the table.
	var officials: Array = []
	for i in 9:
		officials.append([Vector3(-12.0 + i * 3.0, 0.9, table_z - 2.6), Vector2(0, 1)])
	_spawn_crowd(officials, "TableCrew", [Color(0.1, 0.1, 0.12), Color(0.2, 0.2, 0.24)])
	# Team benches either side of the table: away on the left (-x), home on the right.
	for side in [-1, 1]:
		var team := home if side > 0 else away
		var bench: Array = []
		for i in 14:
			bench.append([Vector3(side * (19.0 + i * 1.9), 0.6, -(CourtSpec.HALF_WIDTH + 7.5)), Vector2(0, 1)])
		var c := UIKit.team_color(team)
		var saved := crowd_density
		crowd_density = 1.0
		_spawn_crowd(bench, "Bench%d" % side, [c, c, c.lightened(0.15)])
		crowd_density = saved
		MeshKit.box(self, Vector3(28.0, 1.4, 2.2) * FT, Vector3(side * 31.0, 0.7, -(CourtSpec.HALF_WIDTH + 7.8)) * FT,
			MeshKit.mat(c.darkened(0.4), 0.7))
	# Baseline LED boards facing the court.
	for side in [-1, 1]:
		_led_board(Vector3(side * (CourtSpec.HALF_LENGTH + 11.0), 0.0, 0), 34.0, 2.6, Vector3(-side, 0, 0))
	# Courtside floor seats: near sideline and baselines.
	var floor_seats: Array = []
	for row in 3:
		var z := CourtSpec.HALF_WIDTH + 6.0 + row * 3.2
		var x := -50.0
		while x < 50.0:
			floor_seats.append([Vector3(x, row * 0.6, z), Vector2(0, -1)])
			x += SEAT_SPACING
		for side in [-1, 1]:
			var bx: float = side * (CourtSpec.HALF_LENGTH + 13.5 + row * 3.2)
			var zz := -22.0
			while zz < 22.0:
				if absf(zz) > 3.0:
					floor_seats.append([Vector3(bx, row * 0.6, zz), Vector2(-side, 0)])
				zz += SEAT_SPACING
	_spawn_crowd(floor_seats, "FloorSeats")


# --- Jumbotron -------------------------------------------------------------------

func _build_jumbotron() -> void:
	var size := Vector3(28.0, 17.0, 18.0)
	var y := JUMBO_BOTTOM + size.y / 2.0
	var frame := MeshKit.mat(Color(0.04, 0.04, 0.05), 0.4, 0.5)
	MeshKit.box(self, size * FT, Vector3(0, y, 0) * FT, frame)
	MeshKit.box(self, Vector3(1.0, 40.0, 1.0) * FT, Vector3(0, y + 28.0, 0) * FT, frame)
	# Screen content is rendered once per update into a viewport texture.
	jumbo_viewport = SubViewport.new()
	jumbo_viewport.size = Vector2i(512, 300)
	jumbo_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(jumbo_viewport)
	var bg := ColorRect.new()
	bg.color = Color(0.02, 0.03, 0.06)
	bg.size = Vector2(512, 300)
	jumbo_viewport.add_child(bg)
	var stripe := ColorRect.new()
	stripe.color = UIKit.team_color(home)
	stripe.size = Vector2(512, 50)
	jumbo_viewport.add_child(stripe)
	var title := _jumbo_label(arena.get("name", "").to_upper(), 30, Vector2(0, 4), Vector2(512, 44))
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	for i in 2:
		var team := away if i == 0 else home
		var x := 20.0 + i * 256.0
		var abbr := _jumbo_label(team.abbr, 54, Vector2(x, 62), Vector2(216, 60))
		abbr.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		abbr.add_theme_color_override("font_color", UIKit.team_color(team, "secondary").lightened(0.2))
		var score := _jumbo_label("0", 110, Vector2(x, 112), Vector2(216, 120))
		score.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		jumbo_labels["score%d" % i] = score
	var clock := _jumbo_label("1ST  12:00", 36, Vector2(0, 240), Vector2(512, 50))
	clock.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	clock.add_theme_color_override("font_color", Color(1, 0.8, 0.3))
	jumbo_labels["clock"] = clock
	var screen_mat := StandardMaterial3D.new()
	screen_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	screen_mat.albedo_texture = jumbo_viewport.get_texture()
	screen_mat.albedo_color = Color(1.4, 1.4, 1.4)
	for i in 4:
		var facing: Vector3 = [Vector3(0, 0, 1), Vector3(0, 0, -1), Vector3(1, 0, 0), Vector3(-1, 0, 0)][i]
		var w := size.x if i < 2 else size.z
		var q := QuadMesh.new()
		q.size = Vector2(w - 1.5, size.y - 3.0) * FT
		var mi := MeshInstance3D.new()
		mi.mesh = q
		mi.material_override = screen_mat
		var half := (size.z if i < 2 else size.x) / 2.0 + 0.05
		mi.position = (Vector3(0, y, 0) + facing * half) * FT
		mi.basis = Basis.looking_at(-facing, Vector3.UP)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
	# LED rings above and below the screens.
	for ring_y in [JUMBO_BOTTOM + 0.2, JUMBO_BOTTOM + size.y - 1.4]:
		for i in 4:
			var facing: Vector3 = [Vector3(0, 0, 1), Vector3(0, 0, -1), Vector3(1, 0, 0), Vector3(-1, 0, 0)][i]
			var w := size.x if i < 2 else size.z
			var half := (size.z if i < 2 else size.x) / 2.0 + 0.1
			var c := facing * half
			_led_board(Vector3(c.x, ring_y, c.z), w, 1.2, facing)


func _jumbo_label(text: String, size: int, pos: Vector2, box: Vector2) -> Label:
	var l := Label.new()
	l.text = text
	l.position = pos
	l.size = box
	l.add_theme_font_override("font", UIKit.font(900, true))
	l.add_theme_font_size_override("font_size", size)
	jumbo_viewport.add_child(l)
	return l


func update_jumbotron(away_score: int, home_score: int, clock_text: String) -> void:
	if jumbo_labels.is_empty():
		return
	jumbo_labels["score0"].text = str(away_score)
	jumbo_labels["score1"].text = str(home_score)
	jumbo_labels["clock"].text = clock_text
	jumbo_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE


# --- Ceiling & lights -------------------------------------------------------------

func _build_ceiling() -> void:
	var ceil_mesh := PlaneMesh.new()
	ceil_mesh.size = Vector2(400, 320) * FT
	ceil_mesh.flip_faces = true
	var ceil := MeshInstance3D.new()
	ceil.mesh = ceil_mesh
	ceil.position.y = 118.0 * FT
	ceil.material_override = MeshKit.mat(Color(0.02, 0.02, 0.025), 1.0)
	ceil.layers = LAYER_STANDS
	add_child(ceil)
	# Light banks: one multimesh of emissive panels in a ring over the court.
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	var panel := BoxMesh.new()
	panel.size = Vector3(2.2, 0.4, 2.2) * FT
	mm.mesh = panel
	var spots: Array[Vector3] = []
	for ix in range(-6, 7):
		for side in [-1, 1]:
			spots.append(Vector3(ix * 8.0, 105.0, side * 34.0))
	for iz in range(-3, 4):
		for side in [-1, 1]:
			spots.append(Vector3(side * 58.0, 105.0, iz * 9.0))
	mm.instance_count = spots.size()
	for i in spots.size():
		mm.set_instance_transform(i, Transform3D(Basis.IDENTITY, spots[i] * FT))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = MeshKit.emissive(DataDB.color(arena.get("light_color", "#ffffff")), 6.0)
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)


func _build_lighting() -> void:
	var light_color := DataDB.color(arena.get("light_color", "#ffffff"))
	# Key light for the court and players (layers 1 and 3).
	var key := DirectionalLight3D.new()
	key.name = "CourtKey"
	key.rotation_degrees = Vector3(-64, 28, 0)
	key.light_color = light_color
	key.light_energy = 1.25
	key.light_specular = 0.12   # floor reflections come from the probe, not a hotspot
	key.light_cull_mask = 1 | 4
	key.shadow_enabled = quality != "low"
	key.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	key.directional_shadow_max_distance = 45.0
	key.shadow_blur = 1.5
	add_child(key)
	# Soft fill from the opposite side, no shadows.
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-50, 200, 0)
	fill.light_color = light_color
	fill.light_energy = 0.35
	fill.light_specular = 0.0
	fill.light_cull_mask = 1 | 4
	add_child(fill)
	# Dim light for the stands keeps the crowd in broadcast-style darkness.
	var stands := DirectionalLight3D.new()
	stands.rotation_degrees = Vector3(-70, 10, 0)
	stands.light_energy = 0.32
	stands.light_cull_mask = LAYER_STANDS
	add_child(stands)

	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.01, 0.01, 0.015)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.42, 0.42, 0.48)
	env.ambient_light_energy = 0.55
	env.reflected_light_source = Environment.REFLECTION_SOURCE_BG
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.05
	env.glow_enabled = quality != "low"
	env.glow_intensity = 0.55
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.1
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.06
	env.adjustment_saturation = 1.08
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
