import { mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
}
const pinnedDriver = packageJson.dependencies?.['better-sqlite3']
if (pinnedDriver !== '12.4.1') {
  throw new Error(
    'native SQLite file identity is audited only for better-sqlite3 12.4.1; '
    + 'review the SQLite file-prefix layout before changing that version',
  )
}
const installedPackage = JSON.parse(readFileSync(
  join(root, 'node_modules', 'better-sqlite3', 'package.json'),
  'utf8',
)) as { version?: string }
if (installedPackage.version !== pinnedDriver) {
  throw new Error(
    `installed better-sqlite3 is ${installedPackage.version ?? 'unknown'}, expected ${pinnedDriver}; `
    + 'run npm install before building the native guard',
  )
}

const source = join(root, 'native', 'sqlite-file-identity.c')
const include = join(root, 'node_modules', 'better-sqlite3', 'deps', 'sqlite3')
const extension = process.platform === 'win32'
  ? 'dll'
  : process.platform === 'darwin'
    ? 'dylib'
    : 'so'
const output = join(root, 'native', 'build', `sqlite-file-identity.${extension}`)
mkdirSync(dirname(output), { recursive: true })

const command = process.platform === 'win32' ? 'cl' : process.env.CC ?? 'cc'
const args = process.platform === 'win32'
  ? ['/nologo', '/LD', `/I${include}`, source, `/Fe:${output}`]
  : process.platform === 'darwin'
    ? ['-std=c11', '-O2', '-fPIC', '-dynamiclib', '-undefined', 'dynamic_lookup',
        `-I${include}`, source, '-o', output]
    : ['-std=c11', '-O2', '-fPIC', '-shared', `-I${include}`, source, '-o', output]

const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
if (result.status !== 0) {
  throw new Error(
    `could not build the SQLite file-identity guard with ${command}:\n`
    + `${result.stdout}${result.stderr}`,
  )
}
