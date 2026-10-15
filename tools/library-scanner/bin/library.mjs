#!/usr/bin/env node
// The organizer / scanner CLI for ShapePilot's Library. Run it from the
// ShapePilot folder as `npm run library -- <command>`.
//
//   scan                      index every root, print totals
//   plan [out.json] [--intake] write the reorganization plan (nothing moves)
//   apply [plan] <ids...|--all> [--dry-run]
//   intake [--dry-run]        file settled downloads into _Inbox/ (or ShapePilot/)
//   connect <token> [--url=https://shapepilot.nintek.com]
//   sync                      pull app edits, scan, push index + plan to ShapePilot
//   run                       intake then sync (what the launchd agent runs)
//   serve                     local helper for the ShapePilot web app
//   install | uninstall       launchd agents (Downloads watcher + helper)
//   batches                   list logged batches
//   undo <batch> [--dry-run]  reverse one batch
//   status                    config + counts

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { CONFIG_PATH, loadConfig, saveConfig } from '../src/config.js'
import { ScanCache, scanAll } from '../src/scan.js'
import { applyPlan, buildPlan } from '../src/plan.js'
import { listBatches, undoBatch } from '../src/fsops.js'
import { planPath, runIntake, runSync } from '../src/run.js'
import { createHelper } from '../src/helper.js'
import { install, uninstall } from '../src/launchd.js'

const [command = 'help', ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((a) => a.startsWith('--')))
const option = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const args = rest.filter((a) => !a.startsWith('--'))
const dryRun = flags.has('--dry-run')
let config = loadConfig()

function scan(roots) {
  const cache = new ScanCache(config.cacheDir)
  const result = scanAll(config, {
    cache,
    roots,
    onProgress: (n) => {
      if (process.stderr.isTTY && n % 10 === 0) process.stderr.write(`\r  scanned ${n} files…`)
    },
  })
  if (process.stderr.isTTY) process.stderr.write('\r')
  return result
}

function printPlan(plan) {
  const s = plan.summary
  console.log(`Plan: ${s.models} models to file, ${s.moves} moves, ${s.extracts} ZIP entries to extract, ${s.trash} duplicates to Trash (${mb(s.trashBytes)})`)
  console.log(`Already organized: ${s.alreadyOrganized} model folders`)
  console.log('By destination:', Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))
  if (plan.skipped.length) console.log(`Skipped ${plan.skipped.length} paths (see plan.skipped)`)
}

function notify(message) {
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "ShapePilot Library"`])
  } catch {
    // Best effort: background sessions without a GUI cannot show notifications.
  }
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function reportIntake(result) {
  if (result.filed.length) console.log(`${dryRun ? '[dry run] ' : ''}Intake ${result.batch}: ${result.filed.join(', ')}`)
  for (const f of result.failed) console.log(`  ✗ ${f.title}: ${f.error}`)
  if (!dryRun && result.filed.length) notify(`${result.filed.length} new model${result.filed.length === 1 ? '' : 's'} in Inbox`)
}

switch (command) {
  case 'scan': {
    const started = Date.now()
    const { records, errors } = scan()
    const by = (key) => records.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {})
    console.log(`Scanned ${records.length} model files in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    console.log('By root type:', by('rootType'))
    console.log('By kind:', by('kind'))
    const dupes = Object.values(records.reduce((acc, r) => ((acc[r.sha256] ??= []).push(r), acc), {})).filter((g) => g.length > 1)
    console.log(`Exact duplicate groups: ${dupes.length} (${dupes.reduce((n, g) => n + g.length - 1, 0)} extra copies)`)
    if (errors.length) {
      console.log(`Parse problems: ${errors.length}`)
      for (const e of errors.slice(0, 10)) console.log(`  ${e.relPath}: ${e.error}`)
    }
    break
  }
  case 'plan': {
    const { records } = scan()
    const plan = buildPlan(config, records, { intakeOnly: flags.has('--intake') })
    const out = args[0] ?? planPath(config)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(plan, null, 2))
    printPlan(plan)
    console.log(`\nWrote ${out}\nNothing has been moved. Review it in ShapePilot → Library → Organize, or: npm run library -- apply "${out}" --all`)
    break
  }
  case 'apply': {
    const file = args[0] && existsSync(args[0]) ? args.shift() : planPath(config)
    if (!existsSync(file)) throw new Error(`No plan at ${file}; run "plan" first`)
    const plan = JSON.parse(readFileSync(file, 'utf8'))
    const ids = flags.has('--all') ? null : args
    if (ids && !ids.length) throw new Error('Pass model ids to apply, or --all')
    const result = applyPlan(config, plan, { ids, dryRun })
    const failed = result.results.filter((r) => !r.ok)
    console.log(`${dryRun ? '[dry run] ' : ''}Batch ${result.batch}: ${result.results.length - failed.length} models filed, ${result.ops} operations logged`)
    for (const f of failed) console.log(`  ✗ ${f.title}: ${f.error}`)
    if (!dryRun) console.log(`Undo with: npm run library -- undo ${result.batch}`)
    break
  }
  case 'intake': {
    const result = runIntake(config, { dryRun })
    if (!result.filed.length && !result.failed.length) console.log(result.waiting ? `Waiting for ${result.waiting} download(s) to finish.` : 'Nothing new in Downloads.')
    reportIntake(result)
    break
  }
  case 'connect': {
    if (!args[0]?.startsWith('spl1.')) throw new Error('Usage: connect <device token from ShapePilot → Settings → Library>')
    saveConfig({ deviceToken: args[0], ...(option('url') ? { serverUrl: option('url') } : {}) })
    console.log(`Saved to ${CONFIG_PATH}. Next: npm run library -- sync`)
    break
  }
  case 'sync': {
    const result = await runSync(config)
    console.log(`Synced ${result.models} models (${result.thumbsUploaded} new thumbnails, ${result.edits} edits pulled, ${result.missing} missing). Plan: ${result.planModels} models waiting to be organized.`)
    break
  }
  case 'run': {
    // Downloads can still be arriving when launchd fires; wait for them to settle.
    const cache = new ScanCache(config.cacheDir)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const result = runIntake(config, { cache })
      reportIntake(result)
      if (!result.waiting) break
      await sleep((config.settleSeconds + 5) * 1000)
    }
    if (config.deviceToken) {
      try {
        const result = await runSync(config, { cache })
        console.log(`[${new Date().toISOString()}] synced ${result.models} models`)
      } catch (err) {
        console.error(`[${new Date().toISOString()}] sync failed: ${err.message}`)
        process.exitCode = 1
      }
    }
    break
  }
  case 'serve': {
    const server = createHelper(config, {
      afterChange: () => {
        config = loadConfig()
      },
    })
    server.listen(config.helperPort, '127.0.0.1', () => console.log(`ShapePilot Library helper on http://localhost:${config.helperPort}`))
    break
  }
  case 'install': {
    const result = install(config)
    console.log(`Installed ${result.agents.join(', ')}. Logs: ${result.logs}`)
    console.log('macOS may ask once to allow Node to access Downloads and OneDrive — allow it.')
    break
  }
  case 'uninstall': {
    uninstall()
    console.log('Removed launchd agents.')
    break
  }
  case 'batches': {
    for (const b of listBatches(config.libraryRoot)) console.log(`${b.batch}  ${b.kind ?? ''}  ${b.ops} ops${b.undone ? '  (undone)' : ''}`)
    break
  }
  case 'undo': {
    if (!args[0]) throw new Error('Usage: undo <batch>')
    const n = undoBatch(config.libraryRoot, args[0], { dryRun })
    console.log(`${dryRun ? '[dry run] ' : ''}Reversed ${n} operations from ${args[0]}`)
    break
  }
  case 'status': {
    console.log(`Config: ${CONFIG_PATH}${existsSync(CONFIG_PATH) ? '' : ' (defaults)'}`)
    console.log(JSON.stringify({ ...config, deviceToken: config.deviceToken ? '••••' : null, categoryKeywords: undefined, legacyFolders: undefined }, null, 2))
    break
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
}
