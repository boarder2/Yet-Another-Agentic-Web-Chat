import path from 'path';
import fs from 'fs';
import { UPLOADS_DIR } from '@/lib/dataDir';

export const getFileDetails = (fileId: string) => {
  const fileLoc = path.join(UPLOADS_DIR, fileId + '-extracted.json');

  const parsedFile = JSON.parse(fs.readFileSync(fileLoc, 'utf8'));

  return {
    name: parsedFile.title,
    fileId: fileId,
  };
};
