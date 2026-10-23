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


def soften(mesh, iters=12, gap=0.011, top=0.8, clamp=None):
    """Cloth instead of skin: Taubin-smooth the garment below `top` (the abs; the neckline and arm holes
    stay as cut) so the muscles underneath don't show through, keep it at least `gap` outside the body,
    and shade it with normals of the smoothed shape."""
    tris = [tuple(mesh.idx[i:i + 3]) for i in range(0, len(mesh.idx), 3)]
    nb = [set() for _ in mesh.pos]
    ecount = {}
    for a, b, c in tris:
        nb[a] |= {b, c}; nb[b] |= {a, c}; nb[c] |= {a, b}
        for e in ((a, b), (b, c), (c, a)):
            e = (min(e), max(e)); ecount[e] = ecount.get(e, 0) + 1
    # The open edges (and the ring inside them) stay put so the per-pixel cut lines still fall on cloth
    pinned = {v for e, n in ecount.items() if n == 1 for v in e}
    pinned |= {j for v in list(pinned) for j in nb[v]}
    pos = [list(q) for q in mesh.pos]
    n0, base = mesh.nor, mesh.trim
    for it in range(iters * 2):
        f = 0.6 if it % 2 == 0 else -0.62
        new = []
        for i, q in enumerate(pos):
            if not nb[i] or i in pinned:
                new.append(clamp(base[i], list(q)) if clamp else q); continue
            m = [sum(pos[j][k] for j in nb[i]) / len(nb[i]) for k in range(3)]
            fw = f * max(0.0, min(1.0, (top - base[i][1]) / 0.12))
            # Heights stay put: the hem / neckline cuts are horizontal lines in rest space and must stay straight
            new.append([q[0] + fw * (m[0] - q[0]), q[1], q[2] + fw * (m[2] - q[2])])
        for i, q in enumerate(new):
            d = sum((q[k] - base[i][k]) * n0[i][k] for k in range(3))
            if d < gap:
                for k in range(3):
                    q[k] += n0[i][k] * (gap - d)
            if clamp:
                q[:] = clamp(base[i], q)
        pos = new
    mesh.pos = [tuple(q) for q in pos]
    nn = normals_for(mesh.pos, tris)
    if sum(sum(a[k] * b[k] for k in range(3)) for a, b in zip(nn, n0)) < 0:  # keep the winding's outward side
        nn = [(-a, -b, -c) for a, b, c in nn]
    mesh.nor = nn
    return mesh


def clear_scalp(pts, scalp, gap=0.0035):
    """Hair made for another head shape: push any vertex that sits in (or on) the scalp back out along
    the nearest scalp normal so no skin shows through the hair."""
    out = []
    for q in pts:
        best, bp, bn = 9.0, None, None
        for p, n in scalp:
            d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2
            if d < best:
                best, bp, bn = d, p, n
        h = sum((q[k] - bp[k]) * bn[k] for k in range(3))
        out.append(tuple(q[k] + bn[k] * (gap - h) for k in range(3)) if h < gap else q)
    return out


def make_shorts(P, W, dom, BINS=40):
    """Shorts as smooth tubes instead of a copy of the skin (which shows the glutes): a hip band that
    falls straight from the seat, and a tube round each thigh that it overlaps. Each ring's radius per
    direction is the body's (blurred) outline plus a little ease; skin weights come from the nearest
    body vertex so the cloth moves with the legs."""
    src = [i for i, q in enumerate(P) if dom[i] in (0, 9, 12) and 0.27 < q[1] < 0.60]

    def outline(cx, cz, pick, pad):
        env = [0.0] * BINS
        for i in src:
            q = P[i]
            if pick(q):
                a = math.atan2(q[0] - cx, q[2] - cz)
                b = int((a + math.pi) / (2 * math.pi) * BINS) % BINS
                env[b] = max(env[b], math.hypot(q[0] - cx, q[2] - cz))
        for _ in range(3):
            for k in range(BINS):
                if env[k] == 0:
                    env[k] = max(env[(k - 1) % BINS], env[(k + 1) % BINS])
        for _ in range(3):  # blur round the ring: a smooth outline, the crease between the glutes filled
            env = [max(env[k], (env[(k - 1) % BINS] + 2 * env[k] + env[(k + 1) % BINS]) / 4) for k in range(BINS)]
        return [r + pad for r in env]

    def rings(cx, cz, ys, radius):
        rows = []
        for y in ys:
            env = radius(y)
            rows.append([(cx + math.sin(a) * env[k], y, cz + math.cos(a) * env[k])
                         for k, a in ((k, (k + 0.5) / BINS * 2 * math.pi - math.pi) for k in range(BINS))])
        return rows

    seat = outline(0.0, 0.0, lambda q: 0.45 < q[1] < 0.55, 0.012)
    tubes = []
    hip_ys = [0.455 + i * 0.0125 for i in range(11)]  # 0.455 .. 0.58

    def hip_r(y):
        local = outline(0.0, 0.0, lambda q: abs(q[1] - y) < 0.015, 0.005)
        s = max(0.0, min(1.0, (0.53 - y) / 0.035))  # waistband tucked under the jersey, below it hangs from the seat
        return [l + (max(l, sv) - l) * s for l, sv in zip(local, seat)]
    tubes.append(rings(0.0, 0.0, hip_ys, hip_r))
    pelvis_from = 0.475  # the band moves with the pelvis (thigh weights would push it through the jersey)
    for side in (1, -1):
        lv = [P[i] for i in src if 0.34 < P[i][1] < 0.44 and P[i][0] * side > 0.01]
        cx = sum(q[0] for q in lv) / len(lv); cz = sum(q[2] for q in lv) / len(lv)
        thigh = outline(cx, cz, lambda q, side=side: 0.33 < q[1] < 0.47 and q[0] * side > 0.004, 0.012)
        tubes.append(rings(cx, cz, [0.30 + i * 0.0125 for i in range(16)],  # 0.30 .. 0.4875, top tucked inside the band
                           lambda y, thigh=thigh: [r * (1 - 0.18 * max(0.0, min(1.0, (y - 0.44) / 0.045))) for r in thigh]))

    mesh = Mesh()
    for ti, rows in enumerate(tubes):
        base = len(mesh.pos)
        for row in rows:
            for q in row:
                j = min(src, key=lambda i: (P[i][0] - q[0]) ** 2 + (P[i][1] - q[1]) ** 2 + (P[i][2] - q[2]) ** 2)
                wj = W[j]
                if ti == 0:
                    t = max(0.0, min(1.0, (q[1] - 0.455) / (pelvis_from - 0.455)))
                    wj = [(x * (1 - t), b) for x, b in wj if b != 0] + [(t + (1 - t) * sum(x for x, b in wj if b == 0), 0)]
                    wj = sorted(wj, reverse=True)[:4]
                    tot = sum(x for x, _ in wj); wj = [(x / tot, b) for x, b in wj]
                w = wj + [(0, 0)] * (4 - len(wj))
                mesh.pos.append(q); mesh.trim.append(q); mesh.uv.append((0, 0))
                mesh.si.append([b for _, b in w[:4]])
                sw = [round(x * 255) for x, _ in w[:4]]; sw[0] += 255 - sum(sw)
                mesh.sw.append(sw)
        for r in range(len(rows) - 1):
            for k in range(BINS):
                a, b = base + r * BINS + k, base + r * BINS + (k + 1) % BINS
                c, d = a + BINS, b + BINS
                mesh.idx += [a, b, c, b, d, c]
    tris = [tuple(mesh.idx[i:i + 3]) for i in range(0, len(mesh.idx), 3)]
    nn = normals_for(mesh.pos, tris)
    if nn[0][2] * mesh.pos[0][2] + nn[0][0] * mesh.pos[0][0] < 0:
        nn = [(-x, -y, -z) for x, y, z in nn]
    mesh.nor = nn
    mesh.groups.append({'start': 0, 'count': len(mesh.idx), 'mat': 0})
    return mesh, hip_r


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
        if not (tdom[fi] <= {0, 1} or (c[1] < 0.57 and tdom[fi] <= {0, 1, 9, 12})):  # down to the hem over the hips
            return False
        return 0.465 < c[1] < 0.86

    def shorts(fi):
        c = cen[fi]
        return tdom[fi] <= {0, 9, 12} and 0.295 < c[1] < 0.58


    meshes = {}
    def bare(fi):  # no feet: the game puts sneakers on the ankles
        return not (tdom[fi] <= {11, 14} and cen[fi][1] < 0.055)
    # Skin that's always under the jersey or the shorts' waistband is dropped, so it can never poke through
    # the cloth as the arms and legs move (the cut matches the jersey shader's uniCut, with a margin).
    def jersey_cut(r):
        ax = abs(r[0])
        top = (0.79 + 0.9 * ax if ax < 0.06 else 0.844) if r[2] > 0.01 else 0.836
        e = math.hypot((ax - 0.13) / 0.066, (r[1] - 0.80) / 0.125)
        return min(r[1] - 0.50, top - r[1], (e - 1.0) * 0.06)
    def covered(fi):
        if jersey(fi) and all(jersey_cut(P[c[0]]) > 0.016 for c in faces[fi]):
            return True
        return tdom[fi] <= {0, 9, 12} and all(0.47 < P[c[0]][1] < 0.545 for c in faces[fi])
    meshes['body'] = emit(Mesh(), faces, P, N, W, vt, keep=lambda fi: bare(fi) and not covered(fi))
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
        cr = (chest[i0] * (1 - f) + chest[(i0 + 1) % BINS] * f) * 0.94 + 0.01
        nr = r + (max(r, cr) - r) * b
        return (math.sin(a) * nr, q[1], CZ + math.cos(a) * nr)
    meshes['shorts'], hip_r = make_shorts(P, W, dom)
    # The jersey's bottom hangs over the shorts: keep it just outside the hip band where they overlap
    hip_cache = {}
    def over_shorts(rest, q):
        if rest[1] > 0.6:
            return q
        yk = round(max(0.455, min(0.58, rest[1])), 3)
        if yk not in hip_cache:
            hip_cache[yk] = hip_r(yk)
        env = hip_cache[yk]; nb = len(env)
        a = math.atan2(q[0], q[2]); r = math.hypot(q[0], q[2])
        k = (a + math.pi) / (2 * math.pi) * nb - 0.5
        i0 = int(math.floor(k)) % nb; f = k - math.floor(k)
        e = env[i0] * (1 - f) + env[(i0 + 1) % nb] * f + 0.008
        w = max(0.0, min(1.0, (0.6 - rest[1]) / 0.04))
        nr = r + (max(r, e) - r) * w
        return [math.sin(a) * nr, q[1], math.cos(a) * nr]
    # The jersey hangs from the torso: thigh weights on its bottom would swing it through the shorts
    def torso_only(w):
        t = [(x, b) for x, b in w if b not in (9, 12)]
        moved = sum(x for x, b in w if b in (9, 12))
        t = [(x + (moved if b == 0 else 0), b) for x, b in t]
        if not any(b == 0 for _, b in t):
            t.append((moved, 0))
        tot = sum(x for x, _ in t)
        return [(x / tot, b) for x, b in t if x > 0]
    WJ = [torso_only(w) for w in W]
    meshes['jersey'] = soften(emit(Mesh(), faces, P, N, WJ, None, keep=jersey, offset=lambda vi: 0.011, rest=True, warp=drape),
                              clamp=over_shorts)

    # Hair: rigid on the head. Most styles were made on the neutral body; map them onto this head.
    nv, _, _ = parse_obj(NEUTRAL)
    src_lo, src_hi = head_box(nv, 0.86)
    dst_lo, dst_hi = head_box(v, 0.855)
    hair_meta = {}
    scalp = [(P[i], N[i]) for i in range(len(P)) if P[i][1] > 0.86]
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
        mp = clear_scalp(mp, scalp)
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
