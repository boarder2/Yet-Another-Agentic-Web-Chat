let _counter = 0;

export function uid(): string {
  return crypto.randomUUID();
}

export function uniq(prefix: string): string {
  _counter++;
  return `${prefix}-${Date.now()}-${_counter}`;
}
