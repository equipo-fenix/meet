'use client';

import React from 'react';
import {
  useParticipants,
  useLocalParticipant,
} from '@livekit/components-react';

export function ModeratorPanel({ roomName }: { roomName: string }) {
  const [open, setOpen] = React.useState(false);
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Silenciar todos via API de Supabase → LiveKit Admin
  const muteAll = async () => {
    try {
      await fetch(
        'https://cmblgqzezfzmqkhkunto.supabase.co/functions/v1/livekit-admin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'muteAll', roomName }),
        }
      );
    } catch (e) {
      console.error('muteAll error:', e);
    }
  };

  // Silenciar a un participante específico
  const muteParticipant = async (identity: string) => {
    try {
      await fetch(
        'https://cmblgqzezfzmqkhkunto.supabase.co/functions/v1/livekit-admin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mute', roomName, identity }),
        }
      );
    } catch (e) {
      console.error('mute error:', e);
    }
  };

  const remoteParticipants = participants.filter(
    (p) => p.identity !== localParticipant.identity
  );

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '80px',
        right: '16px',
        zIndex: 9999,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* Botón flotante — participantes */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Panel de moderación"
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: open
            ? 'linear-gradient(135deg, #C9A84C, #a07830)'
            : 'rgba(201,168,76,0.15)',
          border: '1px solid rgba(201,168,76,0.4)',
          color: open ? '#0a0a0f' : '#C9A84C',
          fontSize: '18px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          position: 'relative',
        }}
      >
        👥
        {/* Badge con número */}
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
      </button>

      {/* Panel desplegable */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '56px',
            right: '0',
            width: '260px',
            background: '#12121a',
            border: '1px solid rgba(201,168,76,0.25)',
            borderRadius: '16px',
            padding: '16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}
          >
            <p
              style={{
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.15em',
                color: '#C9A84C',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              Sala · {participants.length} participante{participants.length !== 1 ? 's' : ''}
            </p>
            <button
              onClick={muteAll}
              title="Silenciar a todos"
              style={{
                padding: '4px 10px',
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '6px',
                color: '#f87171',
                fontSize: '10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              🔇 Silenciar todos
            </button>
          </div>

          {/* Lista de participantes */}
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {participants.map((p) => {
              const isLocal = p.identity === localParticipant.identity;
              return (
                <div
                  key={p.identity}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px',
                    borderRadius: '8px',
                    marginBottom: '4px',
                    background: isLocal
                      ? 'rgba(201,168,76,0.06)'
                      : 'rgba(255,255,255,0.03)',
                    border: isLocal
                      ? '1px solid rgba(201,168,76,0.15)'
                      : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {/* Avatar inicial */}
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: isLocal
                        ? 'rgba(201,168,76,0.2)'
                        : 'rgba(255,255,255,0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: isLocal ? '#C9A84C' : '#ffffff',
                      flexShrink: 0,
                    }}
                  >
                    {(p.name || p.identity || '?')[0].toUpperCase()}
                  </div>

                  {/* Nombre */}
                  <span
                    style={{
                      flex: 1,
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#ffffff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name || p.identity}
                    {isLocal && (
                      <span style={{ color: '#C9A84C', fontSize: '10px', marginLeft: '4px' }}>
                        (tú)
                      </span>
                    )}
                  </span>

                  {/* Iconos de estado */}
                  <span title={p.isMicrophoneEnabled ? 'Mic activo' : 'Silenciado'}>
                    {p.isMicrophoneEnabled ? '🎙️' : '🔇'}
                  </span>
                  <span title={p.isCameraEnabled ? 'Cámara activa' : 'Sin cámara'}>
                    {p.isCameraEnabled ? '📹' : '🚫'}
                  </span>

                  {/* Botón silenciar (solo para participantes remotos) */}
                  {!isLocal && p.isMicrophoneEnabled && (
                    <button
                      onClick={() => muteParticipant(p.identity)}
                      title={`Silenciar a ${p.name || p.identity}`}
                      style={{
                        padding: '2px 6px',
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.25)',
                        borderRadius: '4px',
                        color: '#f87171',
                        fontSize: '9px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Mutear
                    </button>
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
