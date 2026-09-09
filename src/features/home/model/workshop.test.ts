import { describe, expect, test } from 'vitest'
import { describeWhen, summarise } from './workshop.ts'
import type { ProjectSummary } from '../../keycap-projects/model/types.ts'
import type { DesignSummary } from '../../keycap-tray/service.ts'
import type { DocumentSummary } from '../../../services/designDocuments.ts'
import type { SwitchTraySummary } from '../../switch-tray/service.ts'
import type { ToolTraySummary } from '../../tool-tray/service.ts'

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: '1', name: 'Set', capCount: 70, trayCount: 2, photoCount: 1,
  createdAt: '2026-08-01 10:00:00', updatedAt: '2026-08-01 10:00:00', ...over,
})

const tray = (over: Partial<DesignSummary> = {}): DesignSummary => ({
  id: '1', projectId: null, projectName: null, name: 'Tray', profileKind: 'preset',
  pocketCount: 18, createdAt: '2026-08-01 10:00:00', updatedAt: '2026-08-01 10:00:00', ...over,
})

const doc = (over: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: '1', kind: 'bambu', name: 'Bracket', objectCount: 4,
  createdAt: '2026-08-01 10:00:00', updatedAt: '2026-08-01 10:00:00', ...over,
})

const switchTray = (over: Partial<SwitchTraySummary> = {}): SwitchTraySummary => ({
  id: '1', name: 'MX spares', profileKind: 'preset', switchLabel: 'Cherry MX',
  createdAt: '2026-08-01 10:00:00', updatedAt: '2026-08-01 10:00:00', ...over,
})

const toolTray = (over: Partial<ToolTraySummary> = {}): ToolTraySummary => ({
  id: '1', name: 'X2D tools', profileKind: 'preset', pocketCount: 12,
  createdAt: '2026-09-08 10:00:00', updatedAt: '2026-09-08 10:00:00', ...over,
})

describe('summarise', () => {
  test('counts what the workshop holds across every store', () => {
    const result = summarise({
      projects: [project({ capCount: 70 }), project({ id: '2', capCount: 30 })],
      trays: [tray({ pocketCount: 18 }), tray({ id: '2', pocketCount: 29 })],
      documents: [doc({ objectCount: 4 }), doc({ id: '2', kind: 'shaper', objectCount: 7 })],
      switchTrays: [switchTray()],
      toolTrays: [toolTray({ pocketCount: 12 })],
    })
    expect(result.totals).toEqual({
      projects: 2, trays: 2, pockets: 47, switchTrays: 1, toolTrays: 1, objects: 11, caps: 100,
    })
    expect(result.empty).toBe(false)
  })

  test('a switch tray can be the latest work, and links to itself by id', () => {
    const result = summarise({
      trays: [tray({ updatedAt: '2026-08-30 09:00:00' })],
      documents: [doc({ updatedAt: '2026-08-30 12:00:00' })],
      switchTrays: [switchTray({ id: '7', updatedAt: '2026-09-01 09:00:00' })],
    })
    expect(result.latest).toMatchObject({
      kind: 'switch-tray', name: 'MX spares', href: '/switch-tray/7', context: 'Cherry MX',
    })
  })

  test('switch trays alone are not emptiness', () => {
    expect(summarise({ switchTrays: [switchTray()] }).empty).toBe(false)
  })

  test('the latest work is the most recently touched of either kind', () => {
    const result = summarise({
      trays: [tray({ updatedAt: '2026-08-30 09:00:00' })],
      documents: [doc({ updatedAt: '2026-08-31 18:00:00', name: 'Bracket' })],
    })
    expect(result.latest).toMatchObject({ kind: 'bambu', name: 'Bracket', href: '/bambu-designer' })
  })

  test('a tray links to itself by id, so Resume opens that tray', () => {
    const result = summarise({ trays: [tray({ id: '7', name: 'Top tray', projectName: 'Womier' })] })
    expect(result.latest).toMatchObject({
      kind: 'tray', href: '/keycap-tray/7', context: 'Womier', pieces: 18,
    })
  })

  test('a tie goes to the tray, the capability this bench was built around', () => {
    const when = '2026-08-31 12:00:00'
    const result = summarise({ trays: [tray({ updatedAt: when })], documents: [doc({ updatedAt: when })] })
    expect(result.latest?.kind).toBe('tray')
  })

  test('a tool tray can be the latest work, and reports its pockets', () => {
    const result = summarise({
      trays: [tray({ updatedAt: '2026-08-30 09:00:00' })],
      toolTrays: [toolTray({ id: '9', updatedAt: '2026-09-09 09:00:00', pocketCount: 12 })],
    })
    expect(result.latest).toMatchObject({
      kind: 'tool-tray', name: 'X2D tools', href: '/tool-tray/9', pieces: 12,
    })
  })

  test('tool trays alone are not emptiness', () => {
    expect(summarise({ toolTrays: [toolTray()] }).empty).toBe(false)
  })

  test('a four-way tie still goes to the keycap tray', () => {
    // The rank, not the order the sources happen to be listed in.
    const when = '2026-09-09 12:00:00'
    const result = summarise({
      trays: [tray({ updatedAt: when })],
      documents: [doc({ updatedAt: when })],
      switchTrays: [switchTray({ updatedAt: when })],
      toolTrays: [toolTray({ updatedAt: when })],
    })
    expect(result.latest?.kind).toBe('tray')
  })

  test('with no keycap tray, a tie goes to the switch tray then the tool tray', () => {
    const when = '2026-09-09 12:00:00'
    expect(summarise({
      documents: [doc({ updatedAt: when })],
      switchTrays: [switchTray({ updatedAt: when })],
      toolTrays: [toolTray({ updatedAt: when })],
    }).latest?.kind).toBe('switch-tray')
    expect(summarise({
      documents: [doc({ updatedAt: when })],
      toolTrays: [toolTray({ updatedAt: when })],
    }).latest?.kind).toBe('tool-tray')
  })

  test('an empty workshop says so rather than showing zeroes as achievement', () => {
    const result = summarise()
    expect(result.empty).toBe(true)
    expect(result.latest).toBeNull()
    expect(result.totals.pockets).toBe(0)
  })

  test('projects alone are not emptiness', () => {
    // A described set with nothing cut for it yet is a real state.
    expect(summarise({ projects: [project()] }).empty).toBe(false)
  })
})

describe('describeWhen', () => {
  const now = Date.parse('2026-08-31T12:00:00Z')

  test('reads as a person would say it', () => {
    expect(describeWhen('2026-08-31 11:59:30', now)).toBe('just now')
    expect(describeWhen('2026-08-31 11:40:00', now)).toBe('20 minutes ago')
    expect(describeWhen('2026-08-31 09:00:00', now)).toBe('3 hours ago')
    expect(describeWhen('2026-08-30 12:00:00', now)).toBe('yesterday')
    expect(describeWhen('2026-08-28 12:00:00', now)).toBe('3 days ago')
  })

  test('an older date is a date, not a growing pile of days', () => {
    expect(describeWhen('2026-07-04 12:00:00', now)).toMatch(/July/)
  })

  test('the stored form is UTC without a marker, and is read as UTC', () => {
    // SQLite writes datetime('now'); reading it as local time would report
    // work done minutes ago as hours old, or in the future.
    expect(describeWhen('2026-08-31 12:00:00', now)).toBe('just now')
  })

  test('an unparseable value is shown as it came rather than as a wrong date', () => {
    expect(describeWhen('who knows', now)).toBe('who knows')
  })
})
