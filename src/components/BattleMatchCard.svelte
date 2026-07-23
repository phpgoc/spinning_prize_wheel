<script lang="ts">
  import {
    battleTmpScoreLocked,
    battleTmpSlotOrigin,
    battleTmpWinnerId,
    type BattleTmpMatch,
    type BattleTmpSnapshot,
  } from '../lib/battle';
  import UiNumberInput from './ui/UiNumberInput.svelte';

  type BattleSide = 'up' | 'down';
  type BattleScorePosition = 'left' | 'right';

  const BATTLE_SIDES: BattleSide[] = ['up', 'down'];

  export let snapshot: BattleTmpSnapshot;
  export let match: BattleTmpMatch;
  export let readOnly = false;
  export let maskUnfixed = false;
  export let hiddenSlotKeys: ReadonlySet<string> = new Set();
  export let saving = false;
  export let scorePosition: BattleScorePosition = 'right';
  export let onMatchKeydown: ((event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreFocus: ((event: FocusEvent) => void) | undefined = undefined;
  export let onScoreKeydown: ((match: BattleTmpMatch, side: BattleSide, event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreChange: ((match: BattleTmpMatch, side: BattleSide, event: Event) => void) | undefined = undefined;
  export let onReveal: ((match: BattleTmpMatch, side: BattleSide) => void) | undefined = undefined;

  $: automaticStatus = battleTmpAutomaticStatus(match);

  function automaticAdvanceParticipant(current: BattleTmpMatch): number | null {
    if (current.status !== 'completed') return null;
    if (current.up === null && current.down !== null) return current.down;
    if (current.down === null && current.up !== null) return current.up;
    return null;
  }

  function battleTmpMatchCode(current: BattleTmpMatch): string {
    const stage = current.stage === 'pairing' ? 'P'
      : current.stage === 'single' ? 'S'
        : current.stage === 'winner' ? 'W'
          : current.stage === 'loser' ? 'L'
            : 'F';
    return `${stage}${current.level} P${current.position}`;
  }

  function battleTmpParticipantName(id: number | null): string {
    if (id === null) return '等待上游';
    return snapshot.participants.find((participant) => participant.id === id)?.name ?? `#${id}`;
  }

  function battleTmpSlotName(current: BattleTmpMatch, side: BattleSide): string {
    const participantId = current[side];
    const origin = battleTmpSlotOrigin(snapshot, current, side);
    if (maskUnfixed && current.level > 1) {
      const originMatch = origin
        ? snapshot.matches.find((candidate) => candidate.matchId === origin.matchId)
        : null;
      return originMatch ? battleTmpMatchCode(originMatch) : '待定';
    }
    if (participantId !== null) {
      const participant = snapshot.participants.find((candidate) => candidate.id === participantId);
      if (maskUnfixed && (!participant || participant.seed > snapshot.fixedSeedCount)) return '待随机';
      return battleTmpParticipantName(participantId);
    }
    if (current.stage === 'final' && current.level === 2 && current.status === 'skipped') return '无需重赛';
    if (automaticAdvanceParticipant(current) !== null) return '轮空';
    if (!origin) return current.status === 'skipped' ? '空签' : '待定';
    const originMatch = snapshot.matches.find((candidate) => candidate.matchId === origin.matchId);
    if (originMatch?.status === 'skipped') return '上游空场';
    if (originMatch && origin.outcome === 'loser' && automaticAdvanceParticipant(originMatch) !== null) {
      return '上游轮空，无败者';
    }
    return originMatch ? battleTmpMatchCode(originMatch) : '待定';
  }

  function battleTmpAutomaticStatus(current: BattleTmpMatch): string | null {
    if (current.stage === 'final' && current.level === 2 && current.status === 'skipped') {
      return '胜者组冠军已胜出，无需重赛';
    }
    const participantId = automaticAdvanceParticipant(current);
    if (participantId === null) return current.status === 'skipped' ? '没有可参赛选手，本场自动跳过' : null;
    const name = battleTmpParticipantName(participantId);
    if (current.stage === 'single' && current.level === 1) return `${name} 轮空，自动进入第二轮`;
    if (current.stage === 'winner' && current.level === 1) return `${name} 轮空，自动进入胜者组第二轮`;
    if (current.stage === 'loser') return `${name} 无对手，自动进入败者组下一轮`;
    return `${name} 无对手，自动晋级下一轮`;
  }

  function battleTmpParticipantWon(current: BattleTmpMatch, id: number | null): boolean {
    return id !== null && battleTmpWinnerId(current) === id;
  }

  function battleTmpParticipantFixed(id: number | null): boolean {
    if (id === null) return false;
    const participant = snapshot.participants.find((item) => item.id === id);
    return Boolean(participant && participant.seed <= snapshot.fixedSeedCount);
  }

  function scoreValue(current: BattleTmpMatch, side: BattleSide): number | '' {
    if (maskUnfixed) return '';
    return (side === 'up' ? current.upResult : current.downResult) ?? '';
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
  class:read-only={readOnly}
  class:mask-unfixed={maskUnfixed}
  class:auto-advance={automaticAdvanceParticipant(match) !== null}
  class:auto-skipped={match.status === 'skipped'}
  class="battle-match"
  tabindex={readOnly ? undefined : 0}
  aria-label={`${battleTmpMatchCode(match)} 对战`}
  data-battle-stage={match.stage}
  data-battle-level={match.level}
  data-battle-position={match.position}
  data-battle-status={match.status}
  data-battle-match-id={match.matchId}
  on:keydown={readOnly ? undefined : onMatchKeydown}
>
  <small>
    <span>{battleTmpMatchCode(match)}</span>
    {#if automaticStatus}
      <em>{automaticStatus}</em>
    {/if}
  </small>
  {#each BATTLE_SIDES as side (side)}
    <div
      class:fixed={battleTmpParticipantFixed(match[side])}
      class:winner={battleTmpParticipantWon(match, match[side])}
      class:waiting={match[side] === null}
      class:score-left={scorePosition === 'left'}
      class="battle-side"
    >
      <div class="battle-participant">
        {#if !readOnly && hiddenSlotKeys.has(`${match.matchId}:${side}`)}
          <button type="button" class="battle-reveal-slot" aria-label={`揭晓 ${battleTmpSlotName(match, side)}`} on:click|stopPropagation={() => onReveal?.(match, side)}>·</button>
          <span class="visually-hidden">{battleTmpSlotName(match, side)}</span>
        {:else}
          <strong>{battleTmpSlotName(match, side)}</strong>
        {/if}
      </div>
      <UiNumberInput
        type="number"
        min={0}
        step={1}
        inputmode="numeric"
        data-battle-match-id={match.matchId}
        data-battle-side={side}
        aria-label={`${battleTmpSlotName(match, side)} ${side === 'up' ? '上方' : '下方'}比分`}
        value={scoreValue(match, side)}
        disabled={readOnly || match.up === null || match.down === null || saving || match.status === 'skipped' || battleTmpScoreLocked(snapshot, match, side)}
        title={!readOnly && battleTmpScoreLocked(snapshot, match, side) ? '下游已有比分' : ''}
        on:focus={(event) => { if (!readOnly) onScoreFocus?.(event.detail.sourceEvent); }}
        on:keydown={(event) => { if (!readOnly) onScoreKeydown?.(match, side, event.detail.sourceEvent); }}
        on:change={(event) => { if (!readOnly) onScoreChange?.(match, side, event.detail.sourceEvent); }}
      />
    </div>
  {/each}
</article>

<style>
  .battle-match {
    min-width: 0;
    padding: calc(9px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1));
    border: 1px solid rgb(255 255 255 / 12%);
    border-radius: calc(11px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1));
    background: var(--battle-match-color, rgb(255 255 255 / 3.5%));
  }

  .battle-match > small {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 7px;
    min-height: calc(14px * var(--font-scale, 1) * var(--battle-round-growth, 1));
    margin-bottom: calc(6px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1));
    color: color-mix(in srgb, var(--battle-text-color, var(--lineup-dim-on-dark)) 38%, transparent);
    font-family: var(--font-mono);
    font-size: calc(9px * var(--font-scale, 1) * var(--battle-round-growth, 1));
  }

  .battle-match > small em {
    padding: 2px 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 13%, transparent);
    color: color-mix(in srgb, var(--accent) 78%, var(--battle-text-color, white));
    font-family: inherit;
    font-style: normal;
    font-weight: 750;
  }

  .battle-match.auto-skipped > small em {
    background: rgb(255 255 255 / 6%);
    color: color-mix(in srgb, var(--battle-text-color, white) 62%, transparent);
  }

  .battle-side {
    --battle-side-border: rgb(255 255 255 / 18%);
    display: flex;
    width: auto;
    max-width: 100%;
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding: calc(8px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1)) calc(9px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1));
    border: 0;
    border-left: 2px solid var(--battle-side-border);
    background: rgb(0 0 0 / 13%);
    color: inherit;
    font: inherit;
    text-align: left;
  }

  /* 预览签表的列宽固定，避免 flex 子项按长文本撑出卡片边界。 */
  .battle-participant { width: auto; max-width: 100%; }
  .battle-participant strong { max-width: 100%; }

  .battle-match > div + div { margin-top: calc(5px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1)); }
  .battle-side.fixed { --battle-side-border: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .battle-side.waiting { color: var(--lineup-dim-on-dark); }
  .battle-side.winner {
    --battle-side-border: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }

  /* 单败右半区和 1 对 2 可把比分朝签表中心放在左侧；双败统一在右侧。 */
  .battle-side.score-left {
    flex-direction: row-reverse;
    border-right: 2px solid var(--battle-side-border);
    border-left: 0;
    text-align: right;
  }

  .battle-participant {
    display: grid;
    min-width: 0;
    min-height: calc(30px * var(--font-scale, 1) * var(--battle-round-growth, 1));
    flex: 1;
    align-items: center;
  }

  .battle-side :global(.ui-number-input) {
    width: calc(48px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1));
    min-height: calc(36px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1));
    padding: 4px 5px;
    border: 1px solid rgb(255 255 255 / 18%);
    border-radius: 7px;
    outline: 0;
    background: rgb(0 0 0 / 20%);
    color: #f4f5ec;
    font-family: var(--font-mono);
    font-size: calc(14px * var(--font-scale, 1) * var(--battle-round-growth, 1));
    font-weight: 800;
    text-align: center;
  }

  .battle-side :global(.ui-number-input:focus) {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .battle-side :global(.ui-number-input:disabled) { opacity: 0.4; }

  .battle-match strong {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: var(--battle-participant-color, inherit);
    font-size: calc(24px * var(--font-scale, 1) * var(--battle-round-growth, 1));
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .battle-reveal-slot {
    display: block;
    width: 100%;
    min-height: calc(30px * var(--font-scale, 1) * var(--battle-round-growth, 1));
    padding: 0;
    border: 1px dashed color-mix(in srgb, var(--accent) 42%, transparent);
    border-radius: 6px;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: calc(21px * var(--font-scale, 1) * var(--battle-round-growth, 1));
    line-height: 1;
  }

  .battle-reveal-slot:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .mask-unfixed.read-only :global(.ui-number-input) { visibility: hidden; }
  .mask-unfixed.read-only .battle-side:not(.fixed) strong { color: color-mix(in srgb, var(--battle-text-color) 42%, transparent); }

  :global(.double-battle-bracket) .battle-match { padding: calc(6px * var(--battle-round-growth, 1)); }
  :global(.double-battle-bracket) .battle-match > small { margin-bottom: calc(3px * var(--battle-round-growth, 1)); font-size: calc(8px * var(--font-scale, 1) * var(--battle-round-growth, 1)); }
  :global(.double-battle-bracket) .battle-side { gap: calc(6px * var(--battle-round-growth, 1)); padding: calc(4px * var(--battle-round-growth, 1)) calc(6px * var(--battle-round-growth, 1)); }
  :global(.double-battle-bracket) .battle-match > div + div { margin-top: calc(2px * var(--battle-round-growth, 1)); }
  :global(.double-battle-bracket) .battle-side :global(.ui-number-input) { min-height: calc(30px * var(--battle-round-growth, 1)); }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
