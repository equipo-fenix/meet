'use client';

/**
 * FenixRoomLayout — Vista profesional de sala para Fénix Live
 *
 * Modos de vista:
 *   · ESCENARIO  — Un participante principal (activo/pinado/pantalla) + tira de miniaturas
 *   · GALERÍA    — Cuadrícula responsive por número de participantes
 *
 * Comportamiento del hablante activo:
 *   · Detección: useSpeakingParticipants() de LiveKit
 *   · Debounce: 1.5 s — evita cambios por ruido momentáneo
 *   · Fallback: host si no hay nadie hablando
 *
 * Prioridad de escenario principal:
 *   1. Pantalla compartida (cualquier participante)
 *   2. Track pinado manualmente por el host
 *   3. Hablante activo (con debounce)
 *   4. Participante local (fallback)
 *
 * Controles de layout (barra superior central):
 *   · Toggle escenario ↔ galería
 *   · Mostrar / ocultar miniaturas (solo modo escenario)
 *   · Botón quitar pin (cuando hay pin activo)
 *
 * Chat:
 *   · Sidebar lateral derecho, colapsable
 *   · Toggle en barra superior
 *
 * Mobile:
 *   · Miniaturas: carrusel horizontal (overflow-x: auto)
 *   · Chat / panel: drawer desde el borde inferior
 *   · Ambas orientaciones soportadas por CSS
 */

import React from 'react';
import {
  useTracks,
  useParticipants,
  useSpeakingParticipants,
  useLocalParticipant,
  ParticipantTile,
  ControlBar,
  Chat,
  RoomAudioRenderer,
  formatChatMessageLinks,
  TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track } from 'livekit-client';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type LayoutMode = 'stage' | 'gallery';

interface FenixRoomLayoutProps {
  isHost: boolean;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const SPEAKER_DEBOUNCE_MS = 1500;

// ── Helper: obtener identidad del participante ────────────────────────────────

function trackIdentity(ref: TrackReferenceOrPlaceholder): string {
  return ref.participant?.identity ?? '';
}

// ── Componente principal ──────────────────────────────────────────────────────

export function FenixRoomLayout({ isHost }: FenixRoomLayoutProps) {
  // ── Estado de UI ─────────────────────────────────────────────────────────
  const [mode, setMode]               = React.useState<LayoutMode>('stage');
  const [showThumbs, setShowThumbs]   = React.useState(true);
  const [chatOpen, setChatOpen]       = React.useState(false);
  const [pinnedId, setPinnedId]       = React.useState<string | null>(null);
  const [mainIdentity, setMainIdentity] = React.useState<string | null>(null);

  // ── Tracks y participantes ────────────────────────────────────────────────
  const allTrackRefs = useTracks(
    [
      { source: Track.Source.Camera,      withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  ) as TrackReferenceOrPlaceholder[];

  const participants      = useParticipants();
  const speakingList      = useSpeakingParticipants();
  const { localParticipant } = useLocalParticipant();

  // ── Separar tracks por tipo ───────────────────────────────────────────────

  // Tracks de pantalla compartida (alta prioridad)
  const screenRefs = allTrackRefs.filter(
    ref => ref.source === Track.Source.ScreenShare
  );

  // Tracks de cámara (incluyendo placeholders)
  const cameraRefs = allTrackRefs.filter(
    ref => ref.source === Track.Source.Camera
  );

  // ── Hablante activo con debounce ──────────────────────────────────────────
  const speakerTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSpeakerId, setDebouncedSpeakerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const topSpeaker = speakingList[0];
    if (!topSpeaker) return; // no cambiar a null — retener el último
    const id = topSpeaker.identity;

    if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);

    if (id === debouncedSpeakerId) return; // ya es el activo

    speakerTimerRef.current = setTimeout(() => {
      setDebouncedSpeakerId(id);
    }, SPEAKER_DEBOUNCE_MS);

    return () => {
      if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
    };
  }, [speakingList]);

  // ── Determinar track principal del escenario ──────────────────────────────

  const mainTrackRef = React.useMemo((): TrackReferenceOrPlaceholder | null => {
    // 1. Pantalla compartida (cualquiera)
    if (screenRefs.length > 0) return screenRefs[0];

    // 2. Track pinado por el host
    if (pinnedId) {
      const pinned = cameraRefs.find(ref => trackIdentity(ref) === pinnedId);
      if (pinned) return pinned;
      // El participante se fue, limpiar pin
    }

    // 3. Hablante activo (debounced)
    if (debouncedSpeakerId) {
      const speaker = cameraRefs.find(ref => trackIdentity(ref) === debouncedSpeakerId);
      if (speaker) return speaker;
    }

    // 4. Local como fallback
    if (localParticipant) {
      const local = cameraRefs.find(
        ref => trackIdentity(ref) === localParticipant.identity
      );
      if (local) return local;
    }

    // 5. Primer disponible
    return cameraRefs[0] ?? null;
  }, [screenRefs, cameraRefs, pinnedId, debouncedSpeakerId, localParticipant]);

  // Cuando cambia la pantalla compartida, auto-cambiar a modo escenario
  React.useEffect(() => {
    if (screenRefs.length > 0 && mode !== 'stage') {
      setMode('stage');
    }
  }, [screenRefs.length]);

  // Actualizar mainIdentity cuando cambia mainTrackRef
  React.useEffect(() => {
    setMainIdentity(mainTrackRef ? trackIdentity(mainTrackRef) : null);
  }, [mainTrackRef]);

  // Limpiar pin si el participante sale
  React.useEffect(() => {
    if (!pinnedId) return;
    const stillHere = participants.some(p => p.identity === pinnedId);
    if (!stillHere) setPinnedId(null);
  }, [participants, pinnedId]);

  // ── Tracks para la tira de miniaturas ─────────────────────────────────────
  // Todos los tracks de cámara excepto el que está en el escenario principal
  // Si hay pantalla compartida, mostrar el participante local de cámara en thumbs también

  const thumbTrackRefs = React.useMemo((): TrackReferenceOrPlaceholder[] => {
    const mainId = mainTrackRef ? trackIdentity(mainTrackRef) : null;

    if (screenRefs.length > 0) {
      // Con pantalla compartida: mostrar todas las cámaras en thumbs
      return cameraRefs;
    }

    // Sin pantalla compartida: mostrar todos excepto el principal
    return cameraRefs.filter(ref => trackIdentity(ref) !== mainId);
  }, [cameraRefs, screenRefs, mainTrackRef]);

  // ── Galería: número de columnas ───────────────────────────────────────────
  const galleryCount = cameraRefs.length;
  const galleryCols = galleryCount <= 1 ? 1
    : galleryCount <= 2 ? 2
    : galleryCount <= 4 ? 2
    : galleryCount <= 9 ? 3
    : 4;

  // ── Pin toggle (solo host) ────────────────────────────────────────────────
  const handlePinToggle = React.useCallback((identity: string) => {
    if (!isHost) return;
    setPinnedId(prev => prev === identity ? null : identity);
  }, [isHost]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0f',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <RoomAudioRenderer />

      {/* ── Barra superior: controles de layout ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '8px 12px',
          background: 'rgba(10,10,15,0.9)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          zIndex: 100,
          flexWrap: 'wrap',
        }}
      >
        {/* Toggle modo */}
        <LayoutToggleButton
          label={mode === 'stage' ? '⊞ Galería' : '◩ Escenario'}
          title={mode === 'stage' ? 'Cambiar a vista de galería' : 'Cambiar a vista de escenario'}
          onClick={() => setMode(m => m === 'stage' ? 'gallery' : 'stage')}
          active={false}
        />

        {/* Mostrar/ocultar miniaturas (solo modo escenario) */}
        {mode === 'stage' && (
          <LayoutToggleButton
            label={showThumbs ? '⊟ Ocultar miniaturas' : '⊞ Mostrar miniaturas'}
            title={showThumbs ? 'Ocultar tira de miniaturas' : 'Mostrar tira de miniaturas'}
            onClick={() => setShowThumbs(v => !v)}
            active={showThumbs}
          />
        )}

        {/* Quitar pin (solo host, solo si hay pin) */}
        {isHost && pinnedId && (
          <LayoutToggleButton
            label="📌 Quitar pin"
            title="Volver a hablante activo automático"
            onClick={() => setPinnedId(null)}
            active={true}
            activeColor="#C9A84C"
          />
        )}

        {/* Indicador de pantalla compartida */}
        {screenRefs.length > 0 && (
          <span
            style={{
              fontSize: '11px',
              color: '#60a5fa',
              fontWeight: 700,
              padding: '4px 10px',
              background: 'rgba(96,165,250,0.1)',
              border: '1px solid rgba(96,165,250,0.25)',
              borderRadius: '8px',
            }}
          >
            🖥 Pantalla compartida activa
          </span>
        )}

        {/* Chat toggle */}
        <LayoutToggleButton
          label={chatOpen ? '✕ Chat' : '💬 Chat'}
          title={chatOpen ? 'Cerrar chat' : 'Abrir chat'}
          onClick={() => setChatOpen(v => !v)}
          active={chatOpen}
        />
      </div>

      {/* ── Área principal ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

        {/* ── Contenido de sala ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

          {mode === 'stage' ? (
            /* ── MODO ESCENARIO ── */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              {/* Escenario principal */}
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
                {mainTrackRef ? (
                  <ParticipantTile
                    trackRef={mainTrackRef}
                    disableSpeakingIndicator={false}
                    style={{ width: '100%', height: '100%' }}
                  />
                ) : (
                  <EmptyStage />
                )}

                {/* Overlay: nombre del participante pinado + botón quitar */}
                {isHost && pinnedId && !screenRefs.length && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '12px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: 'rgba(201,168,76,0.12)',
                      border: '1px solid rgba(201,168,76,0.35)',
                      borderRadius: '20px',
                      padding: '5px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      zIndex: 10,
                    }}
                  >
                    <span style={{ fontSize: '12px', color: '#C9A84C', fontWeight: 700 }}>
                      📌 Escenario fijado
                    </span>
                    <button
                      onClick={() => setPinnedId(null)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(255,255,255,0.6)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>

              {/* Tira de miniaturas */}
              {showThumbs && thumbTrackRefs.length > 0 && (
                <ThumbStrip
                  trackRefs={thumbTrackRefs}
                  pinnedId={pinnedId}
                  mainIdentity={mainIdentity}
                  isHost={isHost}
                  onPin={handlePinToggle}
                />
              )}
            </div>

          ) : (
            /* ── MODO GALERÍA ── */
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '8px',
                display: 'grid',
                gridTemplateColumns: `repeat(${galleryCols}, 1fr)`,
                gap: '6px',
                alignContent: 'start',
              }}
            >
              {cameraRefs.map(ref => {
                const id = trackIdentity(ref);
                const isPinned = pinnedId === id;
                const isSpeaking = debouncedSpeakerId === id;

                return (
                  <div
                    key={`${id}-${ref.source}`}
                    style={{
                      position: 'relative',
                      aspectRatio: '16/9',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: isSpeaking
                        ? '2px solid #C9A84C'
                        : isPinned
                        ? '2px solid #60a5fa'
                        : '2px solid transparent',
                      cursor: isHost ? 'pointer' : 'default',
                    }}
                    onClick={() => isHost && handlePinToggle(id)}
                    title={isHost ? (isPinned ? 'Quitar del escenario' : 'Fijar en escenario') : undefined}
                  >
                    <ParticipantTile
                      trackRef={ref}
                      disableSpeakingIndicator={false}
                      style={{ width: '100%', height: '100%' }}
                    />
                    {isPinned && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          fontSize: '12px',
                          background: 'rgba(96,165,250,0.85)',
                          borderRadius: '4px',
                          padding: '1px 5px',
                        }}
                      >
                        📌
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Screen share en galería también */}
              {screenRefs.map(ref => (
                <div
                  key={`${trackIdentity(ref)}-screen`}
                  style={{
                    position: 'relative',
                    aspectRatio: '16/9',
                    borderRadius: '10px',
                    overflow: 'hidden',
                    border: '2px solid #60a5fa',
                    gridColumn: galleryCols > 1 ? 'span 2' : 'span 1',
                  }}
                >
                  <ParticipantTile
                    trackRef={ref}
                    disableSpeakingIndicator={true}
                    style={{ width: '100%', height: '100%' }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      top: '8px',
                      left: '8px',
                      fontSize: '11px',
                      fontWeight: 700,
                      color: '#60a5fa',
                      background: 'rgba(0,0,0,0.6)',
                      borderRadius: '6px',
                      padding: '3px 8px',
                    }}
                  >
                    🖥 Pantalla
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ── ControlBar de LiveKit ── */}
          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(10,10,15,0.95)',
            }}
          >
            <ControlBar
              variation="minimal"
              controls={{
                microphone: true,
                camera: true,
                screenShare: isHost,
                chat: false,  // Usamos nuestro propio chat toggle
                leave: true,
              }}
            />
          </div>
        </div>

        {/* ── Chat sidebar ── */}
        {chatOpen && (
          <div
            style={{
              width: '320px',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(12,12,20,0.98)',
              overflow: 'hidden',
              // Mobile: drawer desde abajo (via media query en CSS)
            }}
          >
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#C9A84C', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Chat
              </span>
              <button
                onClick={() => setChatOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: '2px 6px',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Chat messageFormatter={formatChatMessageLinks} />
            </div>
          </div>
        )}
      </div>

      {/* ── Estilos globales para mobile ── */}
      <style>{`
        @media (max-width: 640px) {
          .fenix-thumb-strip {
            flex-direction: row !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            height: 100px !important;
            max-height: 100px !important;
          }
          .fenix-thumb-strip .fenix-thumb {
            min-width: 140px !important;
            max-width: 140px !important;
            height: 100% !important;
          }
          .fenix-chat-sidebar {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            height: 60vh !important;
            border-left: none !important;
            border-top: 1px solid rgba(255,255,255,0.12) !important;
            z-index: 200 !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Sub-componente: tira de miniaturas ────────────────────────────────────────

interface ThumbStripProps {
  trackRefs: TrackReferenceOrPlaceholder[];
  pinnedId: string | null;
  mainIdentity: string | null;
  isHost: boolean;
  onPin: (identity: string) => void;
}

function ThumbStrip({ trackRefs, pinnedId, mainIdentity, isHost, onPin }: ThumbStripProps) {
  return (
    <div
      className="fenix-thumb-strip"
      style={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'row',
        gap: '5px',
        padding: '6px 8px',
        background: 'rgba(10,10,15,0.9)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        overflowX: 'auto',
        overflowY: 'hidden',
        height: '120px',
        maxHeight: '120px',
        alignItems: 'center',
      }}
    >
      {trackRefs.map(ref => {
        const id = trackIdentity(ref);
        const isPinned = pinnedId === id;
        const isMain   = mainIdentity === id;

        return (
          <div
            key={`${id}-${ref.source}-thumb`}
            className="fenix-thumb"
            onClick={() => isHost && onPin(id)}
            title={
              isHost
                ? isPinned
                  ? 'Quitar del escenario'
                  : 'Fijar en escenario'
                : undefined
            }
            style={{
              position: 'relative',
              flexShrink: 0,
              width: '160px',
              height: '100%',
              borderRadius: '8px',
              overflow: 'hidden',
              border: isPinned
                ? '2px solid #C9A84C'
                : isMain
                ? '2px solid rgba(255,255,255,0.2)'
                : '2px solid transparent',
              cursor: isHost ? 'pointer' : 'default',
              transition: 'border-color 0.2s',
            }}
          >
            <ParticipantTile
              trackRef={ref}
              disableSpeakingIndicator={false}
              style={{ width: '100%', height: '100%' }}
            />

            {/* Overlay: nombre */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                padding: '4px 6px 4px',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  color: '#fff',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '80%',
                }}
              >
                {ref.participant?.name || ref.participant?.identity || ''}
              </span>
              {isPinned && (
                <span style={{ fontSize: '10px' }}>📌</span>
              )}
            </div>

            {/* Indicador de "en escenario" */}
            {isMain && !isPinned && (
              <span
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  fontSize: '8px',
                  fontWeight: 700,
                  background: 'rgba(255,255,255,0.15)',
                  color: '#fff',
                  borderRadius: '4px',
                  padding: '1px 4px',
                  letterSpacing: '0.05em',
                }}
              >
                EN VIVO
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sub-componente: escenario vacío ───────────────────────────────────────────

function EmptyStage() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ fontSize: '48px', opacity: 0.3 }}>🎬</div>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px', fontWeight: 600, margin: 0 }}>
        Esperando participantes…
      </p>
    </div>
  );
}

// ── Sub-componente: botón de layout ──────────────────────────────────────────

interface LayoutToggleButtonProps {
  label: string;
  title: string;
  onClick: () => void;
  active: boolean;
  activeColor?: string;
}

function LayoutToggleButton({
  label,
  title,
  onClick,
  active,
  activeColor = '#60a5fa',
}: LayoutToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '5px 12px',
        background: active
          ? `${activeColor}18`
          : 'rgba(255,255,255,0.06)',
        border: `1px solid ${active ? activeColor + '44' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: '8px',
        color: active ? activeColor : 'rgba(255,255,255,0.7)',
        fontSize: '11px',
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}
