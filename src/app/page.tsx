/**
 * Home is your desk, not the dashboard.
 *
 * The same engine state, cut for whoever is looking: a project manager gets the questions on their jobs, an
 * accountant gets a prioritised list of their own items, the Controller gets what needs a signature and
 * then the portfolio, and the CFO gets the Command Center. The persona comes from the demo switcher — not
 * authentication — and every number on every version is the calculation layer's, never the view's.
 */

import { canonical, engineState } from '@/workflows/engine';
import { openTasksForPerson } from '@/workflows/replay';
import { currentPersona } from '@/components/personaServer';
import { currentLedger } from '@/components/ledgerServer';
import { CommandCenter } from '@/components/desk/CommandCenter';
import { ControllerDesk } from '@/components/desk/ControllerDesk';
import { TaskDesk } from '@/components/desk/TaskDesk';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { persona } = await currentPersona();
  const state = engineState(await currentLedger());
  const model = canonical();
  const tasks = openTasksForPerson(state, persona.personId);

  switch (persona.role) {
    case 'Project Manager': {
      const managed = model.projects.filter((p) => p.projectManagerId === persona.personId);
      return (
        <TaskDesk
          persona={persona}
          tasks={tasks}
          state={state}
          model={model}
          intro={
            managed.length > 0
              ? `Your jobs: ${managed.map((p) => p.name).join(', ')}. The finance team only asks you what the systems cannot tell them.`
              : undefined
          }
        />
      );
    }
    case 'Project Accountant':
      return (
        <TaskDesk
          persona={persona}
          tasks={tasks}
          state={state}
          model={model}
          intro="Each item comes with the records behind it and a proposed answer — confirm it, change it, or say why no change is needed."
        />
      );
    case 'Controller':
      return <ControllerDesk persona={persona} tasks={tasks} state={state} model={model} />;
    case 'CFO':
      return <CommandCenter state={state} model={model} />;
    default: {
      // A new role must choose a desk; a blank page is not an acceptable default.
      const exhaustive: never = persona.role;
      return exhaustive;
    }
  }
}
