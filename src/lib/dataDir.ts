import path from 'path';
import fs from 'fs';

export const DATA_DIR =
  process.env.DATA_DIR ?? path.join(process.cwd(), 'data');

export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const WORKSPACE_FILES_ROOT = path.join(DATA_DIR, 'workspace-files');
export const DB_PATH = path.join(DATA_DIR, 'db.sqlite');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_FILES_ROOT, { recursive: true });
