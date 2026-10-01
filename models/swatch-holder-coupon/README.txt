Swatch holder fit coupons
=========================

For the 36.4 x 69.4 mm swatch card in
models/filament-swatch/. Cards hang PORTRAIT, like a luggage tag, from the
2 x 30.4 mm slot already in them. Nothing you have
printed becomes obsolete.

Transferring a card
-------------------
Present the card to the blade, push it back, let go. To take it off, lift it
0.5 mm until it clears the lip and pull it forward.

Every mount here carries an IDENTICAL blade, so that motion is the same on the
bar by the shelf, on the AMS and on a dry box. That is the whole point: the
card follows the spool.

Printing
--------
  swatch_bar_1col        40.0 x 22.0 x 13.7 mm   4.0 g
  swatch_pad_1up         30.0 x 24.0 x 6.7 mm   3.0 g
  coupon_blade_ladder    150.0 x 24.0 x 6.7 mm   14.9 g

  Bar:  stand it on its top edge (the face the lips are flush with), brim on, no supports
        It has features on BOTH faces -- blades forward, prongs back -- so
        neither face can lie on the bed. Stood on its top edge, every lip
        starts ON the bed and from there material only ever ends as the
        print rises. The first layer is a long thin strip plus one island
        per blade, so a brim is not optional.
  Pad:  back face down on the bed, so the adhesive face is the bed face. No supports.

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

Sticking the pad
----------------
  30 x 24 mm, for 3M VHB or similar.

  FLAT FACES ONLY. A pad this wide needs a surface no rounder than about
  322 mm radius before its edges lift further than the foam
  takes up. A dryer's flat side or a tub's lid is fine; the wall of a round
  tub is not, and the tape will creep off over weeks rather than fail at once.

  Sunlu and Eibos boxes and most food tubs are polypropylene or polyethylene.
  VHB does not bond to those without 3M Primer 94 -- this is the most likely
  reason a mount falls off. Clean with IPA, press hard for 15 seconds, and
  leave it 72 hours before trusting it.

  For the AMS: print singles and place them one at a time. There is no
  published AMS 2 Pro tray pitch in this repo, and a card hanging off the
  front may foul the lid -- measure yours before committing to a row.

What the coupons settle
-----------------------
  swatch_bar_1col   One prong and one blade. Does it hang on your board?
                    Board thickness is assumed to be 5 mm and has
                    never been measured here. Too thick and the bar rocks,
                    too thin and the catch will not clear.

  coupon_blade_ladder  Four blades, left to right:
                    1. 1.6 mm blade, 0.0 mm lip
                    2. 1.4 mm blade, 0.2 mm lip
                    3. 1.2 mm blade, 0.5 mm lip
                    4. 1.0 mm blade, 0.7 mm lip
                    Hang a real card on each. Keep the one that engages
                    positively and still releases one-handed. A nominal
                    1.2 mm blade often prints 1.3 and a nominal 2.0 mm slot
                    often prints 1.9 -- that is 0.2 mm off a 0.3 mm
                    clearance, and no test can see it.

  swatch_pad_1up    Offer it to each box. Does it sit flat, or rock?
                    No tape needed to find out.

Regenerate with: npm run swatch:holder -- --coupon
