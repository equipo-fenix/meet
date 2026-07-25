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
 * Autorización: cada orden llega acompañada del pase firmado por APEX con el
 * que entró el anfitrión. Se comprueba que el pase sea válido, que sea de
 * anfitrión y que corresponda a ESTA sala. Sin eso, callar a una sala entera
 * era cuestión de mandar un POST.
 */

import { RoomServiceClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { verifyRoomPass, roomPassEnforced } from '@/lib/roomPass';

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
  pass?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as RequestBody;
    const { action, roomName, identity, pass } = body;

    if (!roomName) {
      return new NextResponse('Missing roomName', { status: 400 });
    }

    // Solo el anfitrión de esta sala manda aquí.
    const passCheck = verifyRoomPass(pass, roomName);
    const isHost = passCheck.valid && passCheck.payload.h === 1;
    if (!isHost && roomPassEnforced()) {
      return new NextResponse('Not a host of this room', { status: 403 });
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
