'use client';

/**
 * Aviso de grabación
 *
 * El original de LiveKit hacía dos cosas y las dos estorbaban: un aviso en
 * inglés que duraba tres segundos, y un marco rojo permanente alrededor de
 * toda la pantalla durante el resto de la sesión.
 *
 * Lo que queda es más honesto y menos ruidoso. Al alumno se le informa antes
 * de entrar — eso pasa en la sala de espera, no aquí. Dentro de la sala, la
 * única señal permanente es un punto rojo que parpadea, igual que en una
 * cámara de verdad, donde nadie necesita que le repitan que está grabando.
 *
 * Y cuando la grabación termina, se dice. Que algo deje de grabarse es tan
 * informativo como que empiece.
 */

import { useIsRecording } from '@livekit/components-react';
import * as React from 'react';
import toast from 'react-hot-toast';

interface RecordingIndicatorProps {
  /**
   * El anfitrión ya tiene su propio botón rojo con cronómetro. Mostrarle
   * además el punto sería decirle dos veces lo mismo en la misma pantalla.
   */
  showDot?: boolean;
}

const AVISO_STYLE = {
  background: '#1a1a24',
  color: '#fff',
  border: '1px solid rgba(239,68,68,0.4)',
};

export function RecordingIndicator({ showDot = true }: RecordingIndicatorProps) {
  const isRecording = useIsRecording();

  // `null` al montar, no `false`: si alguien entra a una sesión que ya lleva
  // veinte minutos grabando, no queremos anunciarle un comienzo que no vio.
  const previous = React.useRef<boolean | null>(null);

  React.useEffect(() => {
    const before = previous.current;
    previous.current = isRecording;

    if (before === null) {
      // Primera lectura del estado. Si ya estaba grabando, se lo decimos una
      // vez y sin drama: no es un comienzo, es una situación.
      if (isRecording) {
        toast('Esta sesión se está grabando', {
          id: 'grabacion',
          duration: 4000,
          icon: '🔴',
          position: 'top-center',
          style: AVISO_STYLE,
        });
      }
      return;
    }

    if (before === isRecording) return;

    if (isRecording) {
      toast('La grabación ha comenzado', {
        id: 'grabacion',
        duration: 4000,
        icon: '🔴',
        position: 'top-center',
        style: AVISO_STYLE,
      });
    } else {
      toast('Esta grabación ha terminado', {
        id: 'grabacion',
        duration: 5000,
        icon: '✅',
        position: 'top-center',
        style: { ...AVISO_STYLE, border: '1px solid rgba(201,168,76,0.4)' },
      });
    }
  }, [isRecording]);

  if (!isRecording || !showDot) return null;

  return (
    <div
      aria-label="La sesión se está grabando"
      style={{
        position: 'fixed',
        top: '14px',
        left: '14px',
        zIndex: 9996,
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        padding: '5px 11px',
        borderRadius: '20px',
        background: 'rgba(10,10,15,0.72)',
        border: '1px solid rgba(239,68,68,0.35)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        pointerEvents: 'none',
      }}
    >
      <span className="fenix-rec-dot" />
      <span style={{ fontSize: '11px', fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>
        REC
      </span>
      <style>{`
        .fenix-rec-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 8px rgba(239,68,68,0.9);
          animation: fenix-rec-blink 1.4s ease-in-out infinite;
        }
        @keyframes fenix-rec-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.15; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fenix-rec-dot { animation: none; }
        }
      `}</style>
    </div>
  );
}
