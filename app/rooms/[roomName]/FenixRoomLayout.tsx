'use client';

/**
 * FenixRoomLayout v3 — Vista profesional con overlay de miniaturas estilo Zoom
 *
 * Cambios respecto a v2:
 *   · micUnlocked prop — el micrófono en ControlBar solo aparece si el host
 *     o si el participante fue invitado a hablar y aceptó (flujo webinar)
 *   · Se eliminó la prop/lógica de HandRaiseButton (ya no vive aquí)
 */

import React from 'react';
import {
  useTracks,
  useParticipants,
  useSpeakingParticipants,
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
const SPEAKER_DEBOUNCE_MS = 1500;

interface FenixRoomLayoutProps {
  isHost: boolean;
  /**
   * true cuando el participante fue invitado a hablar y aceptó.
   * El host siempre tiene micUnlocked = true (se inicializa así en useRoomModeration).
   */
  micUnlocked?: boolean;
}

function trackIdentity(ref: TrackReferenceOrPlaceholder): string {
  return ref.participant?.identity ?? '';
}

// ── Componente principal ──────────────────────────────────────────────────────

export function FenixRoomLayout({ isHost, micUnlocked = false }: FenixRoomLayoutProps) {
  const [mode, setMode]         = React.useState<LayoutMode>('stage');
  const [chatOpen, setChatOpen] = React.useState(false);
  const [pinnedId, setPinnedId] = React.useState<string | null>(null);
  const [mainIdentity, setMainIdentity] = React.useState<string | null>(null);

  // ── Tracks ────────────────────────────────────────────────────────────────
  const allTrackRefs = useTracks(
    [
      { source: Track.Source.Camera,      withPlaceholder: true  },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  ) as TrackReferenceOrPlaceholder[];

  const participants = useParticipants();
  const speakingList = useSpeakingParticipants();

  const screenRefs = allTrackRefs.filter(ref => ref.source === Track.Source.ScreenShare);
  const cameraRefs = allTrackRefs.filter(ref => ref.source === Track.Source.Camera);

  // ── Detectar host desde metadata JWT ─────────────────────────────────────
  const hostIdentity = React.useMemo(() => {
    const host = participants.find(p => {
      try { return JSON.parse(p.metadata || '{}').isHost === true; }
      catch { return false; }
    });
    return host?.identity ?? null;
  }, [participants]);

  // ── Hablante activo con debounce de 1.5 s ────────────────────────────────
  const speakerTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSpeakerId, setDebouncedSpeakerId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const topSpeaker = speakingList[0];
    if (!topSpeaker) return;
    const id = topSpeaker.identity;
    if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
    if (id === debouncedSpeakerId) return;
    speakerTimerRef.current = setTimeout(() => setDebouncedSpeakerId(id), SPEAKER_DEBOUNCE_MS);
    return () => { if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current); };
  }, [speakingList]);

  // ── Track principal del escenario ─────────────────────────────────────────
  // Prioridad: pantalla → pin → hablante activo → HOST → primer disponible
  const mainTrackRef = React.useMemo((): TrackReferenceOrPlaceholder | null => {
    // 1. Pantalla compartida
    if (screenRefs.length > 0) return screenRefs[0];

    // 2. Pin manual (solo host puede pinear)
    if (pinnedId) {
      const pinned = cameraRefs.find(ref => trackIdentity(ref) === pinnedId);
      if (pinned) return pinned;
    }

    // 3. Hablante activo (con debounce)
    if (debouncedSpeakerId) {
      const speaker = cameraRefs.find(ref => trackIdentity(ref) === debouncedSpeakerId);
      if (speaker) return speaker;
    }

    // 4. HOST por defecto — todos los participantes ven al host, igual que Zoom
    if (hostIdentity) {
      const hostTrack = cameraRefs.find(ref => trackIdentity(ref) === hostIdentity);
      if (hostTrack) return hostTrack;
    }

    // 5. Primer disponible (sala sin host todavía)
    return cameraRefs[0] ?? null;
  }, [screenRefs, cameraRefs, pinnedId, debouncedSpeakerId, hostIdentity]);

  // Pantalla compartida → forzar modo escenario
  React.useEffect(() => {
    if (screenRefs.length > 0 && mode !== 'stage') setMode('stage');
  }, [screenRefs.length]);

  React.useEffect(() => {
    setMainIdentity(mainTrackRef ? trackIdentity(mainTrackRef) : null);
  }, [mainTrackRef]);

  // Limpiar pin si el participante sale
  React.useEffect(() => {
    if (!pinnedId) return;
    const stillHere = participants.some(p => p.identity === pinnedId);
    if (!stillHere) setPinnedId(null);
  }, [participants, pinnedId]);

  // ── Tracks para el overlay de miniaturas ──────────────────────────────────
  // Todos excepto el que está en el escenario principal
  const thumbTrackRefs = React.useMemo((): TrackReferenceOrPlaceholder[] => {
    const mainId = mainTrackRef ? trackIdentity(mainTrackRef) : null;
    if (screenRefs.length > 0) return cameraRefs; // pantalla compartida → todas las cámaras en thumbs
    return cameraRefs.filter(ref => trackIdentity(ref) !== mainId);
  }, [cameraRefs, screenRefs, mainTrackRef]);

  // ── Galería: columnas según participantes ─────────────────────────────────
  const galleryCount = cameraRefs.length;
  const galleryCols  = galleryCount <= 1 ? 1
    : galleryCount <= 2 ? 2
    : galleryCount <= 4 ? 2
    : galleryCount <= 9 ? 3
    : 4;

  const handlePinToggle = React.useCallback((identity: string) => {
    if (!isHost) return;
    setPinnedId(prev => prev === identity ? null : identity);
  }, [isHost]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0f',
      overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <RoomAudioRenderer />

      {/* ── Barra superior ── */}
      <div style={{
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
      }}>
        <LayoutToggleButton
          label={mode === 'stage' ? '⊞ Galería' : '◩ Escenario'}
          title={mode === 'stage' ? 'Vista de galería' : 'Vista de escenario'}
          onClick={() => setMode(m => m === 'stage' ? 'gallery' : 'stage')}
          active={false}
        />

        {isHost && pinnedId && (
          <LayoutToggleButton
            label="📌 Quitar pin"
            title="Volver a hablante activo automático"
            onClick={() => setPinnedId(null)}
            active={true}
            activeColor="#C9A84C"
          />
        )}

        {screenRefs.length > 0 && (
          <span style={{
            fontSize: '11px', color: '#60a5fa', fontWeight: 700,
            padding: '4px 10px',
            background: 'rgba(96,165,250,0.1)',
            border: '1px solid rgba(96,165,250,0.25)',
            borderRadius: '8px',
          }}>
            🖥 Pantalla compartida
          </span>
        )}

        <LayoutToggleButton
          label={chatOpen ? '✕ Chat' : '💬 Chat'}
          title={chatOpen ? 'Cerrar chat' : 'Abrir chat'}
          onClick={() => setChatOpen(v => !v)}
          active={chatOpen}
        />
      </div>

      {/* ── Área principal ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

          {mode === 'stage' ? (

            /* ── MODO ESCENARIO ── */
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>

              {/* Video principal */}
              {mainTrackRef ? (
                <ParticipantTile
                  trackRef={mainTrackRef}
                  disableSpeakingIndicator={false}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : (
                <EmptyStage />
              )}

              {/* Badge de pin activo */}
              {isHost && pinnedId && !screenRefs.length && (
                <div style={{
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
                }}>
                  <span style={{ fontSize: '12px', color: '#C9A84C', fontWeight: 700 }}>
                    📌 Escenario fijado
                  </span>
                  <button
                    onClick={() => setPinnedId(null)}
                    style={{
                      background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
                      fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
                    }}
                  >✕</button>
                </div>
              )}

              {/* Overlay de miniaturas — esquina superior derecha, estilo Zoom */}
              {thumbTrackRefs.length > 0 && (
                <ThumbnailOverlay
                  trackRefs={thumbTrackRefs}
                  pinnedId={pinnedId}
                  isHost={isHost}
                  onPin={handlePinToggle}
                />
              )}
            </div>

          ) : (

            /* ── MODO GALERÍA ── */
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: '8px',
              display: 'grid',
              gridTemplateColumns: `repeat(${galleryCols}, 1fr)`,
              gap: '6px',
              alignContent: 'start',
            }}>
              {cameraRefs.map(ref => {
                const id = trackIdentity(ref);
                const isPinned  = pinnedId === id;
                const isSpeaking = debouncedSpeakerId === id;
                return (
                  <div
                    key={`${id}-${ref.source}`}
                    onClick={() => isHost && handlePinToggle(id)}
                    title={isHost ? (isPinned ? 'Quitar del escenario' : 'Fijar en escenario') : undefined}
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
                  >
                    <ParticipantTile
                      trackRef={ref}
                      disableSpeakingIndicator={false}
                      style={{ width: '100%', height: '100%' }}
                    />
                    {isPinned && (
                      <span style={{
                        position: 'absolute', top: '6px', right: '6px',
                        fontSize: '12px', background: 'rgba(96,165,250,0.85)',
                        borderRadius: '4px', padding: '1px 5px',
                      }}>📌</span>
                    )}
                  </div>
                );
              })}

              {screenRefs.map(ref => (
                <div
                  key={`${trackIdentity(ref)}-screen`}
                  style={{
                    position: 'relative', aspectRatio: '16/9',
                    borderRadius: '10px', overflow: 'hidden',
                    border: '2px solid #60a5fa',
                    gridColumn: galleryCols > 1 ? 'span 2' : 'span 1',
                  }}
                >
                  <ParticipantTile
                    trackRef={ref}
                    disableSpeakingIndicator={true}
                    style={{ width: '100%', height: '100%' }}
                  />
                  <span style={{
                    position: 'absolute', top: '8px', left: '8px',
                    fontSize: '11px', fontWeight: 700, color: '#60a5fa',
                    background: 'rgba(0,0,0,0.6)', borderRadius: '6px', padding: '3px 8px',
                  }}>🖥 Pantalla</span>
                </div>
              ))}
            </div>
          )}

          {/* ── ControlBar ── */}
          <div style={{
            flexShrink: 0,
            borderTop: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(10,10,15,0.95)',
          }}>
            <ControlBar
              variation="minimal"
              controls={{
                // El micrófono está disponible solo si el host desbloqueó al participante
                // (o si es el propio host). Los participantes no pueden activarse solos.
                microphone: isHost || micUnlocked,
                camera: true,
                screenShare: isHost,
                chat: false,
                leave: true,
              }}
            />
          </div>
        </div>

        {/* ── Chat sidebar ── */}
        {chatOpen && (
          <div style={{
            width: '320px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(12,12,20,0.98)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: '12px', fontWeight: 700, color: '#C9A84C',
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>Chat</span>
              <button
                onClick={() => setChatOpen(false)}
                style={{
                  background: 'none', border: 'none',
                  color: 'rgba(255,255,255,0.5)', cursor: 'pointer',
                  fontSize: '16px', padding: '2px 6px', lineHeight: 1,
                }}
              >✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <Chat messageFormatter={formatChatMessageLinks} />
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile responsive ── */}
      <style>{`
        @media (max-width: 640px) {
          .fenix-thumb-overlay { width: 120px !important; }
          .fenix-thumb-tile    { width: 120px !important; height: 68px !important; }
        }
      `}</style>
    </div>
  );
}

// ── ThumbnailOverlay — top-right, estilo Zoom ─────────────────────────────────

interface ThumbOverlayProps {
  trackRefs:    TrackReferenceOrPlaceholder[];
  pinnedId:     string | null;
  isHost:       boolean;
  onPin:        (identity: string) => void;
}

function ThumbnailOverlay({ trackRefs, pinnedId, isHost, onPin }: ThumbOverlayProps) {
  const [expanded, setExpanded] = React.useState(true);

  if (trackRefs.length === 0) return null;

  return (
    <div
      className="fenix-thumb-overlay"
      style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '4px',
        width: '160px',
        maxHeight: 'calc(100% - 16px)',
        pointerEvents: 'auto',
      }}
    >
      {/* Botón [−] colapsar / [+ N] expandir */}
      <button
        onClick={() => setExpanded(v => !v)}
        title={expanded ? 'Colapsar participantes' : 'Expandir participantes'}
        style={{
          background: 'rgba(0,0,0,0.72)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: '8px',
          padding: '5px 12px',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 700,
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          lineHeight: 1,
          width: '100%',
          justifyContent: 'center',
          letterSpacing: '0.02em',
        }}
      >
        {expanded
          ? '− Ocultar'
          : `+ ${trackRefs.length} participante${trackRefs.length !== 1 ? 's' : ''}`}
      </button>

      {/* Tiles apilados verticalmente */}
      {expanded && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          overflowY: 'auto',
          maxHeight: 'calc(100% - 44px)',
          width: '100%',
        }}>
          {trackRefs.map(ref => {
            const id       = trackIdentity(ref);
            const isPinned = pinnedId === id;
            const name     = ref.participant?.name || ref.participant?.identity || '';

            return (
              <div
                key={`${id}-${ref.source}-overlay`}
                className="fenix-thumb-tile"
                onClick={() => isHost && onPin(id)}
                title={isHost ? (isPinned ? 'Quitar del escenario' : 'Fijar en escenario') : undefined}
                style={{
                  position:     'relative',
                  width:        '100%',
                  height:       '90px',
                  borderRadius: '8px',
                  overflow:     'hidden',
                  border:       isPinned
                    ? '2px solid #C9A84C'
                    : '2px solid rgba(255,255,255,0.14)',
                  cursor:       isHost ? 'pointer' : 'default',
                  flexShrink:   0,
                  background:   '#1a1a2e',
                  transition:   'border-color 0.2s',
                }}
              >
                <ParticipantTile
                  trackRef={ref}
                  disableSpeakingIndicator={false}
                  style={{ width: '100%', height: '100%' }}
                />

                {/* Nombre + pin badge */}
                <div style={{
                  position:   'absolute',
                  bottom:     0,
                  left:       0,
                  right:      0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.72))',
                  padding:    '4px 6px',
                  display:    'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                }}>
                  <span style={{
                    fontSize:     '9px',
                    fontWeight:   700,
                    color:        '#fff',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                    maxWidth:     '85%',
                  }}>{name}</span>
                  {isPinned && <span style={{ fontSize: '10px' }}>📌</span>}
                </div>

                {/* Indicador "Fijar" al hover — solo host */}
                {isHost && !isPinned && (
                  <div style={{
                    position:   'absolute',
                    inset:      0,
                    background: 'rgba(0,0,0,0)',
                    display:    'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity:    0,
                    transition: 'opacity 0.15s',
                    fontSize:   '11px',
                    fontWeight: 700,
                    color:      '#fff',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0.4)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '0'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,0,0,0)'; }}
                  >
                    📌 Fijar
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Escenario vacío ───────────────────────────────────────────────────────────

function EmptyStage() {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '12px',
    }}>
      <div style={{ fontSize: '48px', opacity: 0.3 }}>🎬</div>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '14px', fontWeight: 600, margin: 0 }}>
        Esperando participantes…
      </p>
    </div>
  );
}

// ── Botón de layout ───────────────────────────────────────────────────────────

interface LayoutToggleButtonProps {
  label:       string;
  title:       string;
  onClick:     () => void;
  active:      boolean;
  activeColor?: string;
}

function LayoutToggleButton({ label, title, onClick, active, activeColor = '#60a5fa' }: LayoutToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding:    '5px 12px',
        background: active ? `${activeColor}18` : 'rgba(255,255,255,0.06)',
        border:     `1px solid ${active ? activeColor + '44' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: '8px',
        color:      active ? activeColor : 'rgba(255,255,255,0.7)',
        fontSize:   '11px',
        fontWeight: 700,
        cursor:     'pointer',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}
