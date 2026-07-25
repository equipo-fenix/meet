/**
 * La intro de Vimeo que abre una sesión
 *
 * El parámetro llega por la URL, y una URL la escribe cualquiera. Si
 * aceptáramos una dirección completa estaríamos aceptando que un desconocido
 * decida qué se proyecta en el escenario de una clase — un iframe con lo que
 * él quiera, delante de los alumnos, con el logo de Fénix alrededor.
 *
 * Por eso lo único que viaja es el identificador numérico del video (y su
 * hash, si es privado). La dirección del reproductor la construimos aquí.
 * Nadie de fuera puede escribir un dominio.
 */

/** `123456789` o `123456789:a1b2c3d4e5` para videos no listados. */
const REF_VALIDA = /^(\d{6,12})(?::([0-9a-zA-Z]{6,24}))?$/;

export interface IntroRef {
  videoId: string;
  /** Hash de Vimeo para videos privados / no listados. */
  hash?: string;
}

/** Devuelve `null` para cualquier cosa que no sea una referencia de Vimeo. */
export function parseIntroRef(raw: string | null | undefined): IntroRef | null {
  if (typeof raw !== 'string') return null;
  const match = REF_VALIDA.exec(raw.trim());
  if (!match) return null;
  return { videoId: match[1], hash: match[2] || undefined };
}

/**
 * Extrae la referencia de lo que haya escrito una persona al programar la
 * sesión: puede pegar la URL del navegador, la de compartir, la del embed o
 * solo el número. Todas describen el mismo video.
 */
export function introRefFromInput(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const texto = input.trim();
  if (!texto) return null;

  // Ya es una referencia limpia.
  if (REF_VALIDA.test(texto)) return texto;

  // vimeo.com/123456789/abcdef  ·  player.vimeo.com/video/123456789?h=abcdef
  const conRuta = /vimeo\.com\/(?:video\/)?(\d{6,12})(?:\/([0-9a-zA-Z]{6,24}))?/.exec(texto);
  if (conRuta) {
    const hashQuery = /[?&]h=([0-9a-zA-Z]{6,24})/.exec(texto);
    const hash = conRuta[2] || hashQuery?.[1];
    return hash ? `${conRuta[1]}:${hash}` : conRuta[1];
  }

  return null;
}

/**
 * URL del reproductor. Sin controles, sin título, sin sugerencias al final:
 * esto es una cortinilla, no una página de Vimeo. Y con `autoplay` + `muted`
 * apagados a propósito — el sonido lo gestiona la sala, ver más abajo.
 */
export function introPlayerUrl(ref: IntroRef, opts: { startAt?: number; muted?: boolean } = {}) {
  const params = new URLSearchParams({
    autoplay: '1',
    // Sin esto, Safari y Chrome bloquean el arranque automático. La sala lo
    // desactiva en cuanto la persona toca la pantalla.
    muted: opts.muted === false ? '0' : '1',
    playsinline: '1',
    title: '0',
    byline: '0',
    portrait: '0',
    badge: '0',
    controls: '0',
    dnt: '1',
  });
  if (ref.hash) params.set('h', ref.hash);
  // Quien llega tarde no ve la intro desde el principio: la ve por donde va.
  if (opts.startAt && opts.startAt > 0) params.set('t', `${Math.floor(opts.startAt)}s`);
  return `https://player.vimeo.com/video/${ref.videoId}?${params.toString()}`;
}
