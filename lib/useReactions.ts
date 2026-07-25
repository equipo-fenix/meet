'use client';

/**
 * useReactions — Reacciones de sala, como las de Zoom
 *
 * Un alumno que está escuchando no tiene forma de decir nada sin interrumpir.
 * Puede levantar la mano —eso ya existía— pero levantar la mano es pedir turno,
 * y la mayoría de las veces uno no quiere turno: quiere aplaudir, o decir que
 * sí, o reírse. Sin eso la clase se siente vacía aunque haya cien personas.
 *
 * Así que un emoji sube por la pantalla de todos y se apaga solo. No silencia
 * a nadie, no reparte permisos, no queda registrado. Viaja por el mismo
 * DataChannel que el resto de la señalización de sala.
 */

import React from 'react';
import { Room, RoomEvent, RemoteParticipant } from 'livekit-client';
import { MSG, encodeMsg, decodeMsg } from './roomMessages';

/** Las que ofrece el menú, en el orden en que se ven. */
export const REACCIONES = ['👏', '👍', '❤️', '😂', '😮', '🎉'] as const;

/** Lo que tarda un emoji en subir y apagarse. */
const VIDA_MS = 4000;

/**
 * Cuántos emojis dejamos vivos a la vez. Con cien personas aplaudiendo a la
 * vez, dibujarlos todos convierte la clase en una tormenta y tira el
 * framerate del vídeo, que es lo único que de verdad importa en pantalla.
 */
const MAX_VIVOS = 24;

export interface ReaccionVolando {
  /** Único por emisión — dos aplausos del mismo alumno son dos burbujas. */
  key: string;
  emoji: string;
  name: string;
  /** Posición horizontal, en % del ancho. Repartidas para que no se solapen. */
  left: number;
}

export interface ReactionsState {
  /** Las que están subiendo por la pantalla ahora mismo. */
  volando: ReaccionVolando[];
  /** La última reacción de cada quien, para pintarla sobre su cuadro. */
  porParticipante: Record<string, string>;
  /** Manda una reacción a toda la sala (y la pinta aquí mismo). */
  enviar: (emoji: string) => void;
}

export function useReactions(room: Room): ReactionsState {
  const [volando, setVolando] = React.useState<ReaccionVolando[]>([]);
  const [porParticipante, setPorParticipante] = React.useState<Record<string, string>>({});
  const contador = React.useRef(0);

  const pintar = React.useCallback((identity: string, name: string, emoji: string) => {
    const key = `${identity}-${Date.now()}-${contador.current++}`;
    // Repartidas por el ancho pero lejos de los bordes, donde están las
    // miniaturas y los nombres.
    const left = 12 + Math.random() * 66;

    setVolando((prev) => [...prev, { key, emoji, name, left }].slice(-MAX_VIVOS));
    setPorParticipante((prev) => ({ ...prev, [identity]: emoji }));

    setTimeout(() => {
      setVolando((prev) => prev.filter((r) => r.key !== key));
      setPorParticipante((prev) => {
        // Solo se borra si nadie ha reaccionado encima mientras tanto: si no,
        // una reacción vieja apagaría la nueva al vencer su temporizador.
        if (prev[identity] !== emoji) return prev;
        const copia = { ...prev };
        delete copia[identity];
        return copia;
      });
    }, VIDA_MS);
  }, []);

  // ── Recepción ──────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const alRecibir = (payload: Uint8Array, participante?: RemoteParticipant) => {
      const msg = decodeMsg(payload);
      if (!msg || msg.type !== MSG.REACTION || !msg.emoji) return;
      const identity = msg.identity || participante?.identity || '';
      pintar(identity, msg.name || participante?.name || identity, msg.emoji);
    };
    room.on(RoomEvent.DataReceived, alRecibir);
    return () => {
      room.off(RoomEvent.DataReceived, alRecibir);
    };
  }, [room, pintar]);

  // ── Envío ──────────────────────────────────────────────────────────────────
  const enviar = React.useCallback(
    (emoji: string) => {
      const yo = room.localParticipant;
      // Se pinta aquí primero: LiveKit no devuelve al emisor sus propios datos,
      // y un botón que no responde parece roto aunque el resto lo haya visto.
      pintar(yo.identity, yo.name || yo.identity, emoji);
      void room.localParticipant
        .publishData(
          encodeMsg({
            type: MSG.REACTION,
            identity: yo.identity,
            name: yo.name || yo.identity,
            emoji,
            ts: Date.now(),
          }),
          // Sin fiabilidad: una reacción perdida no le importa a nadie, y no
          // vale la pena retransmitirla por delante del audio.
          { reliable: false },
        )
        .catch((e) => console.warn('[reacciones] no se pudo enviar:', e));
    },
    [room, pintar],
  );

  return { volando, porParticipante, enviar };
}
