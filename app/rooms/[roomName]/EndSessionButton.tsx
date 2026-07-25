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
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: 'rgba(255,255,255,0.75)',
            whiteSpace: 'nowrap',
          }}
        >
          ¿Terminar para todos?
        </span>
        <button
          className="lk-button lk-disconnect-button"
          onClick={() => void terminar()}
          disabled={cerrando}
          style={{ whiteSpace: 'nowrap', opacity: cerrando ? 0.6 : 1 }}
        >
          {cerrando ? 'Terminando…' : 'Sí'}
        </button>
        <button
          className="lk-button"
          onClick={() => setConfirmando(false)}
          disabled={cerrando}
          style={{ whiteSpace: 'nowrap' }}
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      className="lk-button lk-disconnect-button"
      onClick={() => setConfirmando(true)}
      title="Termina la sesión para todos y cierra la grabación"
      style={{ whiteSpace: 'nowrap' }}
    >
      Terminar sesión
    </button>
  );
}
