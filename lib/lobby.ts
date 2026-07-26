/**
 * La puerta, vista desde dentro de la sala
 *
 * Hasta ahora el anfitrión administraba la sala de espera desde APEX, en otra
 * pestaña: entraba a la sala por un lado y aprobaba gente por el otro. Nadie
 * trabaja así. Quien está dando una clase no va a estar cambiando de pestaña
 * para dejar entrar a un alumno.
 *
 * Así que las órdenes salen de aquí. Lo que las autoriza es el mismo pase
 * firmado con el que el anfitrión entró — dentro de la sala no hay sesión de
 * APEX que valga, el navegador está en otro dominio. APEX verifica la firma y
 * comprueba que el pase sea de anfitrión y de esta sesión antes de obedecer.
 */

const APEX_FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_APEX_FUNCTIONS_URL ??
  'https://cmblgqzezfzmqkhkunto.supabase.co/functions/v1';

export interface EsperandoFuera {
  visitor_key: string;
  display_name: string | null;
  origin: string;
  status: string;
  requested_at: string;
}

export interface EstadoPuerta {
  lobbyActive: boolean;
  roomOpen: boolean;
  admissionMode: 'open_all' | 'one_by_one';
  waiting: EsperandoFuera[];
}

async function llamar(accion: string, sessionId: string, pass: string, extra: object = {}) {
  const res = await fetch(`${APEX_FUNCTIONS_URL}/webinar-lobby`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: accion, session_id: sessionId, pass, ...extra }),
  });
  if (!res.ok) throw new Error(`lobby ${accion}: ${res.status}`);
  const data = await res.json();
  if (data?.ok !== true) throw new Error(`lobby ${accion}: ${data?.reason ?? 'sin motivo'}`);
  return data;
}

/** El anfitrión ha llegado. Crea la puerta si no existía — uno por uno. */
export function anunciarAnfitrion(sessionId: string, pass: string) {
  return llamar('host_arrived', sessionId, pass);
}

export async function leerPuerta(sessionId: string, pass: string): Promise<EstadoPuerta> {
  const data = await llamar('list', sessionId, pass);
  return {
    lobbyActive: Boolean(data.lobby_active),
    roomOpen: Boolean(data.room_open),
    admissionMode: data.admission_mode === 'one_by_one' ? 'one_by_one' : 'open_all',
    waiting: Array.isArray(data.waiting) ? data.waiting : [],
  };
}

export function decidir(
  sessionId: string,
  pass: string,
  visitorKey: string,
  decision: 'admit' | 'deny',
) {
  return llamar('decide', sessionId, pass, { visitor_key: visitorKey, decision });
}

export function abrirPuerta(sessionId: string, pass: string) {
  return llamar('open_room', sessionId, pass, { admission_mode: 'open_all' });
}
