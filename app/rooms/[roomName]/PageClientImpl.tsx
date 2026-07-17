'use client';

import React from 'react';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { ConnectionDetails } from '@/lib/types';
import {
  LocalUserChoices,
  PreJoin,
  RoomContext,
  useIsRecording,
} from '@livekit/components-react';
import { ModeratorPanel } from './ModeratorPanel';
import { FenixRoomLayout } from './FenixRoomLayout';
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
  role: string; // 'host' | 'attendee'
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => ({
    username: '',
    videoEnabled: true,
    audioEnabled: false, // webinar: participantes entran silenciados
  }), []);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) url.searchParams.append('region', props.region);
    url.searchParams.append('role', props.role);
    const resp = await fetch(url.toString());
    const data = await resp.json();
    setConnectionDetails(data);
  }, [props.role, props.region, props.roomName]);

  const handlePreJoinError = React.useCallback((e: Error) => console.error(e), []);

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

// ── VideoConferenceComponent ───────────────────────────────────────────────────

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: { hq: boolean; codec: VideoCodec; singlePeerConnection: boolean };
  role: string;
}) {
  const isHost = props.role === 'host';

  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);
  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  // ── Mejora de imagen (solo host) ─────────────────────────────────────────
  const [videoEnhanced, setVideoEnhanced] = React.useState(false);
  const [enhanceMs, setEnhanceMs]         = React.useState<number | null>(null);
  const processorRef     = React.useRef<VideoEnhanceProcessor | null>(null);
  const perfTimerRef     = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const videoEnhancedRef = React.useRef(false);
  React.useEffect(() => { videoEnhancedRef.current = videoEnhanced; }, [videoEnhanced]);

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

  // ── Moderación ───────────────────────────────────────────────────────────
  const moderation = useRoomModeration(room, isHost);

  // ── Krisp: cancelación de ruido con IA ───────────────────────────────────
  React.useEffect(() => {
    if (!isKrispNoiseFilterSupported()) return;
    const filter = KrispNoiseFilter();
    const applyKrisp = async (pub: LocalTrackPublication) => {
      if (pub.kind === 'audio' && pub.track) {
        try {
          // @ts-ignore
          await pub.track.setProcessor(filter);
          console.log('[Krisp] activo');
        } catch (e) {
          console.warn('[Krisp] error:', e);
        }
      }
    };
    room.localParticipant.audioTrackPublications.forEach(applyKrisp);
    room.on(RoomEvent.LocalTrackPublished, applyKrisp);
    return () => { room.off(RoomEvent.LocalTrackPublished, applyKrisp); };
  }, [room]);

  // ── Mejora de imagen ──────────────────────────────────────────────────────
  const applyEnhancement = React.useCallback(async (pub?: LocalTrackPublication) => {
    const camPub = pub ?? Array.from(room.localParticipant.videoTrackPublications.values())
      .find(p => p.source === 'camera' && p.track);
    if (!camPub?.track) return;

    const proc = new VideoEnhanceProcessor();
    try {
      // @ts-ignore
      await camPub.track.setProcessor(proc);
      processorRef.current = proc;

      if (perfTimerRef.current) clearInterval(perfTimerRef.current);
      perfTimerRef.current = setInterval(() => {
        const nowPub = Array.from(room.localParticipant.videoTrackPublications.values())
          .find(p => p.source === 'camera' && p.track);
        const active = nowPub?.track?.getProcessor?.();
        if (!active || active.name !== 'fenix-video-enhance') {
          console.warn('[VideoEnhance] processor desconectado — sync UI');
          if (perfTimerRef.current) { clearInterval(perfTimerRef.current); perfTimerRef.current = null; }
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
  }, [room]);

  const toggleVideoEnhancement = React.useCallback(async () => {
    const camPub = Array.from(room.localParticipant.videoTrackPublications.values())
      .find(p => p.source === 'camera' && p.track);
    if (!camPub?.track) {
      console.warn('[VideoEnhance] sin track de cámara');
      return;
    }
    if (videoEnhanced) {
      try { await camPub.track.stopProcessor(); } catch { /* ok */ }
      if (processorRef.current) { await processorRef.current.destroy(); processorRef.current = null; }
      if (perfTimerRef.current) { clearInterval(perfTimerRef.current); perfTimerRef.current = null; }
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
      if (processorRef.current) { await processorRef.current.destroy().catch(() => {}); processorRef.current = null; }
      if (!isVideoEnhanceSupported()) return;
      await applyEnhancement(pub);
    };
    room.on(RoomEvent.LocalTrackPublished, handle);
    return () => { room.off(RoomEvent.LocalTrackPublished, handle); };
  }, [room, applyEnhancement]);

  React.useEffect(() => () => {
    if (processorRef.current) { processorRef.current.destroy(); processorRef.current = null; }
    if (perfTimerRef.current) { clearInterval(perfTimerRef.current); perfTimerRef.current = null; }
  }, []);

  // ── E2EE ─────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider.setKey(decodePassphrase(e2eePassphrase)).then(() => {
        room.setE2EEEnabled(true).catch((e) => {
          if (e instanceof DeviceUnsupportedError) {
            alert('Tu navegador no soporta E2EE. Actualízalo e inténtalo de nuevo.');
          } else throw e;
        });
      }).then(() => setE2eeSetupComplete(true));
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
      room.connect(
        props.connectionDetails.serverUrl,
        props.connectionDetails.participantToken,
        connectOptions,
      ).then(() => {
        const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        if (isIOS) return;
        if (props.userChoices.videoEnabled) {
          room.localParticipant.setCameraEnabled(true).catch((err) => {
            if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError') handleError(err);
          });
        }
        if (props.userChoices.audioEnabled) {
          room.localParticipant.setMicrophoneEnabled(true).catch((err) => {
            if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError') handleError(err);
          });
        }
      }).catch(handleError);
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleError);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  const lowPowerMode = useLowCPUOptimizer(room);
  React.useEffect(() => { if (lowPowerMode) console.warn('Low power mode enabled'); }, [lowPowerMode]);

  // ── iOS hint ─────────────────────────────────────────────────────────────
  const [showIOSHint, setShowIOSHint] = React.useState(() =>
    /iPhone|iPad|iPod/.test(navigator.userAgent)
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
          ...(typeof constraints?.video === 'object' && constraints.video !== null ? constraints.video : {}),
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
    return () => { navigator.mediaDevices.getDisplayMedia = original; };
  }, []);

  const router = useRouter();
  const handleOnLeave       = React.useCallback(() => router.push('/salir'), [router]);
  const handleError         = React.useCallback((error: Error) => {
    console.error(error);
    if (error?.name === 'NotAllowedError' || error?.name === 'NotFoundError') return;
    toast.error(`Error: ${error.message}`);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    toast.error(`Error de cifrado: ${error.message}`);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        <KeyboardShortcuts />

        {/* ── Layout principal: hablante activo, galería, pantalla compartida ── */}
        <FenixRoomLayout isHost={isHost} />

        {/* ── Panel de moderación — solo host ── */}
        {isHost && (
          <ModeratorPanel
            roomName={props.connectionDetails.roomName}
            moderation={moderation}
          />
        )}

        {/* ── Botón Mejorar imagen — solo host, solo Chrome/Edge
            Posición: bottom 140px (encima del ModeratorPanel: 80 + 48 + 12 = 140) ── */}
        {isHost && isVideoEnhanceSupported() && (
          <div
            style={{
              position: 'fixed',
              bottom: '140px',
              right: '16px',
              zIndex: 9998,
            }}
          >
            <button
              onClick={toggleVideoEnhancement}
              title={
                videoEnhanced
                  ? 'Desactivar mejora de imagen'
                  : 'Activar mejora (nitidez · contraste · brillo · color)'
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
                <span style={{ opacity: 0.65, fontSize: '10px', fontWeight: 400 }}>
                  {enhanceMs.toFixed(1)}ms
                </span>
              )}
            </button>
          </div>
        )}

        {/* ── Botón de grabación — solo host
            Posición: bottom 200px (encima de Mejorar imagen: 140 + 48 + 12 = 200) ── */}
        {isHost && (
          <div
            style={{
              position: 'fixed',
              bottom: '200px',
              right: '16px',
              zIndex: 9997,
            }}
          >
            <RecordingButton roomName={props.connectionDetails.roomName} />
          </div>
        )}

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
        <RecordingIndicator />
      </RoomContext.Provider>
    </div>
  );
}

// ── RecordingButton ───────────────────────────────────────────────────────────
// Debe estar dentro de RoomContext.Provider para usar useIsRecording

function RecordingButton({ roomName }: { roomName: string }) {
  const isRecording = useIsRecording();
  const [loading, setLoading]   = React.useState(false);
  const [elapsed, setElapsed]   = React.useState(0);
  const [dotOn, setDotOn]       = React.useState(true);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const dotRef   = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
      dotRef.current   = setInterval(() => setDotOn(v => !v), 700);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (dotRef.current)   { clearInterval(dotRef.current);   dotRef.current   = null; }
      setDotOn(true);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (dotRef.current)   clearInterval(dotRef.current);
    };
  }, [isRecording]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const handleClick = async () => {
    setLoading(true);
    try {
      const endpoint = isRecording ? '/api/record/stop' : '/api/record/start';
      const res = await fetch(`${endpoint}?roomName=${encodeURIComponent(roomName)}`);
      if (res.status === 409) {
        toast('Ya hay una grabación activa', { duration: 3000 });
      } else if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        toast.error(`Error de grabación: ${txt}`, { duration: 6000 });
      }
    } catch (e) {
      toast.error('No se pudo conectar con el servidor de grabación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={isRecording ? 'Detener grabación' : 'Iniciar grabación de la sesión'}
      style={{
        background: isRecording ? 'rgba(239,68,68,0.9)' : 'rgba(10,10,15,0.85)',
        border: `1px solid ${isRecording ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.18)'}`,
        borderRadius: '10px',
        padding: '8px 14px',
        color: '#ffffff',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: loading ? 'wait' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
        boxShadow: isRecording
          ? '0 2px 14px rgba(239,68,68,0.4)'
          : '0 2px 12px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        transition: 'all 0.18s ease',
        whiteSpace: 'nowrap',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {isRecording ? (
        <>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#fff',
              display: 'inline-block',
              opacity: dotOn ? 1 : 0.25,
              transition: 'opacity 0.2s',
              flexShrink: 0,
            }}
          />
          <span>{fmt(elapsed)}</span>
          <span>⏹ Detener</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: '14px' }}>🎥</span>
          <span>Iniciar grabación</span>
        </>
      )}
    </button>
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
    try { await onDismiss(accepted); } finally { setBusy(false); }
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
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>
          {isSpeak ? '🎙️' : '📷'}
        </div>
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
