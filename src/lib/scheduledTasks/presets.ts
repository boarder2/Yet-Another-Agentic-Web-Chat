export type Preset =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; hour: number; minute: number }
  | {
      kind: 'weekly';
      day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
      hour: number;
      minute: number;
    }
  | { kind: 'advanced'; expression: string };

/** Basic 5-field cron format check. Server-side API routes use cron's validateCronExpression() for full validation. */
function looksLikeCron(expr: string): boolean {
  return /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(expr.trim());
}

export function presetToCron(p: Preset): string {
  switch (p.kind) {
    case 'hourly':
      return `${p.minute} * * * *`;
    case 'daily':
      return `${p.minute} ${p.hour} * * *`;
    case 'weekly':
      return `${p.minute} ${p.hour} * * ${p.day}`;
    case 'advanced':
      if (!looksLikeCron(p.expression)) {
        throw new Error(`Invalid cron expression: ${p.expression}`);
      }
      return p.expression;
  }
}

export function cronToPreset(expr: string): Preset {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { kind: 'advanced', expression: expr };

  const [min, hour, dom, mon, dow] = parts;

  // Hourly: M * * * *
  if (hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const m = parseInt(min, 10);
    if (!isNaN(m) && String(m) === min) {
      return { kind: 'hourly', minute: m };
    }
  }

  // Daily: M H * * *
  if (dom === '*' && mon === '*' && dow === '*') {
    const m = parseInt(min, 10);
    const h = parseInt(hour, 10);
    if (!isNaN(m) && !isNaN(h) && String(m) === min && String(h) === hour) {
      return { kind: 'daily', hour: h, minute: m };
    }
  }

  // Weekly: M H * * D
  if (dom === '*' && mon === '*') {
    const m = parseInt(min, 10);
    const h = parseInt(hour, 10);
    const d = parseInt(dow, 10);
    if (
      !isNaN(m) &&
      !isNaN(h) &&
      !isNaN(d) &&
      String(m) === min &&
      String(h) === hour &&
      String(d) === dow &&
      d >= 0 &&
      d <= 6
    ) {
      return {
        kind: 'weekly',
        day: d as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        hour: h,
        minute: m,
      };
    }
  }

  return { kind: 'advanced', expression: expr };
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function describeCron(expr: string): string {
  const preset = cronToPreset(expr);
  const pad = (n: number) => String(n).padStart(2, '0');

  switch (preset.kind) {
    case 'hourly':
      return `Hourly at :${pad(preset.minute)}`;
    case 'daily':
      return `Daily at ${pad(preset.hour)}:${pad(preset.minute)}`;
    case 'weekly':
      return `${DAY_NAMES[preset.day]} at ${pad(preset.hour)}:${pad(preset.minute)}`;
    case 'advanced':
      return expr;
  }
}
