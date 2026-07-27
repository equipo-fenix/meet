'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { ConnectionDetails } from '@/lib/types';
import { LocalUserChoices, PreJoin, RoomContext, useIsRecording } from '@livekit/components-react';
import { LobbyBar } from './LobbyBar';
import { sessionIdHintFromPass } from '@/lib/clientRoomPass';
import type { IntroConfig } from './FenixRoomLayout';
import { FenixRoomLayout } from './FenixRoomLayout';
import type { HostTool } from './ControlDock';
import type { ModerationState } from '@/lib/useRoomModeration';
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
import { VideoEnhanceProcessor, isVideoEnhanceSupported } from '@/lib/VideoEnhanceProcessor';
import { useRoomModeration, PendingInviteType } from '@/lib/useRoomModeration';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';
import toast from 'react-hot-toast';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';

// ── PageClientImpl ────────────────────────────────────────────────────────────

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
  role: string; // pista para la interfaz; el permiso real lo concede el pase
  pass?: string;
  name?: string;
  micDefault?: boolean;
  camDefault?: boolean;
  /** Cortinilla de apertura. Ausente = la sala abre directo a las cámaras. */
  intro?: IntroConfig | null;
  /** Las sesiones de la Academia se graban solas en cuanto llega el anfitrión. */
  autoRecord?: boolean;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const preJoinDefaults = React.useMemo(
    () => ({
      username: props.name ?? '',
      videoEnabled: props.camDefault ?? true,
      audioEnabled: props.micDefault ?? false,
    }),
    [props.name, props.camDefault, props.micDefault],
  );
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(
    async (values: LocalUserChoices) => {
      setJoinError(null);
      setPreJoinChoices(values);
      const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
      url.searchParams.append('roomName', props.roomName);
      url.searchParams.append('participantName', values.username);
      if (props.region) url.searchParams.append('region', props.region);
      url.searchParams.append('role', props.role);
      if (props.pass) url.searchParams.append('pass', props.pass);
      const resp = await fetch(url.toString());
      if (!resp.ok) {
        // La puerta dijo que no. Devolvemos a la persona al lobby con un motivo
        // en su idioma, en vez de dejarla mirando una pantalla en blanco.
        setPreJoinChoices(undefined);
        setJoinError(
          resp.status === 403
            ? 'Este enlace no da acceso por sí solo. Entra desde tu agenda en la Academia o pide al anfitrión que te deje pasar.'
            : 'No pudimos conectarte a la sala. Vuelve a intentarlo en unos segundos.',
        );
        return;
      }
      const data = await resp.json();
      setConnectionDetails(data);
    },
    [props.role, props.region, props.roomName, props.pass],
  );

  const handlePreJoinError = React.useCallback((e: Error) => console.error(e), []);

  // ── Entrar sin que nos pregunten quiénes somos ─────────────────────────────
  // Si llegamos con pase, la antesala ya resolvió las dos únicas cosas que
  // preguntaba esta pantalla: quién eres y si quieres micro y cámara. Volver a
  // preguntarlo es hacer dos veces un trámite que ya está hecho — y a un alumno
  // que abrió la sesión desde su agenda le pedimos que teclee su propio nombre.
  //
  // Solo se salta con pase Y con nombre. Quien llega por su cuenta sigue viendo
  // la pantalla de siempre (y la puerta le dirá que no, que para eso está).
  const autoJoinedRef = React.useRef(false);
  React.useEffect(() => {
    if (autoJoinedRef.current) return;
    if (!props.pass || !props.name?.trim()) return;
    autoJoinedRef.current = true;
    handlePreJoinSubmit({
      username: props.name.trim(),
      videoEnabled: props.camDefault ?? false,
      audioEnabled: props.micDefault ?? false,
    } as LocalUserChoices);
  }, [props.pass, props.name, props.camDefault, props.micDefault, handlePreJoinSubmit]);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
          <div>
            {joinError && (
              <div
                style={{
                  maxWidth: 420,
                  margin: '0 auto 16px',
                  padding: '12px 16px',
                  borderRadius: 12,
                  background: 'rgba(220,38,38,0.12)',
                  border: '1px solid rgba(220,38,38,0.35)',
                  color: '#fca5a5',
                  fontSize: 14,
                  lineHeight: 1.45,
                  textAlign: 'center',
                }}
              >
                {joinError}
              </div>
            )}
            <PreJoin
              defaults={preJoinDefaults}
              onSubmit={handlePreJoinSubmit}
              onError={handlePreJoinError}
            />
          </div>
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
          role={connectionDetails.isHost ? 'host' : 'attendee'}
          intro={props.intro}
          autoRecord={props.autoRecord}
        />
      )}
    </main>
  );
}

// ── VideoConferenceComponent ───────────────────────────────────────────────────

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: { hq: boolean; codec: VideoCodec; singlePeerConnection: boolean };
  role: string;
  intro?: IntroConfig | null;
  autoRecord?: boolean;
}) {
  const isHost = props.role === 'host';
  const clockOffsetMs = React.useMemo(() => {
    const serverNowMs = props.connectionDetails.serverNowMs;
    return typeof serverNowMs === 'number' && Number.isFinite(serverNowMs)
      ? Date.now() - serverNowMs
      : 0;
  }, [props.connectionDetails.serverNowMs]);

  // El pase con el que entró esta persona. Es lo que autoriza las órdenes que
  // salen de dentro de la sala — aprobar a quien espera, terminar la sesión.
  // Se lee una vez: la URL no cambia mientras la sala está abierta.
  const pass = React.useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('pass');
  }, []);
  const apexSessionId = React.useMemo(
    () => props.connectionDetails.sessionId ?? sessionIdHintFromPass(pass),
    [props.connectionDetails.sessionId, pass],
  );

  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);
  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  // ── Mejora de imagen (solo host) ─────────────────────────────────────────
  const [videoEnhanced, setVideoEnhanced] = React.useState(false);
  const [enhanceMs, setEnhanceMs] = React.useState<number | null>(null);
  const processorRef = React.useRef<VideoEnhanceProcessor | null>(null);
  const perfTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const videoEnhancedRef = React.useRef(false);
  React.useEffect(() => {
    videoEnhancedRef.current = videoEnhanced;
  }, [videoEnhanced]);

  // ── Room ─────────────────────────────────────────────────────────────────
  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec || 'h264';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) videoCodec = undefined;
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
        // En macOS + Chrome + micrófonos integrados, la triple cadena
        // "echoCancellation + noiseSuppression + autoGainControl", sumada a
        // Krisp cuando el usuario lo activa, bombeaba el volumen: subía,
        // bajaba y a ratos sonaba roto. Dejamos solo la cancelación de eco por
        // defecto para priorizar una voz estable y natural.
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      adaptiveStream: false,
      dynacast: false,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  // ── Moderación ───────────────────────────────────────────────────────────
  const moderation = useRoomModeration(room, isHost);

  // ── Mejora de imagen ──────────────────────────────────────────────────────
  const applyEnhancement = React.useCallback(
    async (pub?: LocalTrackPublication) => {
      const camPub =
        pub ??
        Array.from(room.localParticipant.videoTrackPublications.values()).find(
          (p) => p.source === 'camera' && p.track,
        );
      if (!camPub?.track) return;

      const proc = new VideoEnhanceProcessor();
      try {
        // @ts-ignore
        await camPub.track.setProcessor(proc);
        processorRef.current = proc;

        if (perfTimerRef.current) clearInterval(perfTimerRef.current);
        perfTimerRef.current = setInterval(() => {
          const nowPub = Array.from(room.localParticipant.videoTrackPublications.values()).find(
            (p) => p.source === 'camera' && p.track,
          );
          const active = nowPub?.track?.getProcessor?.();
          if (!active || active.name !== 'fenix-video-enhance') {
            console.warn('[VideoEnhance] processor desconectado — sync UI');
            if (perfTimerRef.current) {
              clearInterval(perfTimerRef.current);
              perfTimerRef.current = null;
            }
            processorRef.current = null;
            setEnhanceMs(null);
            setVideoEnhanced(false);
            return;
          }
          setEnhanceMs(processorRef.current?.lastFrameMs ?? null);
        }, 1000);

        setVideoEnhanced(true);
      } catch (err) {
        console.error('[VideoEnhance] error:', err);
        await proc.destroy();
      }
    },
    [room],
  );

  const toggleVideoEnhancement = React.useCallback(async () => {
    const camPub = Array.from(room.localParticipant.videoTrackPublications.values()).find(
      (p) => p.source === 'camera' && p.track,
    );
    if (!camPub?.track) {
      console.warn('[VideoEnhance] sin track de cámara');
      return;
    }
    if (videoEnhanced) {
      try {
        await camPub.track.stopProcessor();
      } catch {
        /* ok */
      }
      if (processorRef.current) {
        await processorRef.current.destroy();
        processorRef.current = null;
      }
      if (perfTimerRef.current) {
        clearInterval(perfTimerRef.current);
        perfTimerRef.current = null;
      }
      setEnhanceMs(null);
      setVideoEnhanced(false);
    } else {
      if (!isVideoEnhanceSupported()) {
        toast.error('Requiere Chrome 94+ o Edge 94+ para mejora de imagen');
        return;
      }
      await applyEnhancement(camPub);
    }
  }, [room, videoEnhanced, applyEnhancement]);

  // Re-apply cuando LiveKit recicla el track de cámara (setCameraEnabled off→on)
  // LiveKit 2.x llama processor.restart() automáticamente si está disponible.
  // Este handler actúa como safety net para tracks totalmente nuevos.
  React.useEffect(() => {
    const handle = async (pub: LocalTrackPublication) => {
      if (pub.source !== 'camera' || !pub.track) return;
      if (!videoEnhancedRef.current) return;
      const existing = pub.track.getProcessor?.();
      if (existing?.name === 'fenix-video-enhance') return;
      if (processorRef.current) {
        await processorRef.current.destroy().catch(() => {});
        processorRef.current = null;
      }
      if (!isVideoEnhanceSupported()) return;
      await applyEnhancement(pub);
    };
    room.on(RoomEvent.LocalTrackPublished, handle);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, handle);
    };
  }, [room, applyEnhancement]);

  React.useEffect(
    () => () => {
      if (processorRef.current) {
        processorRef.current.destroy();
        processorRef.current = null;
      }
      if (perfTimerRef.current) {
        clearInterval(perfTimerRef.current);
        perfTimerRef.current = null;
      }
    },
    [],
  );

  // ── E2EE ─────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert('Tu navegador no soporta E2EE. Actualízalo e inténtalo de nuevo.');
            } else throw e;
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => ({ autoSubscribe: true }), []);

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
            room.localParticipant.setCameraEnabled(true).catch((err) => {
              if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError')
                handleError(err);
            });
          }
          if (props.userChoices.audioEnabled) {
            room.localParticipant.setMicrophoneEnabled(true).catch((err) => {
              if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError')
                handleError(err);
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
  React.useEffect(() => {
    if (lowPowerMode) console.warn('Low power mode enabled');
  }, [lowPowerMode]);

  // ── iOS hint ─────────────────────────────────────────────────────────────
  const [showIOSHint, setShowIOSHint] = React.useState(() =>
    /iPhone|iPad|iPod/.test(navigator.userAgent),
  );
  React.useEffect(() => {
    if (!showIOSHint) return;
    const t = setTimeout(() => setShowIOSHint(false), 5000);
    return () => clearTimeout(t);
  }, [showIOSHint]);

  // ── Fix espejo compartir pantalla ─────────────────────────────────────────
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
          ...(typeof constraints?.video === 'object' && constraints.video !== null
            ? constraints.video
            : {}),
          // @ts-ignore
          displaySurface: 'window',
          frameRate: { ideal: 30, max: 60 },
          width: { ideal: 1920 },
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

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => router.push('/salir'), [router]);
  const handleError = React.useCallback((error: Error) => {
    console.error(error);
    if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') return;
    toast.error(`Error: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    toast.error(`Error de cifrado: ${error.message}`);
  }, []);

  // ── Micrófono móvil: reintento con gesto real ────────────────────────────
  // Algunos navegadores móviles no aceptan publicar audio hasta que el gesto
  // del usuario sucede dentro de la propia sala. Si APEX pidió micrófono
  // desde el lobby, aprovechamos el primer toque para reintentar de forma
  // transparente en vez de dejar a la persona peleándose con un botón muerto.
  React.useEffect(() => {
    if (!props.userChoices.audioEnabled) return;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) return;

    let cancelled = false;
    // Una petición de micrófono a la vez. Dos en paralelo dejan a LiveKit con
    // una operación que nunca termina — y el botón del dock, que se deshabilita
    // mientras hay uno en curso, se queda muerto para siempre.
    let enCurso = false;

    const unlockMic = (ev: Event) => {
      if (cancelled || enCurso) return;
      if (room.localParticipant.isMicrophoneEnabled) return;

      // Si el toque cayó sobre la botonera, no nos metemos: esos botones ya
      // hacen su propio trabajo.
      //
      // Aquí estaba el fallo que dejaba el micrófono muerto en el teléfono.
      // Este desbloqueo se enganchaba al PRIMER toque de la pantalla — y si ese
      // toque era justamente el del botón del micrófono, se disparaban dos
      // peticiones a la vez: la nuestra y la del botón. LiveKit se quedaba con
      // la operación colgada, `pending` no bajaba nunca y el botón, que se
      // deshabilita mientras hay algo pendiente, dejaba de responder. Ni
      // reaccionaba, ni pedía permiso, ni daba error. La cámara funcionaba
      // porque nadie competía con ella.
      const destino = ev.target as Element | null;
      if (destino?.closest?.('.fenix-dock')) return;

      enCurso = true;
      room.localParticipant
        .setMicrophoneEnabled(true)
        .catch((err) => {
          if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError') handleError(err);
        })
        .finally(() => {
          enCurso = false;
        });
    };

    window.addEventListener('pointerdown', unlockMic, { once: true });
    window.addEventListener('touchstart', unlockMic, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', unlockMic);
      window.removeEventListener('touchstart', unlockMic);
    };
  }, [props.userChoices.audioEnabled, room, handleError]);

  // ── Oír a los demás en el teléfono ───────────────────────────────────────
  //
  // Esto es lo que rompía la clase desde el móvil: el alumno entraba, veía al
  // anfitrión moverse y hablar, y no oía nada. En el ordenador funcionaba, así
  // que parecía cosa del micrófono del anfitrión.
  //
  // No lo era. Safari y Chrome en móvil no dejan que una pestaña empiece a
  // sonar sin que la persona haya tocado algo primero; el `<audio>` que monta
  // LiveKit se queda en pausa y no avisa. Había código para desbloquear el
  // MICRÓFONO — hablar — pero ninguno para desbloquear la REPRODUCCIÓN — oír.
  // Son dos permisos distintos y solo teníamos uno.
  //
  // `room.startAudio()` es justo eso: reanuda los elementos de audio. Tiene
  // que ocurrir dentro de un gesto real, así que se engancha al primero que
  // llegue. No se pone `{ once: true }` a propósito: si el primer toque llega
  // antes de que el navegador esté listo, hace falta el siguiente.
  React.useEffect(() => {
    let cancelled = false;
    let avisado = false;

    const intentar = () => {
      if (cancelled) return;
      if (room.canPlaybackAudio) {
        if (avisado) toast.dismiss('audio-bloqueado');
        return;
      }
      room.startAudio().catch(() => {
        // Todavía no toca. El próximo gesto lo vuelve a intentar.
      });
    };

    // Muchos navegadores sí permiten arrancar solos. Se prueba primero, para
    // no depender de un toque en quien no tiene el problema.
    intentar();

    // Y si al segundo y medio sigue mudo, se dice. Un alumno que no oye y no
    // sabe por qué se sale de la clase; uno al que le pides que toque la
    // pantalla, toca la pantalla — y ese toque es justamente lo que hace falta.
    const aviso = setTimeout(() => {
      if (cancelled || room.canPlaybackAudio) return;
      avisado = true;
      toast('Toca la pantalla para escuchar la sesión', {
        id: 'audio-bloqueado',
        duration: Infinity,
        icon: '🔊',
      });
    }, 1500);

    room.on(RoomEvent.AudioPlaybackStatusChanged, intentar);
    window.addEventListener('pointerdown', intentar);
    window.addEventListener('touchstart', intentar);
    window.addEventListener('keydown', intentar);

    return () => {
      cancelled = true;
      clearTimeout(aviso);
      toast.dismiss('audio-bloqueado');
      room.off(RoomEvent.AudioPlaybackStatusChanged, intentar);
      window.removeEventListener('pointerdown', intentar);
      window.removeEventListener('touchstart', intentar);
      window.removeEventListener('keydown', intentar);
    };
  }, [room]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />

        {/* ── La sala entera: escenario, paneles y barra de abajo ──
            Va en su propio componente porque la grabación necesita leer el
            estado desde dentro del contexto de LiveKit, y eso no se puede
            hacer aquí, que es justo donde se crea el contexto. */}
        <SalaFenix
          isHost={isHost}
          intro={props.intro}
          clockOffsetMs={clockOffsetMs}
          roomName={props.connectionDetails.roomName}
          pass={pass}
          moderation={moderation}
          autoRecord={props.autoRecord}
          mejora={
            isHost && isVideoEnhanceSupported()
              ? {
                  id: 'mejora',
                  icon: '✨',
                  label: videoEnhanced ? 'Mejora de imagen activa' : 'Mejorar imagen',
                  detail:
                    videoEnhanced && enhanceMs !== null ? `${enhanceMs.toFixed(1)}ms` : undefined,
                  active: videoEnhanced,
                  onClick: () => void toggleVideoEnhancement(),
                }
              : null
          }
        />

        {/* ── Quién espera fuera — solo host.
            El ID viene dentro del pase verificado. `roomName` puede ser un
            slug legible y no sirve para consultar webinar_sessions.id. ── */}
        {isHost && pass && apexSessionId && <LobbyBar sessionId={apexSessionId} pass={pass} />}

        {/* ── Diálogo de invitación del host (participante) ── */}
        <InviteDialog
          invite={moderation.pendingInvite}
          onDismiss={moderation.actions.dismissInvite}
        />

        {/* ── Banner iOS ── */}
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
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: '18px' }}>📹🎙️</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>
              Toca los botones para activar tu cámara y micrófono
            </span>
          </div>
        )}

        <DebugMode />
        {/* El punto rojo lo ve todo el mundo, anfitrión incluido: su control de
            grabación vive ahora dentro del menú "Más", así que si no hubiera
            punto tendría que abrir un menú para saber si está grabando. */}
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}

// ── SalaFenix ─────────────────────────────────────────────────────────────────
//
// La sala entera. Existe como componente aparte por una razón concreta: la
// grabación necesita `useIsRecording`, que lee del contexto de LiveKit, y ese
// contexto se crea justo en `VideoConferenceComponent`. Un hook no puede leer
// un contexto que su propio componente está creando, así que hace falta bajar
// un nivel.

function SalaFenix({
  isHost,
  intro,
  clockOffsetMs,
  roomName,
  pass,
  moderation,
  autoRecord,
  mejora,
}: {
  isHost: boolean;
  intro?: IntroConfig | null;
  clockOffsetMs: number;
  roomName: string;
  pass: string | null;
  moderation: ModerationState;
  autoRecord?: boolean;
  mejora: HostTool | null;
}) {
  const grabacion = useRecordingTool(roomName, isHost && !!autoRecord);

  // El orden importa: lo que se usa cada clase arriba, lo opcional debajo.
  const herramientas = React.useMemo<HostTool[]>(
    () => (isHost ? [grabacion, ...(mejora ? [mejora] : [])] : []),
    [isHost, grabacion, mejora],
  );

  return (
    <FenixRoomLayout
      isHost={isHost}
      intro={intro}
      clockOffsetMs={clockOffsetMs}
      roomName={roomName}
      pass={pass}
      moderation={moderation}
      hostTools={herramientas}
    />
  );
}

// ── useRecordingTool ──────────────────────────────────────────────────────────
//
// Antes era un botón flotante encima del vídeo. Ahora es una entrada del menú
// del anfitrión, así que lo que era pintura pasa a ser dato: el cronómetro sale
// por `detail` y el rojo de "grabando" por `active`. La lógica —el 409, el
// arranque automático con su retraso— no se ha tocado: es la parte que ya
// estaba probada en producción.
//
// Debe llamarse dentro de RoomContext.Provider para poder usar useIsRecording.

/** Segundos a mm:ss. */
const fmt = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

function useRecordingTool(roomName: string, autoStart?: boolean): HostTool {
  const isRecording = useIsRecording();
  const [loading, setLoading] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const llamar = React.useCallback(
    async (accion: 'start' | 'stop', silencioso = false) => {
      // Grabar es una acción de anfitrión: va firmada con el mismo pase.
      const pass = new URLSearchParams(window.location.search).get('pass');
      const res = await fetch(
        `/api/record/${accion}?roomName=${encodeURIComponent(roomName)}` +
          (pass ? `&pass=${encodeURIComponent(pass)}` : ''),
      );
      // 409 al arrancar = ya estaba grabando. Para el arranque automático eso
      // no es un fallo, es el resultado deseado por otro camino.
      if (res.status === 409) {
        if (!silencioso) toast('Ya hay una grabación activa', { duration: 3000 });
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        throw new Error(txt);
      }
    },
    [roomName],
  );

  const handleClick = React.useCallback(async () => {
    setLoading(true);
    try {
      await llamar(isRecording ? 'stop' : 'start');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo conectar con el servidor';
      toast.error(`Error de grabación: ${msg}`, { duration: 6000 });
    } finally {
      setLoading(false);
    }
  }, [llamar, isRecording]);

  // ── Arranque automático ───────────────────────────────────────────────────
  //
  // Las clases de la Academia se graban siempre, y "siempre" no puede depender
  // de que el anfitrión se acuerde de picarle a un botón antes de empezar a
  // hablar. En cuanto entra, la grabación arranca sola.
  //
  // El retraso no es superstición: al montar, `isRecording` todavía es `false`
  // aunque la sala ya lleve rato grabando, porque el estado viene del servidor.
  // Arrancar de inmediato pediría una grabación que ya existe. Dos segundos
  // bastan para que el estado real llegue; y si aun así se cruza, el 409 lo
  // resuelve sin molestar a nadie.
  const yaIntentado = React.useRef(false);
  React.useEffect(() => {
    if (!autoStart || yaIntentado.current) return;
    const id = setTimeout(async () => {
      if (yaIntentado.current) return;
      yaIntentado.current = true;
      if (isRecording) return;
      try {
        await llamar('start', true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'error desconocido';
        toast.error(`No se pudo iniciar la grabación automática: ${msg}`, { duration: 8000 });
      }
    }, 2000);
    return () => clearTimeout(id);
  }, [autoStart, isRecording, llamar]);

  return React.useMemo<HostTool>(
    () => ({
      id: 'grabacion',
      icon: isRecording ? '⏹' : '🎥',
      label: isRecording ? 'Detener grabación' : 'Iniciar grabación',
      detail: isRecording ? fmt(elapsed) : undefined,
      active: isRecording,
      disabled: loading,
      onClick: () => void handleClick(),
    }),
    [isRecording, elapsed, loading, handleClick],
  );
}

// ── InviteDialog ──────────────────────────────────────────────────────────────

function InviteDialog({
  invite,
  onDismiss,
}: {
  invite: PendingInviteType;
  onDismiss: (accepted: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);

  if (!invite) return null;
  const isSpeak = invite === 'speak';

  const handle = async (accepted: boolean) => {
    setBusy(true);
    try {
      await onDismiss(accepted);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: '#12121a',
          border: '1px solid rgba(201,168,76,0.3)',
          borderRadius: '18px',
          padding: '30px 28px',
          maxWidth: '320px',
          width: '90%',
          boxShadow: '0 10px 40px rgba(0,0,0,0.75)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>{isSpeak ? '🎙️' : '📷'}</div>
        <h3 style={{ color: '#fff', fontSize: '15px', fontWeight: 700, margin: '0 0 8px' }}>
          {isSpeak
            ? 'El anfitrión te invita a activar tu micrófono'
            : 'El anfitrión te invita a activar tu cámara'}
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', margin: '0 0 22px' }}>
          Tú decides si aceptas o no.
        </p>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => handle(true)}
            disabled={busy}
            style={{
              flex: 1,
              padding: '11px',
              borderRadius: '9px',
              background: 'linear-gradient(135deg, #C9A84C, #a07830)',
              border: 'none',
              color: '#0a0a0f',
              fontWeight: 700,
              fontSize: '13px',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {isSpeak ? 'Activar micrófono' : 'Activar cámara'}
          </button>
          <button
            onClick={() => handle(false)}
            disabled={busy}
            style={{
              flex: 1,
              padding: '11px',
              borderRadius: '9px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              fontWeight: 600,
              fontSize: '13px',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
