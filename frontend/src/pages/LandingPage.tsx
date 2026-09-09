import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

export function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animFrameId: number;
    let resizeObserver: ResizeObserver | null = null;

    function syncSize() {
      if (!canvas) return;
      const w = canvas.clientWidth || 1280;
      const h = canvas.clientHeight || 720;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(syncSize);
      resizeObserver.observe(canvas);
    }
    syncSize();

    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    if (!gl) return;

    const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

    const fs = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

    vec2 mouseNorm = (u_mouse - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
    float mouseDist = length(p - mouseNorm);
    float mouseForce = smoothstep(0.6, 0.0, mouseDist) * 0.08;

    vec3 bgColor = vec3(0.051, 0.063, 0.078);

    vec3 threadColor = vec3(0.58, 0.64, 0.72);
    float threadsSum = 0.0;

    for (float i = 0.0; i < 30.0; i += 1.0) {
        float fi = i / 30.0;
        float speed = 0.32 + fi * 0.22;
        float freq = 2.1 + fi * 1.4;
        float amp = 0.28 + 0.12 * sin(fi * 6.28);

        float wave = sin(p.x * freq + u_time * speed + fi * 3.6) * amp;
        wave += cos(p.x * 1.4 - u_time * 0.18 + fi * 1.8) * 0.07;
        wave += (noise(vec2(p.x * 2.2 + u_time * 0.09, fi * 9.0)) - 0.5) * 0.10;

        wave += mouseForce * sin(p.x * 8.0 + u_time * 1.1);

        float distToWave = abs(p.y - wave + (fi - 0.5) * 0.55);
        float lineIntensity = smoothstep(0.0035, 0.0006, distToWave);

        float edgeFade = smoothstep(1.3, 0.1, abs(p.x));
        threadsSum += lineIntensity * (0.24 + 0.36 * sin(fi * 3.1415)) * edgeFade;
    }

    vec3 finalColor = bgColor + threadColor * clamp(threadsSum, 0.0, 0.95);
    gl_FragColor = vec4(finalColor, 1.0);
}`;

    function compileShader(type: number, src: string) {
      const s = gl!.createShader(type);
      if (!s) return null;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }

    const vShader = compileShader(gl.VERTEX_SHADER, vs);
    const fShader = compileShader(gl.FRAGMENT_SHADER, fs);
    if (!vShader || !fShader) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vShader);
    gl.attachShader(prog, fShader);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    const pos = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");

    const mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        const nx = (event.clientX - rect.left) / rect.width;
        const ny = 1.0 - (event.clientY - rect.top) / rect.height;
        mouse.x = nx * canvas.width;
        mouse.y = ny * canvas.height;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);

    function render(t: number) {
      syncSize();
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      if (uTime) gl!.uniform1f(uTime, t * 0.001);
      if (uRes) gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      if (uMouse) gl!.uniform2f(uMouse, mouse.x, mouse.y);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      animFrameId = requestAnimationFrame(render);
    }

    animFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="hero-landing">
      <div className="hero-canvas-wrap">
        <canvas ref={canvasRef} className="hero-canvas" />
      </div>
      <div className="hero-content">
        <header className="hero-header">
          <span className="hero-wordmark">Weft</span>
        </header>
        <main className="hero-main">
          <h1 className="hero-title anim-rise-1">See where the weft breaks</h1>
          <p className="hero-subtitle anim-rise-2">
            Map how your services depend on each other. Know the blast radius before it happens.
          </p>
          <div className="hero-cta-wrap anim-rise-3">
            <button
              type="button"
              className="hero-cta-btn"
              onClick={() => navigate("/graph")}
            >
              See it in action
            </button>
          </div>
        </main>
        <footer className="hero-footer">
          <span>Service dependency &amp; blast radius</span>
          <span>v0.4.1</span>
        </footer>
      </div>
    </div>
  );
}
