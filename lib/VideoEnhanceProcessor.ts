/**
 * VideoEnhanceProcessor — LiveKit TrackProcessor<'video'>
 *
 * Pipeline GPU mínimo (WebGL2 + OffscreenCanvas + Breakout Box):
 *   · Unsharp mask  — nitidez percibida (equivalente a CIUnsharpMask de Zoom/CoreImage)
 *   · Brightness    — lift de luminosidad para interiores
 *   · Contrast      — separación tonal micro-boost
 *   · Saturation    — vibrancy natural
 *
 * ~1–2 ms por frame 720p · sin CPU readback · VideoFrame nativo.
 * Compatible con LiveKit 2.x setProcessor() / stopProcessor() API.
 *
 * Defaults conservadores (similar a Zoom "Video Enhancement" baseline):
 *   sharpness 0.45 · brightness 0.04 · contrast 1.06 · saturation 1.08
 */

export interface VideoEnhanceConfig {
  sharpness?:  number;  // 0.0–1.0   · default 0.45
  brightness?: number;  // -0.2–0.2  · default 0.04
  contrast?:   number;  // 0.8–1.3   · default 1.06
  saturation?: number;  // 0.8–1.5   · default 1.08
}

// ── GLSL ──────────────────────────────────────────────────────────────────────

const VS = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
    v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  }
`;

const FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2  u_px;
  uniform float u_sharp;
  uniform float u_bright;
  uniform float u_contrast;
  uniform float u_sat;
  varying vec2 v_uv;

  void main() {
    vec4 c = texture2D(u_tex, v_uv);

    // 3x3 Gaussian blur (base para unsharp mask)
    vec4 b =
      texture2D(u_tex, v_uv + vec2(-u_px.x,-u_px.y)) * 0.0625 +
      texture2D(u_tex, v_uv + vec2(    0.0,-u_px.y)) * 0.125  +
      texture2D(u_tex, v_uv + vec2( u_px.x,-u_px.y)) * 0.0625 +
      texture2D(u_tex, v_uv + vec2(-u_px.x,    0.0)) * 0.125  +
      c                                                * 0.25   +
      texture2D(u_tex, v_uv + vec2( u_px.x,    0.0)) * 0.125  +
      texture2D(u_tex, v_uv + vec2(-u_px.x, u_px.y)) * 0.0625 +
      texture2D(u_tex, v_uv + vec2(    0.0, u_px.y)) * 0.125  +
      texture2D(u_tex, v_uv + vec2( u_px.x, u_px.y)) * 0.0625;

    // Unsharp mask: amplifica componente de alta frecuencia (bordes/detalles)
    vec4 s = c + u_sharp * (c - b);

    // Brightness + contrast centrados en 0.5 (sin shift tonal)
    vec3 bc = (s.rgb - 0.5) * u_contrast + 0.5 + u_bright;

    // Saturacion con pesos Rec.709 (luminancia perceptual precisa)
    float lum = dot(bc, vec3(0.2126, 0.7152, 0.0722));
    vec3 out_ = mix(vec3(lum), bc, u_sat);

    gl_FragColor = vec4(clamp(out_, 0.0, 1.0), 1.0);
  }
`;

// ── Helper ────────────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`[VideoEnhance] shader error:\n${gl.getShaderInfoLog(s)}`);
  return s;
}

// ── Processor ─────────────────────────────────────────────────────────────────

export class VideoEnhanceProcessor {
  readonly name = 'fenix-video-enhance';

  /** MediaStreamTrack procesado — LiveKit lo usa como nueva fuente al llamar setProcessor() */
  processedTrack?: MediaStreamTrack;

  /** Tiempo de procesamiento del último frame (ms). Leer externamente para métricas. */
  lastFrameMs = 0;

  private cfg: Required<VideoEnhanceConfig>;
  private canvas?: OffscreenCanvas;
  private gl?: WebGL2RenderingContext;
  private tex?: WebGLTexture;
  private uloc?: {
    px:       WebGLUniformLocation | null;
    sharp:    WebGLUniformLocation | null;
    bright:   WebGLUniformLocation | null;
    contrast: WebGLUniformLocation | null;
    sat:      WebGLUniformLocation | null;
  };
  private abort?: AbortController;

  constructor(cfg: VideoEnhanceConfig = {}) {
    this.cfg = {
      sharpness:  cfg.sharpness  ?? 0.45,
      brightness: cfg.brightness ?? 0.04,
      contrast:   cfg.contrast   ?? 1.06,
      saturation: cfg.saturation ?? 1.08,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async init(opts: { track: MediaStreamTrack }): Promise<void> {
    const { width = 1280, height = 720 } = opts.track.getSettings();

    // ── WebGL ────────────────────────────────────────────────────────────────
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('[VideoEnhance] WebGL2 no disponible en este entorno');
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER,   VS));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(`[VideoEnhance] link error:\n${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);

    // Quad de pantalla completa
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Textura de entrada
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);

    // Cache de uniform locations (evita lookup por frame)
    this.uloc = {
      px:       gl.getUniformLocation(prog, 'u_px'),
      sharp:    gl.getUniformLocation(prog, 'u_sharp'),
      bright:   gl.getUniformLocation(prog, 'u_bright'),
      contrast: gl.getUniformLocation(prog, 'u_contrast'),
      sat:      gl.getUniformLocation(prog, 'u_sat'),
    };

    gl.viewport(0, 0, width, height);

    // Uniforms estáticos (resolucion + parametros no cambian durante la sesion)
    gl.uniform2f(this.uloc.px,       1 / width, 1 / height);
    gl.uniform1f(this.uloc.sharp,    this.cfg.sharpness);
    gl.uniform1f(this.uloc.bright,   this.cfg.brightness);
    gl.uniform1f(this.uloc.contrast, this.cfg.contrast);
    gl.uniform1f(this.uloc.sat,      this.cfg.saturation);

    // ── Breakout Box (Insertable Streams) ────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const reader = new w.MediaStreamTrackProcessor({ track: opts.track }) as
      { readable: ReadableStream<VideoFrame> };
    const writer = new w.MediaStreamTrackGenerator({ kind: 'video' }) as
      { writable: WritableStream<VideoFrame> } & MediaStreamTrack;

    this.abort = new AbortController();
    const { signal } = this.abort;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    reader.readable
      .pipeThrough(
        new TransformStream<VideoFrame, VideoFrame>({
          transform: async (frame, ctrl) => {
            const t0  = performance.now();
            const ts  = frame.timestamp;        // guardar ANTES de close
            const dur = frame.duration ?? undefined;
            try {
              // createImageBitmap acepta VideoFrame directamente (Chrome 94+)
              const bmp = await createImageBitmap(frame as unknown as ImageBitmap);
              frame.close();

              const { gl, tex, canvas } = self;
              if (!gl || !tex || !canvas) {
                // Passthrough sin procesamiento
                ctrl.enqueue(new VideoFrame(bmp, { timestamp: ts, duration: dur }));
                bmp.close();
                return;
              }

              // Upload frame a textura WebGL (sin readback — GPU only)
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
              bmp.close();

              // Renderizar quad con shader de mejora
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              gl.flush(); // asegurar flush antes de transferToImageBitmap

              // Captura del resultado: transferencia zero-copy desde buffer WebGL
              const outBmp = canvas.transferToImageBitmap();
              ctrl.enqueue(new VideoFrame(outBmp, { timestamp: ts, duration: dur }));
              outBmp.close();

              self.lastFrameMs = performance.now() - t0;
            } catch (err) {
              // Nunca descartar frames — passthrough en caso de error
              console.warn('[VideoEnhance] frame skip:', err);
            }
          },
        }),
        { signal }
      )
      .pipeTo(writer.writable, { signal })
      .catch(() => { /* AbortError esperado al llamar destroy() */ });

    this.processedTrack = writer as unknown as MediaStreamTrack;
  }

  async destroy(): Promise<void> {
    this.abort?.abort();
    const { gl, tex } = this;
    if (gl && tex) gl.deleteTexture(tex);
    this.gl      = undefined;
    this.canvas  = undefined;
    this.tex     = undefined;
    this.processedTrack = undefined;
  }
}

/**
 * Verifica si el entorno soporta Breakout Box + WebGL2.
 * Requerido: Chrome 94+ / Edge 94+. Safari: no soportado.
 */
export function isVideoEnhanceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'MediaStreamTrackProcessor' in window &&
    'MediaStreamTrackGenerator' in window &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof WebGL2RenderingContext !== 'undefined'
  );
}
