extends Node3D
## Player Lab: inspect player models and animations.
## With no params it opens the interactive viewer (any roster player, any clip,
## turntable, speed). With params it renders lineups / contact sheets for tools:
##   teams: [ids]          one avatar per team (lineup)
##   clips: [names]        one avatar per clip (animation sheet)
##   phase: 0..1           freeze every clip at this fraction of its length
##   yaw: degrees          avatar facing (0 = away from camera, 180 = toward)

var avatars: Array[PlayerAvatar] = []
var cam: Camera3D


func _ready() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.08, 0.09, 0.11)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.5, 0.5, 0.55)
	e.ambient_light_energy = 0.6
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.environment = e
	add_child(env)
	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-40, 30, 0)
	key.shadow_enabled = true
	add_child(key)
	var floor_mesh := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(30, 30)
	floor_mesh.mesh = pm
	floor_mesh.material_override = MeshKit.mat(Color(0.75, 0.58, 0.4), 0.3)
	add_child(floor_mesh)
	cam = Camera3D.new()
	add_child(cam)

	var params: Dictionary = SceneManager.params
	if not params.has("clips") and not params.has("teams"):
		_build_viewer()
		return
	var clips: Array = params.get("clips", [])
	var team_ids: Array = params.get("teams", ["LAL", "BOS", "GSW", "OKC", "MIL"] if clips.is_empty() else ["LAL"])
	var count: int = maxi(clips.size(), team_ids.size())
	var spacing := 1.25 if clips.is_empty() else 1.6
	for i in count:
		var team := DataDB.team(team_ids[i % team_ids.size()])
		var a := PlayerAvatar.new()
		add_child(a)
		a.apply(DataDB.roster(team.id)[0], team, i % 2 == 0 or not clips.is_empty())
		a.position = Vector3((i - (count - 1) / 2.0) * spacing, 0, 0)
		a.rotation.y = deg_to_rad(float(params.get("yaw", 0.0)))
		if not clips.is_empty():
			var ap := AnimationPlayer.new()
			a.model.add_child(ap)
			ap.add_animation_library("", AnimLibrary.library(a.skeleton))
			var clip: String = clips[i]
			ap.play(clip)
			if params.has("phase"):
				ap.seek(float(params.phase) * ap.current_animation_length, true)
				ap.speed_scale = 0.0
			var tag := Label3D.new()
			tag.text = clip
			tag.font_size = 48
			tag.pixel_size = 0.004
			tag.position = Vector3(0, 2.35, 0)
			tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			a.add_child(tag)
		avatars.append(a)
	var width := count * spacing
	cam.fov = 40
	cam.look_at_from_position(Vector3(0, 1.4, maxf(6.2, width * 1.35)), Vector3(0, 1.0, 0))


# --- Interactive viewer -----------------------------------------------------------------

var _avatar: PlayerAvatar
var _ap: AnimationPlayer
var _team_idx := 13
var _player_idx := 0
var _clip_idx := 0
var _spin := true
var _yaw := 0.0
var _info: Label
var _clip_label: Label
var _clips: Array = []
var _ball: MeshInstance3D


func _build_viewer() -> void:
	_clips = AnimLibrary.clip_names()
	_clips.sort()
	cam.fov = 38
	cam.look_at_from_position(Vector3(0, 1.25, 4.6), Vector3(0, 1.0, 0))
	_ball = MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = CourtSpec.BALL_RADIUS * CourtSpec.FT
	sm.height = sm.radius * 2.0
	_ball.mesh = sm
	_ball.material_override = MeshKit.mat(Color(0.85, 0.36, 0.12), 0.75)
	add_child(_ball)
	var ui := CanvasLayer.new()
	add_child(ui)
	var root := Control.new()
	root.theme = UIKit.theme()
	UIKit.full_rect(root)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(root)
	var top := HBoxContainer.new()
	top.position = Vector2(30, 24)
	top.add_theme_constant_override("separation", 12)
	root.add_child(top)
	var back := UIKit.button("BACK", Vector2(160, 64))
	back.pressed.connect(func(): SceneManager.back())
	top.add_child(back)
	top.add_child(UIKit.label("PLAYER LAB", 44, 900, UIKit.TEXT, true))
	_info = UIKit.label("", 26, 700, UIKit.TEXT_DIM)
	_info.position = Vector2(32, 100)
	root.add_child(_info)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)
	bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	bar.position = Vector2(-760, -110)
	root.add_child(bar)
	for spec in [["◀ TEAM", func(): _step_team(-1)], ["TEAM ▶", func(): _step_team(1)],
			["◀ PLAYER", func(): _step_player(-1)], ["PLAYER ▶", func(): _step_player(1)],
			["◀ ANIM", func(): _step_clip(-1)], ["ANIM ▶", func(): _step_clip(1)],
			["TURNTABLE", func(): _spin = not _spin]]:
		var b := UIKit.button(spec[0], Vector2(0, 70))
		b.pressed.connect(spec[1])
		bar.add_child(b)
	_clip_label = UIKit.label("", 40, 900, UIKit.ACCENT_2, true)
	_clip_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_clip_label.position = Vector2(-300, -190)
	_clip_label.size = Vector2(600, 60)
	_clip_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_clip_label)
	var speed := HSlider.new()
	speed.min_value = 0.1
	speed.max_value = 1.5
	speed.step = 0.05
	speed.value = 1.0
	speed.custom_minimum_size = Vector2(300, 50)
	speed.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	speed.position = Vector2(-340, 40)
	speed.value_changed.connect(func(v: float): _ap.speed_scale = v)
	root.add_child(speed)
	_clip_idx = maxi(0, _clips.find("jumpshot"))
	_spawn()


func _spawn() -> void:
	if _avatar:
		_avatar.queue_free()
	var team: Dictionary = DataDB.teams[_team_idx % DataDB.teams.size()]
	var roster := DataDB.roster(team.id)
	_player_idx = posmod(_player_idx, roster.size())
	var p: Dictionary = roster[_player_idx]
	_avatar = PlayerAvatar.new()
	add_child(_avatar)
	_avatar.apply(p, team, true)
	_ap = AnimationPlayer.new()
	_avatar.model.add_child(_ap)
	_ap.add_animation_library("", AnimLibrary.library(_avatar.skeleton))
	_info.text = "%s %s  •  %s  •  %d'%d\"  %d lb  •  wingspan %d'%d\"  •  %s" % [
		p.first, p.last, p.pos, int(p.height_in) / 12, int(p.height_in) % 12, int(p.weight_lb),
		int(p.wingspan_in) / 12, int(p.wingspan_in) % 12, team.name]
	_play()


func _play() -> void:
	var clip: String = _clips[posmod(_clip_idx, _clips.size())]
	_clip_label.text = clip.to_upper().replace("_", " ")
	_ap.play(clip)
	var anim := _ap.get_animation(clip)
	anim.loop_mode = Animation.LOOP_LINEAR


func _step_team(d: int) -> void:
	_team_idx = posmod(_team_idx + d, DataDB.teams.size())
	_player_idx = 0
	_spawn()


func _step_player(d: int) -> void:
	_player_idx += d
	_spawn()


func _step_clip(d: int) -> void:
	_clip_idx = posmod(_clip_idx + d, _clips.size())
	_play()


func _process(delta: float) -> void:
	if _avatar == null:
		return
	if _spin:
		_yaw += delta * 0.6
	_avatar.rotation.y = _yaw
	# Show the ball in the right place for ball-handling clips.
	var hand := _avatar.bone_global("hand_r").lerp(_avatar.bone_global("hand_l"), 0.5)
	_ball.visible = _ap.current_animation in ["jumpshot", "dunk", "chest_pass", "bounce_pass", "triple_threat", "rebound", "layup", "floater", "catch"]
	_ball.global_position = hand - _avatar.global_basis.z * 0.06 if _ball.visible else Vector3.ZERO


func _unhandled_input(event: InputEvent) -> void:
	if _avatar == null:
		return
	if event.is_action_pressed("ui_right"):
		_step_clip(1)
	elif event.is_action_pressed("ui_left"):
		_step_clip(-1)
	elif event.is_action_pressed("ui_cancel"):
		SceneManager.back()
