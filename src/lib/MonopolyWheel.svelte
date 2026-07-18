<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { WheelOption } from './types';

  export let options: WheelOption[] = [];
  export let targetOptionId: string | null = null;
  export let spinning = false;
  export let disabled = false;
  export let duration = 4000;
  export let centerLabel = '开始';
  export let onSpin: () => void;

  // ── 棋盘几何 ────────────────────────────────────────────────────
  // 根据选项总权重计算 16 到 40 之间最接近的 4 的倍数作为格子总数。
  const CS = 62;  // 格子尺寸（像素）
  const GAP = 5;  // 格子间距（像素）
  const SLOT = CS + GAP;

  function totalCells(opts: WheelOption[]): number {
    if (opts.length === 0) return 16;
    const w = opts.reduce((s, o) => s + o.weight, 0);
    const raw = Math.max(opts.length * 2, Math.min(w * 2, 40));
    return Math.ceil(raw / 4) * 4;
  }

  // nH 是上下边的格子数，nV 是左右边的格子数。
  // 公式：2*nH + 2*(nV-2) = N，因此 nV = N/4，nH = N/4+2。
  function boardDims(N: number) {
    const nV = N / 4;
    const nH = N / 4 + 2;
    return { nH, nV };
  }

  // 从左上角开始，按顺时针方向计算每个格子的中心点和倾斜角度。
  function cellPositions(nH: number, nV: number): Array<{ cx: number; cy: number; tilt: number }> {
    const positions: Array<{ cx: number; cy: number; tilt: number }> = [];
    const ox = GAP + CS / 2;          // 左上角格子中心横坐标
    const oy = GAP + CS / 2;          // 左上角格子中心纵坐标
    const fewCells = nH + nV < 16;    // 格子较少时增加轻微倾斜

    // 上边：从左到右。
    for (let i = 0; i < nH; i++) {
      positions.push({ cx: ox + i * SLOT, cy: oy, tilt: 0 });
    }
    // 右边：从上到下，不重复计算角落。
    const rx = ox + (nH - 1) * SLOT;
    for (let j = 1; j <= nV - 2; j++) {
      positions.push({ cx: rx, cy: oy + j * SLOT, tilt: fewCells ? 6 : 0 });
    }
    // 下边：从右到左。
    const by = oy + (nV - 1) * SLOT;
    for (let i = nH - 1; i >= 0; i--) {
      positions.push({ cx: ox + i * SLOT, cy: by, tilt: 0 });
    }
    // 左边：从下到上，不重复计算角落。
    for (let j = nV - 2; j >= 1; j--) {
      positions.push({ cx: ox, cy: oy + j * SLOT, tilt: fewCells ? -6 : 0 });
    }
    return positions;
  }

  // 使用贪心优先队列把选项分配到 N 个格子中，优先选择剩余数量最多且
  // 与前一格不同的选项，同时处理最后一格和第一格的环形相邻关系。
  function assignCells(opts: WheelOption[], N: number): WheelOption[] {
    if (opts.length === 0) return [];
    const totalW = opts.reduce((s, o) => s + o.weight, 0);

    // 按权重计算每个选项的格子数，每项至少一个。
    const raw = opts.map(o => (o.weight / totalW) * N);
    const counts = raw.map(c => Math.max(1, Math.round(c)));

    // 调整格子数，使总和严格等于 N。
    let sum = counts.reduce((s, c) => s + c, 0);
    while (sum > N) {
      const i = counts.reduce((b, c, k) => (c > counts[b] && c > 1 ? k : b), 0);
      counts[i]--; sum--;
    }
    while (sum < N) {
      const fracs = raw.map((r, k) => r - counts[k]);
      const i = fracs.reduce((b, f, k) => (f > fracs[b] ? k : b), 0);
      counts[i]++; sum++;
    }

    // 每次优先选择剩余数量最多且不同于前一格的选项；
    // 最后一格还要尽量避免与第一格相同。
    interface Entry { opt: WheelOption; remaining: number }
    let queue: Entry[] = opts.map((o, k) => ({ opt: o, remaining: counts[k] }))
      .filter(e => e.remaining > 0);

    const result: WheelOption[] = new Array(N);

    for (let i = 0; i < N; i++) {
      // 按剩余数量降序排列，数量相同时优先保留原顺序。
      queue.sort((a, b) => b.remaining - a.remaining);

      const prev = i > 0 ? result[i - 1] : null;
      const isLast = i === N - 1;
      const first = result[0] ?? null; // 用于检查末尾与开头是否相邻。

      // 选择剩余数量最多且不与前一格相同的候选项；
      // 最后一格存在其他选择时，还不能与第一格相同。
      let pick = -1;
      for (let j = 0; j < queue.length; j++) {
        if (queue[j].remaining <= 0) continue;
        if (prev && queue[j].opt.id === prev.id) continue;
        if (isLast && first && queue[j].opt.id === first.id && queue.length > 1) continue;
        pick = j;
        break;
      }
      // 没有其他选择时才允许同项相邻。
      if (pick < 0) {
        pick = queue.findIndex(e => e.remaining > 0);
      }
      if (pick < 0) break; // 正常情况下不会发生。

      result[i] = queue[pick].opt;
      queue[pick].remaining--;
      queue = queue.filter(e => e.remaining > 0);
    }

    return result;
  }

  // ── 响应式格子状态 ──────────────────────────────────────────────
  $: N = totalCells(options);
  $: dims = boardDims(N);
  $: nH = dims.nH;
  $: nV = dims.nV;
  $: positions = cellPositions(nH, nV);
  $: cells = assignCells(options, N);

  // SVG 四周各留一个格子间距。
  $: svgW = (nH - 1) * SLOT + CS + 2 * GAP;
  $: svgH = (nV - 1) * SLOT + CS + 2 * GAP;

  // ── 棋子动画 ────────────────────────────────────────────────────
  let tokenFloatIdx = 0;   // 使用小数格子下标实现平滑移动。
  let startIdx = 0;
  let endIdx = 0;
  let animStartTime = 0;
  let raf = 0;

  function easeOut5(t: number): number { return 1 - Math.pow(1 - t, 5); }

  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

  function tokenXY(floatIdx: number): { x: number; y: number } {
    const n = positions.length;
    if (n === 0) return { x: 0, y: 0 };
    const clamped = ((floatIdx % n) + n) % n;
    const lo = Math.floor(clamped) % n;
    const hi = (lo + 1) % n;
    const frac = clamped - Math.floor(clamped);
    return {
      x: lerp(positions[lo].cx, positions[hi].cx, frac),
      y: lerp(positions[lo].cy, positions[hi].cy, frac),
    };
  }

  function startAnimation(targetId: string) {
    const n = positions.length;
    if (n === 0) return;

    // 找出属于目标选项的全部格子。
    const targetIndices = cells.reduce<number[]>((acc, c, i) => (c.id === targetId ? [...acc, i] : acc), []);
    if (targetIndices.length === 0) { targetIndices.push(0); }

    // 选择顺时针路径最自然的目标格子。
    const cur = ((tokenFloatIdx % n) + n) % n;
    const best = targetIndices.reduce((b, ti) => {
      const dBest = ((b - cur + n) % n);
      const dTi   = ((ti - cur + n) % n);
      return dTi > 0 && (dTi < dBest || dBest === 0) ? ti : b;
    }, targetIndices[0]);

    const dist = ((best - Math.floor(cur) + n) % n) || n;
    const extraLaps = 5;
    const totalDist = extraLaps * n + dist;

    startIdx = tokenFloatIdx;
    endIdx = tokenFloatIdx + totalDist;
    animStartTime = performance.now();

    if (raf) cancelAnimationFrame(raf);

    function tick(now: number) {
      const t = Math.min(1, (now - animStartTime) / duration);
      tokenFloatIdx = lerp(startIdx, endIdx, easeOut5(t));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        tokenFloatIdx = endIdx;
        raf = 0;
      }
    }
    raf = requestAnimationFrame(tick);
  }

  // 监听抽奖开始状态。
  let prevTargetId: string | null = null;
  $: if (spinning && targetOptionId && targetOptionId !== prevTargetId) {
    prevTargetId = targetOptionId;
    startAnimation(targetOptionId);
  }
  $: if (!targetOptionId) { prevTargetId = null; }

  // 根据小数格子下标计算棋子的响应式位置。
  $: tokenPos = tokenXY(tokenFloatIdx);

  // 计算棋子当前最接近的格子，用于高亮。
  $: tokenCellIdx = (((Math.round(tokenFloatIdx) % N) + N) % N);

  onDestroy(() => { if (raf) cancelAnimationFrame(raf); });

  // 生成适合格子宽度的短标签。
  function shortLabel(label: string, maxLen: number): string {
    return label.length > maxLen ? label.slice(0, maxLen) + '…' : label;
  }

  // 根据背景色选择清晰可读的文字颜色。
  function textColor(hex: string): string {
    const n = hex.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(n)) return '#111';
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 148 ? '#1a0e06' : '#fff8ec';
  }

  // 根据格子数量决定每个标签的最大字符数。
  $: maxChars = N <= 20 ? 5 : N <= 28 ? 4 : 3;
</script>

<div class="board-stage" class:spinning>
  <div class="board-glow"></div>
  <div class="board-wrap">
    <svg
      class="board-svg"
      viewBox={`0 0 ${svgW} ${svgH}`}
      role="img"
      aria-label="大富翁抽奖棋盘"
    >
      <!-- 棋盘背景 -->
      <rect x="0" y="0" width={svgW} height={svgH} rx="18" ry="18" class="board-bg" />

      <!-- 中央区域装饰 -->
      <rect
        x={GAP + SLOT}
        y={GAP + SLOT}
        width={svgW - 2 * (GAP + SLOT)}
        height={svgH - 2 * (GAP + SLOT)}
        rx="10"
        ry="10"
        class="center-area"
      />
      <text
        x={svgW / 2}
        y={svgH / 2 - 10}
        class="center-title"
        text-anchor="middle"
        dominant-baseline="middle"
      >幸运</text>
      <text
        x={svgW / 2}
        y={svgH / 2 + 14}
        class="center-sub"
        text-anchor="middle"
        dominant-baseline="middle"
      >转盘</text>

      <!-- 棋盘格子 -->
      {#each cells as cell, i (i)}
        {@const pos = positions[i]}
        {@const isTarget = cell.id === targetOptionId && !spinning}
        {@const isUnderToken = i === tokenCellIdx && spinning}
        <g
          class="cell-group"
          class:token-cell={isUnderToken}
          class:winner-cell={isTarget}
          transform={`rotate(${pos.tilt} ${pos.cx} ${pos.cy})`}
        >
          <rect
            x={pos.cx - CS / 2}
            y={pos.cy - CS / 2}
            width={CS}
            height={CS}
            rx="8"
            ry="8"
            fill={cell.color}
            class="cell-rect"
          />
          <!-- 高光遮罩 -->
          <rect
            x={pos.cx - CS / 2}
            y={pos.cy - CS / 2}
            width={CS}
            height={CS / 2}
            rx="8"
            ry="8"
            class="cell-shine"
          />
          <text
            x={pos.cx}
            y={pos.cy}
            fill={textColor(cell.color)}
            text-anchor="middle"
            dominant-baseline="middle"
            class="cell-label"
          >{shortLabel(cell.label, maxChars)}</text>
        </g>
      {/each}

      <!-- 移动棋子 -->
      {#if positions.length > 0}
        <g class="token" transform={`translate(${tokenPos.x} ${tokenPos.y})`}>
          <circle r="20" class="token-shadow" cx="2" cy="3" />
          <circle r="20" class="token-body" />
          <circle r="16" class="token-inner" />
          <text class="token-label" text-anchor="middle" dominant-baseline="middle">★</text>
        </g>
      {/if}
    </svg>

    <!-- 覆盖在中央区域上的抽奖按钮 -->
    <button
      type="button"
      class="board-button"
      aria-label={spinning ? '抽奖进行中' : `${centerLabel}抽奖`}
      disabled={disabled || spinning}
      on:click={onSpin}
      style={`left: 50%; top: 50%; transform: translate(-50%, -50%); width: ${Math.round(svgW * 0.26)}px; height: ${Math.round(svgH * 0.32)}px;`}
    >
      <span class="btn-star">♟</span>
      <strong>{spinning ? '走格中…' : centerLabel}</strong>
    </button>
  </div>
</div>

<style>
  .board-stage {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: min(100%, 580px);
    margin: auto;
    isolation: isolate;
  }

  .board-glow {
    position: absolute;
    inset: -8%;
    z-index: -1;
    border-radius: 20px;
    background: radial-gradient(ellipse at center, rgba(90, 140, 200, 0.12), transparent 68%);
    filter: blur(18px);
    pointer-events: none;
  }

  .board-wrap {
    position: relative;
    width: 100%;
  }

  .board-svg {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 18px;
    filter: drop-shadow(0 12px 32px rgba(0,0,0,0.38)) drop-shadow(0 2px 6px rgba(0,0,0,0.22));
  }

  .board-bg {
    fill: #1a2433;
    stroke: #2e4060;
    stroke-width: 2;
  }

  .center-area {
    fill: #111d2b;
    stroke: #2d4870;
    stroke-width: 1.5;
    stroke-dasharray: 5 3;
  }

  .center-title {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 22px;
    font-weight: 700;
    fill: #c8a85a;
    letter-spacing: 0.12em;
  }

  .center-sub {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 14px;
    fill: #6a8ab0;
    letter-spacing: 0.08em;
  }

  /* ── 棋盘格子 ── */
  .cell-rect {
    stroke: rgba(255,255,255,0.18);
    stroke-width: 1.5;
    filter: drop-shadow(0 2px 3px rgba(0,0,0,0.28));
    transition: filter 0.15s;
  }

  .cell-shine {
    fill: rgba(255,255,255,0.18);
    pointer-events: none;
  }

  .cell-label {
    font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    font-size: 13px;
    font-weight: 600;
    pointer-events: none;
    user-select: none;
  }

  .winner-cell .cell-rect {
    stroke: #ffd700;
    stroke-width: 3;
    filter: drop-shadow(0 0 8px rgba(255,215,0,0.8)) drop-shadow(0 2px 3px rgba(0,0,0,0.3));
  }

  .token-cell .cell-rect {
    stroke: rgba(255,255,255,0.7);
    stroke-width: 2;
  }

  /* ── 棋子 ── */
  .token-shadow {
    fill: rgba(0,0,0,0.35);
    filter: blur(3px);
  }

  .token-body {
    fill: #f5c842;
    stroke: #a07820;
    stroke-width: 2.5;
    filter: drop-shadow(0 3px 6px rgba(0,0,0,0.4));
  }

  .token-inner {
    fill: none;
    stroke: rgba(255,255,255,0.55);
    stroke-width: 1.5;
    stroke-dasharray: 3 2;
  }

  .token-label {
    font-size: 15px;
    fill: #7a4800;
    pointer-events: none;
  }

  /* 抽奖过程中让棋子呼吸闪烁。 */
  .spinning .token-body {
    animation: token-pulse 0.45s ease-in-out infinite alternate;
  }

  @keyframes token-pulse {
    from { fill: #f5c842; }
    to   { fill: #fff27a; filter: drop-shadow(0 0 10px rgba(255,220,80,0.9)); }
  }

  /* ── 抽奖按钮 ── */
  .board-button {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 3px solid #79adf5;
    border-radius: 12px;
    outline: 0;
    background: linear-gradient(160deg, #1e3356 0%, #0f1e35 100%);
    color: #a8c8f0;
    cursor: pointer;
    box-shadow:
      0 0 0 5px rgba(74,122,191,0.28),
      0 0 28px rgba(87, 151, 238, 0.34),
      0 6px 18px rgba(0,0,0,0.5),
      inset 0 1px 0 rgba(255,255,255,0.08);
    transition: transform 150ms ease, filter 150ms ease, border-color 150ms ease;
  }

  .board-button:hover:not(:disabled),
  .board-button:focus-visible {
    border-color: #6fa0e8;
    filter: brightness(1.15);
    box-shadow:
      0 0 0 6px rgba(94, 160, 244, 0.38),
      0 0 36px rgba(87, 151, 238, 0.52),
      0 8px 22px rgba(0,0,0,0.54),
      inset 0 1px 0 rgba(255,255,255,0.12);
    transform: translate(-50%, -50%) scale(1.04) !important;
  }

  .board-button:focus-visible {
    outline: 3px solid rgba(200, 222, 255, 0.8);
    outline-offset: 7px;
  }

  .board-button:disabled {
    cursor: not-allowed;
    filter: saturate(0.45);
    opacity: 0.68;
  }

  .btn-star {
    font-size: 20px;
    line-height: 1;
  }

  .board-button strong {
    font-family: -apple-system, 'PingFang SC', sans-serif;
    font-size: 13px;
    font-weight: 750;
    color: #e3efff;
    text-shadow: 0 2px 9px rgba(87, 151, 238, 0.48);
  }

  @media (max-width: 600px) {
    .board-stage { width: min(100%, 420px); }
    .cell-label { font-size: 11px; }
  }
</style>
