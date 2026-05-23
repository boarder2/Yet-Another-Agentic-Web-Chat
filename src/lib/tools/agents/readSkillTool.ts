import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { getSkillForRun } from '@/lib/skills/runStore';

const ReadSkillSchema = z.object({
  name: z.string().describe('The skill name to load.'),
});

export const readSkillTool = tool(
  async (
    input: z.infer<typeof ReadSkillSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const runId = config?.configurable?.runId as string | undefined;

    if (!runId) {
      return 'Error: No run context available.';
    }

    const skill = getSkillForRun(runId, input.name);
    if (!skill) {
      console.warn(
        `[skills] read_skill: unknown skill "${input.name}" (runId=${runId})`,
      );
      return `Error: Unknown skill "${input.name}". Only skills listed in the Available Skills section can be loaded.`;
    }

    console.log(
      `[skills] Loaded ${skill.source} skill "${skill.name}" (${skill.content.length} chars, runId=${runId})`,
    );

    return skill.content;
  },
  {
    name: 'read_skill',
    description:
      'Load the full body of a skill by name. Only call with names listed in the ## Available Skills section.',
    schema: ReadSkillSchema,
  },
);
