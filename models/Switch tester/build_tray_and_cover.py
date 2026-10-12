"""Tray + snap-off cover for "Keyboard Switch Testers - Bambu Studio.stl".

    python3 build_tray_and_cover.py

The footprint is taken from the tester STL itself (a slice through its
straight sides), so the fit follows the real outline, rounded corners and all.

The tester is 9 mm tall. Its 1.2 mm plate is at STL z=0 and the 15 mm switch
cavities open upward, so in use it is flipped: the cavity side sits in the
tray and the switches (and keycaps) stand up out of the plate face.
"""

import numpy as np
import trimesh
from manifold3d import CrossSection, JoinType, Manifold

SRC = "Keyboard Switch Testers - Bambu Studio.stl"

FIT = 0.00          # tray, per side: 0.20 and 0.10 printed loose on the X2D; 0.00 is right
COVER_FIT = 0.05    # cover, per side: 0.00 would grip too hard to lift off easily
WALL = 2.0          # tray wall = cover wall, so the two meet flush
FLOOR = 1.6         # tray floor
TRAY_DEPTH = 4.5    # half of the tester's 9 mm height
LID = 2.0           # cover roof
HEADROOM = 20.0     # above the plate face: Cherry-profile caps on MX, ~18.2 at the tallest row + air

TAB_OUT = 5.0       # finger tab: how far it sticks out past the wall
TAB_W = 30.0        # tab width along the short side
TAB_T = 1.6         # flat thickness under the thumb; above that a 45° ramp


def footprint() -> CrossSection:
    m = trimesh.load(SRC)
    m.apply_translation(-m.bounds[0])
    h = m.extents[2]
    # Mid-height slice: the sides are straight from z≈1.1 to z≈8.4.
    sec = m.section([0, 0, 1], [0, 0, h / 2])
    pts = np.array(sec.to_2D(to_2D=np.eye(4))[0].polygons_full[0].exterior.coords)[:-1, :2]
    pts = pts - (pts.min(0) + pts.max(0)) / 2      # centre it
    pts[:, 1] *= -1                                # flipped for use
    cs = CrossSection([pts[::-1].tolist()]).simplify(0.01)
    if cs.area() < 0:
        cs = CrossSection([pts.tolist()])
    return cs, h


def offset(cs: CrossSection, d: float) -> CrossSection:
    return cs.offset(d, JoinType.Round, circular_segments=96)


def tray(outline: CrossSection) -> Manifold:
    pocket = offset(outline, FIT)
    outer = offset(pocket, WALL)
    body = outer.extrude(FLOOR + TRAY_DEPTH)
    cut = pocket.extrude(TRAY_DEPTH + 1).translate([0, 0, FLOOR])
    return body - cut


def cover(outline: CrossSection, part_h: float) -> Manifold:
    """Modelled in use orientation, skirt bottom at z=0 (it sits on the tray rim)."""
    inner = offset(outline, COVER_FIT)
    outer = offset(outline, FIT + WALL)     # match the tray outside, so they stay flush
    skirt = part_h - TRAY_DEPTH            # the tester side left above the tray
    cavity_h = skirt + HEADROOM
    body = outer.extrude(cavity_h + LID) - inner.extrude(cavity_h)

    # Finger tabs on both short ends. Flat underside to push up on; the top is
    # a 45° ramp back into the wall so it prints without support lid-down.
    half_x = outer.bounds()[2]
    tab_h = TAB_T + TAB_OUT
    prof = CrossSection([[(0, 0), (TAB_OUT, 0), (TAB_OUT, TAB_T), (0, tab_h)]])
    wedge = prof.extrude(TAB_W).rotate([90, 0, 0]).translate([0, TAB_W / 2, 0])
    for sx in (1, -1):
        w = wedge.translate([half_x - 0.5, 0, 0])   # 0.5 mm overlap into the wall
        if sx < 0:
            w = w.mirror([1, 0, 0])
        body = body + (w - inner.extrude(cavity_h))
    return body


def save(man: Manifold, path: str, flip: bool = False) -> None:
    mesh = man.to_mesh()
    t = trimesh.Trimesh(mesh.vert_properties[:, :3], mesh.tri_verts, process=True)
    if flip:
        t.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))
    t.apply_translation([0, 0, -t.bounds[0][2]])
    assert t.is_watertight, path
    t.export(path)
    e = t.extents
    print(f"{path}: {e[0]:.1f} x {e[1]:.1f} x {e[2]:.1f} mm, {t.volume / 1000:.1f} cm³")


if __name__ == "__main__":
    outline, h = footprint()
    b = outline.bounds()
    print(f"tester footprint {b[2] - b[0]:.2f} x {b[3] - b[1]:.2f} mm, height {h:.2f} mm")
    save(tray(outline), "switch_tester_tray.stl")
    save(cover(outline, h), "switch_tester_cover.stl", flip=True)   # print lid-down
