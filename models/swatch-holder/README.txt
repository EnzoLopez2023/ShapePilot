Swatch card holders
===================

For the 36.4 x 69.4 mm swatch card in
models/filament-swatch/. Cards hang PORTRAIT, like a luggage tag, from the
2 x 30.4 mm slot already in them. Nothing you have
printed becomes obsolete.

Transferring a card
-------------------
Present the card to the blade, push it back, let go. To take it off, lift it
0.7 mm until it clears the lip and pull it forward.

Every mount here carries an IDENTICAL blade, so that motion is the same on the
bar by the shelf, on the AMS and on a dry box. That is the whole point: the
card follows the spool.

Printing
--------
  swatch_bar_5col        200.0 x 22.0 x 14.9 mm   20.4 g
  swatch_pad_1up         30.0 x 24.0 x 6.7 mm   3.0 g
  swatch_pad_4up         150.0 x 24.0 x 6.7 mm   14.8 g

  Bar:  stand it on its top edge (the face the lips are flush with), brim on, no supports
        It has features on BOTH faces -- blades forward, prongs back -- so
        neither face can lie on the bed. Stood on its top edge, every lip
        starts ON the bed and from there material only ever ends as the
        print rises. The first layer is a long thin strip plus one island
        per blade, so a brim is not optional.
  Pads: back face down on the bed, so the adhesive face is the bed face. No supports.

  No supports on either. PETG, not PLA, for anything that goes on a dryer or
  the AMS: a dryer runs 50-70 C and PLA starts creeping at 55.

Hanging the bar
---------------
  5 cards, one per Skadis column, 200 mm wide.
  Put all the prongs in their slots, then DROP it 5 mm. The shank then rests
  on the slot's lower edge and the catch is behind solid board.

  For 10-15 cards print three bars and stack them 80 mm apart.
  That is two column-steps, so every bar's prongs land on a real slot, and a
  hanging card still clears the bar below it.

  Cards sit 3.6 mm apart. Do not try to overlap them: the
  thickness ladder is in the bottom 13 mm of a hanging card and it is the only
  thing on the card that is not also printed on the label.

Sticking the pads
-----------------
  1 card : 30 x 24 mm, needs a face no rounder than about 322 mm radius
  4 cards: 150 x 24 mm, needs a face no rounder than about 8036 mm radius

  FLAT FACES ONLY, and the longer the pad the flatter the face has to be --
  the numbers above are what the foam can take up before the ends lift. A
  single will sit on a dryer's side; a 4-up wants something genuinely flat,
  and the tape creeps off over weeks rather than failing at once.

  Sunlu and Eibos boxes and most food tubs are polypropylene or polyethylene.
  VHB does not bond to those without 3M Primer 94 -- this is the most likely
  reason a mount falls off. Clean with IPA, press hard for 15 seconds, and
  leave it 72 hours before trusting it.

  For the AMS: print singles and place them one at a time. There is no
  published AMS 2 Pro tray pitch in this repo, and a card hanging off the
  front may foul the lid -- measure yours before committing to a row.

Regenerate with: npm run swatch:holder
