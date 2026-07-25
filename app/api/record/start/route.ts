import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { verifyRoomPass, roomPassEnforced } from '@/lib/roomPass';

/**
 * Arrancar la grabación de una sesión
 *
 * Dos cosas cambiaron aquí respecto al original de LiveKit.
 *
 * La primera es la puerta: esta ruta no autenticaba a nadie, y el propio
 * ejemplo advertía que no se usara así en producción. Ahora exige el pase de
 * anfitrión de esta misma sala.
 *
 * La segunda es el destino. El archivo va al bucket de Supabase, que habla S3
 * pero solo en modo path-style — el bucket viaja en la ruta, no en el nombre
 * del dominio. Sin `forcePathStyle` el egress arranca, corre entero y falla al
 * subir: media hora de clase perdida sin que nadie vea un error.
 *
 * El nombre del archivo tampoco es decorativo. Como el nombre de la sala es el
 * id de la sesión, guardar en `sesiones/<id>/<fecha>.mp4` deja la grabación en
 * un sitio que APEX puede encontrar solo con el id, sin que ningún servicio
 * tenga que avisarle a otro de que existe.
 */
export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    // Solo el anfitrión graba.
    const passCheck = verifyRoomPass(req.nextUrl.searchParams.get('pass'), roomName);
    if (!(passCheck.valid && passCheck.payload.h === 1) && roomPassEnforced()) {
      return new NextResponse('Not a host of this room', { status: 403 });
    }

    const {
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      LIVEKIT_URL,
      S3_KEY_ID,
      S3_KEY_SECRET,
      S3_BUCKET,
      S3_ENDPOINT,
      S3_REGION,
      // Supabase Storage exige path-style. Un S3 de verdad, no.
      S3_FORCE_PATH_STYLE,
    } = process.env;

    // Mejor un error claro ahora que un egress que corre media hora y no sube
    // nada. Eso es exactamente lo que llevaba meses pasando en silencio.
    const faltantes = Object.entries({ S3_KEY_ID, S3_KEY_SECRET, S3_BUCKET, S3_ENDPOINT })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (faltantes.length > 0) {
      return new NextResponse(
        `Almacenamiento de grabaciones sin configurar: falta ${faltantes.join(', ')}`,
        { status: 503 },
      );
    }

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const existingEgresses = await egressClient.listEgress({ roomName });
    if (existingEgresses.length > 0 && existingEgresses.some((e) => e.status < 2)) {
      return new NextResponse('Meeting is already being recorded', { status: 409 });
    }

    const fileOutput = new EncodedFileOutput({
      filepath: `sesiones/${roomName}/${new Date().toISOString()}.mp4`,
      output: {
        case: 's3',
        value: new S3Upload({
          endpoint: S3_ENDPOINT,
          accessKey: S3_KEY_ID,
          secret: S3_KEY_SECRET,
          region: S3_REGION || 'us-east-1',
          bucket: S3_BUCKET,
          forcePathStyle: S3_FORCE_PATH_STYLE !== 'false',
        }),
      },
    });

    const info = await egressClient.startRoomCompositeEgress(
      roomName,
      { file: fileOutput },
      { layout: 'speaker' },
    );

    return NextResponse.json({ egressId: info.egressId }, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
    return new NextResponse('Error desconocido al iniciar la grabación', { status: 500 });
  }
}
