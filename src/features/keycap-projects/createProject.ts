// Starting a project, from either place that can: the projects list or the
// designer's gate.
//
// A project is never tray-less. It opens with copies of the four trays in the
// owner's "Sample Tray" project, named after the new project; where there is no
// sample to copy, it gets one blank tray instead.
import * as api from './service.ts'
import * as trays from '../keycap-tray/service.ts'
import { emptyDesign } from '../keycap-tray/model/presets.ts'
import { pickStarterTrays, starterTrayName } from './model/starterTrays.ts'

export interface CreatedProject {
  id: string
  /**
   * Set when the project exists but its trays did not all arrive, worded for a
   * toast. The project is still worth opening: trays can be added from its page.
   */
  warning?: string
}

export async function createProjectWithTrays(name: string): Promise<CreatedProject> {
  const { id } = await api.createProject({ name })

  let starters: ReturnType<typeof pickStarterTrays>
  try {
    starters = pickStarterTrays(await trays.listDesigns())
  } catch {
    return { id, warning: 'Project created — add a tray from the project page' }
  }

  if (starters.length === 0) {
    try {
      await trays.createDesign({ ...emptyDesign(), name: 'Tray 1' }, id)
      return { id }
    } catch {
      return { id, warning: 'Project created — add a tray from the project page' }
    }
  }

  // One at a time, so the copies are created in stack order.
  let copied = 0
  for (const { sourceId, label } of starters) {
    try {
      await trays.cloneDesign(sourceId, starterTrayName(name, label), id)
      copied += 1
    } catch { /* counted below */ }
  }
  if (copied === starters.length) return { id }
  return {
    id,
    warning: copied === 0
      ? 'Project created — add a tray from the project page'
      : `Project created — only ${copied} of ${starters.length} sample trays were copied`,
  }
}
