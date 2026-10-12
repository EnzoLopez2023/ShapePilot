Keyboard switch tester -- tray + snap-off cover

*** THE STLs ARE NOT IN THE REPOSITORY. Run the script to get them. ***

The tray and cover take their footprint from a switch-tester model that is
someone else's work, sliced out of the STL itself rather than measured. That
makes both pieces derivatives of it, and ShapePilot is a public repository, so
no geometry from this folder is published -- the same call as the keyboard
display boards. What is committed is the script that makes it.

SOURCE MODEL
  Keyboard Switch Testers - Bambu Studio.stl    83.00 x 64.00 x 9.00 mm
  Downloaded, not generated here. Put it in this folder under exactly that
  name before running the script, and check its licence before you share
  anything cut from it.

BUILD
  cd "models/Switch tester"
  python3 build_tray_and_cover.py       # needs numpy, trimesh, manifold3d

  switch_tester_tray.stl    87.00 x 68.00 x  6.10 mm
  switch_tester_cover.stl   96.00 x 68.00 x 26.50 mm   (print lid-down)

HOW IT GOES TOGETHER
  The tester is 9 mm tall: a 1.2 mm plate with 15 mm switch cavities opening
  off one face. In use it is flipped -- the cavity side drops into the tray and
  the switches stand up out of the plate face. The tray takes half the tester's
  height (4.5 mm) so there is something to grip; the cover's skirt lands on the
  tray rim and its walls match the tray's outside, so the two finish flush.
  HEADROOM is 20 mm above the plate face, which clears Cherry-profile caps on
  the switches with air to spare.

FIT
  Tray   0.00 mm per side. 0.20 and 0.10 both printed loose on the X2D.
  Cover  0.05 mm per side. 0.00 grips too hard to lift off.
  Both are constants at the top of the script. Change them there and re-run.

  The cover's finger tab sticks 5 mm past the wall on the short side, 30 mm
  wide, 1.6 mm thick under the thumb with a 45-degree ramp above it -- that is
  what you pull on, and why the cover is wider than the tray.
