import { useEffect, useRef } from "react";

export interface ThreadsProps {
  color?: [number, number, number];
  amplitude?: number;
  distance?: number;
  enableMouseInteraction?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const VS_SOURCE = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FS_SOURCE = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec3 u_color;
uniform float u_amplitude;
uniform float u_distance;
uniform float u_enableMouse;

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
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);

  // Diagonal angle across the screen (~35 deg slant)
  float angle = -0.62;
  float cosA = cos(angle);
  float sinA = sin(angle);
  vec2 pRot = vec2(p.x * cosA - p.y * sinA, p.x * sinA + p.y * cosA);

  // Mouse deflection interaction
  vec2 mouseNorm = (u_mouse - 0.5 * u_resolution.xy) / min(u_resolution.x, u_resolution.y);
  vec2 mouseRot = vec2(mouseNorm.x * cosA - mouseNorm.y * sinA, mouseNorm.x * sinA + mouseNorm.y * cosA);
  float mouseDist = length(pRot - mouseRot);
  float mouseForce = (u_enableMouse > 0.5) ? smoothstep(0.65, 0.0, mouseDist) * 0.12 : 0.0;

  float threadsSum = 0.0;
  const float STRANDS = 24.0;

  for (float i = 0.0; i < STRANDS; i += 1.0) {
    float fi = i / (STRANDS - 1.0);

    float speed = 0.28 + fi * 0.18;
    float freq = 1.75 + fi * 0.95;
    float amp = (0.30 + 0.12 * sin(fi * 3.1415)) * u_amplitude;

    float wave = sin(pRot.x * freq + u_time * speed + fi * 3.3) * amp;
    wave += cos(pRot.x * 1.2 - u_time * 0.14 + fi * 1.7) * 0.08;
    wave += (noise(vec2(pRot.x * 2.2 + u_time * 0.08, fi * 5.5)) - 0.5) * 0.07;

    wave += mouseForce * sin(pRot.x * 6.5 + u_time * 1.25);

    float yOffset = (fi - 0.5) * (0.46 + u_distance);
    float distToWave = abs(pRot.y - (wave + yOffset));

    float lineIntensity = smoothstep(0.0036, 0.0006, distToWave);
    float edgeFade = smoothstep(1.7, 0.2, abs(pRot.x));
    float lineLuminance = 0.45 + 0.55 * sin(fi * 3.1415);

    threadsSum += lineIntensity * lineLuminance * edgeFade;
  }

  float alpha = clamp(threadsSum, 0.0, 0.95);
  gl_FragColor = vec4(u_color, alpha);
}
`;

export function Threads({
  color = [0.4196078431372549, 0.4470588235294118, 0.5019607843137255],
  amplitude = 1,
  distance = 0,
  enableMouseInteraction = true,
  className,
  style,
}: ThreadsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animFrameId: number;
    let resizeObserver: ResizeObserver | null = null;

    function syncSize() {
      if (!canvas) return;
      const w = canvas.clientWidth || 1080;
      const h = canvas.clientHeight || 1080;
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
      canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false }) ||
      (canvas.getContext("experimental-webgl", {
        alpha: true,
        premultipliedAlpha: false,
      }) as WebGLRenderingContext | null);

    if (!gl) return;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    function compileShader(type: number, src: string) {
      const s = gl!.createShader(type);
      if (!s) return null;
      gl!.shaderSource(s, src);
      gl!.compileShader(s);
      return s;
    }

    const vShader = compileShader(gl.VERTEX_SHADER, VS_SOURCE);
    const fShader = compileShader(gl.FRAGMENT_SHADER, FS_SOURCE);
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
    const uColor = gl.getUniformLocation(prog, "u_color");
    const uAmp = gl.getUniformLocation(prog, "u_amplitude");
    const uDist = gl.getUniformLocation(prog, "u_distance");
    const uEnableMouse = gl.getUniformLocation(prog, "u_enableMouse");

    const mouse = { x: canvas.width / 2, y: canvas.height / 2 };
    const handleMouseMove = (event: MouseEvent) => {
      if (!enableMouseInteraction) return;
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
      if (!gl || !canvas) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      if (uTime) gl.uniform1f(uTime, t * 0.001);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      if (uMouse) gl.uniform2f(uMouse, mouse.x, mouse.y);
      if (uColor) gl.uniform3f(uColor, color[0], color[1], color[2]);
      if (uAmp) gl.uniform1f(uAmp, amplitude);
      if (uDist) gl.uniform1f(uDist, distance);
      if (uEnableMouse) gl.uniform1f(uEnableMouse, enableMouseInteraction ? 1.0 : 0.0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animFrameId = requestAnimationFrame(render);
    }

    animFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("mousemove", handleMouseMove);
      if (resizeObserver) resizeObserver.disconnect();
      if (gl) {
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
        gl.deleteShader(vShader);
        gl.deleteShader(fShader);
      }
    };
  }, [color, amplitude, distance, enableMouseInteraction]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        ...style,
      }}
    />
  );
}
