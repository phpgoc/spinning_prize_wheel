<script lang="ts">
  import type { WheelOption } from './types';

  export let options: WheelOption[] = [];
  export let rotation = 0;
  export let duration = 4000;
  export let eliminatedIds: string[] = [];
  export let spinning = false;
  export let disabled = false;
  export let centerLabel = '开启';
  export let onSpin: () => void;

  const size = 360;
  const center = size / 2;
  const radius = 167;
  const bulbs = Array.from({ length: 32 });
  const sparkles = Array.from({ length: 12 });

  function polar(angle: number, distance = radius) {
    const radians = (angle * Math.PI) / 180;
    return {
      x: center + distance * Math.cos(radians),
      y: center + distance * Math.sin(radians),
    };
  }

  function segmentPath(index: number, count: number): string {
    const slice = 360 / count;
    const start = -90 + index * slice;
    const end = start + slice;
    const startPoint = polar(start);
    const endPoint = polar(end);
    return [
      `M ${center} ${center}`,
      `L ${startPoint.x} ${startPoint.y}`,
      `A ${radius} ${radius} 0 ${slice > 180 ? 1 : 0} 1 ${endPoint.x} ${endPoint.y}`,
      'Z',
    ].join(' ');
  }

  function labelPosition(index: number, count: number) {
    const angle = -90 + (index + 0.5) * (360 / count);
    return { ...polar(angle, count > 9 ? 116 : 122), angle };
  }

  function shortLabel(label: string): string {
    const max = options.length > 9 ? 5 : options.length > 6 ? 7 : 9;
    return label.length > max ? `${label.slice(0, max)}…` : label;
  }

  function readableText(hex: string): string {
    const normalized = hex.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return '#18120c';
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 > 158 ? '#20170d' : '#fff9e9';
  }

  $: eliminated = new Set(eliminatedIds);
</script>

<div class:spinning class="luxury-stage">
  <div class="velvet-aura"></div>
  <div class="art-deco-ring ring-one"></div>
  <div class="art-deco-ring ring-two"></div>

  <div class="sparkles" aria-hidden="true">
    {#each sparkles as _, index}
      <i style={`--spark-angle: ${index * 30 + 9}deg; --spark-delay: ${-index * 0.17}s`}>✦</i>
    {/each}
  </div>

  <div class="marquee" aria-hidden="true">
    {#each bulbs as _, index}
      <i style={`--bulb-angle: ${index * 11.25}deg; --bulb-delay: ${-index * 0.055}s`}></i>
    {/each}
  </div>

  <div class="royal-pointer" aria-hidden="true">
    <span class="pointer-gem"></span>
    <span class="pointer-tip"></span>
  </div>

  <div class="gold-frame">
    <div
      class="luxury-rotor"
      style={`transform: rotate(${rotation}deg); transition-duration: ${duration}ms;`}
    >
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="奢华奖项转盘">
        <defs>
          <radialGradient id="luxury-glass" cx="34%" cy="24%" r="76%">
            <stop offset="0" stop-color="#fff" stop-opacity=".31" />
            <stop offset=".42" stop-color="#fff" stop-opacity=".04" />
            <stop offset="1" stop-color="#140b05" stop-opacity=".2" />
          </radialGradient>
          <pattern id="luxury-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="rgba(20,13,8,.62)" />
            <rect width="1.5" height="7" fill="rgba(236,203,119,.22)" />
          </pattern>
        </defs>

        {#if options.length > 0}
          {#each options as option, index (option.id)}
            {@const position = labelPosition(index, options.length)}
            <path
              d={segmentPath(index, options.length)}
              fill={option.color}
              class:eliminated={eliminated.has(option.id)}
              class:retry-segment={option.isRetry}
              class="segment"
            />
            {#if eliminated.has(option.id)}
              <path d={segmentPath(index, options.length)} fill="url(#luxury-hatch)" />
            {/if}
            <path d={segmentPath(index, options.length)} fill="url(#luxury-glass)" class="segment-glass" />
            <text
              x={position.x}
              y={position.y}
              fill={eliminated.has(option.id) ? '#aaa18e' : readableText(option.color)}
              transform={`rotate(${position.angle + 90} ${position.x} ${position.y})`}
              class="segment-label"
              text-anchor="middle"
              dominant-baseline="middle"
            >{shortLabel(option.label)}</text>
          {/each}
        {:else}
          <circle cx={center} cy={center} r={radius} fill="#342216" />
        {/if}

        <circle cx={center} cy={center} r="61" class="hub-plate" />
        <circle cx={center} cy={center} r="51" class="hub-shadow" />
      </svg>
    </div>
    <div class="glass-sheen"></div>
  </div>

  <button
    type="button"
    class="luxury-button"
    aria-label={spinning ? '奢华转盘旋转中' : '开启奢华转盘'}
    disabled={disabled || spinning}
    on:click={onSpin}
  >
    <strong>{spinning ? '揭晓中' : centerLabel}</strong>
    <i>✦</i>
  </button>
</div>

<style>
  .luxury-stage {
    position: relative;
    width: min(100%, 565px);
    aspect-ratio: 1;
    margin: auto;
    isolation: isolate;
  }

  .velvet-aura {
    position: absolute;
    inset: 4%;
    z-index: -3;
    border-radius: 50%;
    background:
      radial-gradient(circle, rgba(117, 75, 39, 0.18) 0 47%, transparent 48%),
      conic-gradient(from 12deg, rgba(220, 178, 85, 0.1), transparent 9% 19%, rgba(220, 178, 85, 0.08) 20%, transparent 31% 44%, rgba(220, 178, 85, 0.09) 45%, transparent 57%);
    filter: blur(2px) drop-shadow(0 30px 30px rgba(3, 2, 1, 0.5));
  }

  .art-deco-ring {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
  }

  .ring-one {
    inset: 3.5%;
    z-index: -2;
    border: 1px solid rgba(232, 196, 111, 0.2);
    outline: 1px dashed rgba(232, 196, 111, 0.1);
    outline-offset: 7px;
  }

  .ring-two {
    inset: 0;
    z-index: -3;
    border: 1px dashed rgba(232, 196, 111, 0.08);
  }

  .gold-frame {
    position: absolute;
    inset: 10.5%;
    z-index: 2;
    overflow: hidden;
    border: 11px solid #d6a849;
    border-radius: 50%;
    background: #281a10;
    box-shadow:
      inset 0 0 0 3px #fff0bc,
      inset 0 0 0 7px #6f491e,
      0 0 0 3px #27170c,
      0 0 0 6px #f0cf78,
      0 0 0 10px #5a3817,
      0 20px 55px rgba(0, 0, 0, 0.58),
      0 0 42px rgba(226, 176, 71, 0.18);
  }

  .gold-frame::before {
    position: absolute;
    inset: -8px;
    z-index: 4;
    border: 2px dotted rgba(255, 239, 184, 0.7);
    border-radius: 50%;
    content: '';
    pointer-events: none;
  }

  .luxury-rotor {
    position: absolute;
    inset: 1px;
    border-radius: 50%;
    overflow: hidden;
    will-change: transform;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.08, 0.66, 0.04, 1);
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .segment {
    stroke: rgba(83, 48, 19, 0.65);
    stroke-width: 2;
  }

  .segment.eliminated { opacity: 0.52; }

  .retry-segment {
    stroke: #6c451c;
    stroke-dasharray: 4 2;
  }

  .segment-glass { pointer-events: none; }

  .segment-label {
    font-family: Georgia, 'Times New Roman', var(--font-sans);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    paint-order: stroke;
    pointer-events: none;
    stroke: rgba(29, 15, 7, 0.12);
    stroke-width: 1px;
  }

  .hub-plate {
    fill: #edcd7b;
    stroke: #6d451b;
    stroke-width: 3;
  }

  .hub-shadow {
    fill: #21130b;
    stroke: #fff0b7;
    stroke-width: 1.5;
  }

  .glass-sheen {
    position: absolute;
    inset: 0;
    z-index: 5;
    border-radius: 50%;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.24) 4%, transparent 28%),
      radial-gradient(ellipse at 65% 82%, rgba(0, 0, 0, 0.18), transparent 41%);
    mix-blend-mode: screen;
    pointer-events: none;
  }

  .marquee {
    position: absolute;
    inset: 5.9%;
    z-index: 7;
    border-radius: 50%;
    pointer-events: none;
  }

  .marquee i {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    transform: rotate(var(--bulb-angle));
  }

  .marquee i::after {
    position: absolute;
    top: -3px;
    left: 50%;
    width: 7px;
    height: 7px;
    border: 1px solid #7c501e;
    border-radius: 50%;
    background: #fff4bd;
    box-shadow: 0 0 7px rgba(255, 220, 128, 0.86);
    content: '';
    transform: translateX(-50%);
  }

  .spinning .marquee i::after {
    animation: bulb-chase 1.15s ease-in-out infinite;
    animation-delay: var(--bulb-delay);
  }

  @keyframes bulb-chase {
    0%, 45%, 100% { opacity: 0.28; transform: translateX(-50%) scale(0.72); }
    18% { opacity: 1; background: #fff; box-shadow: 0 0 13px #ffd66d; transform: translateX(-50%) scale(1.22); }
  }

  .sparkles {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: 50%;
    pointer-events: none;
  }

  .sparkles i {
    position: absolute;
    inset: 0;
    color: #f1cb73;
    font-size: 10px;
    font-style: normal;
    text-shadow: 0 0 9px rgba(241, 203, 115, 0.9);
    transform: rotate(var(--spark-angle));
  }

  .sparkles i::first-letter { transform: translateY(-2px); }

  .spinning .sparkles i {
    animation: sparkle-pulse 1.8s ease-in-out infinite;
    animation-delay: var(--spark-delay);
  }

  @keyframes sparkle-pulse {
    0%, 100% { opacity: 0.18; }
    45% { opacity: 1; filter: brightness(1.7); }
  }

  .royal-pointer {
    position: absolute;
    top: 4.3%;
    left: 50%;
    z-index: 12;
    width: 51px;
    height: 66px;
    filter: drop-shadow(0 8px 7px rgba(0, 0, 0, 0.5));
    transform: translateX(-50%);
  }

  .pointer-gem {
    position: absolute;
    top: 0;
    left: 50%;
    width: 25px;
    height: 25px;
    border: 4px solid #5c3917;
    background: linear-gradient(135deg, #fff3b3, #d39931 70%);
    box-shadow: inset 0 0 0 2px #ffeaa4;
    transform: translateX(-50%) rotate(45deg);
  }

  .pointer-tip {
    position: absolute;
    top: 17px;
    left: 50%;
    width: 0;
    height: 0;
    border-top: 45px solid #5c3917;
    border-right: 18px solid transparent;
    border-left: 18px solid transparent;
    transform: translateX(-50%);
  }

  .pointer-tip::after {
    position: absolute;
    top: -40px;
    left: -11px;
    width: 0;
    height: 0;
    border-top: 32px solid #efc665;
    border-right: 11px solid transparent;
    border-left: 11px solid transparent;
    content: '';
  }

  .luxury-button {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 15;
    display: flex;
    width: 16.5%;
    min-width: 84px;
    aspect-ratio: 1;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 0;
    border: 2px solid #f0cf78;
    border-radius: 50%;
    background: radial-gradient(circle at 36% 28%, #3d2817, #160d08 72%);
    color: #fff4cf;
    cursor: pointer;
    box-shadow:
      0 0 0 4px #6c451c,
      0 0 0 6px #f2d581,
      0 8px 22px rgba(0, 0, 0, 0.52),
      inset 0 0 16px rgba(239, 199, 100, 0.16);
    transform: translate(-50%, -50%);
    transition: transform 180ms ease, filter 180ms ease;
  }

  .luxury-button:hover:not(:disabled),
  .luxury-button:focus-visible {
    filter: brightness(1.18);
    transform: translate(-50%, -50%) scale(1.06);
  }

  .luxury-button strong {
    margin-top: 0;
    font-family: Georgia, var(--font-sans);
    font-size: clamp(13px, 1.35vw, 18px);
  }

  .luxury-button i {
    margin-top: 1px;
    color: #e9c36c;
    font-size: 8px;
    font-style: normal;
  }

  @media (max-width: 600px) {
    .luxury-stage { width: min(100%, 440px); }
    .gold-frame { border-width: 8px; }
    .marquee i::after { width: 5px; height: 5px; }
    .royal-pointer { top: 3.4%; transform: translateX(-50%) scale(0.84); }
    .luxury-button { min-width: 66px; }
  }
</style>
