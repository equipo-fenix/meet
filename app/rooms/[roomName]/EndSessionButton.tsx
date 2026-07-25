'use client';

/**
 * El botón rojo de la barra, para el anfitrión
 *
 * Para un alumno, el botón rojo de abajo significa "me salgo". Para el
 * anfitrión significa otra cosa: si él se va, la clase se acabó. Que los dos
 * hagan lo mismo era mentira — el anfitrión se salía y la sala seguía viva
 * detrás, con la grabación corriendo y la gente dentro.
 *
 * Así que para el anfitrión este botón termina la sesión para todos. Es el
 * mismo botón, en el mismo sitio y del mismo color: no hay que aprender nada
 * nuevo ni buscar un control aparte en una esquina.
 *
 * Pregunta antes, porque no tiene vuelta atrás y está pegado al de compartir
 * pantalla. Y la pregunta se recoge sola si no la contesta: un "¿seguro?"
 * olvidado en pantalla es un accidente esperando a que alguien pase el ratón.
 */

import * as React from 'react';
import { toast } from 'react-hot-toast';

interface EndSessionButtonProps {
  roomName: string;
  pass: string | null;
}

/** Lo que tarda la pregunta en recogerse sola si nadie la contesta. */
const ESPERA_MS = 6000;

export function EndSessionButton({ roomName, pass }: EndSessionButtonProps) {
  const [confirmando, setConfirmando] = React.useState(false);
  const [cerrando, setCerrando] = React.useState(false);

  React.useEffect(() => {
    if (!confirmando || cerrando) return;
    const id = setTimeout(() => setConfirmando(false), ESPERA_MS);
    return () => clearTimeout(id);
  }, [confirmando, cerrando]);

  const terminar = React.useCallback(async () => {
    setCerrando(true);
    try {
      const res = await fetch('/api/livekit-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'endSession', roomName, pass }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
      // No hace falta navegar a ningún sitio: al borrarse la sala, este mismo
      // cliente se desconecta y `handleOnLeave` lo lleva a la pantalla de salida
      // igual que a todos los demás.
    } catch (e) {
      toast.error(
        `No se pudo terminar la sesión: ${e instanceof Error ? e.message : 'error desconocido'}`,
        { duration: 8000 },
      );
      setCerrando(false);
      setConfirmando(false);
    }
  }, [roomName, pass]);

  if (confirmando) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 8px',
          borderRadius: '10px',
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
        }}
      >
        <span
          style={{
            fontSize: '11.5px',
            fontWeight: 700,
            color: 'rgba(255,255,255,0.8)',
            whiteSpace: 'nowrap',
          }}
        >
          ¿Terminar para todos?
        </span>
        <button
          onClick={() => void terminar()}
          disabled={cerrando}
          style={{
            ...respuesta,
            background: '#ef4444',
            color: '#fff',
            opacity: cerrando ? 0.6 : 1,
          }}
        >
          {cerrando ? 'Terminando…' : 'Sí'}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={cerrando}
          style={{ ...respuesta, background: 'rgba(255,255,255,0.1)', color: '#fff' }}
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      title="Termina la sesión para todos y cierra la grabación"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        minWidth: '62px',
        padding: '6px 12px',
        borderRadius: '10px',
        border: '1px solid rgba(239,68,68,0.4)',
        background: 'rgba(239,68,68,0.14)',
        color: '#f87171',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: '19px', lineHeight: 1 }}>⏻</span>
      <span className="fenix-dock-label" style={{ fontSize: '10.5px', fontWeight: 700 }}>
        Terminar
      </span>
    </button>
  );
}

const respuesta: React.CSSProperties = {
  padding: '5px 11px',
  borderRadius: '7px',
  border: 'none',
  fontSize: '11.5px',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};
