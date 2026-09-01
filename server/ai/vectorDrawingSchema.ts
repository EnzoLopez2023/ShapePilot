// The structured-output contract for tracing artwork out of a photograph, and
// the system prompt that goes with it.
//
// The schema constrains the shape of the answer; lib/contracts/vectorDrawing.ts
// still validates the result, because structured output guarantees well-formed
// JSON matching a schema, not that the paths describe a drawable shape.
//
// Flat on purpose, like the keycap-set schema: a drawing is a list of paths and
// a path is a list of commands, and a list is what the model reads best off an
// image. The shape program has to unroll recursion because a scene tree nests;
// this does not.
import { PATH_COMMANDS, VECTOR_LIMITS } from '../../lib/contracts/vectorDrawing.ts'

const point2 = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
  description: 'an [x, y] pair in millimetres, y-up',
}

const command = {
  type: 'object',
  description:
    'One path command. M starts a subpath, L draws a straight segment, C draws '
    + 'a cubic bezier, Z closes the current subpath. Only the keys the chosen '
    + 'command needs: M and L take "to"; C takes "c1", "c2" and "to"; Z takes none.',
  properties: {
    cmd: { type: 'string', enum: [...PATH_COMMANDS] },
    to: point2,
    c1: { ...point2, description: 'cubic bezier: first control point' },
    c2: { ...point2, description: 'cubic bezier: second control point' },
  },
  required: ['cmd'],
}

export const VECTOR_DRAWING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    version: { type: 'integer', enum: [1] },
    units: { type: 'string', enum: ['mm'] },
    widthMm: { type: 'number', description: 'the artwork box width in millimetres' },
    heightMm: { type: 'number', description: 'the artwork box height in millimetres' },
    paths: {
      type: 'array',
      maxItems: VECTOR_LIMITS.maxPaths,
      description:
        'One entry per distinct filled shape, painted in order. A shape with a '
        + 'hole is one path with the hole as a second subpath wound the other way.',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'stable kebab-case identifier, unique in the drawing',
          },
          name: { type: 'string', description: 'short human-readable label, e.g. "monogram"' },
          commands: {
            type: 'array',
            maxItems: VECTOR_LIMITS.maxCommandsPerPath,
            description: 'the path, starting with an M. Repeat M to add a subpath.',
            items: command,
          },
          fill: {
            type: 'string',
            description: 'fill colour as #rrggbb; omit for solid black',
          },
        },
        required: ['id', 'name', 'commands'],
      },
    },
    notes: {
      type: 'string',
      description:
        'One or two sentences for the person reviewing this: what you traced, the '
        + 'size you chose, and anything you deliberately simplified or left out.',
    },
  },
  required: ['version', 'units', 'widthMm', 'heightMm', 'paths', 'notes'],
}

export const VECTOR_DRAWING_INSTRUCTIONS = `
You are tracing artwork -- a logo, a monogram, a line drawing -- out of a
photograph and producing clean vector paths for it. The person will review the
result before anything is applied, so an honest partial trace is worth more than
a confident invented one.

Coordinate system and conventions:
- Millimetres throughout. The origin is the bottom-left of the artwork box and y
  points UP, so a shape near the top of the picture has large y values.
- Give widthMm and heightMm as the artwork's real size if the picture lets you
  judge it (a business card is about 89 mm wide, a keycap about 18 mm). If you
  cannot tell, use a box about 100 mm on its long edge and say so in notes.

Before you trace, examine EVERY characteristic of the image and match it. Get
these wrong and the trace is wrong even when the overall shape is right:
- Stroke weight. Measure the thickness of a stroke against the whole mark and
  against the white gaps beside it (a "counter"). If the gap between two strokes
  looks about as wide as a stroke, your output must read the same way. Too-heavy
  strokes are the single most common mistake -- when unsure, go thinner.
- Terminals. Are the stroke ends rounded, square, or angled? Round ends need
  round caps; square ends must not be rounded.
- Corners. Rounded (and how tight a radius) or sharp?
- Proportions and alignment. The overall aspect ratio; whether elements line up
  on a shared edge or are deliberately offset; the RELATIVE lengths of segments
  (is one bar shorter than another?); the spacing between repeated elements.
- Overlap. Where shapes cross or interlock, and where they leave a visible gap.
- Colour. Pure black, off-black, or a real colour; one colour or several.
Reproduce these measurements; do not approximate them by eye.

Rules you must follow:
- One path per distinct filled shape. Reproduce what you can actually see; do not
  invent detail the photo does not show.
- Use C (cubic bezier) for curved edges and L for straight ones. Keep the command
  count modest -- a clean logo is tens of points, not thousands.
- For a shape with a hole (a counter in a letter, a ring), emit the outline and
  the hole as two subpaths of ONE path: draw the outline, Z, then M into the hole
  and draw it the OTHER way round (if the outline is counter-clockwise, wind the
  hole clockwise).
- Close every subpath with Z.
- Give each path a stable, descriptive kebab-case id.
- Set fill only when the artwork is clearly not black.

In "notes", say what you traced, the size you chose, and what you simplified.
`.trim()
