'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import {
  formatChatMessageLinks,
  LocalUserChoices,
  PreJoin,
  RoomContext,
  VideoConference,
} from '@livekit/components-react';
import { ModeratorPanel } from './ModeratorPanel';
import {
  ExternalE2EEKeyProvider,
  LocalTrackPublication,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  TrackPublishDefaults,
  VideoCaptureOptions,
} from 'livekit-client';
import { KrispNoiseFilter, isKrispNoiseFilterSupported } from '@livekit/krisp-noise-filter';
import { VideoEnhanceProcessor, isVideoEnhanceSupported } from '@/lib/VideoEnhanceProcessor';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
  role: string; // 'host' | 'attendee'
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: '',
      videoEnabled: true,
      // Asistentes entran con micrófono apagado por defecto (webinar standard)
      audioEnabled: false,
    };
  }, []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    url.searchParams.append('role', props.role);
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, [props.role]);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <PreJoin
            defaults={preJoinDefaults}
            onSubmit={handlePreJoinSubmit}
            onError={handlePreJoinError}
          />
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{
            codec: props.codec,
            hq: props.hq,
            singlePeerConnection: props.singlePeerConnection,
          }}
          role={props.role}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
    singlePeerConnection: boolean;
  };
  role: string;
}) {
  const isHost = props.role === 'host';

  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  // ── Mejora de imagen — estado (solo host) ────────────────────────────────
  const [videoEnhanced, setVideoEnhanced]   = React.useState(false);
  const [enhanceMs, setEnhanceMs]           = React.useState<number | null>(null);
  const processorRef     = React.useRef<VideoEnhanceProcessor | null>(null);
  const perfTimerRef     = React.useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref para evitar stale closure en event handlers de LiveKit
  const videoEnhancedRef = React.useRef(false);
  React.useEffect(() => { videoEnhancedRef.current = videoEnhanced; }, [videoEnhanced]);
  // ── /Mejora de imagen ────────────────────────────────────────────────────

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'h264';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h1080,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h720, VideoPresets.h360],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults,
      publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      adaptiveStream: false,
      dynacast: false,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  // ── Krisp: cancelación de ruido con IA ───────────────────────────────────
  React.useEffect(() => {
    if (!isKrispNoiseFilterSupported()) return;
    const filter = KrispNoiseFilter();
    const applyKrisp = async (pub: LocalTrackPublication) => {
      if (pub.kind === 'audio' && pub.track) {
        try {
          // @ts-ignore
          await pub.track.setProcessor(filter);
          console.log('[Krisp] activo en micrófono');
        } catch (e) {
          console.warn('[Krisp] no se pudo aplicar:', e);
        }
      }
    };
    room.localParticipant.audioTrackPublications.forEach(applyKrisp);
    room.on(RoomEvent.LocalTrackPublished, applyKrisp);
    return () => { room.off(RoomEvent.LocalTrackPublished, applyKrisp); };
  }, [room]);
  // ── /Krisp ───────────────────────────────────────────────────────────────

  // ── Toggle mejora de imagen ───────────────────────────────────────────────
  const toggleVideoEnhancement = React.useCallback(async () => {
    const camPub = Array.from(room.localParticipant.videoTrackPublications.values())
      .find(p => p.source === 'camera' && p.track);

    if (!camPub?.track) {
      console.warn('[VideoEnhance] no hay track de cámara activo');
      return;
    }

    if (videoEnhanced) {
      // ── Desactivar ───────────────────────────────────────────────────────
      try { await camPub.track.stopProcessor(); } catch (e) {
        console.warn('[VideoEnhance] stopProcessor error:', e);
      }
      if (processorRef.current) {
        await processorRef.current.destroy();
        processorRef.current = null;
      }
      if (perfTimerRef.current) { clearInterval(perfTimerRef.current); perfTimerRef.current = null; }
      setEnhanceMs(null);
      setVideoEnhanced(false);
      console.log('[VideoEnhance] desactivada');
    } else {
      // ── Activar ──────────────────────────────────────────────────────────
      if (!isVideoEnhanceSupported()) {
        alert('Tu navegador no soporta mejora de imagen (requiere Chrome 94+ o Edge 94+)');
        return;
      }
      await applyEnhancement(camPub.track);
    }
  }, [room, videoEnhanced]);

  // Función auxiliar: aplica el processor a un track específico.
  // Usada por el toggle Y por el re-apply automático en camera recycle.
  const applyEnhancement = React.useCallback(async (track: { setProcessor: (p: unknown) => Promise<void> }) => {
    const proc = new VideoEnhanceProcessor();
    try {
      // @ts-ignore — VideoEnhanceProcessor implementa TrackProcessor<video>
      await track.setProcessor(proc);
      processorRef.current = proc;

      // Limpiar timer anterior si existía
      if (perfTimerRef.current) { clearInterval(perfTimerRef.current); }

      // Polling: métricas + sync UI con estado real del processor
      perfTimerRef.current = setInterval(() => {
        const camPubNow = Array.from(room.localParticipant.videoTrackPublications.values())
          .find(p => p.source === 'camera' && p.track);
        const activeProc = camPubNow?.track?.getProcessor?.();

        // Detectar si el processor fue desconectado externamente
        if (!activeProc || activeProc.name !== 'fenix-video-enhance') {
          console.warn('[VideoEnhance] processor desconectado — sincronizando UI');
          if (perfTimerRef.current) { clearInterval(perfTimerRef.current); perfTimerRef.current = null; }
          processorRef.current = null;
          setEnhanceMs(null);
          setVideoEnhanced(false);
          return;
        }

        setEnhanceMs(processorRef.current?.lastFrameMs ?? null);
      }, 1000);

      setVideoEnhanced(true);
      console.log('[VideoEnhance] activa — shader WebGL2 en cámara');
    } catch (err) {
      console.error('[VideoEnhance] error al activar:', err);
      await proc.destroy();
      // No dejar la cámara en negro — asegurar que el processor está limpio
      alert('No se pudo activar la mejora de imagen. Revisa la consola.');
    }
  }, [room]);

  // ── Re-apply automático si la cámara crea un track nuevo ─────────────────
  // LiveKit crea un MediaStreamTrack NUEVO al hacer setCameraEnabled(false/true).
  // El processor se desconecta del track anterior. Si videoEnhanced era true,
  // re-aplicamos automáticamente al track nuevo.
  // Regla: estado UI = estado real del processor EN TODO MOMENTO.
  React.useEffect(() => {
    const handleLocalTrackPublished = async (pub: LocalTrackPublication) => {
      // Solo cámara — no screen share, no audio
      if (pub.source !== 'camera' || !pub.track) return;
      if (!videoEnhancedRef.current) return; // mejora no estaba activa

      // El toggle está activo pero el nuevo track no tiene processor
      const existingProc = pub.track.getProcessor?.();
      if (existingProc?.name === 'fenix-video-enhance') return; // ya tiene uno

      console.log('[VideoEnhance] nuevo track de cámara detectado — re-aplicando mejora');

      // Destruir processor anterior si quedó huérfano
      if (processorRef.current) {
        await processorRef.current.destroy().catch(() => {});
        processorRef.current = null;
      }

      if (!isVideoEnhanceSupported()) return;
      await applyEnhancement(pub.track);
    };

    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    return () => { room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished); };
  }, [room, applyEnhancement]);

  // Limpiar processor al desmontar (salir de la sala)
  React.useEffect(() => {
    return () => {
      if (processorRef.current) { processorRef.current.destroy(); processorRef.current = null; }
      if (perfTimerRef.current) { clearInterval(perfTimerRef.current); perfTimerRef.current = null; }
    };
  }, []);
  // ── /Mejora de imagen ─────────────────────────────────────────────────────

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `You're trying to join an encrypted meeting, but your browser does not support it. Please update it to the latest version and try again.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return { autoSubscribe: true };
  }, []);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleError);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .then(() => {
          const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
          if (isIOS) return;

          if (props.userChoices.videoEnabled) {
            room.localParticipant.setCameraEnabled(true).catch((error) => {
              if (error?.name !== 'NotAllowedError' && error?.name !== 'NotFoundError') handleError(error);
            });
          }
          if (props.userChoices.audioEnabled) {
            room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
              if (error?.name !== 'NotAllowedError' && error?.name !== 'NotFoundError') handleError(error);
            });
          }
        })
        .catch(handleError);
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const [showIOSHint, setShowIOSHint] = React.useState(() =>
    /iPhone|iPad|iPod/.test(navigator.userAgent)
  );
  React.useEffect(() => {
    if (!showIOSHint) return;
    const t = setTimeout(() => setShowIOSHint(false), 5000);
    return () => clearTimeout(t);
  }, [showIOSHint]);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/salir'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') return;
    alert(`Error inesperado: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(`Encountered an unexpected encryption error: ${error.message}`);
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) console.warn('Low power mode enabled');
  }, [lowPowerMode]);

  // ── Fix espejo en compartir pantalla ─────────────────────────────────────
  React.useEffect(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
      const patched: DisplayMediaStreamOptions = {
        ...constraints,
        // @ts-ignore
        selfBrowserSurface: 'exclude',
        preferCurrentTab: false,
        video: {
          ...(typeof constraints?.video === 'object' && constraints.video !== null ? constraints.video : {}),
          // @ts-ignore
          displaySurface: 'window',
          frameRate: { ideal: 30, max: 60 },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: constraints?.audio ?? true,
      };
      return original(patched);
    };
    return () => { navigator.mediaDevices.getDisplayMedia = original; };
  }, []);
  // ── /Fix espejo ──────────────────────────────────────────────────────────

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        {/* Asistentes: ocultar compartir pantalla */}
        {!isHost && (
          <style>{`
            button[data-lk-source="screen_share"],
            button[data-lk-source="screen_share_audio"] { display: none !important; }
          `}</style>
        )}
        <VideoConference
          chatMessageFormatter={formatChatMessageLinks}
          SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
        />

        {/* Panel de moderación — SOLO host
            Posición: bottom 80px, right 16px (botón circular 48px) */}
        {isHost && <ModeratorPanel roomName={props.connectionDetails.roomName} />}

        {/* Botón mejora de imagen — SOLO host, SOLO Chrome/Edge
            Posición: bottom 140px, right 16px
            (encima del ModeratorPanel: 80 + 48 + 12px gap = 140)
            Nunca se superpone con el panel de participantes */}
        {isHost && isVideoEnhanceSupported() && (
          <div
            style={{
              position: 'fixed',
              bottom: '140px',
              right: '16px',
              zIndex: 9998, // un nivel por debajo del ModeratorPanel (9999)
            }}
          >
            <button
              onClick={toggleVideoEnhancement}
              title={
                videoEnhanced
                  ? 'Desactivar mejora de imagen'
                  : 'Activar mejora de imagen (nitidez · contraste · brillo · color)'
              }
              style={{
                background: videoEnhanced
                  ? 'rgba(201,168,76,0.92)'
                  : 'rgba(10,10,15,0.85)',
                border: `1px solid ${videoEnhanced ? 'rgba(201,168,76,0.7)' : 'rgba(255,255,255,0.18)'}`,
                borderRadius: '10px',
                padding: '8px 14px',
                color: videoEnhanced ? '#0a0a0f' : '#ffffff',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.02em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: videoEnhanced
                  ? '0 2px 14px rgba(201,168,76,0.35)'
                  : '0 2px 12px rgba(0,0,0,0.45)',
                transition: 'all 0.18s ease',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: '14px' }}>✨</span>
              <span>{videoEnhanced ? 'Mejora activa' : 'Mejorar imagen'}</span>
              {videoEnhanced && enhanceMs !== null && (
                <span style={{ opacity: 0.65, fontSize: '10px', fontWeight: 400, marginLeft: '2px' }}>
                  {enhanceMs.toFixed(1)}ms
                </span>
              )}
            </button>
          </div>
        )}

        {/* Banner iOS */}
        {showIOSHint && (
          <div
            style={{
              position: 'fixed',
              top: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(10,10,15,0.95)',
              border: '1px solid rgba(201,168,76,0.4)',
              borderRadius: '12px',
              padding: '10px 18px',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: '18px' }}>📹🎙️</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#ffffff' }}>
              Toca los botones para activar tu cámara y micrófono
            </span>
          </div>
        )}
        <DebugMode />
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}
