import * as React from 'react';
import { PageClientImpl } from './PageClientImpl';
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
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'h264';  // H264: hardware encode/decode en Apple (VideoToolbox) — mejor calidad/CPU que VP9 SVC
  const hq = _searchParams.hq === 'true' ? true : false;
  const singlePC = _searchParams.singlePC !== 'false';
  // role=host → panel de moderación visible; cualquier otro valor → asistente
  const role = _searchParams.role === 'host' ? 'host' : 'attendee';

  return (
    <PageClientImpl
      roomName={_params.roomName}
      region={_searchParams.region}
      hq={hq}
      codec={codec}
      singlePeerConnection={singlePC}
      role={role}
    />
  );
}
