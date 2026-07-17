'use client';

/**
 * ModeratorPanel — Panel de moderación de sala Fénix Live (solo host)
 *
 * Muestra la lista de participantes con:
 *   · nombre + rol (Anfitrión / Participante)
 *   · estado del micrófono y cámara
 *   · indicador de mano levantada
 *   · acciones de moderación contextuales
 *   · cola de solicitudes para hablar
 *
 * Acciones globales (con confirmación):
 *   · Silenciar todos los micrófonos
 *   · Apagar todas las cámaras
 */

import React from 'react';
import { useParticipants, useLocalParticipant } from '@livekit/components-react';
import { RaisedHand, ModerationState } from '@/lib/useRoomModeration';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ModeratorPanelProps {
  roomName: string;
  moderation: ModerationState;
}

// ── Helper de estilos ─────────────────────────────────────────────────────────

function actionBtn(color: string, disabled?: boolean): React.CSSProperties {
  return {
    padding: '3px 8px',
    background: `${color}1a`,
    border: `1px solid ${color}44`,
    borderRadius: '5px',
    color: color,
    fontSize: '10px',
    fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'opacity 0.15s',
    whiteSpace: 'nowrap' as const,
  };
}

function globalBtn(color: string): React.CSSProperties {
  return {
    padding: '4px 9px',
    background: `${color}18`,
    border: `1px solid ${color}40`,
    borderRadius: '6px',
    color: color,
    fontSize: '9px',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  };
}

// ── Sub-componente: banner de confirmación ────────────────────────────────────

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
        marginBottom: '10px',
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
        <button onClick={onConfirm} style={actionBtn('#ef4444')}>
          Confirmar
        </button>
        <button onClick={onCancel} style={actionBtn('#6b7280')}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export function ModeratorPanel({ roomName, moderation }: ModeratorPanelProps) {
  const [open, setOpen]             = React.useState(false);
  const [confirmMuteAll, setConfirmMuteAll]   = React.useState(false);
  const [confirmCamOff, setConfirmCamOff]     = React.useState(false);
  const [busy, setBusy]             = React.useState<string | null>(null);

  const participants    = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { raisedHands, actions } = moderation;
  const handIds = new Set(raisedHands.map(h => h.identity));

  // ── Manejadores con loading guard ─────────────────────────────────────────

  const withBusy = (key: string, fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '80px',
        right: '16px',
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Botón toggle ── */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Panel de participantes"
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: open
            ? 'linear-gradient(135deg, #C9A84C, #a07830)'
            : 'rgba(201,168,76,0.15)',
          border: '1px solid rgba(201,168,76,0.4)',
          color: open ? '#0a0a0f' : '#C9A84C',
          fontSize: '20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          position: 'relative',
        }}
      >
        👥
        {/* Contador de participantes */}
        <span
          style={{
            position: 'absolute',
            top: '-4px',
            right: '-4px',
            background: '#C9A84C',
            color: '#0a0a0f',
            borderRadius: '50%',
            width: '18px',
            height: '18px',
            fontSize: '10px',
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {participants.length}
        </span>
        {/* Indicador de manos levantadas */}
        {raisedHands.length > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '-4px',
              left: '-4px',
              background: '#ef4444',
              color: '#fff',
              borderRadius: '50%',
              width: '18px',
              height: '18px',
              fontSize: '10px',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {raisedHands.length}
          </span>
        )}
      </button>

      {/* ── Panel desplegable ── */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '56px',
            right: '0',
            width: '300px',
            background: '#12121a',
            border: '1px solid rgba(201,168,76,0.2)',
            borderRadius: '16px',
            padding: '14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '72vh',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '10px',
              flexShrink: 0,
            }}
          >
            <p
              style={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: '#C9A84C',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              Sala · {participants.length} participante{participants.length !== 1 ? 's' : ''}
            </p>
            <div style={{ display: 'flex', gap: '5px' }}>
              <button
                onClick={() => { setConfirmCamOff(true); setConfirmMuteAll(false); }}
                style={globalBtn('#60a5fa')}
                title="Apagar todas las cámaras"
              >
                📷 Cámaras
              </button>
              <button
                onClick={() => { setConfirmMuteAll(true); setConfirmCamOff(false); }}
                style={globalBtn('#f87171')}
                title="Silenciar a todos"
              >
                🔇 Todos
              </button>
            </div>
          </div>

          {/* Confirmaciones */}
          {confirmMuteAll && (
            <ConfirmBanner
              msg="¿Silenciar todos los micrófonos?"
              onConfirm={() => { setConfirmMuteAll(false); actions.muteAll(roomName); }}
              onCancel={() => setConfirmMuteAll(false)}
            />
          )}
          {confirmCamOff && (
            <ConfirmBanner
              msg="¿Apagar todas las cámaras?"
              onConfirm={() => { setConfirmCamOff(false); actions.disableAllCameras(roomName); }}
              onCancel={() => setConfirmCamOff(false)}
            />
          )}

          {/* Cola de manos levantadas */}
          {raisedHands.length > 0 && (
            <div style={{ marginBottom: '10px', flexShrink: 0 }}>
              <p
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: '#C9A84C',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  margin: '0 0 5px',
                }}
              >
                ✋ Solicitudes para hablar
              </p>
              {raisedHands.map(h => (
                <div
                  key={h.identity}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    background: 'rgba(201,168,76,0.07)',
                    border: '1px solid rgba(201,168,76,0.18)',
                    borderRadius: '8px',
                    marginBottom: '4px',
                  }}
                >
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#C9A84C' }}>
                    {h.name}
                  </span>
                  <button
                    onClick={withBusy(`invite-${h.identity}`, () => actions.inviteToSpeak(h.identity))}
                    disabled={busy === `invite-${h.identity}`}
                    style={actionBtn('#16a34a', busy === `invite-${h.identity}`)}
                  >
                    Invitar a hablar
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Lista de participantes */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {participants.map(p => {
              const isLocal = p.identity === localParticipant.identity;
              let isParticipantHost = false;
              try {
                const meta = JSON.parse(p.metadata || '{}');
                isParticipantHost = meta.isHost === true;
              } catch { /* empty */ }

              const micOn  = p.isMicrophoneEnabled;
              const camOn  = p.isCameraEnabled;
              const hand   = handIds.has(p.identity);
              const nameStr = p.name || p.identity || '?';

              return (
                <div
                  key={p.identity}
                  style={{
                    padding: '9px 10px',
                    borderRadius: '10px',
                    marginBottom: '5px',
                    background: isLocal
                      ? 'rgba(201,168,76,0.06)'
                      : 'rgba(255,255,255,0.03)',
                    border: isLocal
                      ? '1px solid rgba(201,168,76,0.14)'
                      : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {/* Fila superior: avatar + nombre + estado */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: isLocal ? 0 : '7px' }}>
                    {/* Avatar */}
                    <div
                      style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: '50%',
                        flexShrink: 0,
                        background: isLocal
                          ? 'rgba(201,168,76,0.2)'
                          : 'rgba(255,255,255,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: isLocal ? '#C9A84C' : '#fff',
                      }}
                    >
                      {nameStr[0].toUpperCase()}
                    </div>

                    {/* Nombre + rol */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: '#fff',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {nameStr}
                          {isLocal && (
                            <span style={{ color: '#C9A84C', fontSize: '10px', marginLeft: '4px' }}>
                              (tú)
                            </span>
                          )}
                        </span>
                        {hand && (
                          <span title="Solicitó hablar" style={{ fontSize: '12px' }}>
                            ✋
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontSize: '9px',
                          color: 'rgba(255,255,255,0.4)',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                        }}
                      >
                        {isParticipantHost ? 'Anfitrión' : 'Participante'}
                      </span>
                    </div>

                    {/* Iconos de estado */}
                    <span
                      style={{ fontSize: '13px' }}
                      title={micOn ? 'Micrófono activo' : 'Silenciado'}
                    >
                      {micOn ? '🎙️' : '🔇'}
                    </span>
                    <span
                      style={{ fontSize: '13px' }}
                      title={camOn ? 'Cámara activa' : 'Cámara apagada'}
                    >
                      {camOn ? '📷' : '🚫'}
                    </span>
                  </div>

                  {/* Fila de acciones — solo participantes remotos */}
                  {!isLocal && (
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                      {/* Acciones de micrófono */}
                      {micOn ? (
                        <button
                          onClick={withBusy(`mute-${p.identity}`, () =>
                            actions.muteParticipant(p.identity, nameStr, roomName)
                          )}
                          disabled={busy === `mute-${p.identity}`}
                          style={actionBtn('#ef4444', busy === `mute-${p.identity}`)}
                        >
                          Silenciar mic
                        </button>
                      ) : (
                        <button
                          onClick={withBusy(`invite-${p.identity}`, () =>
                            actions.inviteToSpeak(p.identity)
                          )}
                          disabled={busy === `invite-${p.identity}`}
                          style={actionBtn('#16a34a', busy === `invite-${p.identity}`)}
                        >
                          Invitar a hablar
                        </button>
                      )}

                      {/* Acciones de cámara */}
                      {camOn ? (
                        <button
                          onClick={withBusy(`cam-${p.identity}`, () =>
                            actions.disableCamera(p.identity, nameStr, roomName)
                          )}
                          disabled={busy === `cam-${p.identity}`}
                          style={actionBtn('#ef4444', busy === `cam-${p.identity}`)}
                        >
                          Apagar cámara
                        </button>
                      ) : (
                        <button
                          onClick={withBusy(`icam-${p.identity}`, () =>
                            actions.inviteToCamera(p.identity)
                          )}
                          disabled={busy === `icam-${p.identity}`}
                          style={actionBtn('#3b82f6', busy === `icam-${p.identity}`)}
                        >
                          Invitar cámara
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
