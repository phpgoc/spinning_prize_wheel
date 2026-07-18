<script lang="ts">
  import type { AnimationStyle, WheelOption } from './types';
  import { createWeightedSegments, type WeightedSegment } from './wheel-geometry';

  export let options: WheelOption[] = [];
  export let rotation = 0;
  export let duration = 4000;
  export let animationStyle: AnimationStyle = 'luxury';
  export let eliminatedIds: string[] = [];
  export let spinning = false;
  export let disabled = false;
  export let centerLabel = '开始';
  export let onSpin: () => void;

  const size = 320;
  const center = size / 2;
  const radius = 153;

  function polar(angle: number, r = radius) {
    const radians = (angle * Math.PI) / 180;
    return {
      x: center + r * Math.cos(radians),
      y: center + r * Math.sin(radians),
    };
  }

  function segmentAngles(segment: WeightedSegment) {
    const slice = segment.sizeRatio * 360;
    const start = -90 + segment.startRatio * 360;
    return { start, end: start + slice, slice };
  }

  function segmentPath(segment: WeightedSegment): string {
    const { start, end, slice } = segmentAngles(segment);
    const startPoint = polar(start);
    if (slice >= 360) {
      const middlePoint = polar(start + 180);
      return [
        `M ${startPoint.x} ${startPoint.y}`,
        `A ${radius} ${radius} 0 1 1 ${middlePoint.x} ${middlePoint.y}`,
        `A ${radius} ${radius} 0 1 1 ${startPoint.x} ${startPoint.y}`,
        'Z',
      ].join(' ');
    }
    const endPoint = polar(end);
    const largeArc = slice > 180 ? 1 : 0;

    return [
      `M ${center} ${center}`,
      `L ${startPoint.x} ${startPoint.y}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y}`,
      'Z',
    ].join(' ');
  }

  function labelPosition(segment: WeightedSegment) {
    const { start, slice } = segmentAngles(segment);
    const angle = start + slice / 2;
    const point = polar(angle, options.length > 9 ? 108 : 112);
    return { ...point, angle };
  }

  function shortLabel(label: string): string {
    const max = options.length > 9 ? 5 : options.length > 6 ? 7 : 9;
    return label.length > max ? `${label.slice(0, max)}…` : label;
  }

  function readableText(hex: string): string {
    const normalized = hex.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#161712';
    const [red, green, blue] = [0, 2, 4].map((index) =>
      Number.parseInt(normalized.slice(index, index + 2), 16),
    );
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    return luminance > 158 ? '#171813' : '#fffdf7';
  }

  $: eliminated = new Set(eliminatedIds);
  $: weightedSegments = createWeightedSegments(options);
</script>

<div
  class="wheel-stage"
  class:luxury={animationStyle === 'luxury'}
  class:three-d={animationStyle === 'threeD'}
  class:simple={animationStyle === 'simple'}
  class:spinning
>
  <div class="orbit orbit-one"><span></span><span></span><span></span></div>
  <div class="orbit orbit-two"><span></span><span></span><span></span></div>

  <div class="pointer" aria-hidden="true">
    <div></div>
  </div>

  <div class="wheel-shadow"></div>
  <div class="wheel-tilt">
    <div
      class="wheel-rotor"
      style={`transform: rotate(${rotation}deg); transition-duration: ${duration}ms;`}
    >
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="奖项转盘">
        <defs>
          <filter id="inner-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.24" />
          </filter>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="rgba(20,21,16,.58)" />
            <rect width="2" height="8" fill="rgba(255,255,255,.13)" />
          </pattern>
        </defs>

        <circle cx={center} cy={center} r="158" class="outer-rim" />

        {#if options.length > 0}
          {#each options as option, index (option.id)}
            {@const segment = weightedSegments[index]}
            {@const position = labelPosition(segment)}
            <path
              d={segmentPath(segment)}
              fill={option.color}
              class:eliminated={eliminated.has(option.id)}
              class:retry-segment={option.isRetry}
              class="segment"
            />
            {#if eliminated.has(option.id)}
              <path d={segmentPath(segment)} fill="url(#hatch)" class="hatch" />
            {/if}
            <text
              x={position.x}
              y={position.y}
              fill={eliminated.has(option.id) ? '#aaa99f' : readableText(option.color)}
              transform={`rotate(${position.angle + 90} ${position.x} ${position.y})`}
              class:retry-label={option.isRetry}
              class="segment-label"
              text-anchor="middle"
              dominant-baseline="middle"
            >
              {shortLabel(option.label)}
            </text>
          {/each}
        {:else}
          <circle cx={center} cy={center} r={radius} fill="#303128" />
          <text x={center} y={center - 62} class="empty-label" text-anchor="middle">请启用奖项</text>
        {/if}

        <circle cx={center} cy={center} r="52" class="hub-ring" />
        <circle cx={center} cy={center} r="44" class="hub" />
      </svg>
    </div>
  </div>

  <button
    type="button"
    class="spin-button"
    aria-label={spinning ? '转盘旋转中' : '开始转动转盘'}
    disabled={disabled || spinning}
    on:click={onSpin}
  >
    <strong>{spinning ? '转动中' : centerLabel}</strong>
  </button>
</div>

<style>
  .wheel-stage {
    position: relative;
    width: min(100%, 540px);
    aspect-ratio: 1;
    margin: auto;
    perspective: 900px;
    isolation: isolate;
  }

  .wheel-tilt,
  .wheel-shadow,
  .wheel-rotor {
    position: absolute;
    inset: 10%;
    border-radius: 50%;
  }

  .wheel-shadow {
    background: rgba(4, 5, 3, 0.42);
    filter: blur(26px);
    transform: translateY(7%);
    z-index: -1;
  }

  .wheel-tilt {
    border: 8px solid #f3efe4;
    background: #f3efe4;
    box-shadow:
      0 0 0 4px #26271f,
      0 0 0 6px rgba(235, 255, 123, 0.52),
      0 24px 55px rgba(5, 6, 4, 0.5);
    overflow: hidden;
    transition: transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 300ms ease;
  }

  .wheel-rotor {
    inset: 0;
    background: #f3efe4;
    will-change: transform;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.12, 0.68, 0.08, 1);
  }

  .simple .wheel-rotor {
    transition-timing-function: cubic-bezier(0.18, 0.75, 0.18, 1);
  }

  .luxury .wheel-rotor {
    transition-timing-function: cubic-bezier(0.08, 0.78, 0.05, 1);
  }

  .three-d .wheel-tilt {
    transform: rotateX(12deg) scaleY(0.95);
    box-shadow:
      0 7px 0 #b9b4a9,
      0 12px 0 #747268,
      0 0 0 4px #26271f,
      0 28px 60px rgba(4, 5, 3, 0.62);
  }

  .three-d.spinning .wheel-tilt {
    transform: rotateX(17deg) scaleY(0.93);
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    filter: url(#inner-shadow);
  }

  .outer-rim {
    fill: none;
    stroke: rgba(22, 23, 18, 0.72);
    stroke-width: 4;
  }

  .segment {
    stroke: rgba(255, 255, 255, 0.52);
    stroke-width: 1.2;
    transition: opacity 220ms ease;
  }

  .segment.eliminated {
    opacity: 0.48;
  }

  .retry-segment {
    stroke: #171813;
    stroke-dasharray: 3 2;
    stroke-width: 1.5;
  }

  .hatch {
    pointer-events: none;
  }

  .segment-label {
    font-family: var(--font-sans);
    font-size: calc(14px * var(--font-scale, 1));
    font-weight: 850;
    letter-spacing: 0.02em;
    paint-order: stroke;
    pointer-events: none;
    stroke: rgba(0, 0, 0, 0.08);
    stroke-width: 0.5px;
  }

  .retry-label {
    fill: #171813;
    font-size: calc(13px * var(--font-scale, 1));
  }

  .empty-label {
    fill: #aaa99f;
    font-size: calc(16px * var(--font-scale, 1));
    font-weight: 700;
  }

  .hub-ring {
    fill: #f6f2e8;
    stroke: rgba(23, 24, 19, 0.25);
    stroke-width: 2;
  }

  .hub {
    fill: #1c1d17;
    stroke: #ebff7b;
    stroke-width: 1.5;
  }

  .pointer {
    position: absolute;
    top: 5.8%;
    left: 50%;
    width: 44px;
    height: 57px;
    z-index: 8;
    filter: drop-shadow(0 7px 7px rgba(0, 0, 0, 0.36));
    transform: translateX(-50%);
  }

  .pointer::before {
    position: absolute;
    top: 0;
    left: 50%;
    width: 18px;
    height: 18px;
    border: 4px solid #1a1b15;
    border-radius: 50%;
    background: var(--accent);
    content: '';
    transform: translateX(-50%);
  }

  .pointer div {
    position: absolute;
    top: 12px;
    left: 50%;
    width: 0;
    height: 0;
    border-top: 35px solid #1a1b15;
    border-right: 14px solid transparent;
    border-left: 14px solid transparent;
    transform: translateX(-50%);
  }

  .pointer div::after {
    position: absolute;
    top: -31px;
    left: -8px;
    width: 0;
    height: 0;
    border-top: 25px solid var(--accent);
    border-right: 8px solid transparent;
    border-left: 8px solid transparent;
    content: '';
  }

  .spin-button {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 10;
    display: flex;
    width: 15%;
    min-width: 74px;
    aspect-ratio: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 0;
    border: 0;
    border-radius: 50%;
    outline: 0;
    background: #1b1c16;
    color: #fffdf7;
    cursor: pointer;
    font-family: var(--font-sans);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    transform: translate(-50%, -50%);
    transition: transform 180ms ease, background 180ms ease;
  }

  .spin-button:hover:not(:disabled),
  .spin-button:focus-visible {
    background: #26281e;
    transform: translate(-50%, -50%) scale(1.06);
  }

  .spin-button:focus-visible {
    box-shadow: 0 0 0 4px rgba(235, 255, 123, 0.3);
  }

  .spin-button:disabled {
    cursor: not-allowed;
  }

  .spin-button strong {
    margin-top: 0;
    font-size: clamp(
      calc(15px * var(--font-scale, 1)),
      calc(1.25vw * var(--font-scale, 1)),
      calc(20px * var(--font-scale, 1))
    );
    letter-spacing: 0.04em;
  }

  .orbit {
    position: absolute;
    inset: 4%;
    border: 1px solid rgba(235, 255, 123, 0.12);
    border-radius: 50%;
    pointer-events: none;
  }

  .orbit-two {
    inset: 1%;
    border-style: dashed;
    opacity: 0.52;
    transform: rotate(21deg);
  }

  .orbit span {
    position: absolute;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 11px var(--accent);
  }

  .orbit span:nth-child(1) {
    top: 14%;
    left: 13%;
  }

  .orbit span:nth-child(2) {
    top: 67%;
    right: 1%;
  }

  .orbit span:nth-child(3) {
    bottom: 1%;
    left: 37%;
  }

  .simple .orbit,
  .simple .wheel-shadow {
    display: none;
  }

  .simple .wheel-tilt {
    inset: 12%;
    border: 4px solid #eeebe3;
    background: #eeebe3;
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.3),
      0 0 0 3px #2b2c25,
      0 13px 28px rgba(5, 6, 4, 0.3);
  }

  .simple .wheel-rotor {
    background: #eeebe3;
    transition-timing-function: cubic-bezier(0.08, 0.66, 0.04, 1);
  }

  .simple .outer-rim {
    stroke: rgba(31, 32, 27, 0.75);
    stroke-width: 2;
  }

  .simple .segment {
    stroke: rgba(255, 255, 255, 0.68);
    stroke-width: 1;
  }

  .simple .segment-label {
    font-size: calc(13px * var(--font-scale, 1));
    font-weight: 750;
    letter-spacing: 0;
  }

  .simple .hub-ring {
    fill: #f2efe7;
    stroke: #262720;
    stroke-width: 1.5;
  }

  .simple .hub {
    fill: #f2efe7;
    stroke: #262720;
    stroke-width: 1.5;
  }

  .simple .pointer::before {
    border-color: #292a23;
    background: #f2efe7;
  }

  .simple .pointer div {
    border-top-color: #292a23;
  }

  .simple .pointer div::after {
    border-top-color: #ff7657;
  }

  .simple .spin-button {
    border: 1px solid #292a23;
    background: #f2efe7;
    color: #24251f;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18);
  }

  .simple .spin-button:hover:not(:disabled),
  .simple .spin-button:focus-visible {
    background: #fffdf8;
  }

  .luxury.spinning .orbit-one {
    animation: orbit-spin 9s linear infinite;
  }

  .luxury.spinning .orbit-two {
    animation: orbit-spin-reverse 6s linear infinite;
  }

  .luxury.spinning .wheel-tilt {
    box-shadow:
      0 0 0 4px #26271f,
      0 0 0 8px rgba(235, 255, 123, 0.22),
      0 0 48px rgba(235, 255, 123, 0.18),
      0 24px 55px rgba(5, 6, 4, 0.5);
  }

  @keyframes orbit-spin {
    to { transform: rotate(360deg); }
  }

  @keyframes orbit-spin-reverse {
    from { transform: rotate(21deg); }
    to { transform: rotate(-339deg); }
  }

  @media (max-width: 600px) {
    .wheel-stage {
      width: min(100%, 430px);
    }

    .wheel-tilt,
    .wheel-shadow,
    .wheel-rotor {
      inset: 11%;
    }

    .wheel-rotor {
      inset: 0;
    }

    .pointer {
      top: 6.5%;
      transform: translateX(-50%) scale(0.88);
    }

    .spin-button {
      min-width: 63px;
    }
  }
</style>
