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
      // El host puede activarlo desde la sala; los alumnos lo activan solo si quieren hablar
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
    // Pasar rol → el servidor genera token con roomAdmin y metadata {isHost}
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
  role: string; // 'host' | 'attendee'
}) {
  const isHost = props.role === 'host';

  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      // 1080p por defecto (era 720p). Para 4K usa ?hq=true en la URL.
      resolution: props.options.hq ? VideoPresets.h2160 : VideoPresets.h1080,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      // Simulcast 1080p+720p en modo normal (antes 540+216 — muy baja calidad)
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h720, VideoPresets.h360],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
        echoCancellation: true,   // elimina eco del audio
        noiseSuppression: true,   // filtra ruido de fondo
        autoGainControl: true,    // normaliza volumen automáticamente
        // Mono: AEC funciona mejor con 1 canal (estéreo confunde el algoritmo)
        channelCount: 1,
      },
      // adaptiveStream: false → siempre recibe la capa de mayor calidad disponible
      // (antes: true bajaba automáticamente a 360p cuando el tile era pequeño)
      adaptiveStream: false,
      // dynacast: false → no limita calidad por ancho de banda estimado
      dynacast: false,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  // ── Krisp: cancelación de eco y ruido con IA ─────────────────────────────
  // Se aplica automáticamente al micrófono cuando se publica el track.
  // isKrispNoiseFilterSupported() verifica AudioWorklet (no disponible en Safari iOS).
  React.useEffect(() => {
    if (!isKrispNoiseFilterSupported()) return;

    const filter = KrispNoiseFilter();

    const applyKrisp = async (pub: LocalTrackPublication) => {
      if (pub.kind === 'audio' && pub.track) {
        try {
          await pub.track.setProcessor(filter);
          console.log('[Krisp] activo en micrófono');
        } catch (e) {
          console.warn('[Krisp] no se pudo aplicar:', e);
        }
      }
    };

    // Aplicar a tracks ya publicados (si el mic ya estaba encendido)
    room.localParticipant.audioTrackPublications.forEach(applyKrisp);
    // Aplicar a futuros tracks (cuando el usuario enciende mic)
    room.on(RoomEvent.LocalTrackPublished, applyKrisp);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, applyKrisp);
    };
  }, [room]);
  // ── /Krisp ───────────────────────────────────────────────────────────────

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
    return {
      autoSubscribe: true,
    };
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
          // ── iOS: NO auto-activar cámara/mic desde código ──────────────────
          // En iOS, getUserMedia solo funciona desde un gesto directo del usuario.
          // El gesto "Join Room" ya expiró cuando llegamos aquí (async + delay).
          // → El usuario activa 📹 y 🎙️ tocando los botones del ControlBar,
          //   que SÍ son gestos válidos y publican el track correctamente.
          const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
          if (isIOS) return; // iOS: esperar gesto del usuario en ControlBar

          // ── Desktop / Android: auto-activar normalmente ────────────────────
          if (props.userChoices.videoEnabled) {
            room.localParticipant.setCameraEnabled(true).catch((error) => {
              if (error?.name !== 'NotAllowedError' && error?.name !== 'NotFoundError') {
                handleError(error);
              }
            });
          }
          if (props.userChoices.audioEnabled) {
            room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
              if (error?.name !== 'NotAllowedError' && error?.name !== 'NotFoundError') {
                handleError(error);
              }
            });
          }
        })
        .catch((error) => {
          handleError(error);
        });
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);

  // Banner de hint para iOS — aparece 5s al entrar, recuerda tocar 📹🎙️
  const [showIOSHint, setShowIOSHint] = React.useState(() =>
    /iPhone|iPad|iPod/.test(navigator.userAgent)
  );
  React.useEffect(() => {
    if (!showIOSHint) return;
    const t = setTimeout(() => setShowIOSHint(false), 5000);
    return () => clearTimeout(t);
  }, [showIOSHint]);

  const router = useRouter();
  // Al salir → página "Sesión finalizada", NO el formulario de crear sala
  const handleOnLeave = React.useCallback(() => router.push('/salir'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    // Errores de permisos en iOS son normales — no mostrar alert intrusivo
    if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') return;
    alert(`Error inesperado: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Encountered an unexpected encryption error, check the console logs for details: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  // ── Fix efecto espejo en compartir pantalla ──────────────────────────────
  // selfBrowserSurface:'exclude' → Chrome oculta la pestaña actual de las opciones
  // displaySurface:'window'      → sugiere compartir una ventana, no el monitor entero
  // NOTA: iOS Safari no tiene getDisplayMedia — el guard evita crash en móvil
  React.useEffect(() => {
    if (!navigator.mediaDevices?.getDisplayMedia) return; // iOS / móvil → skip
    const original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
      const patched: DisplayMediaStreamOptions = {
        ...constraints,
        // @ts-ignore — propiedades Chrome no en el tipo estándar aún
        selfBrowserSurface: 'exclude',
        preferCurrentTab: false,
        video: {
          ...(typeof constraints?.video === 'object' && constraints.video !== null
            ? constraints.video
            : {}),
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
    return () => {
      navigator.mediaDevices.getDisplayMedia = original;
    };
  }, []);
  // ── /Fix espejo ──────────────────────────────────────────────────────────

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />
        {/* Asistentes: ocultar "Compartir pantalla" via CSS — solo host lo ve */}
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
        {/* Panel de moderación — SOLO visible para el anfitrión (host) */}
        {isHost && <ModeratorPanel roomName={props.connectionDetails.roomName} />}

        {/* Banner iOS: recordatorio de activar cámara/mic manualmente */}
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
