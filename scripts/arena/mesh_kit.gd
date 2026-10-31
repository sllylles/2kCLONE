class_name MeshKit
extends RefCounted
## Small helpers for building primitive geometry in code. Sizes in meters.


static func mat(color: Color, roughness := 0.6, metallic := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	m.metallic = metallic
	return m


static func emissive(color: Color, energy := 2.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color * energy
	return m


static func box(parent: Node3D, size: Vector3, pos: Vector3, material: Material, layers := 1) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = material
	mi.position = pos
	mi.layers = layers
	parent.add_child(mi)
	return mi


static func cylinder(parent: Node3D, radius: float, height: float, pos: Vector3, material: Material, segments := 16) -> MeshInstance3D:
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = height
	mesh.radial_segments = segments
	mesh.rings = 1
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = material
	mi.position = pos
	parent.add_child(mi)
	return mi


static func label3d(parent: Node3D, text: String, font_px: int, pixel_size: float, color: Color, pos: Vector3,
		basis := Basis.IDENTITY, bold := true) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font = UIKit.font(900 if bold else 600, bold)
	l.font_size = font_px
	l.pixel_size = pixel_size
	l.modulate = color
	l.outline_size = 0
	l.position = pos
	l.basis = basis
	l.shaded = false
	l.double_sided = false
	l.alpha_cut = Label3D.ALPHA_CUT_DISABLED
	parent.add_child(l)
	return l


## A closed rounded rectangle on the XZ plane, `half` = half extents of the
## outer edge, `radius` = corner radius, grown outward by `offset`.
## Returns points in feet; every call with the same `arc_steps` returns the
## same number of points so loops at different offsets can be stitched.
static func rounded_rect(half: Vector2, radius: float, offset: float, arc_steps := 6) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var cx := half.x - radius
	var cz := half.y - radius
	var centers := [Vector2(cx, cz), Vector2(-cx, cz), Vector2(-cx, -cz), Vector2(cx, -cz)]
	for i in 4:
		for s in arc_steps + 1:
			var a := (i + float(s) / arc_steps) * PI * 0.5
			pts.append(centers[i] + Vector2(cos(a), sin(a)) * (radius + offset))
	return pts


static func loop_lengths(pts: PackedVector2Array) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	var acc := 0.0
	out.append(0.0)
	for i in range(1, pts.size() + 1):
		acc += pts[i - 1].distance_to(pts[i % pts.size()])
		out.append(acc)
	return out
