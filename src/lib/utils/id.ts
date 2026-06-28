/**
 * Generate a unique id, preferring `crypto.randomUUID()` and falling back to a
 * timestamp + random suffix where crypto is unavailable. Shared by the
 * localStorage-backed preset stores (model + panel presets).
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
