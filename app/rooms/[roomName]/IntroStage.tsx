'use client';

/**
 * La cortinilla de apertura
 *
 * Hasta hoy, el primero en llegar a una sesión entraba a una sala vacía y se
 * quedaba mirando su propia cámara hasta que apareciera alguien más. Cinco
 * minutos de eso bastan para que la gente se vaya.
 *
 * La intro llena ese hueco. A la hora de inicio empieza a correr un video, y
 * los alumnos entran a algo que ya empezó. Mientras corre, todos se van viendo
 * aparecer en sus recuadros — la sala se llena a la vista de todos, que es
 * exactamente la sensación que da entrar a un salón antes de que empiece la
 * clase. Cuando el video termina, el escenario se lo lleva el anfitrión.
 *
 * Detalles que importan:
 *
 *   · Quien llega tarde no ve la intro desde el principio. La ve por donde va.
 *     Todos están en el mismo minuto del mismo video.
 *
 *   · Arranca en silencio porque el navegador no deja otra cosa, y se desmutea
 *     sola en cuanto la persona toca cualquier parte de la pantalla. Mientras
 *     tanto hay un botón que lo dice, para quien no toque nada.
 *
 *   · Termina por dos caminos a la vez: el aviso del reproductor y un
 *     cronómetro con la duración que se guardó al programar la sesión. Si
 *     Vimeo no responde, la sesión empieza igual. Una sala que se queda
 *     colgada en una cortinilla es peor que no tener cortinilla.
 */

import * as React from 'react';
import { introPlayerUrl, type IntroRef } from '@/lib/vimeoIntro';

interface IntroStageProps {
  introRef: IntroRef;
  /** Momento en que la intro empezó a correr, en milisegundos epoch. */
  startedAtMs: number;
  /** Duración declarada al programar la sesión. */
  durationSec: number;
  onEnded: () => void;
}

/**
 * Margen antes de rendirse si el reproductor no avisa que terminó. Vale más
 * cortar un par de segundos tarde que dejar la sala colgada.
 */
const MARGEN_SEGURIDAD_SEG = 2;

export function IntroStage({ introRef, startedAtMs, durationSec, onEnded }: IntroStageProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [silenciada, setSilenciada] = React.useState(true);
  const [duracionVimeoSec, setDuracionVimeoSec] = React.useState<number | null>(null);
  // El anfitrión puede preparar la sala antes de la hora. En ese caso conoce
  // la intro, pero no debe reproducirla antes: esperamos al reloj del servidor.
  const [yaEmpezo, setYaEmpezo] = React.useState(() => Date.now() >= startedAtMs);

  React.useEffect(() => {
    if (Date.now() >= startedAtMs) {
      setYaEmpezo(true);
      return;
    }
    const id = setInterval(() => {
      if (Date.now() >= startedAtMs) setYaEmpezo(true);
    }, 1000);
    return () => clearInterval(id);
  }, [startedAtMs]);

  // El punto por el que va la intro cuando esta persona entra. Se calcula una
  // sola vez: recalcularlo obligaría a recargar el iframe y el video saltaría.
  const desdeSegundos = React.useMemo(() => {
    if (!yaEmpezo) return 0;
    const transcurrido = (Date.now() - startedAtMs) / 1000;
    return transcurrido > 0 ? transcurrido : 0;
  }, [startedAtMs, yaEmpezo]);

  const src = React.useMemo(
    () => introPlayerUrl(introRef, { startAt: desdeSegundos }),
    [introRef, desdeSegundos],
  );

  // Una sola salida, se llame desde donde se llame.
  const terminada = React.useRef(false);
  const terminar = React.useCallback(() => {
    if (terminada.current) return;
    terminada.current = true;
    onEnded();
  }, [onEnded]);

  // ── Cronómetro de respaldo ────────────────────────────────────────────────
  React.useEffect(() => {
    if (!yaEmpezo) return;
    // El campo guardado al programar es un respaldo. Si Vimeo responde,
    // manda la duración real del archivo para que una intro de 5:15 no se
    // corte porque alguien dejó el valor predeterminado de 60 segundos.
    const duracionEfectiva = Math.max(durationSec, duracionVimeoSec ?? 0);
    const restante = duracionEfectiva - desdeSegundos + MARGEN_SEGURIDAD_SEG;
    if (restante <= 0) {
      terminar();
      return;
    }
    const id = setTimeout(terminar, restante * 1000);
    return () => clearTimeout(id);
  }, [durationSec, duracionVimeoSec, desdeSegundos, terminar, yaEmpezo]);

  // ── El reproductor avisa que terminó ──────────────────────────────────────
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://player.vimeo.com') return;
      let data: { event?: string; method?: string; value?: unknown };
      try {
        data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.event === 'ready') {
        for (const eventName of ['ended', 'finish']) {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ method: 'addEventListener', value: eventName }),
            'https://player.vimeo.com',
          );
        }
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ method: 'getDuration' }),
          'https://player.vimeo.com',
        );
      }
      if (
        data?.method === 'getDuration' &&
        typeof data.value === 'number' &&
        Number.isFinite(data.value) &&
        data.value > 0
      ) {
        setDuracionVimeoSec(data.value);
      }
      if (data?.event === 'ended' || data?.event === 'finish') terminar();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [terminar]);

  // ── Devolver el sonido al primer gesto ────────────────────────────────────
  const activarSonido = React.useCallback(() => {
    const ventana = iframeRef.current?.contentWindow;
    if (!ventana) return;
    ventana.postMessage(
      JSON.stringify({ method: 'setVolume', value: 1 }),
      'https://player.vimeo.com',
    );
    setSilenciada(false);
  }, []);

  React.useEffect(() => {
    if (!silenciada) return;
    const alTocar = () => activarSonido();
    // `once` en los tres: el primer gesto que llegue sirve.
    window.addEventListener('pointerdown', alTocar, { once: true });
    window.addEventListener('keydown', alTocar, { once: true });
    window.addEventListener('touchstart', alTocar, { once: true });
    return () => {
      window.removeEventListener('pointerdown', alTocar);
      window.removeEventListener('keydown', alTocar);
      window.removeEventListener('touchstart', alTocar);
    };
  }, [silenciada, activarSonido]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#000' }}>
      {yaEmpezo ? (
        <iframe
          ref={iframeRef}
          src={src}
          title="Introducción de la sesión"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          // La sala usa COEP para proteger las llamadas. Vimeo es un origen
          // externo, así que el iframe debe cargarse sin credenciales para que
          // Chrome permita incrustarlo manteniendo el aislamiento de la sala.
          {...({ credentialless: '' } as Record<string, string>)}
          // Sin `allow-top-navigation`: una cortinilla no tiene por qué poder
          // sacar a nadie de la sala.
          sandbox="allow-scripts allow-same-origin allow-presentation"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            textAlign: 'center',
            background:
              'radial-gradient(circle at 50% 42%, rgba(201,168,76,.20), transparent 34%), #050509',
          }}
        >
          <div>
            <div style={{ fontSize: '30px', marginBottom: '10px' }}>✦</div>
            <strong style={{ fontSize: '18px' }}>La apertura comenzará a la hora programada</strong>
            <p style={{ marginTop: '7px', color: 'rgba(255,255,255,.58)', fontSize: '13px' }}>
              Puedes preparar cámara y micrófono mientras esperas.
            </p>
          </div>
        </div>
      )}

      {/* Marca de que esto es la apertura y no la sesión */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 12px',
          borderRadius: '20px',
          background: 'rgba(10,10,15,0.72)',
          border: '1px solid rgba(201,168,76,0.35)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}
      >
        <span
          style={{ fontSize: '11px', fontWeight: 700, color: '#C9A84C', letterSpacing: '0.1em' }}
        >
          LA SESIÓN ESTÁ POR COMENZAR
        </span>
      </div>

      {silenciada && (
        <button
          onClick={activarSonido}
          style={{
            position: 'absolute',
            bottom: '18px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '9px 18px',
            borderRadius: '22px',
            background: 'rgba(201,168,76,0.92)',
            border: 'none',
            color: '#0a0a0f',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 3px 16px rgba(0,0,0,0.5)',
          }}
        >
          🔊 Activar sonido
        </button>
      )}
    </div>
  );
}
