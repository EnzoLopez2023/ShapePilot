Systainer3 S76 modular rack -- 2 bays

*** JOINT COUPON -- not a usable rack. ***

Case          60 x 40 x 20 mm (feet included)
Rack          69.4 w x 51 d x 55.6 h mm
Bay opening   23.0 mm clear, 26.2 mm pitch
Pieces        2 to print, 2 distinct (2 middle)

PRINT QUANTITIES
  rack_middle_L.stl  x1
  rack_middle_R.stl  x1
Material      ~66 cm3 solid, roughly 0.08 kg of PLA at 100% infill

PRINTING
  Print every piece EXACTLY as exported -- standing on its back face, the
  long axis vertical. That is not arbitrary: in this orientation every layer
  is the same cross-section, so nothing overhangs and no supports are needed.
  Laid flat the way the rack is used, a shelf would cantilever over air.
  Use a brim. No supports.

ASSEMBLY
  1. Lay a course flat and DROP the two halves together. The flared tabs
     through the shelf pass straight down into their slots.
  2. SLIDE the finished course onto the stack from the FRONT. The dovetail
     along the wall runs the full depth and takes the load in tension.
  3. Repeat: bottom cap, then middles, then the top cap.
  The halves are locked in the loaded directions and free only straight up,
  which is how you take it apart again.

WALL MOUNT
  A French cleat. Screw cleat_wall_L and _R to the studs, pegged end to pegged
  end, 40 mm tall, level. The rack's top cap hooks over them and its
  weight pulls it against the wall; the bottom cap's pad holds it parallel.
  Both towers seat on the same strip -- that is what stops the two halves of
  a course lifting apart, which is the one direction the seam leaves free.
  Stand-off from the wall is 6 mm.

FIT
  Every mating feature carries 0.15 mm of clearance. If the coupon is
  tight or sloppy, change fitMm in src/rack/config.ts and re-run. Do that
  BEFORE printing the full set.

  THIS COUPON TESTS ALL THREE JOINTS:
    rack_middle_L + _R   glue together  -> the seam V
    two of rack_middle_L slide together -> the course dovetail
    hook onto strip                     -> the cleat
  The cleat pieces keep their real height because the bevel tops out 34 mm
  up the cap; only their width is cut down.
