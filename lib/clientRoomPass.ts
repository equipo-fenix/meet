/**
 * Lee únicamente el `sid` del sobre para saber qué puerta consultar.
 *
 * Esto NO autoriza nada: el cliente no conoce el secreto y no puede validar la
 * firma. Cada acción se envía junto con el pase completo y APEX sí verifica que
 * la firma sea válida y que `sid` corresponda a esa sesión.
 */
export function sessionIdHintFromPass(pass: string | null | undefined): string | undefined {
  if (!pass) return undefined;
  const parts = pass.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return undefined;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sid?: unknown };
    return typeof payload.sid === 'string' && payload.sid.trim() ? payload.sid.trim() : undefined;
  } catch {
    return undefined;
  }
}
