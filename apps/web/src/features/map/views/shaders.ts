import * as THREE from 'three';
import { DECADE } from './landscape.js';
const U = <T,>(value: T) => ({ value });

export const starMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    attribute vec3 aColor; attribute float aSize, aBright, aHalo, aTwinkle, aPhase, aLit;
    uniform float uTime, uScale;
    varying vec3 vColor; varying float vBright, vHalo;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float tw = aTwinkle > 0.5 ? 0.62 + 0.38 * pow(0.5 + 0.5 * sin(uTime * 2.4 + aPhase * 40.0), 3.0) * 1.6 : 1.0;
      vColor = aColor; vBright = aBright * tw * aLit; vHalo = aHalo * aLit;
      gl_PointSize = clamp(aSize * uScale * 5.5 / -mv.z, 2.5, 110.0);
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColor; varying float vBright, vHalo;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float core = exp(-d * d * 30.0);
      float glow = exp(-d * 5.5) * 0.3;
      float halo = vHalo * smoothstep(0.05, 0.0, abs(d - 0.42)) * 0.22;
      vec3 c = vColor * glow * vBright + mix(vColor, vec3(1.0), 0.35) * core * vBright * 1.5 + vColor * halo;
      gl_FragColor = vec4(c, 1.0);
    }`,
});

export const terrainMat = () => new THREE.ShaderMaterial({
  uniforms: { uH1: U(new THREE.Color()), uH2: U(new THREE.Color()), uH3: U(new THREE.Color()), uH4: U(new THREE.Color()),
    uDeep: U(new THREE.Color()), uContour: U(new THREE.Color()), uShore: U(new THREE.Color()), uPaper: U(new THREE.Color()),
    uFogNear: U(11), uFogFar: U(26), uDark: U(0), uFloorY: U(0) },
  vertexShader: /* glsl */`
    varying vec3 vN; varying float vY, vDepth;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vY = w.y; vN = normalize(mat3(modelMatrix) * normal);
      vec4 mv = viewMatrix * w; vDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uH1, uH2, uH3, uH4, uDeep, uContour, uShore, uPaper; uniform float uFogNear, uFogFar, uDark, uFloorY;
    varying vec3 vN; varying float vY, vDepth;
    void main() {
      float dec = vY / ${DECADE.toFixed(3)};
      float t = clamp(dec / 2.0, 0.0, 1.0);
      vec3 land = t < 0.33 ? mix(uH1, uH2, t / 0.33) : t < 0.66 ? mix(uH2, uH3, (t - 0.33) / 0.33) : mix(uH3, uH4, (t - 0.66) / 0.34);
      vec3 sea = mix(uH1, uDeep, clamp(-dec / 2.5, 0.0, 1.0));
      vec3 col = dec >= 0.0 ? land : sea;
      float light = 0.62 + 0.5 * max(dot(normalize(vN), normalize(vec3(-0.45, 0.8, 0.35))), 0.0);
      col *= mix(light, 0.75 + 0.35 * light, uDark);
      float f = dec * 4.0;                       // a contour every quarter decade (×1.78)
      float line = (1.0 - smoothstep(0.0, max(fwidth(f), 1e-4) * 1.1, abs(fract(f - 0.5) - 0.5))) * smoothstep(uFloorY + 0.01, uFloorY + 0.06, vY);
      col = mix(col, uContour, line * (dec >= 0.0 ? 0.55 : 0.25));
      float shore = 1.0 - smoothstep(0.0, max(fwidth(dec), 1e-4) * 1.6, abs(dec));
      col = mix(col, uShore, shore);
      col = mix(col, uPaper, smoothstep(uFogNear, uFogFar, vDepth));
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});

export const markerMat = () => new THREE.ShaderMaterial({
  uniforms: { uScale: U(1), uRingCol: U(new THREE.Color()), uFill: U(new THREE.Color()), uFault: U(new THREE.Color()) },
  transparent: true, depthWrite: false,
  vertexShader: /* glsl */`
    attribute vec3 aColor; attribute float aSize, aAlpha, aRing; uniform float uScale;
    varying vec3 vC; varying float vA, vR;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aSize * uScale / -mv.z, 3.0, 26.0);
      vC = aColor; vA = aAlpha; vR = aRing;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uRingCol, uFill, uFault; varying vec3 vC; varying float vA, vR;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float aa = fwidth(d);
      float disc = 1.0 - smoothstep(1.0 - aa * 1.5, 1.0, d);
      if (disc <= 0.0 || vA <= 0.0) discard;
      // buoys (protected, afloat): ink ring; unprotected: fault ring; centre is the type colour
      float inner = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, d);
      vec3 col = vR > 1.5 ? mix(uFault, vC, inner) : vR > 0.5 ? mix(uRingCol, mix(uFill, vC, 0.85), inner) : vC;
      gl_FragColor = vec4(col, disc * vA);
      #include <colorspace_fragment>
    }`,
});
