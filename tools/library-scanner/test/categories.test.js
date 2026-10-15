import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../src/config.js'
import { undoBatch } from '../src/fsops.js'
import {
  createCategory, deleteCategory, listCategoryDetails, mergeCategory, renameCategory,
} from '../src/categories.js'

function library() {
  const root = join(mkdtempSync(join(tmpdir(), 'library-categories-')), '3D Print')
  const model = (category, title, id) => {
    const dir = join(root, category, title)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${title}.stl`), 'solid x\nendsolid x')
    writeFileSync(join(dir, 'model.json'), JSON.stringify({ schema: 1, id, title, category, status: 'inbox' }))
  }
  model('Gridginity', 'Gridfinity bin', 'a1')
  model('Gridginity', 'Toolbox', 'a2')
  model('Skadis', 'Hook', 'b1')
  model('Skadis', 'Toolbox', 'b2')
  mkdirSync(join(root, '_Inbox'))
  mkdirSync(join(root, 'Review'))
  const config = { ...DEFAULT_CONFIG, libraryRoot: root, trashDir: join(root, '..', 'Trash') }
  return { root, config }
}

const category = (root, ...path) => JSON.parse(readFileSync(join(root, ...path, 'model.json'), 'utf8')).category

test('categories list with model counts, skipping legacy folders', () => {
  const { config } = library()
  assert.deepEqual(listCategoryDetails(config), [
    { name: '_Inbox', models: 0, protected: true },
    { name: 'Gridginity', models: 2, protected: false },
    { name: 'Skadis', models: 2, protected: false },
  ])
})

test('rename moves the folder, rewrites model.json, and undo restores both', () => {
  const { root, config } = library()
  const result = renameCategory(config, 'Gridginity', 'Gridfinity')
  assert.equal(result.models, 2)
  assert.ok(!existsSync(join(root, 'Gridginity')))
  assert.equal(category(root, 'Gridfinity', 'Toolbox'), 'Gridfinity')
  assert.equal(category(root, 'Gridfinity', 'Gridfinity bin'), 'Gridfinity')

  undoBatch(root, result.batch)
  assert.ok(!existsSync(join(root, 'Gridfinity')))
  assert.equal(category(root, 'Gridginity', 'Toolbox'), 'Gridginity')
})

test('a case-only rename works on a case-insensitive volume', () => {
  const { root, config } = library()
  renameCategory(config, 'Skadis', 'SKADIS')
  assert.ok(readdirSync(root).includes('SKADIS'))
  assert.equal(category(root, 'SKADIS', 'Hook'), 'SKADIS')
})

test('rename refuses clashes, reserved names and organizer-managed categories', () => {
  const { config } = library()
  assert.throws(() => renameCategory(config, 'Gridginity', 'skadis'), (err) => err.status === 409)
  assert.throws(() => renameCategory(config, 'Gridginity', '_Hidden'), (err) => err.status === 400)
  assert.throws(() => renameCategory(config, 'Gridginity', 'Review'), (err) => err.status === 400)
  assert.throws(() => renameCategory(config, 'Gridginity', '   '), (err) => err.status === 400)
  assert.throws(() => renameCategory(config, '_Inbox', 'Inbox'), (err) => err.status === 400)
  assert.throws(() => renameCategory(config, 'Nope', 'Other'), (err) => err.status === 404)
})

test('merge moves every model, keeps clashing folder names unique, removes the source, and undoes', () => {
  const { root, config } = library()
  const result = mergeCategory(config, 'Gridginity', 'Skadis')
  assert.equal(result.moved, 2)
  assert.ok(!existsSync(join(root, 'Gridginity')))
  assert.deepEqual(readdirSync(join(root, 'Skadis')).sort(), ['Gridfinity bin', 'Hook', 'Toolbox', 'Toolbox 2'])
  assert.equal(category(root, 'Skadis', 'Toolbox 2'), 'Skadis')
  assert.equal(category(root, 'Skadis', 'Gridfinity bin'), 'Skadis')

  undoBatch(root, result.batch)
  assert.deepEqual(readdirSync(join(root, 'Gridginity')).sort(), ['Gridfinity bin', 'Toolbox'])
  assert.deepEqual(readdirSync(join(root, 'Skadis')).sort(), ['Hook', 'Toolbox'])
  assert.equal(category(root, 'Gridginity', 'Toolbox'), 'Gridginity')
})

test('merging into the Inbox is allowed; merging out of it is not', () => {
  const { root, config } = library()
  mergeCategory(config, 'Skadis', '_Inbox')
  assert.equal(category(root, '_Inbox', 'Hook'), '_Inbox')
  assert.throws(() => mergeCategory(config, '_Inbox', 'Gridginity'), (err) => err.status === 400)
  assert.throws(() => mergeCategory(config, 'Gridginity', 'Gridginity'), (err) => err.status === 404 || err.status === 400)
})

test('create makes an empty category; delete removes it only when empty', () => {
  const { root, config } = library()
  const created = createCategory(config, 'Household')
  assert.ok(existsSync(join(root, 'Household')))
  assert.throws(() => createCategory(config, 'household'), (err) => err.status === 409)

  writeFileSync(join(root, 'Household', '.DS_Store'), 'x')
  deleteCategory(config, 'Household')
  assert.ok(!existsSync(join(root, 'Household')))
  assert.throws(() => deleteCategory(config, 'Skadis'), (err) => err.status === 409)
  assert.ok(existsSync(join(root, 'Skadis', 'Hook', 'Hook.stl')))
  assert.ok(created.batch)
})
