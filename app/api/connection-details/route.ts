import { randomString } from '@/lib/client-utils';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { ConnectionDetails } from '@/lib/types';
import { verifyRoomPass, roomPassEnforced, sessionIdFromVerifiedPass } from '@/lib/roomPass';
import { AccessToken, AccessTokenOptions, VideoGrant } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

const COOKIE_KEY = 'random-participant-postfix';

export async function GET(request: NextRequest) {
  try {
    const roomName = request.nextUrl.searchParams.get('roomName');
    const participantName = request.nextUrl.searchParams.get('participantName');
    const metadata = request.nextUrl.searchParams.get('metadata') ?? '';
    const region = request.nextUrl.searchParams.get('region');

    if (!LIVEKIT_URL) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;
    let randomParticipantPostfix = request.cookies.get(COOKIE_KEY)?.value;
    if (livekitServerUrl === undefined) {
      throw new Error('Invalid region');
    }

    if (typeof roomName !== 'string') {
      return new NextResponse('Missing required query parameter: roomName', { status: 400 });
    }
    if (participantName === null) {
      return new NextResponse('Missing required query parameter: participantName', { status: 400 });
    }

    if (!randomParticipantPostfix) {
      randomParticipantPostfix = randomString(4);
    }

    // ── Quién entra y con qué permisos ─────────────────────────────────────
    // La respuesta viene del pase firmado por APEX, no de la URL. Antes el rol
    // se leía de ?role=host, que es como dejar que el visitante se ponga él
    // mismo la credencial de anfitrión.
    const pass = request.nextUrl.searchParams.get('pass');
    const passCheck = verifyRoomPass(pass, roomName);
    const enforced = roomPassEnforced();

    if (enforced && !passCheck.valid) {
      // Sin pase válido no se abre la puerta. El mensaje es deliberadamente
      // parco: no le decimos a quien prueba llaves cuál falló y por qué.
      return new NextResponse(
        JSON.stringify({ error: 'room_pass_required', reason: passCheck.reason }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Periodo de transición: mientras FENIX_ROOM_ENFORCE no esté en '1', las
    // salas siguen abiertas como antes para no cortar sesiones en curso. El
    // rol de anfitrión, en cambio, ya solo lo concede el pase — salvo en ese
    // mismo periodo de transición, donde se acepta el enlace antiguo.
    const legacyHostParam = !enforced && request.nextUrl.searchParams.get('role') === 'host';
    const isHost = passCheck.valid ? passCheck.payload.h === 1 : legacyHostParam;
    const canPublish = passCheck.valid ? passCheck.payload.p !== 0 : true;

    // El nombre del pase manda: si APEX dice que quien entra es "Ana Ruiz", no
    // puede presentarse como otra persona escribiendo otro nombre en el lobby.
    const effectiveName =
      passCheck.valid && typeof passCheck.payload.n === 'string' && passCheck.payload.n.trim()
        ? passCheck.payload.n.trim()
        : participantName;

    // Embeber metadata con el rol — accesible desde el cliente via localParticipant.metadata
    let participantMetadata: Record<string, unknown> = { isHost };
    try {
      if (metadata) {
        const extra = JSON.parse(metadata);
        participantMetadata = { ...participantMetadata, ...extra };
      }
    } catch (_) {}

    const participantToken = await createParticipantToken(
      {
        identity: `${effectiveName}__${randomParticipantPostfix}`,
        name: effectiveName,
        metadata: JSON.stringify(participantMetadata),
      },
      roomName,
      isHost,
      canPublish,
    );

    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName: roomName,
      serverNowMs: Date.now(),
      // Sale del pase ya verificado. Aceptarlo desde la URL permitiría mezclar
      // la puerta de una sesión con la sala de otra.
      sessionId: sessionIdFromVerifiedPass(passCheck),
      participantToken: participantToken,
      participantName: effectiveName,
      isHost,
    };
    return new NextResponse(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${COOKIE_KEY}=${randomParticipantPostfix}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${getCookieExpirationTime()}`,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  isHost = false,
  canPublish = true,
) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  at.ttl = isHost ? '24h' : '8h';
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    // El anfitrión siempre puede publicar; al asistente se lo concede el pase.
    canPublish: isHost || canPublish,
    canPublishData: true,
    canSubscribe: true,
    ...(isHost && { roomAdmin: true }), // solo el host tiene control admin
  };
  at.addGrant(grant);
  return at.toJwt();
}

function getCookieExpirationTime(): string {
  var now = new Date();
  var time = now.getTime();
  var expireTime = time + 60 * 120 * 1000;
  now.setTime(expireTime);
  return now.toUTCString();
}
