"""Builds the shared player model: assets/players/player.glb

Runs headless with Blender (or the `bpy` Python module) plus the MPFB2 extension:

    blender --background --python tools/blender/build_player.py
    # or, with `pip install bpy` and MPFB2 installed as a user extension:
    python tools/blender/build_player.py

Everything here is generated from CC0 data: the MakeHuman base mesh, targets and
game_engine rig shipped with MPFB2, plus the hair and eyes in this repo.

Output (one glb, Y-up, meters):
  Armature   game_engine skeleton (53 bones, UE-style names)
  Body       ~13k verts with blend shapes for body build and face sliders
  Eyes       fitted from eyes/low-poly
  Hair_*     every style in hair/, fitted to the head (toggled at runtime)
  Jersey, Shorts, Shoes   generated from the body surface, skinned, with the
             same body blend shapes so they follow build changes
The base is a 25-year-old athletic male about 6'7" (2.0 m); Godot scales the skeleton
to each player's height and wingspan (see scripts/player/player_avatar.gd).
"""
import bpy  # must come before bmesh when running as the bpy module
import bmesh
import importlib
import math
import os
import pathlib
import sys

try:
    import addon_utils
except ImportError:  # pragma: no cover
    addon_utils = None

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "players" / "player.glb"
MPFB = "bl_ext.user_default.mpfb"

BASE_MACROS = {
    "gender": 1.0, "age": 0.5, "muscle": 0.68, "weight": 0.42, "proportions": 1.0,
    "height": 0.7, "cupsize": 0.5, "firmness": 0.5,
    "race": {"african": 0.34, "asian": 0.33, "caucasian": 0.33},
}

# Body-build blend shapes: macro overrides relative to BASE_MACROS.
BUILD_SHAPES = {
    "build_heavy": {"weight": 0.9},
    "build_light": {"weight": 0.1},
    "build_muscular": {"muscle": 1.0},
    "build_slim": {"muscle": 0.25},
}

# Ancestry face shapes (generic customization options, never auto-assigned).
RACE_SHAPES = {
    "face_african": {"african": 1.0, "asian": 0.0, "caucasian": 0.0},
    "face_asian": {"african": 0.0, "asian": 1.0, "caucasian": 0.0},
    "face_caucasian": {"african": 0.0, "asian": 0.0, "caucasian": 1.0},
}

# Face sliders: blend shape name -> MPFB targets (path relative to data/targets).
FACE_SHAPES = {
    "head_round": ["head/head-round"],
    "head_square": ["head/head-square"],
    "head_oval": ["head/head-oval"],
    "head_long": ["head/head-scale-vert-incr"],
    "head_wide": ["head/head-scale-horiz-incr"],
    "jaw_wide": ["chin/chin-width-incr", "chin/chin-bones-incr"],
    "chin_strong": ["chin/chin-prominent-incr"],
    "nose_wide": ["nose/nose-scale-horiz-incr", "nose/nose-flaring-incr"],
    "nose_narrow": ["nose/nose-scale-horiz-decr"],
    "nose_long": ["nose/nose-scale-vert-incr"],
    "lips_full": ["mouth/mouth-upperlip-volume-incr", "mouth/mouth-lowerlip-volume-incr"],
    "cheeks_high": ["cheek/l-cheek-bones-incr", "cheek/r-cheek-bones-incr"],
    "brow_heavy": ["forehead/forehead-nubian-incr", "eyebrows/eyebrows-trans-down"],
    "eyes_narrow": ["eyes/l-eye-height2-decr", "eyes/r-eye-height2-decr"],
    "ears_big": ["ears/l-ear-scale-incr", "ears/r-ear-scale-incr"],
    "neck_thick": ["neck/neck-scale-horiz-incr", "neck/measure-neck-circ-incr"],
}

HAIR_DIR = ROOT / "hair"
EYES_MHCLO = ROOT / "eyes" / "low-poly" / "low-poly.mhclo"


def mpfb(module, name):
    return getattr(importlib.import_module(f"{MPFB}.{module}"), name)


def enable_mpfb():
    if addon_utils is None:
        raise SystemExit("addon_utils unavailable")
    addon_utils.enable(MPFB, default_set=True)
    if f"{MPFB}" not in sys.modules:
        raise SystemExit("MPFB2 is not installed as a Blender user extension (see docs/ART_PIPELINE.md)")


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def coords(obj):
    """Vertex positions with all shape keys applied, ignoring modifiers."""
    for m in obj.modifiers:
        m.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    mesh = ev.to_mesh()
    out = [v.co.copy() for v in mesh.vertices]
    ev.to_mesh_clear()
    for m in obj.modifiers:
        m.show_viewport = True
    return out


def set_macros(human, macros):
    props = mpfb("entities.objectproperties", "HumanObjectProperties")
    for k, v in macros.items():
        if k == "race":
            for rk, rv in v.items():
                props.set_value(rk, rv, entity_reference=human)
        else:
            props.set_value(k, v, entity_reference=human)
    mpfb("services.targetservice", "TargetService").reapply_macro_details(human)


def capture_shapes(human):
    """Returns {shape_name: [delta per vertex]} relative to the base macros."""
    target_dir = pathlib.Path(sys.modules[MPFB].__file__).parent / "data" / "targets"
    TargetService = mpfb("services.targetservice", "TargetService")
    base = coords(human)
    shapes = {}

    def delta(name):
        now = coords(human)
        shapes[name] = [n - b for n, b in zip(now, base)]

    for name, override in BUILD_SHAPES.items():
        set_macros(human, {**BASE_MACROS, **override})
        delta(name)
    for name, race in RACE_SHAPES.items():
        set_macros(human, {**BASE_MACROS, "race": race})
        delta(name)
    set_macros(human, BASE_MACROS)
    for name, targets in FACE_SHAPES.items():
        keys = []
        for t in targets:
            keys.append(TargetService.load_target(human, str(target_dir / (t + ".target.gz")), weight=1.0,
                                                  name="tmp_" + t.replace("/", "_")))
        delta(name)
        for k in keys:
            human.shape_key_remove(human.data.shape_keys.key_blocks[k.name])
    return shapes


def add_shape_keys(obj, shapes, index_map=None):
    """Adds relative shape keys. index_map maps obj vertex -> source vertex index."""
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis", from_mix=False)
    for name, deltas in shapes.items():
        sk = obj.shape_key_add(name=name, from_mix=False)
        for i, v in enumerate(obj.data.vertices):
            src = index_map[i] if index_map else i
            sk.data[i].co = v.co + deltas[src]
        sk.value = 0.0


def delete_helpers(human):
    """Removes MakeHuman helper geometry (joint cubes, tights, eye placeholders)."""
    body_idx = human.vertex_groups["body"].index
    keep = set()
    for v in human.data.vertices:
        for g in v.groups:
            if g.group == body_idx and g.weight > 0.5:
                keep.add(v.index)
    for m in list(human.modifiers):
        if m.type == "MASK":
            human.modifiers.remove(m)
    bm = bmesh.new()
    bm.from_mesh(human.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
    bm.to_mesh(human.data)
    bm.free()
    # Drop helper/joint vertex groups; keep only bone weights.
    rig_bones = set(b.name for b in human.parent.data.bones) if human.parent else set()
    for g in list(human.vertex_groups):
        if g.name not in rig_bones:
            human.vertex_groups.remove(g)
    return sorted(keep)


def remove_covered_skin(body, filters):
    """Deletes body faces under the uniform, keeping a one-face border so no
    gap shows at the hems. Saves triangles and stops skin poking through."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    covered = {f.index for f in bm.faces if any(flt(f) for flt in filters)}
    border = set()
    for f in bm.faces:
        if f.index in covered:
            for e in f.edges:
                if any(n.index not in covered for n in e.link_faces):
                    border.add(f.index)
    doomed = [f for f in bm.faces if f.index in covered and f.index not in border]
    bmesh.ops.delete(bm, geom=doomed, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    return len(doomed)


def bone_z(rig, name):
    return (rig.matrix_world @ rig.data.bones[name].head_local).z


def smooth_verts(bm, verts, iterations, boundary_only):
    """Laplacian smoothing applied identically to the basis and every shape-key
    layer, so blend shapes keep their deltas. Boundary mode smooths hems only."""
    layers = [bm.verts.layers.shape[k] for k in bm.verts.layers.shape.keys()]
    for _ in range(iterations):
        moves = {}
        for v in verts:
            if boundary_only:
                nbrs = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
                if len(nbrs) != 2:
                    continue
            else:
                nbrs = [e.other_vert(v) for e in v.link_edges]
                if not nbrs:
                    continue
            avg = sum((n.co for n in nbrs), v.co * 0) / len(nbrs)
            moves[v] = (avg - v.co) * 0.5
        for v, d in moves.items():
            v.co += d
            for lay in layers:
                v[lay] += d


def make_garment(body, name, face_filter, offset, color, flare=None, smooth_all=0):
    """Duplicates the body faces that pass face_filter and pushes them outward.

    The copy keeps vertex groups (skin weights) and every blend shape, so the
    garment deforms and changes build exactly like the body underneath."""
    g = body.copy()
    g.data = body.data.copy()
    g.name = name
    g.data.name = name
    bpy.context.collection.objects.link(g)
    bm = bmesh.new()
    bm.from_mesh(g.data)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if not face_filter(f)]
    bmesh.ops.delete(bm, geom=drop, context="FACES_ONLY")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.normal_update()
    # Offset the basis and every shape key layer along the basis normals.
    layers = [bm.verts.layers.shape[k] for k in bm.verts.layers.shape.keys()]
    for v in bm.verts:
        push = offset if flare is None else offset + flare(v)
        d = v.normal * push
        v.co += d
        for lay in layers:
            v[lay] += d
    if smooth_all:
        smooth_verts(bm, list(bm.verts), smooth_all, boundary_only=False)
    smooth_verts(bm, [v for v in bm.verts if v.is_boundary], 8, boundary_only=True)
    bm.to_mesh(g.data)
    bm.free()
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    g.data.materials.clear()
    g.data.materials.append(mat)
    return g


def cylinder_uv(obj, z0, z1):
    """Wraps UVs around the torso: u = angle (front = 0.5), v = height."""
    me = obj.data
    uv = me.uv_layers.new(name="Wrap") if "Wrap" not in me.uv_layers else me.uv_layers["Wrap"]
    me.uv_layers.active = uv
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            ang = math.atan2(co.x, -co.y)            # Blender: -Y is the character's front
            us.append(0.5 + ang / (2 * math.pi))
            uv.data[li].uv = (us[-1], (co.z - z0) / max(0.001, z1 - z0))
        # Faces straddling the back seam: keep u continuous (values may exceed 1).
        if max(us) - min(us) > 0.5:
            for li, u in zip(poly.loop_indices, us):
                if u < 0.5:
                    uv.data[li].uv = (u + 1.0, uv.data[li].uv[1])
    # Godot only needs one UV set for the garment shader.
    for other in [u for u in me.uv_layers if u.name != "Wrap"]:
        me.uv_layers.remove(other)


def main():
    if os.environ.get("MH_HEIGHT"):
        BASE_MACROS["height"] = float(os.environ["MH_HEIGHT"])
    reset_scene()
    enable_mpfb()
    HumanService = mpfb("services.humanservice", "HumanService")
    TargetService = mpfb("services.targetservice", "TargetService")

    human = HumanService.create_human(macro_detail_dict=BASE_MACROS)
    human.name = "Body"
    print("capturing blend shapes...")
    shapes = capture_shapes(human)
    TargetService.bake_targets(human)

    rig = HumanService.add_builtin_rig(human, "game_engine")
    rig.name = "Armature"

    eyes = HumanService.add_mhclo_asset(str(EYES_MHCLO), human, asset_type="Eyes", subdiv_levels=0)
    eyes.name = "Eyes"
    hairs = []
    for d in sorted(HAIR_DIR.iterdir()):
        mh = next(d.glob("*.mhclo"), None)
        if mh is None:
            continue
        h = HumanService.add_mhclo_asset(str(mh), human, asset_type="Clothes", subdiv_levels=0)
        h.name = "Hair_" + d.name
        hairs.append(h)

    add_shape_keys(human, shapes)
    delete_helpers(human)
    for m in list(human.modifiers):
        if m.type != "ARMATURE":
            human.modifiers.remove(m)

    # --- generated uniform --------------------------------------------------------
    knee = bone_z(rig, "calf_l")
    hip = bone_z(rig, "thigh_l")
    waist = bone_z(rig, "spine_01")
    neck = bone_z(rig, "neck_01")
    ankle = bone_z(rig, "foot_l")
    vgi = {g.index: g.name for g in human.vertex_groups}

    def dominant(f):
        score = {}
        for v in f.verts:
            for g in human.data.vertices[v.index].groups:
                n = vgi.get(g.group, "")
                score[n] = score.get(n, 0.0) + g.weight
        return max(score, key=score.get) if score else ""

    me = human.data
    centers = [p.center.copy() for p in me.polygons]
    doms = []
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        doms.append(dominant(f))
    bm.free()
    arm_bones = ("upperarm", "lowerarm", "hand", "index", "middle", "ring", "pinky", "thumb")

    shoulder_x = abs((rig.matrix_world @ rig.data.bones["upperarm_l"].head_local).x)
    armpit = bone_z(rig, "upperarm_l") - 0.11

    def jersey_filter(f):
        """Tank top: torso below the armpits, narrowing to straps over the shoulders,
        with a scooped neckline (deeper in front; Blender -Y is the front)."""
        c = centers[f.index]
        dom = doms[f.index]
        if dom.startswith(("neck", "head", "thigh", "calf", "foot", "ball")):
            return False
        if not (waist - 0.10 < c.z < neck + 0.02):
            return False
        ax = abs(c.x)
        if c.z < armpit:
            return not any(dom.startswith(a) for a in arm_bones) and ax < shoulder_x - 0.05
        # Above the armpits: straps between the neckline and the shoulder.
        t = (c.z - armpit) / max(0.01, neck - armpit)
        outer = (shoulder_x - 0.05) - t * 0.07
        if ax > outer:
            return False
        neck_depth = 0.085 if c.y < 0 else 0.035
        inner = 0.075 if c.z > neck - neck_depth else 0.0
        return ax >= inner

    def shorts_filter(f):
        c = centers[f.index]
        dom = doms[f.index]
        if any(dom.startswith(a) for a in arm_bones):
            return False
        return knee + 0.06 < c.z < waist + 0.02

    def shoes_filter(f):
        # High-tops: up over the ankle bone.
        return centers[f.index].z < ankle + 0.07 and doms[f.index].startswith(("foot", "ball", "calf"))

    def shoe_sole(v):
        # Thicker, wider sole near the floor.
        return 0.012 if v.co.z < 0.03 else 0.0

    def shorts_flare(v):
        # Basketball shorts hang loose: widen toward the hem.
        t = max(0.0, min(1.0, (hip - v.co.z) / max(0.01, hip - knee)))
        return 0.035 * t

    jersey = make_garment(human, "Jersey", jersey_filter, 0.008, (0.9, 0.9, 0.9, 1))
    shorts = make_garment(human, "Shorts", shorts_filter, 0.016, (0.9, 0.9, 0.9, 1), shorts_flare)
    shoes = make_garment(human, "Shoes", shoes_filter, 0.014, (0.1, 0.1, 0.1, 1), shoe_sole, smooth_all=12)
    cylinder_uv(jersey, waist - 0.10, neck)
    cylinder_uv(shorts, knee, waist + 0.05)
    hidden = remove_covered_skin(human, [jersey_filter, shorts_filter, shoes_filter])
    print(f"removed {hidden} body faces hidden under the uniform")

    # Hair textures ship at up to 2048px; 512 is plenty for a phone screen.
    for img in bpy.data.images:
        if img.size[0] > 512:
            img.scale(512, max(1, int(512 * img.size[1] / img.size[0])))

    # Body material placeholder (Godot replaces it with the skin shader).
    skin = bpy.data.materials.new("Skin")
    human.data.materials.clear()
    human.data.materials.append(skin)

    height = max((human.matrix_world @ v.co).z for v in human.data.vertices) - min(
        (shoes.matrix_world @ v.co).z for v in shoes.data.vertices)
    print(f"base height: {height:.3f} m ({height / 0.0254:.1f} in)")
    meta = {"height_m": round(height, 4), "shapes": list(shapes.keys()),
            "hair": [h.name[len("Hair_"):] for h in hairs], "source": "MPFB2 base mesh + game_engine rig (CC0)"}
    (OUT.parent / "player_meta.json").write_text(__import__("json").dumps(meta, indent=1) + "\n")

    # --- export -------------------------------------------------------------------
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in [rig, human, eyes, jersey, shorts, shoes, *hairs]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(OUT), export_format="GLB", use_selection=True,
        export_skins=True, export_morph=True, export_morph_normal=True,
        export_animations=False, export_apply=False, export_yup=True,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="AUTO",
    )
    tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in [human, eyes, jersey, shorts, shoes, *hairs]}
    print("triangles:", tris)
    print("wrote", OUT, f"{OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
