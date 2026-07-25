/**
 * Pase de sala — la prueba de que APEX autorizó a esta persona.
 *
 * El problema que resuelve: hasta ahora, quien conociera el nombre de una sala
 * podía ir directo a /rooms/<nombre> y el servidor le entregaba un token de
 * LiveKit sin preguntar nada. Y si añadía ?role=host a la URL, se llevaba
 * además permisos de administrador de la sala. El nombre de la sala era la
 * llave, y un nombre de sala se adivina o se reenvía.
 *
 * A partir de aquí la llave la firma APEX. El pase es un sobre corto y firmado
 * que dice: quién es, a qué sala va, si es anfitrión, si puede publicar, y
 * hasta cuándo vale. Esta sala solo lo lee y lo verifica — nunca lo emite.
 *
 * Formato:  v1.<base64url(payload)>.<base64url(hmac-sha256)>
 * Firma:    HMAC-SHA256( "v1." + payloadB64 , FENIX_ROOM_SECRET )
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RoomPassPayload {
  /** room — nombre de la sala a la que da acceso */
  r: string;
  /** name — nombre con el que entra la persona */
  n?: string;
  /** host — 1 si es anfitrión */
  h?: 0 | 1;
  /** publish — 1 si puede abrir micrófono/cámara */
  p?: 0 | 1;
  /** session id de APEX, para rastrear */
  sid?: string | null;
  /** expiración, epoch en segundos */
  exp: number;
}

export type RoomPassResult =
  | { valid: true; payload: RoomPassPayload }
  | {
      valid: false;
      reason: 'no_secret' | 'malformed' | 'bad_signature' | 'expired' | 'room_mismatch';
    };

function b64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(signingInput: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(signingInput).digest());
}

/**
 * Verifica un pase contra la sala pedida.
 *
 * `expectedRoom` no es opcional a propósito: un pase válido para otra sala no
 * debe abrir esta. Es el error clásico de estos esquemas.
 */
export function verifyRoomPass(
  pass: string | null | undefined,
  expectedRoom: string,
): RoomPassResult {
  const secret = process.env.FENIX_ROOM_SECRET;
  if (!secret) return { valid: false, reason: 'no_secret' };
  if (!pass || typeof pass !== 'string') return { valid: false, reason: 'malformed' };

  const parts = pass.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { valid: false, reason: 'malformed' };

  const [version, payloadB64, sigB64] = parts;
  const expected = sign(`${version}.${payloadB64}`, secret);

  // Comparación en tiempo constante: comparar firmas con === filtra secretos
  // por el reloj. Buffers de distinta longitud rompen timingSafeEqual, así que
  // se descarta antes.
  const a = Buffer.from(sigB64);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload: RoomPassPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (typeof payload?.r !== 'string' || typeof payload?.exp !== 'number') {
    return { valid: false, reason: 'malformed' };
  }
  if (payload.exp * 1000 <= Date.now()) return { valid: false, reason: 'expired' };
  if (payload.r !== expectedRoom) return { valid: false, reason: 'room_mismatch' };

  return { valid: true, payload };
}

/**
 * ¿Exigimos pase? Solo cuando hay secreto configurado Y el interruptor está
 * puesto. Así el despliegue puede ir por delante de la emisión de pases sin
 * dejar a nadie fuera: primero la sala aprende a leerlos, después se exigen.
 */
export function roomPassEnforced(): boolean {
  return Boolean(process.env.FENIX_ROOM_SECRET) && process.env.FENIX_ROOM_ENFORCE === '1';
}
