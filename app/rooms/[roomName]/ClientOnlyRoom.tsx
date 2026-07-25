'use client';

// La sala solo existe en el navegador.
//
// Dentro de PageClientImpl viven cosas que solo el navegador sabe hacer:
// `Worker` (el cifrado extremo a extremo), el filtro de ruido de Krisp, los
// permisos de cámara y micrófono. Al renderizar en el servidor esas piezas se
// evalúan sin navegador y la página entera se cae con un 500 antes de llegar a
// nadie.
//
// Este envoltorio corta ese camino: la sala se carga solo del lado del cliente.
// El servidor devuelve una página válida con un mensaje de espera, y el
// navegador monta la sala en cuanto puede. Nadie ve un error.

import * as React from 'react';
import dynamic from 'next/dynamic';
import type { VideoCodec } from 'livekit-client';
import type { IntroConfig } from './FenixRoomLayout';

type Props = {
  intro?: IntroConfig | null;
  autoRecord?: boolean;
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
  role: 'host' | 'attendee';
  pass?: string;
  name?: string;
  micDefault: boolean;
  camDefault: boolean;
};

const PageClientImpl = dynamic(() => import('./PageClientImpl').then((m) => m.PageClientImpl), {
  ssr: false,
  loading: () => (
    <main data-lk-theme="default" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <p style={{ opacity: 0.7 }}>Preparando la sala…</p>
    </main>
  ),
});

export function ClientOnlyRoom(props: Props) {
  return <PageClientImpl {...props} />;
}
