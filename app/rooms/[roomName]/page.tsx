import * as React from 'react';
import { ClientOnlyRoom } from './ClientOnlyRoom';
import { isVideoCodec } from '@/lib/types';

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

  return (
    <ClientOnlyRoom
      roomName={_params.roomName}
      region={_searchParams.region}
      hq={hq}
      codec={codec}
      singlePeerConnection={singlePC}
      role={role}
      pass={typeof _searchParams.pass === 'string' ? _searchParams.pass : undefined}
      name={typeof _searchParams.name === 'string' ? _searchParams.name : undefined}
      micDefault={_searchParams.mic === '1'}
      camDefault={_searchParams.cam !== '0'}
    />
  );
}
