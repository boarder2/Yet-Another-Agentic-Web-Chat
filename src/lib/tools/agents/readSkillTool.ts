import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { getRunContext } from '@/lib/skills/runStore';
import { persistFromToolConfig } from '@/lib/utils/persistToolContext';

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
      return JSON.stringify({ error: 'No run context available.' });
    }

    const ctx = getRunContext(runId);
    const skill = ctx?.skills.get(input.name);
    if (!skill) {
      console.warn(
        `[skills] read_skill: unknown skill "${input.name}" (runId=${runId})`,
      );
      return JSON.stringify({
        error: `Unknown skill "${input.name}". Only skills listed in the Available Skills section can be loaded.`,
      });
    }

    console.log(
      `[skills] Loaded ${skill.source} skill "${skill.name}" (${skill.content.length} chars, runId=${runId})`,
    );

    await persistFromToolConfig({
      config,
      kind: 'skill_invocation',
      body: `[Skill "${input.name}" loaded by agent]\n${skill.content}`,
      metadataExtras: { skillName: input.name },
    });

    return skill.content;
  },
  {
    name: 'read_skill',
    description:
      'Load the full body of a skill by name. Only call with names listed in the ## Available Skills section.',
    schema: ReadSkillSchema,
  },
);
