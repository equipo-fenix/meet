import { LocalAudioTrack, LocalVideoTrack, videoCodecs } from 'livekit-client';
import { VideoCodec } from 'livekit-client';

export interface SessionProps {
  roomName: string;
  identity: string;
  audioTrack?: LocalAudioTrack;
  videoTrack?: LocalVideoTrack;
  region?: string;
  turnServer?: RTCIceServer;
  forceRelay?: boolean;
}

export interface TokenResult {
  identity: string;
  accessToken: string;
}

export function isVideoCodec(codec: string): codec is VideoCodec {
  return videoCodecs.includes(codec as VideoCodec);
}

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  /**
   * ID canónico de la sesión en APEX. No siempre coincide con `roomName`:
   * las salas programadas suelen usar un slug legible. La puerta de espera
   * siempre se consulta con este ID, nunca con el nombre de la sala.
   */
  sessionId?: string;
  participantName: string;
  participantToken: string;
  /**
   * Lo que el servidor decidió, no lo que la URL pedía. El panel de moderación
   * se dibuja a partir de esto para que nunca aparezcan controles que el token
   * no respalda.
   */
  isHost?: boolean;
};
