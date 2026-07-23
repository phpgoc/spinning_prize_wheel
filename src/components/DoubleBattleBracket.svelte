<script lang="ts">
  import type { BattleTmpMatch, BattleTmpSnapshot } from '../lib/battle';
  import type { BattleBracketLayout } from '../lib/battle-bracket-layout';
  import BattleMatchCard from './BattleMatchCard.svelte';
  import type { BattleBracketProps } from './battle-bracket-props';

  export let snapshot: BattleTmpSnapshot;
  export let layout: BattleBracketLayout;
  export let readOnly: BattleBracketProps['readOnly'] = false;
  export let maskUnfixed: BattleBracketProps['maskUnfixed'] = false;
  export let hiddenSlotKeys: BattleBracketProps['hiddenSlotKeys'] = new Set();
  export let saving: BattleBracketProps['saving'] = false;
  export let onMatchKeydown: BattleBracketProps['onMatchKeydown'] = undefined;
  export let onScoreFocus: BattleBracketProps['onScoreFocus'] = undefined;
  export let onScoreKeydown: BattleBracketProps['onScoreKeydown'] = undefined;
  export let onScoreChange: BattleBracketProps['onScoreChange'] = undefined;
  export let onReveal: BattleBracketProps['onReveal'] = undefined;
</script>

{#snippet card(match: BattleTmpMatch)}
  <BattleMatchCard
    {snapshot}
    {match}
    {readOnly}
    {maskUnfixed}
    {hiddenSlotKeys}
    {saving}
    {onMatchKeydown}
    {onScoreFocus}
    {onScoreKeydown}
    {onScoreChange}
    {onReveal}
  />
{/snippet}

<!-- 双败查看和编辑共用同一组胜者、败者、总决赛坐标。 -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class:read-only={readOnly}
  class:mask-unfixed={maskUnfixed}
  class="double-battle-scroll"
  tabindex={readOnly ? undefined : 0}
  role={readOnly ? undefined : 'application'}
  aria-label={readOnly ? '双败签表查看' : '双败横向签表'}
  aria-keyshortcuts={readOnly ? undefined : 'U J H K L'}
>
  <div class="double-battle-bracket">
    <div class="double-battle-groups">
      <section class="double-stage-section double-winner-section"><h3>胜者组</h3><div class="battle-bracket">{#each layout.winner as round, levelIndex (round.id)}<section class="battle-round" data-level-index={levelIndex}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render card(match)}{/each}</div></section>{/each}</div></section>
      <section class="double-stage-section double-loser-section"><h3>败者组</h3><div class="battle-bracket">{#each layout.loser as round, levelIndex (round.id)}<section class="battle-round" data-level-index={levelIndex}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render card(match)}{/each}</div></section>{/each}</div></section>
    </div>
    <section class="double-final-section"><div class="battle-bracket">{#each layout.final as round (round.id)}<section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render card(match)}{/each}</div></section>{/each}</div></section>
  </div>
</div>

<style>
  .double-battle-scroll { margin-top: 18px; outline: 0; overflow: auto; scroll-behavior: smooth; }
  .double-battle-scroll:focus { box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--accent) 34%, transparent); }
  .double-battle-bracket { display: grid; width: max-content; min-width: 100%; grid-template-columns: max-content max-content; grid-template-rows: max-content max-content; align-items: start; column-gap: clamp(42px, 5vw, 86px); row-gap: clamp(34px, 5vh, 62px); transition: opacity 180ms ease; }
  .double-battle-groups { display: contents; }
  .double-stage-section,
  .double-final-section { display: flex; min-width: 0; padding: 13px; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 13px; background: rgba(255, 255, 255, 0.018); flex-direction: column; }
  .double-stage-section { padding: 0; border: 0; background: transparent; }
  .double-stage-section > h3 { color: var(--accent); font-size: calc(15px * var(--font-scale, 1)); }
  .double-battle-bracket .battle-bracket { display: flex; gap: clamp(32px, 4vw, 68px); margin-top: 10px; overflow: visible; align-items: stretch; }
  .double-stage-section > .battle-bracket { min-height: 0; }
  .double-winner-section { grid-column: 1; grid-row: 1; }
  .double-loser-section { grid-column: 1; grid-row: 2; }
  .double-final-section { grid-column: 2; grid-row: 2; align-self: start; transform: translateY(-50%); }
  .double-final-section > .battle-bracket { min-height: 180px; align-items: center; margin-top: 0; transform: translateY(6px); }
  .double-final-section .battle-round { position: relative; justify-content: center; }
  .double-final-section .battle-round > h3 { position: absolute; bottom: calc(100% + 9px); left: 0; }
  .double-final-section .battle-round > div { margin-top: 0; }
  .double-battle-bracket .battle-round { --battle-round-width: calc(235px * var(--battle-layout-scale, 1)); display: flex; flex: 0 0 var(--battle-round-width); flex-direction: column; }
  .double-battle-bracket .battle-round > div { flex: 1; display: grid; gap: calc(10px * var(--battle-layout-scale, 1)); margin-top: 9px; }
  .double-winner-section .battle-round > div { align-content: end; }
  .double-loser-section .battle-round > div { align-content: start; }
  :global(.battle-fullscreen) .double-battle-scroll { margin-top: 10px; }
</style>
