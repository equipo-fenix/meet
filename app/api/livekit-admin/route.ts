/**
 * /api/livekit-admin — Operaciones de moderación server-side sobre LiveKit
 *
 * Acciones disponibles:
 *   mute              — silencia el micrófono de un participante específico
 *   muteAll           — silencia todos los micrófonos de la sala
 *   disableCamera     — silencia (mutes) la cámara de un participante específico
 *   disableAllCameras — silencia todas las cámaras de la sala
 *   endSession        — termina la sesión para todos y cierra la grabación
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

import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { sessionIdFromVerifiedPass, verifyRoomPass, roomPassEnforced } from '@/lib/roomPass';

const API_KEY = process.env.LIVEKIT_API_KEY!;
const API_SECRET = process.env.LIVEKIT_API_SECRET!;
const LIVEKIT_URL = process.env.LIVEKIT_URL!;
const APEX_FUNCTIONS_URL =
  process.env.NEXT_PUBLIC_APEX_FUNCTIONS_URL ??
  'https://cmblgqzezfzmqkhkunto.supabase.co/functions/v1';

/** LIVEKIT_URL viene en `wss://`; la API de administración se habla por HTTPS. */
function httpOrigin(): string {
  const url = new URL(LIVEKIT_URL);
  url.protocol = 'https:';
  return url.origin;
}

function getServiceClient(): RoomServiceClient {
  return new RoomServiceClient(httpOrigin(), API_KEY, API_SECRET);
}

interface RequestBody {
  action: string;
  roomName: string;
  identity?: string;
  pass?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as RequestBody;
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
          (t) => Number(t.type) === 0 && !t.muted, // 0 = AUDIO
        );
        await Promise.all(
          audioTracks.map((t) => svc.mutePublishedTrack(roomName, identity, t.sid, true)),
        );
        return new NextResponse(null, { status: 200 });
      }

      case 'muteAll': {
        const participants = await svc.listParticipants(roomName);
        await Promise.all(
          participants.flatMap((p) =>
            p.tracks
              .filter((t) => Number(t.type) === 0 && !t.muted)
              .map((t) =>
                svc.mutePublishedTrack(roomName, p.identity, t.sid, true).catch(() => {}),
              ),
          ),
        );
        return new NextResponse(null, { status: 200 });
      }

      case 'disableCamera': {
        if (!identity) return new NextResponse('Missing identity', { status: 400 });
        const participant = await svc.getParticipant(roomName, identity);
        const videoTracks = participant.tracks.filter(
          (t) => Number(t.type) === 1 && !t.muted, // 1 = VIDEO
        );
        await Promise.all(
          videoTracks.map((t) => svc.mutePublishedTrack(roomName, identity, t.sid, true)),
        );
        return new NextResponse(null, { status: 200 });
      }

      case 'disableAllCameras': {
        const participants = await svc.listParticipants(roomName);
        await Promise.all(
          participants.flatMap((p) =>
            p.tracks
              .filter((t) => Number(t.type) === 1 && !t.muted)
              .map((t) =>
                svc.mutePublishedTrack(roomName, p.identity, t.sid, true).catch(() => {}),
              ),
          ),
        );
        return new NextResponse(null, { status: 200 });
      }

      case 'endSession': {
        // Terminar una sesión es una sola cosa vista desde fuera y dos por
        // dentro, y el orden importa: primero se cierra la grabación, después
        // se vacía la sala. Al revés, el egress se queda grabando una sala sin
        // nadie y el archivo termina con minutos de negro al final.
        //
        // Los dos pasos se intentan pase lo que pase. Si la grabación falla al
        // cerrarse, la sala se vacía igual — que el anfitrión no pueda terminar
        // su clase porque un egress se atascó sería peor que un archivo mal
        // cerrado, que además se puede arreglar después.
        const problemas: string[] = [];

        try {
          const egress = new EgressClient(httpOrigin(), API_KEY, API_SECRET);
          const activas = (await egress.listEgress({ roomName })).filter((info) => info.status < 2);
          await Promise.all(
            activas.map((info) =>
              egress.stopEgress(info.egressId).catch((e) => {
                problemas.push(`egress ${info.egressId}: ${e?.message ?? e}`);
              }),
            ),
          );
        } catch (e) {
          problemas.push(`grabación: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Borrar la sala desconecta a todo el mundo a la vez. No hay que
        // recorrer participantes ni confiar en que cada cliente se entere:
        // el servidor los suelta y cada uno cae en la pantalla de salida.
        try {
          await svc.deleteRoom(roomName);
        } catch (e) {
          return NextResponse.json(
            {
              ok: false,
              error: `No se pudo cerrar la sala: ${e instanceof Error ? e.message : String(e)}`,
              problemas,
            },
            { status: 500 },
          );
        }

        const sessionId = sessionIdFromVerifiedPass(passCheck);
        if (sessionId) {
          try {
            const apexRes = await fetch(`${APEX_FUNCTIONS_URL}/webinar-session-finalize`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: sessionId,
                pass,
                room_closed_by_meet: true,
              }),
            });
            if (!apexRes.ok) {
              const detail = await apexRes.text().catch(() => apexRes.statusText);
              problemas.push(`apex: ${apexRes.status} ${detail.slice(0, 200)}`);
            } else {
              const apexJson = (await apexRes.json().catch(() => null)) as {
                sala?: { problemas?: string[] };
              } | null;
              if (Array.isArray(apexJson?.sala?.problemas)) {
                problemas.push(...apexJson.sala.problemas);
              }
            }
          } catch (e) {
            problemas.push(`apex: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        return NextResponse.json({ ok: true, problemas });
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
