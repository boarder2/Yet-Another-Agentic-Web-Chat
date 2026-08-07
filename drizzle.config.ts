import { defineConfig } from 'drizzle-kit';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || process.cwd();

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: path.join(DATA_DIR, 'db.sqlite'),
  },
  // Owned by LangGraph's SqliteSaver, not schema.ts — without this, push drops
  // them and any in-flight run's checkpoint with them.
  tablesFilter: ['!checkpoints', '!writes'],
});
