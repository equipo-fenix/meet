/**
 * VideoEnhanceProcessor — LiveKit TrackProcessor<'video'>
 *
 * Pipeline GPU mínimo (WebGL2 + OffscreenCanvas + Breakout Box):
 *   · Unsharp mask  — nitidez percibida (equivalente a CIUnsharpMask de Zoom/CoreImage)
 *   · Brightness    — lift de luminosidad para interiores
 *   · Contrast      — separación tonal micro-boost
 *   · Saturation    — vibrancy natural
 *
 * ~0.5–3 ms por frame 720p · GPU blit sin CPU readback · VideoFrame nativo.
 * Compatible con LiveKit 2.x setProcessor() / stopProcessor() API.
 *
 * Implementa restart() — requerido para que LiveKit reutilice el processor
 * cuando el track de cámara cambia (setCameraEnabled off/on).
 *
 * Compatibilidad macOS: usa canvas 2D como intermediario para VideoFrame
 * (WebGL2 canvas → ctx2d.drawImage → canvas2d.transferToImageBitmap)
 * porque el VideoFrame constructor rechaza ImageBitmaps IOSurface-backed
 * de canvas WebGL2 en macOS Chrome.
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
    vec4 s = c + u_sharp * (c - b);
    vec3 bc = (s.rgb - 0.5) * u_contrast + 0.5 + u_bright;
    float lum = dot(bc, vec3(0.2126, 0.7152, 0.0722));
    vec3 out_ = mix(vec3(lum), bc, u_sat);
    gl_FragColor = vec4(clamp(out_, 0.0, 1.0), 1.0);
  }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(`[VideoEnhance] shader error:\n${gl.getShaderInfoLog(s)}`);
  return s;
}

interface BreakoutBoxWindow {
  MediaStreamTrackProcessor: new (opts: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };
  MediaStreamTrackGenerator: new (opts: { kind: 'video' | 'audio' }) => { writable: WritableStream<VideoFrame> } & MediaStreamTrack;
}

// ── Processor ─────────────────────────────────────────────────────────────────

export class VideoEnhanceProcessor {
  readonly name = 'fenix-video-enhance';

  processedTrack?: MediaStreamTrack;
  lastFrameMs = 0;

  private cfg: Required<VideoEnhanceConfig>;
  private canvas?: OffscreenCanvas;
  private gl?: WebGL2RenderingContext;
  private tex?: WebGLTexture;
  private uloc?: {
    px: WebGLUniformLocation | null;
    sharp: WebGLUniformLocation | null;
    bright: WebGLUniformLocation | null;
    contrast: WebGLUniformLocation | null;
    sat: WebGLUniformLocation | null;
  };
  private canvas2d?: OffscreenCanvas;
  private ctx2d?: OffscreenCanvasRenderingContext2D;
  private abort?: AbortController;

  constructor(cfg: VideoEnhanceConfig = {}) {
    this.cfg = {
      sharpness:  cfg.sharpness  ?? 0.45,
      brightness: cfg.brightness ?? 0.04,
      contrast:   cfg.contrast   ?? 1.06,
      saturation: cfg.saturation ?? 1.08,
    };
  }

  // ── init: configura WebGL + primer pipeline ────────────────────────────────
  async init(opts: { track: MediaStreamTrack }): Promise<void> {
    const { width = 1280, height = 720 } = opts.track.getSettings();

    // WebGL2 canvas para procesamiento GPU
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext('webgl2', {
      alpha: false, antialias: false, preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('[VideoEnhance] WebGL2 no disponible');
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER,   VS));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error(`[VideoEnhance] link error:\n${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);

    this.uloc = {
      px:       gl.getUniformLocation(prog, 'u_px'),
      sharp:    gl.getUniformLocation(prog, 'u_sharp'),
      bright:   gl.getUniformLocation(prog, 'u_bright'),
      contrast: gl.getUniformLocation(prog, 'u_contrast'),
      sat:      gl.getUniformLocation(prog, 'u_sat'),
    };
    gl.viewport(0, 0, width, height);
    gl.uniform2f(this.uloc.px,       1 / width, 1 / height);
    gl.uniform1f(this.uloc.sharp,    this.cfg.sharpness);
    gl.uniform1f(this.uloc.bright,   this.cfg.brightness);
    gl.uniform1f(this.uloc.contrast, this.cfg.contrast);
    gl.uniform1f(this.uloc.sat,      this.cfg.saturation);

    // Canvas 2D auxiliar para compatibilidad macOS con VideoFrame
    this.canvas2d = new OffscreenCanvas(width, height);
    const ctx2d = this.canvas2d.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
    if (!ctx2d) throw new Error('[VideoEnhance] OffscreenCanvas 2D no disponible');
    this.ctx2d = ctx2d;

    // Iniciar pipeline Breakout Box
    this.startPipeline(opts.track);
  }

  // ── restart: LiveKit llama esto cuando el MediaStreamTrack cambia ──────────
  // Ocurre cuando setCameraEnabled(false/true) cicla el track mientras
  // el processor está activo. Reutilizamos el contexto WebGL existente.
  async restart(opts: { track: MediaStreamTrack }): Promise<void> {
    // Abortar pipeline anterior
    this.abort?.abort();
    this.abort = undefined;
    this.processedTrack = undefined;
    this.lastFrameMs = 0;

    // Pausa breve para que el AbortSignal se propague
    await new Promise<void>(r => setTimeout(r, 50));

    // Actualizar uniform de resolución si cambió la cámara
    const { width = 1280, height = 720 } = opts.track.getSettings();
    if (this.gl && this.uloc) {
      this.gl.viewport(0, 0, width, height);
      this.gl.uniform2f(this.uloc.px, 1 / width, 1 / height);
    }

    // Iniciar nuevo pipeline con el track nuevo (WebGL reutilizado)
    this.startPipeline(opts.track);
    console.log('[VideoEnhance] restart — nuevo track de cámara adjuntado');
  }

  // ── Pipeline Breakout Box ─────────────────────────────────────────────────
  private startPipeline(track: MediaStreamTrack): void {
    const w = window as unknown as BreakoutBoxWindow;
    const reader = new w.MediaStreamTrackProcessor({ track });
    const writer = new w.MediaStreamTrackGenerator({ kind: 'video' });

    this.abort = new AbortController();
    const { signal } = this.abort;

    reader.readable
      .pipeThrough(
        new TransformStream<VideoFrame, VideoFrame>({
          transform: async (frame, ctrl) => {
            const t0  = performance.now();
            const ts  = frame.timestamp;
            // Nunca pasar duration undefined — causa OperationError en macOS
            const frameInit: VideoFrameInit = { timestamp: ts };
            if (typeof frame.duration === 'number') frameInit.duration = frame.duration;

            try {
              const bmp = await createImageBitmap(frame as unknown as ImageBitmap);
              frame.close();

              const { gl, tex, canvas, ctx2d, canvas2d } = this;
              if (!gl || !tex || !canvas || !ctx2d || !canvas2d) {
                // Passthrough: processor destruido entre frames
                ctrl.enqueue(new VideoFrame(bmp, frameInit));
                bmp.close();
                return;
              }

              // Upload a textura WebGL → render shader
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
              bmp.close();
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
              gl.flush();

              // GPU blit WebGL → 2D canvas (fix macOS VideoFrame IOSurface bug)
              ctx2d.drawImage(canvas, 0, 0);
              const outBmp = canvas2d.transferToImageBitmap();
              ctrl.enqueue(new VideoFrame(outBmp, frameInit));
              outBmp.close();

              this.lastFrameMs = performance.now() - t0;
            } catch (err) {
              // Frame drop individual — no interrumpe la cámara
              console.warn('[VideoEnhance] frame skip:', err);
            }
          },
        }),
        { signal }
      )
      .pipeTo(writer.writable, { signal })
      .catch(() => { /* AbortError esperado al destroy() o restart() */ });

    this.processedTrack = writer as unknown as MediaStreamTrack;
  }

  // ── destroy ───────────────────────────────────────────────────────────────
  async destroy(): Promise<void> {
    this.abort?.abort();
    const { gl, tex } = this;
    if (gl && tex) gl.deleteTexture(tex);
    this.gl       = undefined;
    this.canvas   = undefined;
    this.tex      = undefined;
    this.ctx2d    = undefined;
    this.canvas2d = undefined;
    this.processedTrack = undefined;
  }
}

/**
 * Verifica soporte de Breakout Box + WebGL2 + OffscreenCanvas.
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
