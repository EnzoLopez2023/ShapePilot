import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpLog, renameTree, trash, undoBatch } from '../src/fsops.js'

test('a model folder goes to the Trash whole and undo brings it back', () => {
  const root = mkdtempSync(join(tmpdir(), 'library-fsops-'))
  try {
    const lib = join(root, 'library')
    const bin = join(root, 'Trash')
    const model = join(lib, 'For Sale', 'Stand')
    mkdirSync(join(model, 'plates'), { recursive: true })
    mkdirSync(bin)
    writeFileSync(join(model, 'model.json'), '{}')
    writeFileSync(join(model, 'plates', 'a.3mf'), 'mesh')

    const log = new OpLog(lib)
    const to = trash(log, model, bin, 'deleted from the Library')
    assert.equal(to, join(bin, 'Stand'))
    assert.ok(!existsSync(model))
    assert.equal(readFileSync(join(to, 'plates', 'a.3mf'), 'utf8'), 'mesh')

    undoBatch(lib, log.batch)
    assert.equal(readFileSync(join(model, 'plates', 'a.3mf'), 'utf8'), 'mesh')
    assert.ok(!existsSync(to))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('renameTree never moves onto something that exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'library-fsops-'))
  try {
    mkdirSync(join(root, 'a'))
    writeFileSync(join(root, 'a', 'x'), '1')
    mkdirSync(join(root, 'b'))
    writeFileSync(join(root, 'b', 'y'), '2')
    assert.throws(() => renameTree(join(root, 'a'), join(root, 'b')))
    assert.ok(existsSync(join(root, 'a', 'x')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
