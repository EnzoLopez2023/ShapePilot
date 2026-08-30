// The JSON schema handed to the model as a structured-output contract, and the
// system prompt that goes with it.
//
// The schema constrains the shape of the answer; lib/contracts/shapeProgram.ts
// still validates the result, because structured output guarantees well-formed
// JSON matching a schema, not that the numbers make a manufacturable part.
import { BOOLEAN_OPS, PRIMITIVE_OPS, PROGRAM_LIMITS } from '../../lib/contracts/shapeProgram.ts'

const point2 = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
}

const triple = {
  type: 'array',
  items: { type: 'number' },
  minItems: 3,
  maxItems: 3,
}

const transform = {
  type: 'object',
  properties: {
    position: { ...triple, description: 'millimetres from the origin, [x, y, z]' },
    rotationDeg: { ...triple, description: 'degrees about x, y, z' },
    scale: { ...triple, description: 'each factor must be greater than zero' },
  },
  required: ['position', 'rotationDeg', 'scale'],
}

const params = {
  type: 'object',
  description: 'Only the keys the chosen op needs. All lengths are millimetres.',
  properties: {
    widthMm: { type: 'number' },
    depthMm: { type: 'number' },
    heightMm: { type: 'number' },
    radiusMm: { type: 'number' },
    topRadiusMm: { type: 'number', description: 'cone only; 0 is a true point' },
    tubeMm: { type: 'number', description: 'torus only; must be less than radiusMm' },
    segments: {
      type: 'integer',
      minimum: PROGRAM_LIMITS.minSegments,
      maximum: PROGRAM_LIMITS.maxSegments,
    },
    profile: {
      type: 'array',
      description: 'extrude only: the outer ring, counter-clockwise, unclosed',
      items: point2,
    },
    holes: {
      type: 'array',
      description: 'extrude only: inner rings, clockwise',
      items: { type: 'array', items: point2 },
    },
  },
}

/**
 * The recursion is expressed as a fixed nesting of three levels rather than a
 * $ref cycle: strict-mode structured output does not accept a self-referential
 * schema, and three levels is deeper than any part this assistant should build
 * in one turn.
 */
const nodeAtDepth = (depth: number): Record<string, unknown> => {
  const node: Record<string, unknown> = {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'stable kebab-case identifier, unique in the program; '
          + 'reuse the existing id when modifying a part so the edit is targeted',
      },
      name: { type: 'string', description: 'short human-readable label, e.g. "cable cutout"' },
      op: { type: 'string', enum: [...PRIMITIVE_OPS, ...BOOLEAN_OPS] },
      params,
      transform,
    },
    required: ['id', 'name', 'op', 'transform'],
  }
  if (depth > 0) {
    ;(node.properties as Record<string, unknown>).children = {
      type: 'array',
      description: 'boolean ops only. difference subtracts every child after the first.',
      items: nodeAtDepth(depth - 1),
    }
  }
  return node
}

export const SHAPE_PROGRAM_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    version: { type: 'integer', enum: [1] },
    units: { type: 'string', enum: ['mm'] },
    parts: {
      type: 'array',
      description: 'top-level parts, unioned to form the model',
      items: nodeAtDepth(3),
    },
    notes: {
      type: 'string',
      description: 'one or two sentences for the user about what you built or changed',
    },
  },
  required: ['version', 'units', 'parts', 'notes'],
}

const SHARED_RULES = `
You design real, printable and machinable parts as a CSG program.

Coordinate system and conventions:
- Millimetres throughout. Z is up. The build plate is the z = 0 plane.
- Every primitive is generated centred on the origin in x and y and SITTING ON
  z = 0. A transform's position moves it from there.
- box/wedge use widthMm (x), depthMm (y), heightMm (z).
- cylinder/cone use radiusMm and heightMm; cone also takes topRadiusMm.
- sphere uses radiusMm. torus uses radiusMm and tubeMm, tubeMm < radiusMm.
- extrude takes profile (outer ring, counter-clockwise, unclosed) and heightMm.
- 'difference' subtracts every child after the first from the first.

Rules you must follow:
- Give every part a stable, descriptive id in kebab-case. Ids are how the user
  refers to parts in later turns, so keep them meaningful and keep them STABLE.
- To cut a hole, make the cutting solid LONGER than the material it passes
  through and position it so it protrudes from both faces. A cutter that ends
  exactly flush with a surface leaves a zero-thickness face that is not
  watertight.
- Use realistic dimensions. Look up nothing; reason from common physical sizes.
- Keep wall thicknesses at or above 2 mm unless the user asks otherwise.
- Prefer few, well-named parts over many tiny ones.
`.trim()

export const CREATE_INSTRUCTIONS = `${SHARED_RULES}

This is a new design. Build the whole part from the user's description.
In 'notes', say in one or two plain sentences what you made and the key
dimensions you chose.`

export const EDIT_INSTRUCTIONS = `${SHARED_RULES}

You are MODIFYING an existing program, which is given to you as JSON.

- Return the COMPLETE updated program, not a patch.
- Keep the id and geometry of every part the user did not ask you to change,
  exactly as they are. Do not renumber, rename or re-centre anything gratuitously.
- Add new parts with new ids; modify a part by returning it under its existing id.
- In 'notes', say specifically what you added, changed or removed, naming the
  part ids, so the change can be reviewed before it is applied.`

export const BAMBU_CONTEXT = `
The result will be 3D printed on a Bambu Lab X2D: a 256 x 256 x 260 mm build
volume with a 0.4 mm nozzle. Keep the part inside that envelope, avoid
unsupported overhangs steeper than about 45 degrees where you reasonably can,
and keep features above 0.8 mm so the nozzle can resolve them.`.trim()

export const PLAYGROUND_CONTEXT = `
The result will be previewed in 3D and may then be exported for printing or
taken into a CNC workflow, so it must be a single well-formed solid.`.trim()
