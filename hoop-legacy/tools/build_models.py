#!/usr/bin/env python3
"""Convert the MakeHuman assets in hoop-legacy/ into the game's player model pack (www/models/).

usage: build_models.py            (run from anywhere; paths are relative to this file)

Output:
  www/models/players.json  manifest: meshes (offsets into players.bin), joint landmarks, skins, hair
  www/models/players.bin   vertex data: positions/normals/uvs (float32), skin index/weight (uint8), indices (uint16)
  www/models/*.jpg|png     downscaled skin and hair textures

Everything is normalised to a 1-unit-tall body (feet at y=0, +x = the player's left, +z = forward).
The body is skinned to the game's procedural rig (see player.js) by distance to bone segments built from
the joint landmarks below; the jersey and shorts are cut from the body surface and pushed out along the
normals so they deform with it. Needs ImageMagick (`convert`) for the textures.
"""
import json, math, os, struct, subprocess, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'www', 'models')
BODY = 'proxymeshes/male_muscle_13290/male_muscle_13290.obj'
NEUTRAL = 'proxymeshes/male1591/male1591.obj'  # the body most hair was modelled on

# Joint landmarks of the athletic body (left side), measured from the mesh. Unit height.
J = {
    'pelvis': (0, 0.53, 0.01), 'spine': (0, 0.66, 0.02), 'neck': (0, 0.855, 0.01), 'crown': (0, 0.97, 0.04),
    'hip': (0.055, 0.50, 0.0), 'knee': (0.09, 0.28, 0.02), 'ankle': (0.112, 0.045, 0.01), 'toe': (0.12, 0.01, 0.12),
    'shoulder': (0.115, 0.80, 0.005), 'elbow': (0.215, 0.678, 0.038), 'wrist': (0.281, 0.603, 0.12), 'tip': (0.325, 0.541, 0.18),
}
# Bone order shared with player.js
BONES = ['pelvis', 'torso', 'head', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hpL', 'knL', 'anL', 'hpR', 'knR', 'anR']

HAIR = {  # game style -> MakeHuman asset
    'Buzz': 'short02', 'Fade': 'short01', 'Afro': 'afro01', 'Swoop': 'short04',
}
SKINS = {'light': 'young_caucasian_male/young_lightskinned_male_diffuse.png',
         'tan': 'young_asian_male/young_lightskinned_male_diffuse3.png',
         'dark': 'young_african_male/young_darkskinned_male_diffuse.png'}


def mirror(p):
    return (-p[0], p[1], p[2])


def segments():
    L = J
    s = [
        ((0, 0.46, 0), L['spine'], 0.075),         # pelvis
        (L['spine'], L['neck'], 0.07),             # torso
        (L['neck'], L['crown'], 0.05),             # head
        (L['shoulder'], L['elbow'], 0.03), (L['elbow'], L['wrist'], 0.025), (L['wrist'], L['tip'], 0.02),
    ]
    s += [(mirror(a), mirror(b), r) for a, b, r in s[3:6]]
    legs = [(L['hip'], L['knee'], 0.045), (L['knee'], L['ankle'], 0.03), (L['ankle'], L['toe'], 0.03)]
    s += legs + [(mirror(a), mirror(b), r) for a, b, r in legs]
    return s


def seg_dist(p, a, b):
    ab = [b[i] - a[i] for i in range(3)]
    ap = [p[i] - a[i] for i in range(3)]
    t = max(0.0, min(1.0, sum(ab[i] * ap[i] for i in range(3)) / (sum(x * x for x in ab) or 1)))
    return math.dist(p, [a[i] + ab[i] * t for i in range(3)])


def parse_obj(path):
    v, vt, faces = [], [], []
    for line in open(os.path.join(ROOT, path), errors='ignore'):
        if line.startswith('v '):
            v.append(tuple(map(float, line.split()[1:4])))
        elif line.startswith('vt '):
            vt.append(tuple(map(float, line.split()[1:3])))
        elif line.startswith('f '):
            corners = []
            for c in line.split()[1:]:
                parts = c.split('/')
                corners.append((int(parts[0]) - 1, int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1))
            for i in range(1, len(corners) - 1):  # fan-triangulate quads
                faces.append((corners[0], corners[i], corners[i + 1]))
    return v, vt, faces


def bbox(pts):
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def head_box(verts, neck_frac):
    y0 = min(p[1] for p in verts); h = max(p[1] for p in verts) - y0
    return bbox([p for p in verts if p[1] > y0 + neck_frac * h])


def normals_for(pos, tris):
    n = [[0.0, 0.0, 0.0] for _ in pos]
    for a, b, c in tris:
        pa, pb, pc = pos[a], pos[b], pos[c]
        u = [pb[i] - pa[i] for i in range(3)]; w = [pc[i] - pa[i] for i in range(3)]
        cr = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        for k in (a, b, c):
            for i in range(3):
                n[k][i] += cr[i]
    out = []
    for x in n:
        l = math.sqrt(sum(c * c for c in x)) or 1
        out.append((x[0] / l, x[1] / l, x[2] / l))
    return out


class Mesh:
    """Unique (vertex, uv) pairs -> render vertices."""

    def __init__(self):
        self.pos, self.nor, self.uv, self.si, self.sw, self.idx, self.groups, self.trim = [], [], [], [], [], [], [], []


def build_body():
    v, vt, faces = parse_obj(BODY)
    y0 = min(p[1] for p in v); H = max(p[1] for p in v) - y0
    P = [(p[0] / H, (p[1] - y0) / H, p[2] / H) for p in v]
    tris = [(a[0], b[0], c[0]) for a, b, c in faces]
    N = normals_for(P, tris)
    segs = segments()
    # Skin weights per original vertex: inverse surface distance to the bone capsules, 3 strongest
    W = []
    for p in P:
        side = 1 if p[0] > 0.012 else -1 if p[0] < -0.012 else 0
        cand = []
        for b, (a, c, r) in enumerate(segs):
            limb_side = 0 if b < 3 else (1 if b in (3, 4, 5, 9, 10, 11) else -1)
            if limb_side and limb_side != side:
                continue
            d = max(seg_dist(p, a, c) - r, 0.003)
            cand.append((d ** -4, b))
        cand.sort(reverse=True)
        cand = cand[:3]
        if p[1] > 0.862 and abs(p[0]) < 0.07:      # face, jaw, skull
            cand = [(1.0, 2)]
        elif p[1] > 0.835 and abs(p[0]) < 0.05:    # neck: head <-> torso
            t = (p[1] - 0.835) / 0.027
            cand = [(t, 2), (1 - t, 1)]
        tot = sum(w for w, _ in cand)
        ws = [(w / tot, b) for w, b in cand if w / tot > 0.03]
        tot = sum(w for w, _ in ws)
        W.append([(w / tot, b) for w, b in ws])
    return v, vt, faces, P, N, W, (y0, H)


def emit(mesh, faces, P, N, W, uvs, keep=None, offset=None, group_of=None, rest=False, warp=None):
    """Append triangles (optionally filtered / pushed out along the normal) to a Mesh."""
    remap = {}
    groups = {}
    for fi, tri in enumerate(faces):
        if keep and not keep(fi):
            continue
        g = group_of(fi) if group_of else 0
        groups.setdefault(g, []).append(tri)
    for g in sorted(groups):
        start = len(mesh.idx)
        for tri in groups[g]:
            for vi, ti in tri:
                key = (vi, ti if uvs is not None else -1)
                if key not in remap:
                    remap[key] = len(mesh.pos)
                    p, n = P[vi], N[vi]
                    o = offset(vi) if offset else 0
                    q = (p[0] + n[0] * o, p[1] + n[1] * o, p[2] + n[2] * o)
                    mesh.pos.append(warp(vi, q) if warp else q)
                    mesh.nor.append(n)
                    mesh.uv.append(uvs[ti] if uvs is not None and ti >= 0 else (0, 0))
                    if rest:
                        mesh.trim.append(P[vi])  # rest position, for the per-pixel cut
                    w = W[vi] + [(0, 0)] * (4 - len(W[vi]))
                    mesh.si.append([b for _, b in w[:4]])
                    mesh.sw.append([round(x * 255) for x, _ in w[:4]])
                    fix = 255 - sum(mesh.sw[-1])
                    mesh.sw[-1][0] += fix
                mesh.idx.append(remap[key])
        mesh.groups.append({'start': start, 'count': len(mesh.idx) - start, 'mat': g})
    return mesh


def edge_dist(faces, keep, seeds, P):
    """Shortest distance along mesh edges from the seed vertices (Dijkstra), within the kept triangles."""
    import heapq
    adj = {}
    for fi, tri in enumerate(faces):
        if not keep(fi):
            continue
        ids = [c[0] for c in tri]
        for i in range(3):
            a, b = ids[i], ids[(i + 1) % 3]
            d = math.dist(P[a], P[b])
            adj.setdefault(a, []).append((b, d)); adj.setdefault(b, []).append((a, d))
    dist = {v: 0.0 for v in seeds}
    heap = [(0.0, v) for v in seeds]
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist.get(v, 1e9):
            continue
        for w, e in adj.get(v, []):
            if d + e < dist.get(w, 1e9):
                dist[w] = d + e
                heapq.heappush(heap, (d + e, w))
    return dist


def boundary_verts(faces, keep):
    count = {}
    for fi, tri in enumerate(faces):
        if not keep(fi):
            continue
        ids = [c[0] for c in tri]
        for i in range(3):
            e = tuple(sorted((ids[i], ids[(i + 1) % 3])))
            count[e] = count.get(e, 0) + 1
    out = set()
    for e, n in count.items():
        if n == 1:
            out.update(e)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    v, vt, faces, P, N, W, (y0, Hu) = build_body()
    dom = [max(w, key=lambda x: x[0])[1] for w in W]
    cen = [tuple(sum(P[c[0]][i] for c in tri) / 3 for i in range(3)) for tri in faces]
    tdom = [set(dom[c[0]] for c in tri) for tri in faces]

    def jersey(fi):
        c = cen[fi]
        if not tdom[fi] <= {0, 1}:
            return False
        return 0.485 < c[1] < 0.86

    def shorts(fi):
        c = cen[fi]
        return tdom[fi] <= {0, 9, 12} and 0.295 < c[1] < 0.58


    meshes = {}
    def bare(fi):  # no feet: the game puts sneakers on the ankles
        return not (tdom[fi] <= {11, 14} and cen[fi][1] < 0.055)
    meshes['body'] = emit(Mesh(), faces, P, N, W, vt, keep=bare)
    # Jersey drape: a loose tank hangs straight down from the chest instead of hugging the abs.
    # Per direction around the torso, take the chest's radius and don't let the fabric below it go inside that.
    CZ, BINS = 0.02, 48
    def polar(q):
        return math.atan2(q[0], q[2] - CZ), math.hypot(q[0], q[2] - CZ)
    chest = [0.0] * BINS
    for fi, tri in enumerate(faces):
        if not jersey(fi):
            continue
        for vi, _ in tri:
            q = P[vi]
            if 0.69 < q[1] < 0.76 and abs(q[0]) < 0.11:
                a, r = polar(q)
                b = int((a + math.pi) / (2 * math.pi) * BINS) % BINS
                chest[b] = max(chest[b], r)
    for i in range(BINS):  # fill empty bins from neighbours
        if chest[i] == 0:
            chest[i] = max(chest[(i - 1) % BINS], chest[(i + 1) % BINS])
    def drape(vi, q):
        b = max(0.0, min(1.0, (0.735 - q[1]) / 0.09))
        b = b * b * (3 - 2 * b)
        if b <= 0:
            return q
        a, r = polar(q)
        k = (a + math.pi) / (2 * math.pi) * BINS
        i0 = int(k) % BINS; f = k - int(k)
        cr = (chest[i0] * (1 - f) + chest[(i0 + 1) % BINS] * f) * 0.985 + 0.012
        nr = r + (max(r, cr) - r) * b
        return (math.sin(a) * nr, q[1], CZ + math.cos(a) * nr)
    meshes['jersey'] = emit(Mesh(), faces, P, N, W, None, keep=jersey, offset=lambda vi: 0.011, rest=True, warp=drape)
    meshes['shorts'] = emit(Mesh(), faces, P, N, W, None, keep=shorts,
                            offset=lambda vi: 0.011 + 0.02 * max(0.0, min(1.0, (0.47 - P[vi][1]) / 0.16)), rest=True)

    # Hair: rigid on the head. Most styles were made on the neutral body; map them onto this head.
    nv, _, _ = parse_obj(NEUTRAL)
    src_lo, src_hi = head_box(nv, 0.86)
    dst_lo, dst_hi = head_box(v, 0.855)
    hair_meta = {}
    for style, name in HAIR.items():
        hv, hvt, hf = parse_obj(f'hair/{name}/{name}.obj')
        native = max(p[1] for p in hv) > dst_hi[1] - 0.2  # made on a body as tall as ours
        mp = []
        for p in hv:
            if native:
                q = p
            else:
                q = tuple(dst_lo[i] + (p[i] - src_lo[i]) * (dst_hi[i] - dst_lo[i]) / (src_hi[i] - src_lo[i]) for i in range(3))
            mp.append((q[0] / Hu, (q[1] - y0) / Hu, q[2] / Hu))
        hn = normals_for(mp, [(a[0], b[0], c[0]) for a, b, c in hf])
        hw = [[(1.0, 2)] for _ in mp]
        meshes['hair_' + style] = emit(Mesh(), hf, mp, hn, hw, hvt)
        tex = f'hair_{name}.png'
        mat = open(os.path.join(ROOT, f'hair/{name}/{name}.mhmat')).read()
        src = [l.split()[1] for l in mat.splitlines() if l.startswith('diffuseTexture')][0]
        subprocess.run(['convert', os.path.join(ROOT, f'hair/{name}', src), '-resize', '512x512', '-strip',
                        'PNG32:' + os.path.join(OUT, tex)], check=True)
        hair_meta[style] = {'mesh': 'hair_' + style, 'tex': tex}

    # Eyeballs (the body has empty sockets), modelled on the neutral body like most hair
    ev, evt, ef = parse_obj('eyes/low-poly/low-poly.obj')
    mp = []
    # The athletic body's lids are closed: set each eyeball flush with the face just above the bridge of the nose
    # (eye level and surface depth measured on the mesh), keeping MakeHuman's eye size.
    src_c = {sx: [sum(q[i] for q in ev if q[0] * sx > 0) / sum(1 for q in ev if q[0] * sx > 0) for i in range(3)] for sx in (1, -1)}
    for p in ev:
        sx = 1 if p[0] > 0 else -1
        c = src_c[sx]; tc = (0.30 * sx, 8.20, 1.39)
        q = tuple(tc[i] + (p[i] - c[i]) * 0.86 for i in range(3))
        mp.append((q[0] / Hu, (q[1] - y0) / Hu, q[2] / Hu))
    meshes['eyes'] = emit(Mesh(), ef, mp, normals_for(mp, [(a[0], b[0], c[0]) for a, b, c in ef]), [[(1.0, 2)] for _ in mp], evt)
    subprocess.run(['convert', os.path.join(ROOT, 'eyes/materials/brown_eye.png'), '-resize', '256x256', '-quality', '88', '-strip',
                    os.path.join(OUT, 'eyes_brown.jpg')], check=True)

    # Skins: downscaled; the game tints them to the exact skin tone, so record each texture's mean colour
    skins = {}
    for key, path in SKINS.items():
        out = f'skin_{key}.jpg'
        subprocess.run(['convert', os.path.join(ROOT, path), '-resize', '1024x1024', '-quality', '86', '-strip',
                        os.path.join(OUT, out)], check=True)
        # mean colour of the skin pixels (the texture has black padding between UV islands)
        raw = subprocess.run(['convert', os.path.join(ROOT, path), '-resize', '64x64!', '-depth', '8', 'rgb:-'],
                             capture_output=True, check=True).stdout
        px = [raw[i:i + 3] for i in range(0, len(raw), 3)]
        px = [c for c in px if sum(c) > 90]
        mean = [sum(c[k] for c in px) / len(px) / 255 for k in range(3)]
        skins[key] = {'tex': out, 'mean': [round(x, 4) for x in mean]}

    # Pack
    blob = bytearray()
    manifest = {'bones': BONES, 'joints': J, 'meshes': {}, 'hair': hair_meta, 'skins': skins,
                'source': 'MakeHuman system assets (CC0)'}
    def put(arr):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr)
        return off
    for name, m in meshes.items():
        n = len(m.pos)
        assert n < 65536, (name, n)
        manifest['meshes'][name] = {
            'count': n, 'index': len(m.idx), 'groups': m.groups,
            'pos': put(struct.pack(f'<{n * 3}f', *[c for p in m.pos for c in p])),
            'nor': put(struct.pack(f'<{n * 3}b', *[max(-127, min(127, round(c * 127))) for p in m.nor for c in p])),
            'uv': put(struct.pack(f'<{n * 2}e', *[c for p in m.uv for c in p])),
            'si': put(bytes(c for s in m.si for c in s)),
            'sw': put(bytes(c for s in m.sw for c in s)),
            'idx': put(struct.pack(f'<{len(m.idx)}H', *m.idx)),
            'rest': put(struct.pack(f'<{len(m.trim) * 3}f', *[c for p in m.trim for c in p])) if m.trim else None,
        }
        print(f'{name}: {n} verts, {len(m.idx) // 3} tris, groups {len(m.groups)}')
    open(os.path.join(OUT, 'players.bin'), 'wb').write(blob)
    json.dump(manifest, open(os.path.join(OUT, 'players.json'), 'w'), indent=1)
    print('players.bin', len(blob), 'bytes')


if __name__ == '__main__':
    sys.exit(main())
