class_name PlayerAvatar
extends Node3D
## The rigged player model (assets/players/player.glb) dressed for one player:
##  * height  – uniform scale from the 2.0 m base model
##  * wingspan – lengthens the arm bones (not their thickness)
##  * build    – blend shapes from weight/height and strength
##  * face     – blend shapes from the player's "face" data, else a stable
##               per-player variation of the neutral sliders
##  * hair     – one of the styles from /hair (or none)
##  * uniform  – team colors, number and team name drawn by shaders/uniform.gdshader
## The model faces -Z like every other node in the game.

const MODEL := preload("res://assets/players/player.glb")
const UNIFORM_SHADER := preload("res://shaders/uniform.gdshader")
const META_PATH := "res://assets/players/player_meta.json"
const DEFAULT_SKIN := "#A0785A"
const DEFAULT_HAIR_COLOR := "#1B1410"
## Face sliders that get a small stable per-player variation when the roster
## doesn't specify a face. Ancestry shapes (face_*) are never set automatically.
const VARIED_FACE := ["head_round", "head_square", "head_oval", "head_long", "jaw_wide", "chin_strong",
	"nose_wide", "nose_narrow", "nose_long", "lips_full", "cheeks_high", "brow_heavy", "ears_big"]
const SHORT_HAIR := ["short01", "short02", "short03", "short04", "afro01", "none"]

static var _meta: Dictionary = {}

var model: Node3D
var skeleton: Skeleton3D
var body: MeshInstance3D
var eyes: MeshInstance3D
var shape_meshes: Array[MeshInstance3D] = []   # body + garments: share blend shapes
var hair := {}                                  # style -> MeshInstance3D
var jersey_mat: ShaderMaterial
var shorts_mat: ShaderMaterial
var shoes_mat: StandardMaterial3D
var skin_mat: StandardMaterial3D
var height_m := 2.0
var data: Dictionary = {}


func _init() -> void:
	model = MODEL.instantiate()
	model.rotation.y = PI         # the glb faces +Z
	add_child(model)
	skeleton = model.find_children("*", "Skeleton3D", true, false)[0]
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		mi.layers = 4
		match str(mi.name):
			"Body":
				body = mi
				shape_meshes.append(mi)
			"Eyes":
				eyes = mi
			"Jersey", "Shorts", "Shoes":
				shape_meshes.append(mi)
			_:
				if str(mi.name).begins_with("Hair_"):
					hair[str(mi.name).substr(5)] = mi
					mi.visible = false
	_setup_materials()


static func meta() -> Dictionary:
	if _meta.is_empty():
		_meta = JSON.parse_string(FileAccess.get_file_as_string(META_PATH))
	return _meta


func _setup_materials() -> void:
	skin_mat = StandardMaterial3D.new()
	skin_mat.roughness = 0.55
	skin_mat.rim_enabled = true
	skin_mat.rim = 0.25
	skin_mat.rim_tint = 0.6
	body.material_override = skin_mat
	jersey_mat = ShaderMaterial.new()
	jersey_mat.shader = UNIFORM_SHADER
	jersey_mat.set_shader_parameter("is_jersey", true)
	shorts_mat = ShaderMaterial.new()
	shorts_mat.shader = UNIFORM_SHADER
	shorts_mat.set_shader_parameter("is_jersey", false)
	shoes_mat = StandardMaterial3D.new()
	shoes_mat.roughness = 0.45
	for mi in shape_meshes:
		match str(mi.name):
			"Jersey":
				mi.material_override = jersey_mat
			"Shorts":
				mi.material_override = shorts_mat
			"Shoes":
				mi.material_override = shoes_mat
	for style in hair:
		var mi: MeshInstance3D = hair[style]
		var src := mi.get_active_material(0) as StandardMaterial3D
		var m := src.duplicate() as StandardMaterial3D if src else StandardMaterial3D.new()
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.45
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.roughness = 0.75
		mi.material_override = m
	if eyes:
		var em := StandardMaterial3D.new()
		var tex := load("res://assets/players/eye_brown.png") as Texture2D
		if tex:
			em.albedo_texture = tex
		else:
			em.albedo_color = Color(0.25, 0.16, 0.1)
		em.roughness = 0.15
		eyes.material_override = em


# --- Applying a player -------------------------------------------------------------

func apply(player: Dictionary, team: Dictionary, home_uniform: bool) -> void:
	data = player
	var h_in := float(player.get("height_in", 79))
	set_height(h_in * 0.0254)
	set_wingspan(float(player.get("wingspan_in", h_in + 3.0)) * 0.0254)
	set_build(float(player.get("weight_lb", 220)), h_in, float(player.get("ratings", {}).get("strength", 70)))
	set_face(player.get("face", {}), str(player.get("id", player.get("last", ""))))
	set_skin(DataDB.color(str(player.get("skin", DEFAULT_SKIN))))
	set_hair(str(player.get("hair", _default_hair(str(player.get("id", ""))))),
		DataDB.color(str(player.get("hair_color", DEFAULT_HAIR_COLOR))))
	set_uniform(team, home_uniform, PlayerAvatar.jersey_number(player))


func set_height(meters: float) -> void:
	height_m = meters
	scale = Vector3.ONE * (meters / float(meta().get("height_m", 2.0)))


## Real wingspans run ~0-8" longer than height. The base model's arms are
## lengthened or shortened in the upper/lower arm bones only.
func set_wingspan(meters: float) -> void:
	var s := scale.x
	var base := _base_wingspan() * s
	var shoulder := _shoulder_width() * s
	var arm_now := (base - shoulder) / 2.0
	var arm_want := (meters - shoulder) / 2.0
	for side in ["l", "r"]:
		var upper := skeleton.find_bone("upperarm_" + side)
		var lower := skeleton.find_bone("lowerarm_" + side)
		var hand := skeleton.find_bone("hand_" + side)
		var long_bones := (skeleton.get_bone_rest(lower).origin.length() + skeleton.get_bone_rest(hand).origin.length()) * s
		var k := clampf(1.0 + (arm_want - arm_now) / maxf(0.01, long_bones), 0.85, 1.2)
		for b in [lower, hand]:
			var rest := _original_rest(b)
			var t := Transform3D(rest.basis, rest.origin * k)
			skeleton.set_bone_rest(b, t)
			skeleton.set_bone_pose_position(b, t.origin)


var _rest_cache := {}

func _original_rest(bone: int) -> Transform3D:
	if not _rest_cache.has(bone):
		_rest_cache[bone] = skeleton.get_bone_rest(bone)
	return _rest_cache[bone]


func _bone_pos(name: String) -> Vector3:
	return skeleton.get_bone_global_rest(skeleton.find_bone(name)).origin


func _shoulder_width() -> float:
	return _bone_pos("upperarm_l").distance_to(_bone_pos("upperarm_r"))


## Fingertip to fingertip with the arms straight out, in model units.
func _base_wingspan() -> float:
	var arm := 0.0
	var chain := ["upperarm_l", "lowerarm_l", "hand_l", "middle_01_l", "middle_02_l", "middle_03_l"]
	for i in chain.size() - 1:
		var a: Transform3D = _original_global(chain[i])
		var b: Transform3D = _original_global(chain[i + 1])
		arm += a.origin.distance_to(b.origin)
	arm += _original_global("middle_02_l").origin.distance_to(_original_global("middle_03_l").origin)
	return arm * 2.0 + _shoulder_width()


func _original_global(name: String) -> Transform3D:
	var b := skeleton.find_bone(name)
	var t := _original_rest(b)
	var p := skeleton.get_bone_parent(b)
	while p >= 0:
		t = _original_rest(p) * t
		p = skeleton.get_bone_parent(p)
	return t


func set_build(weight_lb: float, height_in: float, strength: float) -> void:
	var bmi := weight_lb / (height_in * height_in) * 703.0
	set_shape("build_heavy", clampf((bmi - 25.5) / 5.0, 0.0, 1.0))
	set_shape("build_light", clampf((23.5 - bmi) / 3.5, 0.0, 1.0))
	set_shape("build_muscular", clampf((strength - 65.0) / 30.0, 0.0, 1.0))
	set_shape("build_slim", clampf((60.0 - strength) / 25.0, 0.0, 1.0))


func set_face(face: Dictionary, seed_text: String) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(seed_text)
	for s in meta().get("shapes", []):
		if str(s).begins_with("face_") or str(s).begins_with("build_"):
			continue
		set_shape(s, 0.0)
	set_shape("neck_thick", 0.35)
	if face.is_empty():
		for s in VARIED_FACE:
			set_shape(s, rng.randf_range(0.0, 0.45) if rng.randf() < 0.45 else 0.0)
	else:
		for s in face:
			set_shape(s, float(face[s]))


func set_shape(shape: String, value: float) -> void:
	for mi in shape_meshes:
		var idx := mi.find_blend_shape_by_name(shape)
		if idx >= 0:
			mi.set_blend_shape_value(idx, value)


func set_skin(c: Color) -> void:
	skin_mat.albedo_color = c


func set_hair(style: String, color: Color) -> void:
	for s in hair:
		hair[s].visible = s == style
		(hair[s].material_override as StandardMaterial3D).albedo_color = color.lightened(0.15)


func _default_hair(seed_text: String) -> String:
	return SHORT_HAIR[absi(hash(seed_text + "hair")) % SHORT_HAIR.size()]


func set_uniform(team: Dictionary, home: bool, number: String) -> void:
	var primary := UIKit.team_color(team)
	var secondary := UIKit.team_color(team, "secondary")
	var base := Color(0.96, 0.96, 0.95) if home else primary
	var trim := primary if home else secondary
	# Keep the number readable against the base color.
	var num := trim
	if num.get_luminance() > 0.8 and base.get_luminance() > 0.8:
		num = primary
	var outline := secondary if home else Color.WHITE
	if absf(outline.get_luminance() - num.get_luminance()) < 0.15:
		outline = Color.BLACK if num.get_luminance() > 0.5 else Color.WHITE
	for m in [jersey_mat, shorts_mat]:
		m.set_shader_parameter("base_color", base)
		m.set_shader_parameter("trim_color", trim)
		m.set_shader_parameter("number_color", num)
		m.set_shader_parameter("outline_color", outline)
	jersey_mat.set_shader_parameter("digits", UniformTextures.digits())
	jersey_mat.set_shader_parameter("wordmark", UniformTextures.wordmark(str(team.get("name", "")).to_upper()))
	var digits := number.substr(0, 2)
	jersey_mat.set_shader_parameter("digit_a", int(digits[0]) if digits.length() > 0 else -1)
	jersey_mat.set_shader_parameter("digit_b", int(digits[1]) if digits.length() > 1 else -1)
	shoes_mat.albedo_color = Color(0.08, 0.08, 0.09) if home else Color(0.95, 0.95, 0.95)
	if team.get("id", "") in ["BKN", "SAS"] and not home:
		shoes_mat.albedo_color = Color(0.08, 0.08, 0.09)


## Jersey numbers are strings so "0" and "00" stay different.
static func jersey_number(player: Dictionary) -> String:
	var n: Variant = player.get("number", "0")
	return str(int(n)) if n is float else str(n)


## World position of a bone (for the ball, IK targets, cameras).
func bone_global(name: String) -> Vector3:
	var b := skeleton.find_bone(name)
	return skeleton.global_transform * skeleton.get_bone_global_pose(b).origin
