import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface PreflightResult {
  ok: boolean;
  problems: string[];
}

export function preflightProject(cwd: string): PreflightResult {
  const problems: string[] = [];
  const packagePath = join(cwd, 'package.json');
  const modulesPath = join(cwd, 'node_modules');
  const configPath = join(cwd, 'config.toml');

  if (!isFile(packagePath)) {
    problems.push(`Missing ${packagePath}.`);
  } else {
    try {
      const packageJson: unknown = JSON.parse(
        readFileSync(packagePath, 'utf8'),
      );
      if (typeof packageJson !== 'object' || packageJson === null) {
        problems.push(`${packagePath} is not a JSON object.`);
      }
    } catch {
      problems.push(`${packagePath} is not valid JSON.`);
    }
  }

  if (!isDirectory(modulesPath)) {
    problems.push(
      `Missing ${modulesPath}; install dependencies before starting.`,
    );
  }
  if (!isFile(configPath)) {
    problems.push(`Missing ${configPath}; create it before starting.`);
  }

  return { ok: problems.length === 0, problems };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
