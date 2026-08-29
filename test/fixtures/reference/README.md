# Reference geometry fixture

`systainer-75-pocket.json` is a regression fixture ShapePilot generates from its
own pipeline. It replaces the pinned Hearth test that compared against a printed
STL sitting in one developer's OneDrive folder: that file is not in the
repository, is not licensed for redistribution, and made the suite pass or skip
depending on the machine.

The fixture pins the values that a geometry regression would move:

| Field | Why it is here |
|---|---|
| `triangleCount`, `vertexCount`, `uniqueVertexCount` | A change in welding, collinear pruning or T-junction repair moves these. |
| `bbox` | The 248 × 156 × 12.4 mm Systainer S76 footprint. |
| `volumeMm3` | Divergence-theorem volume; catches inverted windings and lost cavities. |
| `danglingEdges` | Must stay 0 — the mesh is watertight. |
| `stlBytes` | The binary-STL contract, `84 + 50n`. |
| `vertexSetSha256` | SHA-256 over the sorted set of vertices quantized to `QUANTUM` (1e-4 mm). |

The vertex hash is deliberately quantized and order-independent. Triangle
ordering depends on earcut's fan choices and raw coordinates depend on the
platform's `Math.cos`/`Math.sin`, which are implementation-defined to about one
ULP. Quantizing to 1e-4 mm — nine orders of magnitude above that noise — makes
the fixture stable across machines while still failing on any real geometry
change.

## Regenerating

Only regenerate after a deliberate, reviewed geometry change, and state the
reason in the commit message. The generator lives in the test itself:

```
node --input-type=module -e "$(sed -n '/BEGIN GENERATOR/,/END GENERATOR/p' \
  ../../parity/referenceGeometry.test.ts)"
```

In practice: run the suite, read the actual values from the failure, and update
this fixture only if the new numbers are the intended ones.
