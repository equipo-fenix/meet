/**
 * roomMessages.ts — Protocolo de mensajes DataChannel para moderación de sala LiveKit
 *
 * Todos los eventos de moderación que requieren señalización peer-to-peer
 * (levantar mano, invitaciones, notificaciones) viajan como DataMessages
 * sobre el DataChannel fiable de LiveKit.
 *
 * Las acciones server-side (silenciar pista, desactivar cámara) siguen
 * usando la API de administración de LiveKit vía /api/livekit-admin.
 */

export const MSG = {
  // Participante → host
  RAISE_HAND:               'RAISE_HAND',
  LOWER_HAND:               'LOWER_HAND',
  PARTICIPANT_ACCEPT_SPEAK: 'PARTICIPANT_ACCEPT_SPEAK',
  PARTICIPANT_DECLINE_SPEAK:'PARTICIPANT_DECLINE_SPEAK',
  PARTICIPANT_ACCEPT_CAMERA:'PARTICIPANT_ACCEPT_CAMERA',
  PARTICIPANT_DECLINE_CAMERA:'PARTICIPANT_DECLINE_CAMERA',

  // Host → participante (o broadcast)
  HOST_MUTED_YOU:            'HOST_MUTED_YOU',
  HOST_DISABLED_CAMERA:      'HOST_DISABLED_CAMERA',
  HOST_MUTED_ALL:            'HOST_MUTED_ALL',
  HOST_DISABLED_ALL_CAMERAS: 'HOST_DISABLED_ALL_CAMERAS',
  HOST_INVITE_SPEAK:         'HOST_INVITE_SPEAK',
  HOST_INVITE_CAMERA:        'HOST_INVITE_CAMERA',
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

export interface RoomMessage {
  type: MsgType;
  identity?: string; // identidad del participante objetivo o emisor
  name?: string;     // nombre para mostrar
  ts: number;        // timestamp en ms
}

export function encodeMsg(msg: RoomMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeMsg(payload: Uint8Array): RoomMessage | null {
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as RoomMessage;
  } catch {
    return null;
  }
}
