'use client';

/**
 * useRoomModeration — Hook de moderación de sala Fénix Live
 *
 * Centraliza todo el estado y acciones de moderación:
 * - Levantamiento de mano (participante → host)
 * - Invitaciones a hablar / activar cámara (host → participante)
 * - Notificaciones cuando el host silencia o apaga cámara
 * - Avisos de entrada/salida de participantes
 *
 * Acciones server-side (silencio real de pista) → /api/livekit-admin
 * Señalización → DataChannel fiable de LiveKit (publishData)
 */

import React from 'react';
import { Room, RoomEvent, RemoteParticipant } from 'livekit-client';
import toast from 'react-hot-toast';
import { MSG, RoomMessage, encodeMsg, decodeMsg } from './roomMessages';

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export interface RaisedHand {
  identity: string;
  name: string;
  ts: number;
}

/** 'speak' = invitación a activar micrófono, 'camera' = cámara, null = ninguna */
export type PendingInviteType = 'speak' | 'camera' | null;

export interface ModerationState {
  /** Lista de participantes que levantaron la mano (solo relevante para el host) */
  raisedHands: RaisedHand[];
  /** Invitación pendiente del host hacia este participante */
  pendingInvite: PendingInviteType;
  /**
   * true cuando el host ha invitado a este participante a hablar y aceptó.
   * Controla si el botón de micrófono está visible/activo en el ControlBar.
   * El host siempre tiene micUnlocked = true (no necesita invitación).
   */
  micUnlocked: boolean;
  /** Acciones disponibles (host o participante según rol) */
  actions: {
    // Host
    muteParticipant:    (identity: string, name: string, roomName: string) => Promise<void>;
    muteAll:            (roomName: string) => Promise<void>;
    disableCamera:      (identity: string, name: string, roomName: string) => Promise<void>;
    disableAllCameras:  (roomName: string) => Promise<void>;
    inviteToSpeak:      (identity: string) => Promise<void>;
    inviteToCamera:     (identity: string) => Promise<void>;
    // Participante
    raiseHand:          () => Promise<void>;
    lowerHand:          () => Promise<void>;
    dismissInvite:      (accepted: boolean) => Promise<void>;
  };
}

// ── Estilos de toast por contexto ──────────────────────────────────────────────

const darkToast = { background: '#1a1a2e', color: '#ffffff', border: '1px solid rgba(201,168,76,0.2)' };
const warnToast = { background: '#1a1a2e', color: '#ffffff', border: '1px solid rgba(239,68,68,0.3)' };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRoomModeration(room: Room, isHost: boolean): ModerationState {
  const [raisedHands, setRaisedHands] = React.useState<RaisedHand[]>([]);
  const [pendingInvite, setPendingInvite] = React.useState<PendingInviteType>(null);
  // El host siempre tiene el mic desbloqueado; los participantes lo desbloquean
  // solo cuando aceptan la invitación del host a hablar.
  const [micUnlocked, setMicUnlocked] = React.useState<boolean>(isHost);

  // Sincronizar si `isHost` cambia en caliente (raro, pero defensivo)
  React.useEffect(() => {
    if (isHost) setMicUnlocked(true);
  }, [isHost]);

  // ── Recepción de DataMessages ──────────────────────────────────────────────
  React.useEffect(() => {
    const handleData = (payload: Uint8Array, participant?: RemoteParticipant) => {
      const msg = decodeMsg(payload);
      if (!msg) return;

      if (isHost) {
        // El host recibe eventos de participantes
        switch (msg.type) {
          case MSG.RAISE_HAND:
            setRaisedHands(prev =>
              prev.some(h => h.identity === msg.identity)
                ? prev
                : [...prev, { identity: msg.identity!, name: msg.name!, ts: msg.ts }]
            );
            toast(`✋ ${msg.name} solicitó hablar`, {
              duration: 10000,
              style: { background: '#1a1a2e', color: '#C9A84C', border: '1px solid rgba(201,168,76,0.35)' },
            });
            break;
          case MSG.LOWER_HAND:
            setRaisedHands(prev => prev.filter(h => h.identity !== msg.identity));
            break;
          case MSG.PARTICIPANT_ACCEPT_SPEAK:
            toast(`🎙️ ${msg.name} activó su micrófono`, { duration: 3000, style: darkToast });
            setRaisedHands(prev => prev.filter(h => h.identity !== msg.identity));
            break;
          case MSG.PARTICIPANT_DECLINE_SPEAK:
            toast(`${msg.name} prefirió no hablar ahora`, { duration: 3000, style: darkToast });
            break;
          case MSG.PARTICIPANT_ACCEPT_CAMERA:
            toast(`📷 ${msg.name} activó su cámara`, { duration: 3000, style: darkToast });
            break;
          case MSG.PARTICIPANT_DECLINE_CAMERA:
            toast(`${msg.name} prefirió no activar su cámara`, { duration: 3000, style: darkToast });
            break;
        }
      } else {
        // Los participantes reciben eventos del host
        switch (msg.type) {
          case MSG.HOST_MUTED_YOU:
            toast('El anfitrión silenció tu micrófono.', {
              duration: 8000, icon: '🔇', style: warnToast,
            });
            break;
          case MSG.HOST_DISABLED_CAMERA:
            toast('El anfitrión apagó tu cámara.', {
              duration: 6000, icon: '📷', style: warnToast,
            });
            break;
          case MSG.HOST_MUTED_ALL:
            toast('El anfitrión silenció todos los micrófonos.', {
              duration: 5000, icon: '🔇', style: darkToast,
            });
            break;
          case MSG.HOST_DISABLED_ALL_CAMERAS:
            toast('El anfitrión apagó todas las cámaras.', {
              duration: 5000, icon: '📷', style: darkToast,
            });
            break;
          case MSG.HOST_INVITE_SPEAK:
            setPendingInvite('speak');
            break;
          case MSG.HOST_INVITE_CAMERA:
            setPendingInvite('camera');
            break;
        }
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => { room.off(RoomEvent.DataReceived, handleData); };
  }, [room, isHost]);

  // ── Avisos de entrada/salida ───────────────────────────────────────────────
  React.useEffect(() => {
    const onJoin = (p: RemoteParticipant) => {
      toast(`${p.name || p.identity} se unió`, { duration: 3000, icon: '👋', style: darkToast });
    };
    const onLeave = (p: RemoteParticipant) => {
      toast(`${p.name || p.identity} salió`, { duration: 3000, style: darkToast });
      setRaisedHands(prev => prev.filter(h => h.identity !== p.identity));
    };
    room.on(RoomEvent.ParticipantConnected, onJoin);
    room.on(RoomEvent.ParticipantDisconnected, onLeave);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin);
      room.off(RoomEvent.ParticipantDisconnected, onLeave);
    };
  }, [room]);

  // Auto-descartar invitación tras 90 s si el participante no respondió
  React.useEffect(() => {
    if (!pendingInvite) return;
    const t = setTimeout(() => setPendingInvite(null), 90_000);
    return () => clearTimeout(t);
  }, [pendingInvite]);

  // ── Helpers internos ───────────────────────────────────────────────────────

  const adminFetch = React.useCallback(async (body: object): Promise<void> => {
    const res = await fetch('/api/livekit-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(text);
    }
  }, []);

  const broadcast = React.useCallback(async (msg: RoomMessage, to?: string): Promise<void> => {
    const data = encodeMsg(msg);
    const opts = to
      ? { reliable: true, destinationIdentities: [to] }
      : { reliable: true };
    await room.localParticipant.publishData(data, opts);
  }, [room]);

  // ── Acciones ───────────────────────────────────────────────────────────────

  const muteParticipant = React.useCallback(async (identity: string, name: string, roomName: string) => {
    await adminFetch({ action: 'mute', roomName, identity }).catch(e => console.warn('[mod] mute error:', e));
    await broadcast({ type: MSG.HOST_MUTED_YOU, identity, name, ts: Date.now() }, identity);
  }, [adminFetch, broadcast]);

  const muteAll = React.useCallback(async (roomName: string) => {
    await adminFetch({ action: 'muteAll', roomName }).catch(e => console.warn('[mod] muteAll error:', e));
    await broadcast({ type: MSG.HOST_MUTED_ALL, ts: Date.now() });
  }, [adminFetch, broadcast]);

  const disableCamera = React.useCallback(async (identity: string, name: string, roomName: string) => {
    await adminFetch({ action: 'disableCamera', roomName, identity }).catch(e => console.warn('[mod] disableCam error:', e));
    await broadcast({ type: MSG.HOST_DISABLED_CAMERA, identity, name, ts: Date.now() }, identity);
  }, [adminFetch, broadcast]);

  const disableAllCameras = React.useCallback(async (roomName: string) => {
    await adminFetch({ action: 'disableAllCameras', roomName }).catch(e => console.warn('[mod] disableAllCams error:', e));
    await broadcast({ type: MSG.HOST_DISABLED_ALL_CAMERAS, ts: Date.now() });
  }, [adminFetch, broadcast]);

  const inviteToSpeak = React.useCallback(async (identity: string) => {
    const me = room.localParticipant;
    await broadcast(
      { type: MSG.HOST_INVITE_SPEAK, identity, name: me.name || me.identity, ts: Date.now() },
      identity
    );
    setRaisedHands(prev => prev.filter(h => h.identity !== identity));
  }, [room, broadcast]);

  const inviteToCamera = React.useCallback(async (identity: string) => {
    const me = room.localParticipant;
    await broadcast(
      { type: MSG.HOST_INVITE_CAMERA, identity, name: me.name || me.identity, ts: Date.now() },
      identity
    );
  }, [room, broadcast]);

  const raiseHand = React.useCallback(async () => {
    const me = room.localParticipant;
    await broadcast({ type: MSG.RAISE_HAND, identity: me.identity, name: me.name || me.identity, ts: Date.now() });
  }, [room, broadcast]);

  const lowerHand = React.useCallback(async () => {
    const me = room.localParticipant;
    await broadcast({ type: MSG.LOWER_HAND, identity: me.identity, name: me.name || me.identity, ts: Date.now() });
  }, [room, broadcast]);

  const dismissInvite = React.useCallback(async (accepted: boolean) => {
    if (!pendingInvite) return;
    const me = room.localParticipant;
    const type = pendingInvite === 'speak'
      ? (accepted ? MSG.PARTICIPANT_ACCEPT_SPEAK : MSG.PARTICIPANT_DECLINE_SPEAK)
      : (accepted ? MSG.PARTICIPANT_ACCEPT_CAMERA : MSG.PARTICIPANT_DECLINE_CAMERA);

    await broadcast({ type, identity: me.identity, name: me.name || me.identity, ts: Date.now() });

    if (accepted) {
      try {
        if (pendingInvite === 'speak') {
          // Desbloquear botón mic en ControlBar y activar el micrófono
          setMicUnlocked(true);
          await room.localParticipant.setMicrophoneEnabled(true);
        } else {
          await room.localParticipant.setCameraEnabled(true);
        }
      } catch (e) {
        console.warn('[mod] error activating device after invite:', e);
      }
    }
    setPendingInvite(null);
  }, [room, pendingInvite, broadcast]);

  return {
    raisedHands,
    pendingInvite,
    micUnlocked,
    actions: {
      muteParticipant,
      muteAll,
      disableCamera,
      disableAllCameras,
      inviteToSpeak,
      inviteToCamera,
      raiseHand,
      lowerHand,
      dismissInvite,
    },
  };
}
