'use client';

/**
 * ControlDock — La barra de abajo, con la forma de la de Zoom
 *
 * Antes había una barra minimalista con cuatro iconos sin nombre, y todo lo
 * demás —participantes, grabación, mejora de imagen— vivía en burbujas
 * flotantes apiladas en la esquina derecha, encima del vídeo. Funcionaba, pero
 * había que descubrirlo. Nadie llega a una clase dispuesto a explorar botones.
 *
 * Ahora todo está en un solo sitio y cada icono lleva su nombre debajo. Es la
 * gramática que la gente ya trae aprendida de Zoom, y aprovecharla sale gratis:
 * el alumno que nunca ha entrado aquí ya sabe dónde está el chat.
 *
 * Un detalle deliberado: el rojo de la derecha está separado del resto por un
 * hueco. Es el único botón sin vuelta atrás.
 */

import React from 'react';
import { Track } from 'livekit-client';
import { useTrackToggle, MediaDeviceMenu, useRoomContext } from '@livekit/components-react';
import toast from 'react-hot-toast';
import { REACCIONES } from '@/lib/useReactions';

// ── Tipos ─────────────────────────────────────────────────────────────────────

/** Una herramienta del anfitrión, de las que viven en el menú "Más". */
export interface HostTool {
  id: string;
  icon: string;
  label: string;
  /** Texto pequeño a la derecha: el cronómetro de la grabación, los ms de la mejora… */
  detail?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface ControlDockProps {
  isHost: boolean;
  /** Nº de participantes, para la insignia. */
  totalParticipantes: number;
  /** Nº de manos levantadas, para el punto rojo sobre Participantes. */
  manosLevantadas: number;
  /** Mensajes de chat sin leer. */
  sinLeer: number;
  panelAbierto: 'participantes' | 'chat' | null;
  onTogglePanel: (panel: 'participantes' | 'chat') => void;
  onReaccion: (emoji: string) => void;
  manoLevantada: boolean;
  onToggleMano: () => void;
  herramientas: HostTool[];
  /** El botón rojo. El anfitrión trae el suyo (terminar para todos). */
  botonSalir: React.ReactNode;
}

const ORO = '#C9A84C';

// ── Botón del dock ────────────────────────────────────────────────────────────

interface DockButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  /** Rojo tachado: el micro o la cámara apagados. Como en Zoom. */
  off?: boolean;
  badge?: number;
  alerta?: number;
  title?: string;
  /** El chevron de elegir dispositivo, pegado al borde del botón. */
  extra?: React.ReactNode;
  disabled?: boolean;
}

const DockButton = React.forwardRef<HTMLDivElement, DockButtonProps>(function DockButton(
  { icon, label, onClick, active, off, badge, alerta, title, extra, disabled },
  ref,
) {
  const [hover, setHover] = React.useState(false);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
      <button
        onClick={onClick}
        title={title ?? label}
        aria-label={title ?? label}
        aria-pressed={active}
        disabled={disabled}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '3px',
          minWidth: '62px',
          padding: '6px 10px',
          borderRadius: '10px',
          border: '1px solid transparent',
          background: active
            ? 'rgba(201,168,76,0.16)'
            : hover && !disabled
              ? 'rgba(255,255,255,0.08)'
              : 'transparent',
          borderColor: active ? 'rgba(201,168,76,0.35)' : 'transparent',
          color: disabled ? 'rgba(255,255,255,0.28)' : off ? '#f87171' : active ? ORO : '#e9e9ef',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s, color 0.15s',
          position: 'relative',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontSize: '19px', lineHeight: 1, position: 'relative' }}>
          {icon}
          {badge !== undefined && badge > 0 && (
            <span style={insignia(ORO, '#0a0a0f', { right: '-10px', top: '-4px' })}>{badge}</span>
          )}
          {alerta !== undefined && alerta > 0 && (
            <span style={insignia('#ef4444', '#fff', { left: '-10px', top: '-4px' })}>
              {alerta}
            </span>
          )}
        </span>
        <span
          className="fenix-dock-label"
          style={{
            fontSize: '10.5px',
            fontWeight: 600,
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
      </button>
      {extra}
    </div>
  );
});

function insignia(fondo: string, texto: string, pos: React.CSSProperties): React.CSSProperties {
  return {
    position: 'absolute',
    ...pos,
    background: fondo,
    color: texto,
    borderRadius: '9px',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    fontSize: '9.5px',
    fontWeight: 900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  };
}

/** El chevron que abre la lista de micrófonos o cámaras. */
function ChevronDispositivos({ kind }: { kind: MediaDeviceKind }) {
  return (
    <div className="fenix-chevron" title="Elegir dispositivo">
      <MediaDeviceMenu kind={kind} />
    </div>
  );
}

// ── Popover ───────────────────────────────────────────────────────────────────

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Se cierra al tocar fuera o con Escape. Un menú que se queda abierto tapando
  // la cara de quien habla es peor que no tener menú.
  React.useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // En el mismo tick el clic que abrió el menú lo cerraría.
    const id = setTimeout(() => document.addEventListener('mousedown', fuera), 0);
    document.addEventListener('keydown', escape);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#1c1c26',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '14px',
        boxShadow: '0 10px 34px rgba(0,0,0,0.6)',
        padding: '10px',
        zIndex: 200,
      }}
    >
      {children}
    </div>
  );
}

// ── Dock ──────────────────────────────────────────────────────────────────────

export function ControlDock({
  isHost,
  totalParticipantes,
  manosLevantadas,
  sinLeer,
  panelAbierto,
  onTogglePanel,
  onReaccion,
  manoLevantada,
  onToggleMano,
  herramientas,
  botonSalir,
}: ControlDockProps) {
  const [menu, setMenu] = React.useState<'reacciones' | 'mas' | null>(null);
  const room = useRoomContext();

  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const pantalla = useTrackToggle({ source: Track.Source.ScreenShare });

  const cerrarMenu = React.useCallback(() => setMenu(null), []);

  /**
   * Enciende o apaga el micrófono, y —esto es lo importante— cuenta en voz alta
   * lo que salió mal.
   *
   * Antes usábamos `mic.toggle()` a secas. Cuando el navegador rechazaba el
   * permiso, la promesa se rompía, nadie recogía el error y el botón se quedaba
   * exactamente igual que antes de pulsarlo. Desde fuera parecía un botón roto:
   * lo tocabas y no pasaba nada, ni permiso, ni aviso, ni micrófono.
   *
   * Y el caso más frecuente es justo el más silencioso: si alguien denegó el
   * micrófono una vez en este sitio, el navegador se lo apunta y a partir de
   * entonces rechaza al instante, sin volver a preguntar nunca. Por eso con la
   * cámara sí aparece el diálogo y con el micrófono no. Ningún cambio de código
   * puede deshacer ese "no" guardado: hay que decirle a la persona dónde
   * revocarlo. Eso es lo que hace el aviso de abajo.
   */
  const alternarMicrofono = React.useCallback(async () => {
    const queremosEncender = !room.localParticipant.isMicrophoneEnabled;
    try {
      await room.localParticipant.setMicrophoneEnabled(queremosEncender);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const enIOS =
        typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
        toast.error(
          enIOS
            ? 'Tu navegador tiene bloqueado el micrófono para esta sala y por eso ya no te lo vuelve a preguntar. Toca «AA» arriba, a la izquierda de la dirección → Ajustes del sitio web → Micrófono → Permitir, y recarga la página.'
            : 'Tu navegador tiene bloqueado el micrófono para esta sala y por eso ya no te lo vuelve a preguntar. Toca el candado que hay junto a la dirección → Permisos → Micrófono → Permitir, y recarga la página.',
          { duration: 14000 },
        );
      } else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') {
        toast.error(
          'No encontramos ningún micrófono disponible. Si tienes auriculares conectados, prueba a desconectarlos y vuelve a intentarlo.',
          { duration: 10000 },
        );
      } else if (e?.name === 'NotReadableError' || e?.name === 'AbortError') {
        toast.error(
          'Otra aplicación está usando el micrófono. Cierra las llamadas o grabaciones abiertas y vuelve a intentarlo.',
          { duration: 10000 },
        );
      } else {
        toast.error(
          `No pudimos activar el micrófono (${e?.name ?? 'error'}): ${e?.message ?? 'sin detalle'}`,
          { duration: 10000 },
        );
      }
    }
  }, [room]);

  return (
    <div
      className="fenix-dock"
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '7px 14px',
        background: '#101018',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        position: 'relative',
      }}
    >
      {/* ── Izquierda: lo mío ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <DockButton
          icon={mic.enabled ? '🎙️' : '🔇'}
          label="Audio"
          off={!mic.enabled}
          onClick={() => void alternarMicrofono()}
          // A propósito sin `disabled`. Antes se apagaba mientras hubiera una
          // operación en curso, y bastaba con que una se quedara colgada para
          // que la persona no pudiera reintentarlo nunca: el botón dejaba de
          // reaccionar —sin pedir permiso y sin dar error— y ya no había forma
          // de hablar en toda la sesión. Poder pulsarlo dos veces es un mal
          // mucho menor que no poder pulsarlo ninguna.
          title={mic.enabled ? 'Silenciar mi micrófono' : 'Activar mi micrófono'}
          extra={<ChevronDispositivos kind="audioinput" />}
        />
        <DockButton
          icon={cam.enabled ? '📹' : '🚫'}
          label="Vídeo"
          off={!cam.enabled}
          onClick={() => void cam.toggle()}
          disabled={cam.pending}
          title={cam.enabled ? 'Apagar mi cámara' : 'Encender mi cámara'}
          extra={<ChevronDispositivos kind="videoinput" />}
        />
      </div>

      {/* ── Centro: la sala ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2px',
          flexWrap: 'wrap',
        }}
      >
        <DockButton
          icon="👥"
          label="Participantes"
          badge={totalParticipantes}
          alerta={manosLevantadas}
          active={panelAbierto === 'participantes'}
          onClick={() => onTogglePanel('participantes')}
        />

        <DockButton
          icon="💬"
          label="Chat"
          badge={sinLeer}
          active={panelAbierto === 'chat'}
          onClick={() => onTogglePanel('chat')}
        />

        {/* Reaccionar */}
        <div style={{ position: 'relative' }}>
          <DockButton
            icon={manoLevantada ? '✋' : '😀'}
            label="Reaccionar"
            active={menu === 'reacciones' || manoLevantada}
            onClick={() => setMenu((m) => (m === 'reacciones' ? null : 'reacciones'))}
          />
          {menu === 'reacciones' && (
            <Popover onClose={cerrarMenu}>
              <div style={{ display: 'flex', gap: '4px' }}>
                {REACCIONES.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      onReaccion(e);
                      cerrarMenu();
                    }}
                    title={`Enviar ${e}`}
                    style={{
                      width: '42px',
                      height: '42px',
                      fontSize: '23px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      transition: 'background 0.12s, transform 0.12s',
                    }}
                    onMouseEnter={(ev) => {
                      ev.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                      ev.currentTarget.style.transform = 'scale(1.18)';
                    }}
                    onMouseLeave={(ev) => {
                      ev.currentTarget.style.background = 'transparent';
                      ev.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>

              {/* Levantar la mano no es una reacción: no se apaga sola y el
                  anfitrión la ve en su lista hasta que da la palabra. Por eso
                  va separada por una línea. */}
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                }}
              >
                <button
                  onClick={() => {
                    onToggleMano();
                    cerrarMenu();
                  }}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    background: manoLevantada ? 'rgba(201,168,76,0.18)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${manoLevantada ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: '9px',
                    color: manoLevantada ? ORO : '#fff',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit',
                  }}
                >
                  ✋ {manoLevantada ? 'Bajar la mano' : 'Levantar la mano'}
                </button>
              </div>
            </Popover>
          )}
        </div>

        {isHost && (
          <DockButton
            icon="🖥"
            label="Compartir"
            active={pantalla.enabled}
            disabled={pantalla.pending}
            onClick={() => void pantalla.toggle()}
            title={pantalla.enabled ? 'Dejar de compartir' : 'Compartir pantalla'}
          />
        )}

        {/* Más — herramientas de anfitrión */}
        {herramientas.length > 0 && (
          <div style={{ position: 'relative' }}>
            <DockButton
              icon="⋯"
              label="Más"
              active={menu === 'mas' || herramientas.some((h) => h.active)}
              onClick={() => setMenu((m) => (m === 'mas' ? null : 'mas'))}
            />
            {menu === 'mas' && (
              <Popover onClose={cerrarMenu}>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '250px' }}
                >
                  {herramientas.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        h.onClick();
                        cerrarMenu();
                      }}
                      disabled={h.disabled}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 11px',
                        background: h.active ? 'rgba(201,168,76,0.14)' : 'transparent',
                        border: 'none',
                        borderRadius: '9px',
                        color: h.disabled ? 'rgba(255,255,255,0.3)' : h.active ? ORO : '#e9e9ef',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        cursor: h.disabled ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={(ev) => {
                        if (!h.disabled && !h.active)
                          ev.currentTarget.style.background = 'rgba(255,255,255,0.07)';
                      }}
                      onMouseLeave={(ev) => {
                        if (!h.active) ev.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span style={{ fontSize: '16px' }}>{h.icon}</span>
                      <span style={{ flex: 1 }}>{h.label}</span>
                      {h.detail && (
                        <span
                          style={{
                            fontSize: '11px',
                            opacity: 0.65,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {h.detail}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </Popover>
            )}
          </div>
        )}
      </div>

      {/* ── Derecha: la salida ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isHost ? (
          botonSalir
        ) : (
          <button
            onClick={() => void room.disconnect()}
            title="Salir de la sesión"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '3px',
              minWidth: '62px',
              padding: '6px 12px',
              borderRadius: '10px',
              border: '1px solid rgba(239,68,68,0.35)',
              background: 'rgba(239,68,68,0.12)',
              color: '#f87171',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: '19px', lineHeight: 1 }}>⏻</span>
            <span className="fenix-dock-label" style={{ fontSize: '10.5px', fontWeight: 700 }}>
              Salir
            </span>
          </button>
        )}
      </div>

      <style>{`
        /* El chevron de dispositivos es de LiveKit; aquí solo lo encogemos
           para que quede pegado al botón y no parezca un botón aparte. */
        .fenix-chevron .lk-button {
          background: transparent;
          border: none;
          padding: 0 2px;
          width: 14px;
          min-width: 14px;
          color: rgba(255,255,255,0.45);
        }
        .fenix-chevron .lk-button:hover { color: #fff; background: transparent; }

        @media (max-width: 720px) {
          .fenix-dock { flex-wrap: wrap; justify-content: center; padding: 6px 8px; }
          /* En el móvil los nombres no caben: quedan los iconos, que es
             exactamente lo que hace Zoom en pantalla pequeña. */
          .fenix-dock-label { display: none; }
          .fenix-chevron { display: none; }
        }
      `}</style>
    </div>
  );
}
