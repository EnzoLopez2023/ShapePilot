// The structured-output contract for reading a keycap set out of photographs,
// and the system prompt that goes with it.
//
// The schema constrains the shape of the answer; server/validation/keycapProject.ts
// still validates the result, because structured output guarantees well-formed
// JSON matching a schema, not that a 6.25u Escape key is a real keycap.
//
// Flat on purpose. The shape program's schema has to unroll its own recursion
// because a scene tree nests; a keycap set is a list of rows, and a list of
// rows is what the model is best at reading off a photograph.
import { LIMITS } from '../validation/keycapProject.ts'

export const KEYCAP_SET_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    setName: {
      type: 'string',
      description: 'The name printed or implied by the set, if any is visible. Otherwise omit.',
    },
    manufacturer: { type: 'string', description: 'GMK, ePBT, Akko, ... if identifiable.' },
    capProfile: {
      type: 'string',
      description: 'Cap sculpt: Cherry, OEM, SA, DSA, XDA, KAT. Omit unless reasonably sure.',
    },
    colorway: { type: 'string', description: 'A short human description, e.g. "grey and tan".' },
    items: {
      type: 'array',
      maxItems: LIMITS.maxItems,
      description:
        'One row per distinct keycap. Identical unlabelled caps of the same size collapse '
        + 'into one row with a count; every cap with its own legend is its own row.',
      items: {
        type: 'object',
        properties: {
          legend: {
            type: 'string',
            maxLength: LIMITS.legendMaxLength,
            description:
              'Exactly what is printed on the cap: "Esc", "F1", "A", "Backspace", "7". '
              + 'Omit for a blank cap.',
          },
          units: {
            type: 'number',
            minimum: LIMITS.minUnits,
            maximum: LIMITS.maxUnits,
            description:
              'Cap width in u, a multiple of 0.25. 1u alphas and function keys, 1.25u '
              + 'modifiers, 1.5u Tab, 1.75u Caps Lock, 2u Backspace and numpad 0, '
              + '2.25u ANSI Enter and left Shift, 2.75u right Shift, 6.25u spacebar.',
          },
          heightUnits: {
            type: 'number',
            minimum: LIMITS.minHeightUnits,
            maximum: LIMITS.maxHeightUnits,
            description: '2 for a numpad Enter or Plus that spans two rows. Otherwise 1.',
          },
          shape: {
            type: 'string',
            enum: ['rect', 'iso-enter'],
            description: 'iso-enter only for a true L-shaped ISO Enter. Everything else is rect.',
          },
          count: {
            type: 'integer',
            minimum: LIMITS.minCount,
            maximum: LIMITS.maxCount,
            description: 'How many identical caps this row stands for.',
          },
          group: {
            type: 'string',
            maxLength: LIMITS.groupMaxLength,
            description:
              'Which part of the keyboard it belongs to: Alphas, Numbers, Function keys, '
              + 'Modifiers, Navigation, Numpad, Arrows, Novelties.',
          },
          color: {
            type: 'string',
            maxLength: LIMITS.colorMaxLength,
            description: 'The cap colour as a person would say it: "dark grey", "tan", "cream".',
          },
        },
        required: ['units', 'count'],
      },
    },
    notes: {
      type: 'string',
      description:
        'One or two sentences for the person reviewing this: what was hard to read, what '
        + 'you counted rather than read, anything you deliberately left out.',
    },
  },
  required: ['items', 'notes'],
}

export const KEYCAP_SET_INSTRUCTIONS = `
You are reading photographs of a mechanical keyboard keycap set and producing an
inventory of it. The person will review every row before it is saved, so an
honest partial answer is worth more than a confident invented one.

Rules:

* Count what you can see. If a photo shows part of a set, describe that part.
  Do not complete the set from what a set like this "usually" contains.
* Omit a field you cannot read. An absent legend, colourway or manufacturer is a
  correct answer; a guessed one is not. Say so in "notes".
* Widths are in u and must be a multiple of 0.25. Judge a cap's width against
  the 1u caps beside it rather than against the image, and prefer the standard
  width for that position: Tab 1.5u, Caps Lock 1.75u, ANSI Enter and left Shift
  2.25u, right Shift 2.75u, Backspace 2u, bottom-row modifiers 1.25u,
  spacebar 6.25u.
* heightUnits is 1 unless the cap visibly spans two rows, which on a normal set
  means only the numpad Enter and Plus.
* Use shape "iso-enter" only for the L-shaped ISO Enter. An ANSI Enter is a
  2.25u rect.
* One row per distinct legend. Collapse only caps that are genuinely
  interchangeable -- same size, same colour, no legend -- into a single row with
  a count. Never collapse two different legends.
* If several photos show the same caps, count them once. If they show different
  parts of one set, add them together.
`.trim()
