'use client';

/**
 * FenixRoomLayout v5 — Con la forma de Zoom
 *
 * Lo de antes funcionaba pero había que aprenderlo: una barra de cuatro iconos
 * sin nombre, el chat escondido tras un botón arriba, la lista de participantes
 * en una burbuja flotante que solo veía el anfitrión, y encima de todo eso tres
 * botones redondos apilados en la esquina tapando el vídeo.
 *
 * Ahora la sala tiene la gramática que la gente ya trae aprendida:
 *   · una sola barra abajo, con cada icono nombrado
 *   · chat y participantes como paneles del costado, que estrechan el vídeo
 *     en vez de taparlo, y solo uno abierto a la vez
 *   · reacciones que suben por la pantalla y se apagan solas
 *   · cuadros redondeados, con el nombre y el micro abajo a la izquierda
 *
 * Nada de lo que ya funcionaba cambió de comportamiento: el escenario sigue
 * eligiendo pantalla → pin → hablante → anfitrión, la cortinilla sigue mandando
 * mientras dure, y el botón rojo del anfitrión sigue cerrando la sala entera.
 */

import React from 'react';
import {
  useTracks,
  useParticipants,
  useSpeakingParticipants,
  useChat,
  useRoomContext,
  ParticipantTile,
  Chat,
  RoomAudioRenderer,
  formatChatMessageLinks,
  TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { IntroStage } from './IntroStage';
import { EndSessionButton } from './EndSessionButton';
import { ControlDock, HostTool } from './ControlDock';
import { ParticipantsPanel } from './ParticipantsPanel';
import { PanelShell } from './PanelShell';
import { ReactionsOverlay } from './ReactionsOverlay';
import { useReactions } from '@/lib/useReactions';
import type { ModerationState } from '@/lib/useRoomModeration';
import type { IntroRef } from '@/lib/vimeoIntro';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type LayoutMode = 'stage' | 'gallery';
type Panel = 'participantes' | 'chat' | null;
const SPEAKER_DEBOUNCE_MS = 1500;

export interface IntroConfig {
  ref: IntroRef;
  startedAtMs: number;
  durationSec: number;
}

interface FenixRoomLayoutProps {
  isHost: boolean;
  /** Cortinilla de apertura. Ausente = la sala abre directo a las cámaras. */
  intro?: IntroConfig | null;
  /** Diferencia reloj local - reloj del servidor. */
  clockOffsetMs: number;
  /** Necesarios para que el anfitrión pueda cerrar la sala desde la barra. */
  roomName: string;
  pass: string | null;
  /** Manos levantadas, silencios, invitaciones. */
  moderation: ModerationState;
  /** Grabación, mejora de imagen… lo que va dentro del menú "Más". */
  hostTools?: HostTool[];
}

function trackIdentity(ref: TrackReferenceOrPlaceholder): string {
  return ref.participant?.identity ?? '';
}

// ── Componente principal ──────────────────────────────────────────────────────

export function FenixRoomLayout({
  isHost,
  intro,
  clockOffsetMs,
  roomName,
  pass,
  moderation,
  hostTools = [],
}: FenixRoomLayoutProps) {
  const [mode, setMode] = React.useState<LayoutMode>('stage');
  const [panel, setPanel] = React.useState<Panel>(null);
  const [pinnedId, setPinnedId] = React.useState<string | null>(null);
  const [manoLevantada, setManoLevantada] = React.useState(false);

  const room = useRoomContext();
  const reacciones = useReactions(room);

  // ── Intro ─────────────────────────────────────────────────────────────────
  // Solo cuenta si todavía le queda tiempo. Quien entre cuando la cortinilla
  // ya pasó entra a la sesión, no a un video terminado.
  const introVigente = React.useMemo(() => {
    if (!intro) return false;
    const ahoraSincronizado = Date.now() - clockOffsetMs;
    const transcurrido = (ahoraSincronizado - intro.startedAtMs) / 1000;
    return transcurrido < intro.durationSec;
  }, [intro, clockOffsetMs]);

  const [introCorriendo, setIntroCorriendo] = React.useState(introVigente);
  React.useEffect(() => setIntroCorriendo(introVigente), [introVigente]);

  // ── Tracks ────────────────────────────────────────────────────────────────
  const allTrackRefs = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  ) as TrackReferenceOrPlaceholder[];

  const participants = useParticipants();
  const speakingList = useSpeakingParticipants();

  const screenRefs = allTrackRefs.filter((ref) => ref.source === Track.Source.ScreenShare);
  const cameraRefs = allTrackRefs.filter((ref) => ref.source === Track.Source.Camera);

  // ── Chat sin leer ─────────────────────────────────────────────────────────
  // El contador solo tiene sentido si el panel está cerrado: mientras está
  // abierto, todo lo que llega ya se está leyendo.
  const { chatMessages } = useChat();
  const [vistoHasta, setVistoHasta] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (panel === 'chat') setVistoHasta(Date.now());
  }, [panel, chatMessages.length]);
  const sinLeer =
    panel === 'chat' ? 0 : chatMessages.filter((m) => m.timestamp > vistoHasta).length;

  // ── Detectar host desde metadata JWT ─────────────────────────────────────
  const hostIdentity = React.useMemo(() => {
    const host = participants.find((p) => {
      try {
        return JSON.parse(p.metadata || '{}').isHost === true;
      } catch {
        return false;
      }
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
    return () => {
      if (speakerTimerRef.current) clearTimeout(speakerTimerRef.current);
    };
  }, [speakingList]);

  // ── Track principal del escenario ─────────────────────────────────────────
  // Prioridad: pantalla → pin → hablante activo → HOST → primer disponible
  const mainTrackRef = React.useMemo((): TrackReferenceOrPlaceholder | null => {
    // 1. Pantalla compartida
    if (screenRefs.length > 0) return screenRefs[0];

    // 2. Pin manual (solo host puede pinear)
    if (pinnedId) {
      const pinned = cameraRefs.find((ref) => trackIdentity(ref) === pinnedId);
      if (pinned) return pinned;
    }

    // 3. Hablante activo (con debounce)
    if (debouncedSpeakerId) {
      const speaker = cameraRefs.find((ref) => trackIdentity(ref) === debouncedSpeakerId);
      if (speaker) return speaker;
    }

    // 4. HOST por defecto — todos los participantes ven al host, igual que Zoom
    if (hostIdentity) {
      const hostTrack = cameraRefs.find((ref) => trackIdentity(ref) === hostIdentity);
      if (hostTrack) return hostTrack;
    }

    // 5. Primer disponible (sala sin host todavía)
    return cameraRefs[0] ?? null;
  }, [screenRefs, cameraRefs, pinnedId, debouncedSpeakerId, hostIdentity]);

  // Pantalla compartida → forzar modo escenario
  React.useEffect(() => {
    if (screenRefs.length > 0 && mode !== 'stage') setMode('stage');
  }, [screenRefs.length]);

  // Limpiar pin si el participante sale
  React.useEffect(() => {
    if (!pinnedId) return;
    const stillHere = participants.some((p) => p.identity === pinnedId);
    if (!stillHere) setPinnedId(null);
  }, [participants, pinnedId]);

  // ── Tracks para el overlay de miniaturas ──────────────────────────────────
  // Todos excepto el que está en el escenario principal
  const thumbTrackRefs = React.useMemo((): TrackReferenceOrPlaceholder[] => {
    // Durante la intro el escenario lo ocupa el video, así que nadie está
    // "en el escenario": todos van apareciendo en las miniaturas conforme
    // entran. Eso es justo lo que queremos que se vea — la sala llenándose.
    if (introCorriendo) return cameraRefs;
    const mainId = mainTrackRef ? trackIdentity(mainTrackRef) : null;
    if (screenRefs.length > 0) return cameraRefs; // pantalla compartida → todas las cámaras en thumbs
    return cameraRefs.filter((ref) => trackIdentity(ref) !== mainId);
  }, [cameraRefs, screenRefs, mainTrackRef, introCorriendo]);

  // ── Al terminar la intro, el escenario es del anfitrión ───────────────────
  // Sin esto, si alguien tosió durante la cortinilla se quedaría él en el
  // escenario cuando el video acabe. Limpiamos pin y hablante para que la
  // prioridad caiga sola en el host, que es el paso 4 de la lista de arriba.
  const introCorriaAntes = React.useRef(introCorriendo);
  React.useEffect(() => {
    if (introCorriaAntes.current && !introCorriendo) {
      setPinnedId(null);
      setDebouncedSpeakerId(null);
      setMode('stage');
    }
    introCorriaAntes.current = introCorriendo;
  }, [introCorriendo]);

  // Mientras corre la cortinilla la vista es siempre escenario: la galería
  // no tiene dónde poner un video que no es de nadie.
  React.useEffect(() => {
    if (introCorriendo) setMode('stage');
  }, [introCorriendo]);

  // ── Galería: columnas según participantes ─────────────────────────────────
  const galleryCount = cameraRefs.length;
  const galleryCols =
    galleryCount <= 1
      ? 1
      : galleryCount <= 2
        ? 2
        : galleryCount <= 4
          ? 2
          : galleryCount <= 9
            ? 3
            : 4;

  const handlePinToggle = React.useCallback(
    (identity: string) => {
      if (!isHost) return;
      setPinnedId((prev) => (prev === identity ? null : identity));
    },
    [isHost],
  );

  // ── Mano levantada ────────────────────────────────────────────────────────
  const alternarMano = React.useCallback(() => {
    setManoLevantada((antes) => {
      void (antes ? moderation.actions.lowerHand() : moderation.actions.raiseHand());
      return !antes;
    });
  }, [moderation]);

  // Cuando el anfitrión da la palabra, la mano se baja sola: dejarla arriba
  // haría que el alumno tuviera que acordarse de bajarla él.
  React.useEffect(() => {
    if (moderation.pendingInvite === 'speak') setManoLevantada(false);
  }, [moderation.pendingInvite]);

  const manosIds = React.useMemo(
    () => new Set(moderation.raisedHands.map((h) => h.identity)),
    [moderation.raisedHands],
  );

  const alternarPanel = React.useCallback((p: Exclude<Panel, null>) => {
    setPanel((actual) => (actual === p ? null : p));
  }, []);

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
      <EstilosDeSala />

      {/* ── Barra superior ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '7px 12px',
          background: 'rgba(10,10,15,0.9)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          zIndex: 100,
          flexWrap: 'wrap',
        }}
      >
        {/* Durante la cortinilla no hay galería que ofrecer: el escenario lo
            ocupa un video que no pertenece a ningún participante. */}
        {!introCorriendo && (
          <LayoutToggleButton
            label={mode === 'stage' ? '⊞ Galería' : '◩ Escenario'}
            title={mode === 'stage' ? 'Vista de galería' : 'Vista de escenario'}
            onClick={() => setMode((m) => (m === 'stage' ? 'gallery' : 'stage'))}
            active={false}
          />
        )}

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
            🖥 Pantalla compartida
          </span>
        )}
      </div>

      {/* ── Área principal ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {mode === 'stage' ? (
            /* ── MODO ESCENARIO ── */
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
              {/* Video principal — la cortinilla manda mientras dure */}
              {introCorriendo && intro ? (
                <IntroStage
                  introRef={intro.ref}
                  startedAtMs={intro.startedAtMs}
                  clockOffsetMs={clockOffsetMs}
                  durationSec={intro.durationSec}
                  onEnded={() => setIntroCorriendo(false)}
                  // El toque que ocurre encima de la cortinilla es, muchas
                  // veces, el único que el alumno del móvil llega a dar antes
                  // de que empiece la clase. Se aprovecha para desbloquear
                  // también el audio de la sala: si se pierde ese gesto, el
                  // alumno se queda sin oír el resto de la sesión.
                  onGesto={() => {
                    if (!room.canPlaybackAudio) void room.startAudio().catch(() => {});
                  }}
                />
              ) : mainTrackRef ? (
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

              {/* Overlay de miniaturas — esquina superior derecha, estilo Zoom */}
              {thumbTrackRefs.length > 0 && (
                <ThumbnailOverlay
                  trackRefs={thumbTrackRefs}
                  pinnedId={pinnedId}
                  isHost={isHost}
                  onPin={handlePinToggle}
                  reacciones={reacciones.porParticipante}
                  manos={manosIds}
                />
              )}

              {/* Los emojis suben por encima del vídeo, sin robarle los clics */}
              <ReactionsOverlay reacciones={reacciones.volando} />
            </div>
          ) : (
            /* ── MODO GALERÍA ── */
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '10px',
                display: 'grid',
                gridTemplateColumns: `repeat(${galleryCols}, 1fr)`,
                gap: '8px',
                alignContent: 'start',
                position: 'relative',
              }}
            >
              {cameraRefs.map((ref) => {
                const id = trackIdentity(ref);
                const isPinned = pinnedId === id;
                return (
                  <div
                    key={`${id}-${ref.source}`}
                    onClick={() => isHost && handlePinToggle(id)}
                    title={
                      isHost
                        ? isPinned
                          ? 'Quitar del escenario'
                          : 'Fijar en escenario'
                        : undefined
                    }
                    style={{
                      position: 'relative',
                      aspectRatio: '16/9',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      border: isPinned ? '2px solid #60a5fa' : '2px solid transparent',
                      cursor: isHost ? 'pointer' : 'default',
                    }}
                  >
                    <ParticipantTile
                      trackRef={ref}
                      disableSpeakingIndicator={false}
                      style={{ width: '100%', height: '100%' }}
                    />
                    <Distintivos
                      reaccion={reacciones.porParticipante[id]}
                      mano={manosIds.has(id)}
                      pin={isPinned}
                      grande
                    />
                  </div>
                );
              })}

              {screenRefs.map((ref) => (
                <div
                  key={`${trackIdentity(ref)}-screen`}
                  style={{
                    position: 'relative',
                    aspectRatio: '16/9',
                    borderRadius: '12px',
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

              <ReactionsOverlay reacciones={reacciones.volando} />
            </div>
          )}

          {/* ── La barra de abajo ── */}
          <ControlDock
            isHost={isHost}
            puedeCompartirPantalla={moderation.screenUnlocked}
            totalParticipantes={participants.length}
            manosLevantadas={isHost ? moderation.raisedHands.length : 0}
            sinLeer={sinLeer}
            panelAbierto={panel}
            onTogglePanel={alternarPanel}
            onReaccion={reacciones.enviar}
            manoLevantada={manoLevantada}
            onToggleMano={alternarMano}
            herramientas={hostTools}
            botonSalir={<EndSessionButton roomName={roomName} pass={pass} />}
          />
        </div>

        {/* ── Paneles del costado ── */}
        {panel === 'participantes' && (
          <ParticipantsPanel
            roomName={roomName}
            moderation={moderation}
            isHost={isHost}
            reacciones={reacciones.porParticipante}
            onClose={() => setPanel(null)}
          />
        )}

        {panel === 'chat' && (
          <PanelShell titulo="Chat" onClose={() => setPanel(null)}>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <Chat messageFormatter={formatChatMessageLinks} />
            </div>
          </PanelShell>
        )}
      </div>
    </div>
  );
}

// ── Distintivos sobre un cuadro ───────────────────────────────────────────────

function Distintivos({
  reaccion,
  mano,
  pin,
  grande,
}: {
  reaccion?: string;
  mano?: boolean;
  pin?: boolean;
  grande?: boolean;
}) {
  if (!reaccion && !mano && !pin) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: grande ? '8px' : '5px',
        right: grande ? '8px' : '5px',
        display: 'flex',
        gap: '4px',
        pointerEvents: 'none',
      }}
    >
      {mano && <span style={burbuja(grande)}>✋</span>}
      {reaccion && <span style={burbuja(grande)}>{reaccion}</span>}
      {pin && <span style={burbuja(grande)}>📌</span>}
    </div>
  );
}

function burbuja(grande?: boolean): React.CSSProperties {
  return {
    fontSize: grande ? '15px' : '12px',
    lineHeight: 1,
    background: 'rgba(0,0,0,0.6)',
    borderRadius: '8px',
    padding: grande ? '4px 6px' : '3px 5px',
  };
}

// ── ThumbnailOverlay — top-right, estilo Zoom ─────────────────────────────────

interface ThumbOverlayProps {
  trackRefs: TrackReferenceOrPlaceholder[];
  pinnedId: string | null;
  isHost: boolean;
  onPin: (identity: string) => void;
  reacciones: Record<string, string>;
  manos: Set<string>;
}

function ThumbnailOverlay({
  trackRefs,
  pinnedId,
  isHost,
  onPin,
  reacciones,
  manos,
}: ThumbOverlayProps) {
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
        width: '168px',
        maxHeight: 'calc(100% - 16px)',
        pointerEvents: 'auto',
      }}
    >
      {/* Botón [−] colapsar / [+ N] expandir */}
      <button
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? 'Colapsar participantes' : 'Expandir participantes'}
        style={{
          background: 'rgba(0,0,0,0.72)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: '9px',
          padding: '5px 12px',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '12px',
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
          fontFamily: 'inherit',
        }}
      >
        {expanded
          ? '− Ocultar'
          : `+ ${trackRefs.length} participante${trackRefs.length !== 1 ? 's' : ''}`}
      </button>

      {/* Tiles apilados verticalmente */}
      {expanded && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            overflowY: 'auto',
            maxHeight: 'calc(100% - 44px)',
            width: '100%',
          }}
        >
          {trackRefs.map((ref) => {
            const id = trackIdentity(ref);
            const isPinned = pinnedId === id;

            return (
              <div
                key={`${id}-${ref.source}-overlay`}
                className="fenix-thumb-tile"
                onClick={() => isHost && onPin(id)}
                title={
                  isHost ? (isPinned ? 'Quitar del escenario' : 'Fijar en escenario') : undefined
                }
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '95px',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: isPinned ? '2px solid #C9A84C' : '2px solid rgba(255,255,255,0.12)',
                  cursor: isHost ? 'pointer' : 'default',
                  flexShrink: 0,
                  background: '#1a1a2e',
                  transition: 'border-color 0.2s',
                }}
              >
                <ParticipantTile
                  trackRef={ref}
                  disableSpeakingIndicator={false}
                  style={{ width: '100%', height: '100%' }}
                />
                <Distintivos reaccion={reacciones[id]} mano={manos.has(id)} pin={isPinned} />
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

// ── Botón de layout ───────────────────────────────────────────────────────────

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
        background: active ? `${activeColor}18` : 'rgba(255,255,255,0.06)',
        border: `1px solid ${active ? activeColor + '44' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: '8px',
        color: active ? activeColor : 'rgba(255,255,255,0.7)',
        fontSize: '11px',
        fontWeight: 700,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
        transition: 'all 0.15s',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

// ── Estilos de sala ───────────────────────────────────────────────────────────

/**
 * Los cuadros los dibuja LiveKit; aquí solo les cambiamos la piel. Reescribir
 * el componente entero para redondear una esquina sería cambiar el motor por
 * el color de la carrocería — y perderíamos gratis todo lo que ya resuelve:
 * el placeholder cuando no hay cámara, el icono de micro, la calidad de red.
 */
function EstilosDeSala() {
  return (
    <style>{`
      .lk-participant-tile {
        border-radius: 12px;
        overflow: hidden;
        background: #1a1a24;
      }
      .lk-participant-tile .lk-participant-placeholder { background: #1a1a24; }

      /* Quien habla se enmarca en el oro de Fénix, no en el azul de fábrica. */
      .lk-participant-tile[data-lk-speaking="true"] {
        outline: 2px solid #C9A84C;
        outline-offset: -2px;
        box-shadow: 0 0 0 3px rgba(201,168,76,0.16);
      }

      /* El nombre, abajo a la izquierda, en una píldora legible sobre
         cualquier fondo — como Zoom. */
      .lk-participant-tile .lk-participant-metadata-item {
        background: rgba(0,0,0,0.55);
        border-radius: 8px;
        padding: 3px 8px;
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
      }
      .lk-participant-tile .lk-participant-name {
        font-size: 12px;
        font-weight: 600;
      }

      /* El chat de LiveKit viene con su propio fondo y su propio borde; dentro
         de nuestro panel sobran los dos. */
      .fenix-panel .lk-chat {
        background: transparent;
        border: none;
        height: 100%;
      }
      .fenix-panel .lk-chat-form-input {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px;
        color: #fff;
      }
      .fenix-panel .lk-chat-entry { font-size: 13px; }

      @media (max-width: 640px) {
        .fenix-thumb-overlay { width: 118px !important; }
        .fenix-thumb-tile    { height: 68px !important; }
        /* En el móvil el panel se come la pantalla entera: 320px al lado de
           un vídeo dejarían el vídeo en nada. */
        .fenix-panel { position: absolute; inset: 0; width: 100% !important; z-index: 150; }
      }
    `}</style>
  );
}
