'use client';

/**
 * ParticipantsPanel — La lista de la sala, en el costado
 *
 * Antes esto era una burbuja flotante que solo veía el anfitrión, encima del
 * vídeo y tapándolo. Ahora es un panel al lado, como el de Zoom: se abre, el
 * vídeo se estrecha, y nada queda escondido debajo.
 *
 * Y lo ve todo el mundo. Un alumno tiene derecho a saber quién más está en
 * clase — es la diferencia entre sentirse en un grupo y sentirse solo frente a
 * una pantalla. Lo que cambia con el rol no es la lista, son los botones:
 * silenciar, apagar cámara e invitar a hablar solo aparecen para el anfitrión.
 */

import React from 'react';
import { useParticipants, useLocalParticipant } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import type { ModerationState } from '@/lib/useRoomModeration';
import { PanelShell, ORO } from './PanelShell';

interface ParticipantsPanelProps {
  roomName: string;
  moderation: ModerationState;
  isHost: boolean;
  /** Última reacción de cada quien, para mostrarla junto al nombre. */
  reacciones: Record<string, string>;
  onClose: () => void;
}

function esAnfitrion(p: Participant): boolean {
  try {
    return JSON.parse(p.metadata || '{}').isHost === true;
  } catch {
    return false;
  }
}

// ── Botones ───────────────────────────────────────────────────────────────────

function botonAccion(color: string, ocupado?: boolean): React.CSSProperties {
  return {
    padding: '4px 9px',
    background: `${color}1a`,
    border: `1px solid ${color}44`,
    borderRadius: '6px',
    color,
    fontSize: '10px',
    fontWeight: 700,
    cursor: ocupado ? 'wait' : 'pointer',
    opacity: ocupado ? 0.5 : 1,
    whiteSpace: 'nowrap',
  };
}

function ConfirmBanner({
  msg,
  onConfirm,
  onCancel,
}: {
  msg: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        margin: '10px 12px 0',
        background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: '10px',
        flexShrink: 0,
      }}
    >
      <p style={{ margin: '0 0 8px', fontSize: '11px', color: '#fca5a5', fontWeight: 600 }}>
        {msg}
      </p>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onConfirm} style={botonAccion('#ef4444')}>
          Confirmar
        </button>
        <button onClick={onCancel} style={botonAccion('#6b7280')}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function ParticipantsPanel({
  roomName,
  moderation,
  isHost,
  reacciones,
  onClose,
}: ParticipantsPanelProps) {
  const [confirmarSilencio, setConfirmarSilencio] = React.useState(false);
  const [confirmarCamaras, setConfirmarCamaras] = React.useState(false);
  const [ocupado, setOcupado] = React.useState<string | null>(null);

  const participantes = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { raisedHands, actions } = moderation;
  const manos = React.useMemo(() => new Set(raisedHands.map((h) => h.identity)), [raisedHands]);

  const conOcupado = (clave: string, fn: () => Promise<void>) => async () => {
    if (ocupado) return;
    setOcupado(clave);
    try {
      await fn();
    } finally {
      setOcupado(null);
    }
  };

  // Orden: anfitrión, luego quien pide turno, luego el resto por nombre. Sin
  // esto la lista se reordena sola cada vez que alguien entra o sale, y el
  // anfitrión termina persiguiendo un botón por la pantalla.
  const ordenados = React.useMemo(() => {
    return [...participantes].sort((a, b) => {
      const rango = (p: Participant) => (esAnfitrion(p) ? 0 : manos.has(p.identity) ? 1 : 2);
      const d = rango(a) - rango(b);
      if (d !== 0) return d;
      return (a.name || a.identity).localeCompare(b.name || b.identity);
    });
  }, [participantes, manos]);

  return (
    <PanelShell
      titulo={`Participantes (${participantes.length})`}
      onClose={onClose}
      pie={
        isHost ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => {
                setConfirmarSilencio(true);
                setConfirmarCamaras(false);
              }}
              style={{ ...botonAccion('#f87171'), flex: 1, padding: '8px' }}
            >
              🔇 Silenciar a todos
            </button>
            <button
              onClick={() => {
                setConfirmarCamaras(true);
                setConfirmarSilencio(false);
              }}
              style={{ ...botonAccion('#60a5fa'), flex: 1, padding: '8px' }}
            >
              📷 Apagar cámaras
            </button>
          </div>
        ) : null
      }
    >
      {confirmarSilencio && (
        <ConfirmBanner
          msg="¿Silenciar todos los micrófonos?"
          onConfirm={() => {
            setConfirmarSilencio(false);
            void actions.muteAll(roomName);
          }}
          onCancel={() => setConfirmarSilencio(false)}
        />
      )}
      {confirmarCamaras && (
        <ConfirmBanner
          msg="¿Apagar todas las cámaras?"
          onConfirm={() => {
            setConfirmarCamaras(false);
            void actions.disableAllCameras(roomName);
          }}
          onCancel={() => setConfirmarCamaras(false)}
        />
      )}

      {/* Cola de manos levantadas — arriba del todo, para el anfitrión.
          Quien pide turno espera callado; si hay que buscarlo en la lista,
          se queda esperando. */}
      {isHost && raisedHands.length > 0 && (
        <div style={{ padding: '10px 12px 0', flexShrink: 0 }}>
          <p
            style={{
              fontSize: '9px',
              fontWeight: 700,
              color: ORO,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              margin: '0 0 6px',
            }}
          >
            ✋ Piden la palabra
          </p>
          {raisedHands.map((h) => (
            <div
              key={h.identity}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '7px 9px',
                background: 'rgba(201,168,76,0.07)',
                border: '1px solid rgba(201,168,76,0.18)',
                borderRadius: '8px',
                marginBottom: '5px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: ORO,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {h.name}
              </span>
              <button
                onClick={conOcupado(`inv-${h.identity}`, () => actions.inviteToSpeak(h.identity))}
                disabled={ocupado === `inv-${h.identity}`}
                style={botonAccion('#16a34a', ocupado === `inv-${h.identity}`)}
              >
                Dar la palabra
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {ordenados.map((p) => {
          const soyYo = p.identity === localParticipant.identity;
          const anfitrion = esAnfitrion(p);
          const micOn = p.isMicrophoneEnabled;
          const camOn = p.isCameraEnabled;
          const mano = manos.has(p.identity);
          const reaccion = reacciones[p.identity];
          const nombre = p.name || p.identity || '?';

          return (
            <div
              key={p.identity}
              style={{
                padding: '9px 10px',
                borderRadius: '10px',
                marginBottom: '5px',
                background: soyYo ? 'rgba(201,168,76,0.06)' : 'transparent',
                border: soyYo
                  ? '1px solid rgba(201,168,76,0.16)'
                  : '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                {/* Inicial */}
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: anfitrion ? 'rgba(201,168,76,0.22)' : 'rgba(255,255,255,0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: anfitrion ? ORO : '#fff',
                  }}
                >
                  {nombre[0].toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 600,
                        color: '#fff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {nombre}
                    </span>
                    {(soyYo || anfitrion) && (
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'rgba(255,255,255,0.45)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        (
                        {[anfitrion ? 'Anfitrión' : null, soyYo ? 'yo' : null]
                          .filter(Boolean)
                          .join(', ')}
                        )
                      </span>
                    )}
                    {mano && <span title="Pide la palabra">✋</span>}
                    {reaccion && <span>{reaccion}</span>}
                  </div>
                </div>

                {/* Estado de mic y cámara — tachados cuando están apagados,
                    igual que en Zoom, para leerlo de un vistazo. */}
                <IconoEstado activo={micOn} on="🎙️" off="🔇" titulo="micrófono" />
                <IconoEstado activo={camOn} on="📹" off="🚫" titulo="cámara" />
              </div>

              {isHost && !soyYo && (
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '7px' }}>
                  {micOn ? (
                    <button
                      onClick={conOcupado(`mute-${p.identity}`, () =>
                        actions.muteParticipant(p.identity, nombre, roomName),
                      )}
                      disabled={ocupado === `mute-${p.identity}`}
                      style={botonAccion('#ef4444', ocupado === `mute-${p.identity}`)}
                    >
                      Silenciar
                    </button>
                  ) : (
                    <button
                      onClick={conOcupado(`inv-${p.identity}`, () =>
                        actions.inviteToSpeak(p.identity),
                      )}
                      disabled={ocupado === `inv-${p.identity}`}
                      style={botonAccion('#16a34a', ocupado === `inv-${p.identity}`)}
                    >
                      Dar la palabra
                    </button>
                  )}
                  {camOn ? (
                    <button
                      onClick={conOcupado(`cam-${p.identity}`, () =>
                        actions.disableCamera(p.identity, nombre, roomName),
                      )}
                      disabled={ocupado === `cam-${p.identity}`}
                      style={botonAccion('#ef4444', ocupado === `cam-${p.identity}`)}
                    >
                      Apagar cámara
                    </button>
                  ) : (
                    <button
                      onClick={conOcupado(`icam-${p.identity}`, () =>
                        actions.inviteToCamera(p.identity),
                      )}
                      disabled={ocupado === `icam-${p.identity}`}
                      style={botonAccion('#3b82f6', ocupado === `icam-${p.identity}`)}
                    >
                      Pedir cámara
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}

function IconoEstado({
  activo,
  on,
  off,
  titulo,
}: {
  activo: boolean;
  on: string;
  off: string;
  titulo: string;
}) {
  return (
    <span
      title={activo ? `Con ${titulo}` : `Sin ${titulo}`}
      style={{ fontSize: '13px', opacity: activo ? 1 : 0.5, flexShrink: 0 }}
    >
      {activo ? on : off}
    </span>
  );
}
