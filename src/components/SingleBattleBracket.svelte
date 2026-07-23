<script lang="ts">
  import { tick } from 'svelte';
  import { battleTmpSlotOrigin, type BattleTmpMatch, type BattleTmpSnapshot } from '../lib/battle';
  import { battleRoundGrowth } from '../lib/battle-bracket-layout';
  import type { BattleBracketLayout } from '../lib/battle-bracket-layout';
  import BattleMatchCard from './BattleMatchCard.svelte';
  import type { BattleBracketProps, BattleScorePosition, BattleSide } from './battle-bracket-props';

  export let snapshot: BattleTmpSnapshot;
  export let layout: BattleBracketLayout['single'];
  export let readOnly: BattleBracketProps['readOnly'] = false;
  export let maskUnfixed: BattleBracketProps['maskUnfixed'] = false;
  export let hiddenSlotKeys: BattleBracketProps['hiddenSlotKeys'] = new Set();
  export let saving: BattleBracketProps['saving'] = false;
  export let onMatchKeydown: BattleBracketProps['onMatchKeydown'] = undefined;
  export let onScoreFocus: BattleBracketProps['onScoreFocus'] = undefined;
  export let onScoreKeydown: BattleBracketProps['onScoreKeydown'] = undefined;
  export let onScoreChange: BattleBracketProps['onScoreChange'] = undefined;
  export let onReveal: BattleBracketProps['onReveal'] = undefined;

  const BATTLE_SIDES: BattleSide[] = ['up', 'down'];
  let connectorPaths: string[] = [];
  let connectorWidth = 0;
  let connectorHeight = 0;

  function observeBracket(node: HTMLElement) {
    let frame = 0;
    const observer = new ResizeObserver(() => schedule());
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.querySelectorAll<HTMLElement>('.battle-match[data-battle-match-id]').forEach((match) => observer.observe(match));
        updateConnectors(node);
      });
    }
    observer.observe(node);
    void tick().then(schedule);
    window.addEventListener('resize', schedule);
    return {
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener('resize', schedule);
      },
    };
  }

  function updateConnectors(node: HTMLElement) {
    const rootRect = node.getBoundingClientRect();
    const matchElements = new Map(
      [...node.querySelectorAll<HTMLElement>('.battle-match[data-battle-match-id]')]
        .map((element) => [element.dataset.battleMatchId!, element] as const),
    );
    const nextPaths: string[] = [];
    for (const targetMatch of snapshot.matches.filter((match) => match.stage === 'single')) {
      const targetElement = matchElements.get(targetMatch.matchId);
      if (!targetElement) continue;
      for (const side of BATTLE_SIDES) {
        const origin = battleTmpSlotOrigin(snapshot, targetMatch, side);
        const sourceElement = origin ? matchElements.get(origin.matchId) : null;
        if (!sourceElement) continue;
        const sourceRect = sourceElement.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const leftToRight = sourceRect.left + sourceRect.width / 2 < targetRect.left + targetRect.width / 2;
        const sourceX = (leftToRight ? sourceRect.right : sourceRect.left) - rootRect.left + node.scrollLeft;
        const targetX = (leftToRight ? targetRect.left : targetRect.right) - rootRect.left + node.scrollLeft;
        const sourceY = sourceRect.top + sourceRect.height / 2 - rootRect.top + node.scrollTop;
        const targetY = targetRect.top + targetRect.height / 2 - rootRect.top + node.scrollTop;
        const middleX = (sourceX + targetX) / 2;
        nextPaths.push(`M ${sourceX} ${sourceY} H ${middleX} V ${targetY} H ${targetX}`);
      }
    }
    connectorWidth = node.scrollWidth;
    connectorHeight = node.scrollHeight;
    if (nextPaths.join('|') !== connectorPaths.join('|')) connectorPaths = nextPaths;
  }
</script>

{#snippet card(match: BattleTmpMatch, scorePosition: BattleScorePosition = 'right')}
  <BattleMatchCard
    {snapshot}
    {match}
    {readOnly}
    {maskUnfixed}
    {hiddenSlotKeys}
    {saving}
    {scorePosition}
    {onMatchKeydown}
    {onScoreFocus}
    {onScoreKeydown}
    {onScoreChange}
    {onReveal}
  />
{/snippet}

<div use:observeBracket class:read-only={readOnly} class:mask-unfixed={maskUnfixed} class="single-battle-bracket">
  {#if connectorPaths.length > 0}
    <svg class="single-bracket-connectors" width={connectorWidth} height={connectorHeight} viewBox={`0 0 ${connectorWidth} ${connectorHeight}`} aria-hidden="true">
      {#each connectorPaths as path}<path d={path}></path>{/each}
    </svg>
  {/if}
  <div class="single-bracket-side left">
    {#each layout.left as round (round.id)}
      <section class="battle-round" data-level-index={round.level} style={`--battle-round-growth: ${battleRoundGrowth(round.stage, round.level)};`}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render card(match, 'right')}{/each}</div></section>
    {/each}
  </div>
  <section
    class="single-bracket-final"
    data-level-index={layout.final?.level}
    style={`--battle-round-growth: ${layout.final ? battleRoundGrowth('single', layout.final.level) : 1}`}
  >
    <h3>决赛</h3>
    {#if layout.final}{@render card(layout.final)}{/if}
  </section>
  <div class="single-bracket-side right">
    {#each layout.right as round (round.id)}
      <section class="battle-round" data-level-index={round.level} style={`--battle-round-growth: ${battleRoundGrowth(round.stage, round.level)};`}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render card(match, 'left')}{/each}</div></section>
    {/each}
  </div>
</div>

<style>
  .single-battle-bracket {
    --battle-round-width: calc(235px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1));
    --battle-match-row-gap: calc(36px * var(--battle-layout-scale, 1));
    --battle-round-column-gap: calc(108px * var(--battle-layout-scale, 1));
    position: relative;
    display: grid;
    min-width: 0;
    grid-template-columns: max-content var(--battle-round-width) max-content;
    gap: var(--battle-round-column-gap);
    align-items: center;
    margin-top: 18px;
    overflow: auto;
    isolation: isolate;
    transition: opacity 180ms ease;
  }
  .single-bracket-connectors { position: absolute; z-index: 0; top: 0; left: 0; overflow: visible; pointer-events: none; }
  .single-bracket-connectors path { fill: none; stroke: color-mix(in srgb, var(--accent) 42%, transparent); stroke-width: calc(2px * var(--battle-layout-scale, 1)); stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .single-bracket-side { position: relative; z-index: 1; display: flex; align-items: stretch; gap: var(--battle-round-column-gap); }
  .single-bracket-side.left { justify-content: flex-end; }
  .single-bracket-side.right { justify-content: flex-start; }
  .single-bracket-side .battle-round { display: flex; flex-direction: column; justify-content: center; }
  .single-bracket-final { position: relative; z-index: 1; min-width: 0; padding: calc(12px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1)); border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); border-radius: 13px; background: color-mix(in srgb, var(--battle-background-color, #282c34) 96%, transparent); }
  .single-bracket-final > h3 { margin-bottom: calc(9px * var(--battle-round-growth, 1)); color: var(--accent); font-size: calc(14px * var(--font-scale, 1) * var(--battle-round-growth, 1)); text-align: center; }
  .battle-round { --battle-round-width: calc(235px * var(--battle-layout-scale, 1) * var(--battle-round-growth, 1)); flex: 0 0 var(--battle-round-width); }
  .battle-round h3 { display: inline; font-size: calc(14px * var(--font-scale, 1) * var(--battle-round-growth, 1)); }
  .battle-round > div { display: grid; gap: calc(var(--battle-match-row-gap) * var(--battle-round-growth, 1)); margin-top: calc(9px * var(--battle-round-growth, 1)); }
  .single-bracket-side.left .battle-round:first-child > div,
  .single-bracket-side.right .battle-round:last-child > div { gap: var(--battle-match-row-gap); }
</style>
