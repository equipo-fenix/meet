'use client';

/**
 * Quién está tocando la puerta
 *
 * Una barra arriba, solo para el anfitrión, con los nombres de quienes esperan
 * fuera y un botón por cada uno. Toca "Aprobar" y esa persona entra. No hay
 * más pasos, no hay otra pestaña, no hay que acordarse de nada.
 *
 * Aparece cuando hay alguien esperando y desaparece cuando no. Una barra
 * permanente que casi siempre dice "no hay nadie" es una barra que se deja de
 * mirar, y el día que dice algo tampoco se mira.
 *
 * Al montar, lo primero que hace es anunciar que el anfitrión llegó. Ese aviso
 * es el que crea la puerta: a partir de ese momento los alumnos que lleguen
 * esperan en vez de entrar solos.
 */

import * as React from 'react';
import { toast } from 'react-hot-toast';
import {
  anunciarAnfitrion,
  leerPuerta,
  decidir,
  abrirPuerta,
  type EsperandoFuera,
} from '@/lib/lobby';

interface LobbyBarProps {
  sessionId: string;
  pass: string;
}

/** Cada cuánto se mira si llegó alguien. Tres segundos: quien espera lo nota. */
const CADENCIA_MS = 3000;

export function LobbyBar({ sessionId, pass }: LobbyBarProps) {
  const [esperando, setEsperando] = React.useState<EsperandoFuera[]>([]);
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [modoAbierto, setModoAbierto] = React.useState(false);

  // Que el anfitrión llegó se anuncia una sola vez.
  const anunciado = React.useRef(false);

  React.useEffect(() => {
    if (!sessionId || !pass) return;
    let vivo = true;

    const mirar = async () => {
      try {
        if (!anunciado.current) {
          anunciado.current = true;
          await anunciarAnfitrion(sessionId, pass);
        }
        const estado = await leerPuerta(sessionId, pass);
        if (!vivo) return;
        setEsperando(estado.waiting);
        setModoAbierto(estado.admissionMode === 'open_all' && estado.roomOpen);
      } catch {
        // La puerta es una comodidad, no el eje de la sesión. Si APEX no
        // responde, la clase sigue: nadie se queda sin dar su clase porque una
        // lista de espera no cargó.
      }
    };

    void mirar();
    const id = setInterval(mirar, CADENCIA_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [sessionId, pass]);

  const aprobar = React.useCallback(
    async (v: EsperandoFuera) => {
      setOcupado(v.visitor_key);
      // Fuera de la lista al instante. La confirmación llega del servidor un
      // momento después, pero para entonces el anfitrión ya siguió con lo suyo.
      setEsperando((antes) => antes.filter((x) => x.visitor_key !== v.visitor_key));
      try {
        await decidir(sessionId, pass, v.visitor_key, 'admit');
      } catch {
        toast.error(`No se pudo aprobar a ${v.display_name ?? 'esa persona'}`);
        setEsperando((antes) => [...antes, v]);
      } finally {
        setOcupado(null);
      }
    },
    [sessionId, pass],
  );

  const abrirParaTodos = React.useCallback(async () => {
    setOcupado('todos');
    try {
      await abrirPuerta(sessionId, pass);
      setModoAbierto(true);
      setEsperando([]);
      toast('Sala abierta — ya entra todo el mundo', { duration: 3500 });
    } catch {
      toast.error('No se pudo abrir la sala');
    } finally {
      setOcupado(null);
    }
  }, [sessionId, pass]);

  if (modoAbierto || esperando.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '56px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        maxHeight: '40vh',
        overflowY: 'auto',
        padding: '8px',
        borderRadius: '14px',
        background: 'rgba(10,10,15,0.88)',
        border: '1px solid rgba(201,168,76,0.35)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        boxShadow: '0 6px 28px rgba(0,0,0,0.55)',
      }}
    >
      {esperando.map((v) => (
        <div
          key={v.visitor_key}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '2px 4px' }}
        >
          <span style={{ fontSize: '13px', color: '#fff', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {v.display_name ?? 'Alguien'}{' '}
            <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>
              está en la sala de espera
            </span>
          </span>
          <button
            onClick={() => void aprobar(v)}
            disabled={ocupado === v.visitor_key}
            style={{
              marginLeft: 'auto',
              padding: '5px 14px',
              borderRadius: '16px',
              border: 'none',
              background: '#C9A84C',
              color: '#0a0a0f',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              opacity: ocupado === v.visitor_key ? 0.5 : 1,
            }}
          >
            Aprobar
          </button>
        </div>
      ))}

      {/* Cuando llegan quince a la vez, aprobar de uno en uno deja de ser
          cuidado y pasa a ser trabajo. */}
      {esperando.length > 2 && (
        <button
          onClick={() => void abrirParaTodos()}
          disabled={ocupado === 'todos'}
          style={{
            marginTop: '2px',
            padding: '6px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent',
            color: 'rgba(255,255,255,0.7)',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Dejar pasar a todos ({esperando.length})
        </button>
      )}
    </div>
  );
}
