import * as React from 'react';
import { ClientOnlyRoom } from './ClientOnlyRoom';
import { isVideoCodec } from '@/lib/types';
import { parseIntroRef } from '@/lib/vimeoIntro';
import { verifyRoomPass } from '@/lib/roomPass';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    region?: string;
    hq?: string;
    codec?: string;
    singlePC?: string;
    role?: string; // 'host' | 'attendee'
    // APEX manda la identidad y las preferencias del lobby para que la persona
    // no tenga que escribir su nombre otra vez ni volver a elegir dispositivos.
    name?: string;
    mic?: string;
    cam?: string;
    // Pase firmado por APEX. Es lo único que concede rol de anfitrión.
    pass?: string;
    // Cortinilla de apertura. `intro` es la referencia del video en Vimeo
    // (`id` o `id:hash`) — nunca una URL, para que nadie de fuera pueda
    // decidir qué se proyecta en el escenario de una clase.
    intro?: string;
    /** Epoch en segundos del momento en que la cortinilla empezó a correr. */
    introAt?: string;
    /** Duración de la cortinilla, en segundos. */
    introSec?: string;
    /**
     * `1` en las sesiones que se graban.
     *
     * Se mantiene por compatibilidad con enlaces ya repartidos, pero ya no es
     * la fuente de la verdad: quien manda es el pase firmado. Ver abajo.
     */
    rec?: string;
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'h264'; // H264: hardware encode/decode en Apple (VideoToolbox) — mejor calidad/CPU que VP9 SVC
  const hq = _searchParams.hq === 'true' ? true : false;
  const singlePC = _searchParams.singlePC !== 'false';
  // ?role=host ya no concede nada: sirve, como mucho, de pista para la interfaz
  // mientras el servidor responde. Quien decide es el pase.
  const role = _searchParams.role === 'host' ? 'host' : 'attendee';

  // La cortinilla solo existe si las tres piezas están y son coherentes. Con
  // una sola mal escrita, la sala abre como siempre: sin intro, sin error.
  const introRef = parseIntroRef(_searchParams.intro);
  const introAt = Number(_searchParams.introAt);
  const introSec = Number(_searchParams.introSec);
  const intro =
    introRef && Number.isFinite(introAt) && introAt > 0 && Number.isFinite(introSec) && introSec > 0
      ? { ref: introRef, startedAtMs: introAt * 1000, durationSec: introSec }
      : null;

  // ── ¿Esta sesión se graba? ──────────────────────────────────────────────────
  //
  // Lo dice el pase, que viene firmado por APEX. Antes lo decía `?rec=1` en la
  // URL, y solo lo ponía uno de los caminos de entrada: el anfitrión que
  // entraba por cualquier otro botón llegaba sin la marca y la clase no se
  // grababa. La decisión es de la sesión, no del enlace.
  //
  // El `?rec=1` se sigue aceptando para no romper los enlaces ya repartidos,
  // pero no concede nada por su cuenta: sin pase de anfitrión válido, la
  // grabación la rechaza igualmente `/api/record/start`.
  const pass = typeof _searchParams.pass === 'string' ? _searchParams.pass : undefined;
  const passCheck = verifyRoomPass(pass, _params.roomName);
  const autoRecord =
    (passCheck.valid && passCheck.payload.h === 1 && passCheck.payload.rec === 1) ||
    _searchParams.rec === '1';

  return (
    <ClientOnlyRoom
      intro={intro}
      autoRecord={autoRecord}
      roomName={_params.roomName}
      region={_searchParams.region}
      hq={hq}
      codec={codec}
      singlePeerConnection={singlePC}
      role={role}
      pass={pass}
      name={typeof _searchParams.name === 'string' ? _searchParams.name : undefined}
      micDefault={_searchParams.mic === '1'}
      camDefault={_searchParams.cam !== '0'}
    />
  );
}
