/**
 * /api/livekit-admin — Operaciones de moderación server-side sobre LiveKit
 *
 * Acciones disponibles:
 *   mute              — silencia el micrófono de un participante específico
 *   muteAll           — silencia todos los micrófonos de la sala
 *   disableCamera     — silencia (mutes) la cámara de un participante específico
 *   disableAllCameras — silencia todas las cámaras de la sala
 *
 * Nota: LiveKit no permite apagar forzosamente el dispositivo en el cliente —
 * solo puede silenciar la pista publicada a nivel servidor. El participante
 * recibe la notificación vía DataMessage desde el host.
 *
 * Nota de seguridad: En producción deberías validar que quien llama es realmente
 * el host (verificar el JWT del request). Por ahora, la ruta es accesible desde
 * el frontend del host.
 */

import { RoomServiceClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

const API_KEY    = process.env.LIVEKIT_API_KEY!;
const API_SECRET = process.env.LIVEKIT_API_SECRET!;
const LIVEKIT_URL = process.env.LIVEKIT_URL!;

function getServiceClient(): RoomServiceClient {
  const url = new URL(LIVEKIT_URL);
  url.protocol = 'https:';
  return new RoomServiceClient(url.origin, API_KEY, API_SECRET);
}

interface RequestBody {
  action: string;
  roomName: string;
  identity?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as RequestBody;
    const { action, roomName, identity } = body;

    if (!roomName) {
      return new NextResponse('Missing roomName', { status: 400 });
    }

    const svc = getServiceClient();

    switch (action) {
      case 'mute': {
        if (!identity) return new NextResponse('Missing identity', { status: 400 });
        const participant = await svc.getParticipant(roomName, identity);
        const audioTracks = participant.tracks.filter(
          t => Number(t.type) === 0 && !t.muted // 0 = AUDIO
        );
        await Promise.all(
          audioTracks.map(t => svc.mutePublishedTrack(roomName, identity, t.sid, true))
        );
        return new NextResponse(null, { status: 200 });
      }

      case 'muteAll': {
        const participants = await svc.listParticipants(roomName);
        await Promise.all(
          participants.flatMap(p =>
            p.tracks
              .filter(t => Number(t.type) === 0 && !t.muted)
              .map(t => svc.mutePublishedTrack(roomName, p.identity, t.sid, true).catch(() => {}))
          )
        );
        return new NextResponse(null, { status: 200 });
      }

      case 'disableCamera': {
        if (!identity) return new NextResponse('Missing identity', { status: 400 });
        const participant = await svc.getParticipant(roomName, identity);
        const videoTracks = participant.tracks.filter(
          t => Number(t.type) === 1 && !t.muted // 1 = VIDEO
        );
        await Promise.all(
          videoTracks.map(t => svc.mutePublishedTrack(roomName, identity, t.sid, true))
        );
        return new NextResponse(null, { status: 200 });
      }

      case 'disableAllCameras': {
        const participants = await svc.listParticipants(roomName);
        await Promise.all(
          participants.flatMap(p =>
            p.tracks
              .filter(t => Number(t.type) === 1 && !t.muted)
              .map(t => svc.mutePublishedTrack(roomName, p.identity, t.sid, true).catch(() => {}))
          )
        );
        return new NextResponse(null, { status: 200 });
      }

      default:
        return new NextResponse('Unknown action', { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[livekit-admin] error:', msg);
    return new NextResponse(msg, { status: 500 });
  }
}
