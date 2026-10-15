// launchd agents: one watches Downloads and runs intake + sync, one keeps the
// local helper running. Installed per user into ~/Library/LaunchAgents.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const AGENTS = join(homedir(), 'Library/LaunchAgents')
const LOGS = join(homedir(), 'Library/Logs/workshop-library')
export const RUN_LABEL = 'com.nintek.workshop-library.run'
export const HELPER_LABEL = 'com.nintek.workshop-library.helper'

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function plist({ label, args, watchPaths = [], interval = null, keepAlive = false }) {
  const array = (items) => `<array>${items.map((i) => `\n      <string>${escape(i)}</string>`).join('')}\n    </array>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    ${array(args)}
${watchPaths.length ? `    <key>WatchPaths</key>\n    ${array(watchPaths)}\n` : ''}${interval ? `    <key>StartInterval</key>\n    <integer>${interval}</integer>\n` : ''}${keepAlive ? '    <key>KeepAlive</key>\n    <true/>\n' : ''}    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>15</integer>
    <key>ProcessType</key>
    <string>Background</string>
    <key>StandardOutPath</key>
    <string>${escape(join(LOGS, `${label}.log`))}</string>
    <key>StandardErrorPath</key>
    <string>${escape(join(LOGS, `${label}.log`))}</string>
  </dict>
</plist>
`
}

function launchctl(...args) {
  try {
    execFileSync('launchctl', args, { stdio: 'pipe' })
  } catch {
    // bootout of a not-loaded agent fails; that is fine.
  }
}

export function install(config) {
  const cli = fileURLToPath(new URL('../bin/library.mjs', import.meta.url))
  const node = process.execPath
  mkdirSync(AGENTS, { recursive: true })
  mkdirSync(LOGS, { recursive: true })
  const agents = [
    { label: RUN_LABEL, args: [node, cli, 'run'], watchPaths: config.intakeRoots.filter(existsSync), interval: 900 },
    { label: HELPER_LABEL, args: [node, cli, 'serve'], keepAlive: true },
  ]
  const uid = process.getuid()
  for (const agent of agents) {
    const path = join(AGENTS, `${agent.label}.plist`)
    launchctl('bootout', `gui/${uid}`, path)
    writeFileSync(path, plist(agent))
    launchctl('bootstrap', `gui/${uid}`, path)
  }
  return { agents: agents.map((a) => a.label), logs: LOGS }
}

export function uninstall() {
  const uid = process.getuid()
  for (const label of [RUN_LABEL, HELPER_LABEL]) {
    const path = join(AGENTS, `${label}.plist`)
    launchctl('bootout', `gui/${uid}`, path)
    if (existsSync(path)) unlinkSync(path)
  }
}
