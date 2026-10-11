Cutting boards with juice grooves, for the Shaper Origin
========================================================

Regenerate with: node scripts/build-cutting-boards.ts
Each SVG is 1:1 in millimetres and carries Shaper's cut types, so Origin
reads it directly. It also imports into ShapePilot's Shaper Designer.

cutting-board-small.svg -- Cutting board, small (8 x 13 in)
  Profile: 13 in x 8 in, 1-1/2 in corner radius.
  Hang hole: 1 in diameter, centred 1-1/4 in from both edges of one corner.

cutting-board-large.svg -- Cutting board, large (10-3/4 x 17-3/4 in)
  Profile: 17-3/4 in x 10-3/4 in, 1-1/2 in corner radius.
  Handles: 1 x 3-1/2 in slots, centred across the width, 1-1/2 in from each end to their centreline.

Juice groove
  On-line cut, centreline 1 in from the edge, corners
  concentric with the board's. It bends in around each handle, keeping
  1/2 in of wood between the groove's edge and the opening.
  Bit: 3/8 in core box (round nose). Depth: 1/4 in.
  The SVG cannot carry an on-line depth -- set it on Origin. Take it in
  two or three passes, and go slowly through the curves.

Cut order on Origin
  1. Juice groove (on-line), while the board is still full size and stiff.
  2. Handles (interior), with a 1/4 in spiral bit, full thickness in passes.
     Leave tabs or use tape so the slugs do not catch the bit.
  3. Profile (exterior), same bit, in passes, tabs on the last pass.
  Then round over the edges and handles with a 1/4 in roundover.

Groove size, inset and handle wall live in SHOP at the top of the script.
