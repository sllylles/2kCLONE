class_name CourtBuilder
extends Node3D
## Builds the regulation court: hardwood floor with all markings (shader),
## apron lettering, both basket stanchions with backboard, rim, net and
## shot-clock units, plus the floor reflection probe.

const FT := CourtSpec.FT

var home: Dictionary
var quality := "medium"
var nets: Array[ShaderMaterial] = []
var shot_clock_labels: Array[Label3D] = []
var game_clock_labels: Array[Label3D] = []
var floor_material: ShaderMaterial


func build(home_team: Dictionary, quality_level: String) -> void:
	home = home_team
	quality = quality_level
	_build_floor()
	_build_apron_text()
	for side in [-1, 1]:
		_build_hoop(side)
	if quality != "low":
		_build_reflection_probe()


func _build_floor() -> void:
	var court: Dictionary = home.get("court", {})
	floor_material = ShaderMaterial.new()
	floor_material.shader = preload("res://shaders/court_floor.gdshader")
	floor_material.set_shader_parameter("paint_color", DataDB.color(court.get("paint", home.primary)))
	floor_material.set_shader_parameter("apron_color", DataDB.color(court.get("apron", home.primary)))
	floor_material.set_shader_parameter("stain", float(court.get("stain", 0.0)))
	floor_material.set_shader_parameter("logo_tex", _make_logo_texture())
	var plane := PlaneMesh.new()
	plane.size = Vector2(CourtSpec.LENGTH + 32.0, CourtSpec.WIDTH + 30.0) * FT
	var mi := MeshInstance3D.new()
	mi.name = "Floor"
	mi.mesh = plane
	mi.material_override = floor_material
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	# Dark concrete beyond the court so the floor seats have somewhere to sit.
	var base := PlaneMesh.new()
	base.size = Vector2(260, 220) * FT
	var bmi := MeshInstance3D.new()
	bmi.mesh = base
	bmi.position.y = -0.01
	bmi.material_override = MeshKit.mat(Color(0.05, 0.05, 0.06), 0.9)
	add_child(bmi)


## Center-court logo: the team's PNG if provided, otherwise a generated badge
## with the abbreviation, rendered once into a texture.
func _make_logo_texture() -> Texture2D:
	var logo := DataDB.team_logo(home.id)
	if logo:
		return logo
	var vp := SubViewport.new()
	vp.size = Vector2i(512, 512)
	vp.transparent_bg = true
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	var badge := TextureRect.new()
	badge.texture = UIKit.team_badge(home, 512)
	badge.size = Vector2(512, 512)
	vp.add_child(badge)
	var abbr := Label.new()
	abbr.text = home.abbr
	abbr.size = Vector2(512, 512)
	abbr.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	abbr.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	abbr.add_theme_font_override("font", UIKit.font(900, true))
	abbr.add_theme_font_size_override("font_size", 150)
	abbr.add_theme_color_override("font_color", DataDB.color(home.get("accent", "#ffffff")))
	abbr.add_theme_color_override("font_outline_color", DataDB.color(home.secondary))
	abbr.add_theme_constant_override("outline_size", 18)
	vp.add_child(abbr)
	add_child(vp)
	return vp.get_texture()


func _build_apron_text() -> void:
	var color := DataDB.color(home.get("accent", "#ffffff"))
	var flat := Basis(Vector3.RIGHT, -PI / 2)
	# Far sideline: team name, reads from the main broadcast side.
	MeshKit.label3d(self, home.name.to_upper(), 256, 0.0105, color,
		Vector3(0, 0.005, -(CourtSpec.HALF_WIDTH + 2.6) * FT), flat)
	for side in [-1, 1]:
		var b := Basis(Vector3.UP, side * PI / 2) * flat
		MeshKit.label3d(self, home.city.to_upper() if side < 0 else home.name.to_upper(), 220, 0.009, color,
			Vector3(side * (CourtSpec.HALF_LENGTH + 4.0) * FT, 0.005, 0), b)


func _build_hoop(side: int) -> void:
	var s := float(side)
	var hoop := Node3D.new()
	hoop.name = "Hoop%s" % ("East" if side > 0 else "West")
	add_child(hoop)
	var board_x := (CourtSpec.HALF_LENGTH - CourtSpec.BACKBOARD_FROM_BASELINE) * FT * s
	var board_cy := (CourtSpec.BACKBOARD_BOTTOM + CourtSpec.BACKBOARD_HEIGHT / 2.0) * FT
	var white := MeshKit.mat(Color(0.96, 0.96, 0.96), 0.4)
	var black := MeshKit.mat(Color(0.05, 0.05, 0.05), 0.5)
	var team_pad := MeshKit.mat(UIKit.team_color(home), 0.7)

	# Glass backboard.
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.85, 0.92, 1.0, 0.14)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.roughness = 0.05
	glass.metallic_specular = 0.9
	var bw := CourtSpec.BACKBOARD_WIDTH * FT
	var bh := CourtSpec.BACKBOARD_HEIGHT * FT
	var thick := 0.5 * CourtSpec.IN
	MeshKit.box(hoop, Vector3(thick, bh, bw), Vector3(board_x + s * thick / 2.0, board_cy, 0), glass)
	# Border and shooter's square on the court-facing side.
	var lw := 2.0 * CourtSpec.IN
	var front := board_x - s * 0.004
	MeshKit.box(hoop, Vector3(0.006, lw, bw), Vector3(front, board_cy + bh / 2.0 - lw / 2.0, 0), white)
	MeshKit.box(hoop, Vector3(0.006, lw, bw), Vector3(front, board_cy - bh / 2.0 + lw / 2.0, 0), white)
	for z in [-1, 1]:
		MeshKit.box(hoop, Vector3(0.006, bh, lw), Vector3(front, board_cy, z * (bw - lw) / 2.0), white)
	var sq_w := CourtSpec.BOX_WIDTH * FT
	var sq_h := CourtSpec.BOX_HEIGHT * FT
	var sq_y := CourtSpec.RIM_HEIGHT * FT + sq_h / 2.0
	MeshKit.box(hoop, Vector3(0.006, lw, sq_w), Vector3(front, sq_y + sq_h / 2.0, 0), white)
	MeshKit.box(hoop, Vector3(0.006, lw, sq_w), Vector3(front, sq_y - sq_h / 2.0, 0), white)
	for z in [-1, 1]:
		MeshKit.box(hoop, Vector3(0.006, sq_h, lw), Vector3(front, sq_y, z * (sq_w - lw) / 2.0), white)
	# Padding along the bottom edge.
	MeshKit.box(hoop, Vector3(0.09, 0.07, bw + 0.04), Vector3(board_x + s * 0.02, CourtSpec.BACKBOARD_BOTTOM * FT - 0.02, 0), team_pad)

	# Rim, bracket and net.
	var rim_center := CourtSpec.basket_position(side)
	var torus := TorusMesh.new()
	torus.inner_radius = CourtSpec.RIM_RADIUS * FT
	torus.outer_radius = CourtSpec.RIM_RADIUS * FT + 0.016
	torus.rings = 32
	torus.ring_segments = 8
	var rim := MeshInstance3D.new()
	rim.mesh = torus
	rim.material_override = MeshKit.mat(Color(0.95, 0.32, 0.08), 0.35, 0.6)
	rim.position = rim_center
	hoop.add_child(rim)
	var bracket_len := absf(board_x - rim_center.x) - CourtSpec.RIM_RADIUS * FT
	MeshKit.box(hoop, Vector3(bracket_len, 0.03, 0.12), Vector3(board_x - s * bracket_len / 2.0, rim_center.y - 0.01, 0),
		rim.material_override)
	var net_mesh := CylinderMesh.new()
	net_mesh.top_radius = CourtSpec.RIM_RADIUS * FT
	net_mesh.bottom_radius = CourtSpec.RIM_RADIUS * FT * 0.62
	net_mesh.height = 1.5 * FT
	net_mesh.cap_top = false
	net_mesh.cap_bottom = false
	net_mesh.radial_segments = 24
	net_mesh.rings = 4
	var net_mat := ShaderMaterial.new()
	net_mat.shader = preload("res://shaders/net.gdshader")
	var net := MeshInstance3D.new()
	net.mesh = net_mesh
	net.material_override = net_mat
	net.position = rim_center - Vector3(0, net_mesh.height / 2.0, 0)
	net.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	hoop.add_child(net)
	nets.append(net_mat)

	# Stanchion: padded base behind the baseline, post, and arm to the board.
	var base_x := (CourtSpec.HALF_LENGTH + 7.0) * FT * s
	MeshKit.box(hoop, Vector3(5.0, 3.6, 6.0) * FT, Vector3(base_x, 1.8 * FT, 0), team_pad)
	MeshKit.label3d(hoop, home.abbr, 160, 0.006, Color.WHITE, Vector3(base_x - s * 2.52 * FT, 1.9 * FT, 0),
		Basis(Vector3.UP, -s * PI / 2))
	var post_x := base_x + s * 1.0 * FT
	MeshKit.box(hoop, Vector3(1.0, 9.5, 1.0) * FT, Vector3(post_x, (3.6 + 4.75) * FT, 0), black)
	var arm_start := post_x
	var arm_end := board_x + s * 0.12
	var arm_len := absf(arm_start - arm_end)
	MeshKit.box(hoop, Vector3(arm_len, 0.9 * FT, 0.8 * FT), Vector3((arm_start + arm_end) / 2.0, 12.6 * FT, 0), black)
	# diagonal brace
	var brace := MeshKit.box(hoop, Vector3(arm_len * 0.7, 0.35 * FT, 0.5 * FT),
		Vector3(arm_start - s * arm_len * 0.3, 10.2 * FT, 0), black)
	brace.rotation.z = s * 0.45

	# Shot-clock unit on top of the board, facing the court.
	var unit_y := (CourtSpec.BACKBOARD_BOTTOM + CourtSpec.BACKBOARD_HEIGHT + 0.85) * FT
	MeshKit.box(hoop, Vector3(0.6, 1.5, 3.0) * FT, Vector3(board_x + s * 0.12, unit_y, 0), black)
	var face := Basis(Vector3.UP, -s * PI / 2)
	var face_x := board_x + s * 0.12 - s * 0.32 * FT
	var sc := MeshKit.label3d(hoop, "24", 120, 0.0016, Color(1.0, 0.15, 0.1), Vector3(face_x, unit_y - 0.05, 0), face)
	var gc := MeshKit.label3d(hoop, "12:00", 64, 0.0011, Color(1, 0.85, 0.4), Vector3(face_x, unit_y + 0.14, 0), face)
	sc.render_priority = 1
	shot_clock_labels.append(sc)
	game_clock_labels.append(gc)


func _build_reflection_probe() -> void:
	var probe := ReflectionProbe.new()
	probe.size = Vector3(CourtSpec.LENGTH + 40.0, 60.0, CourtSpec.WIDTH + 40.0) * FT
	probe.position = Vector3(0, 5.0 * FT, 0)
	probe.origin_offset = Vector3(0, 4.0 * FT, 0)
	probe.box_projection = true
	probe.update_mode = ReflectionProbe.UPDATE_ONCE
	probe.intensity = 0.9
	probe.max_distance = 120.0
	probe.cull_mask = 0xFFFFF & ~4   # skip layer 3 (players/ball) so moving objects don't smear
	add_child(probe)


func set_clock_text(game_clock: String, shot_clock: String, shot_clock_on: bool) -> void:
	for l in shot_clock_labels:
		l.text = shot_clock if shot_clock_on else ""
	for l in game_clock_labels:
		l.text = game_clock


func swish(side: int) -> void:
	var mat: ShaderMaterial = nets[0 if side < 0 else 1]
	var tw := create_tween()
	tw.tween_method(func(v: float): mat.set_shader_parameter("swish", v), 1.0, 0.0, 0.9)
