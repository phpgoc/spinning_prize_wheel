<script lang="ts">
  import {
    type BattleTmpMatch,
    type BattleTmpSnapshot,
  } from '../lib/battle';
  import { createBattleBracketLayout } from '../lib/battle-bracket-layout';
  import DoubleBattleEditor from './DoubleBattleEditor.svelte';
  import DoubleBattleViewer from './DoubleBattleViewer.svelte';
  import SingleBattleEditor from './SingleBattleEditor.svelte';
  import SingleBattleViewer from './SingleBattleViewer.svelte';
  import type { BattleSide } from './battle-bracket-props';

  export let snapshot: BattleTmpSnapshot;
  export let readOnly = false;
  export let maskUnfixed = false;
  export let viewOnly = false;
  export let hiddenSlotKeys: ReadonlySet<string> = new Set();
  export let saving = false;
  export let onMatchKeydown: ((event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreFocus: ((event: FocusEvent) => void) | undefined = undefined;
  export let onScoreKeydown: ((match: BattleTmpMatch, side: BattleSide, event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreChange: ((match: BattleTmpMatch, side: BattleSide, event: Event) => void) | undefined = undefined;
  export let onReveal: ((match: BattleTmpMatch, side: BattleSide) => void) | undefined = undefined;

  $: layout = createBattleBracketLayout(snapshot);
  $: byeExplanation = createByeExplanation(snapshot);

  function automaticAdvanceParticipant(match: BattleTmpMatch): number | null {
    if (match.status !== 'completed') return null;
    if (match.up === null && match.down !== null) return match.down;
    if (match.down === null && match.up !== null) return match.up;
    return null;
  }

  function createByeExplanation(current: BattleTmpSnapshot): { count: number; text: string } | null {
    const firstStage = current.format === 'double-elimination' ? 'winner' : 'single';
    const byeMatches = current.matches.filter((match) => (
      match.stage === firstStage
      && match.level === 1
      && automaticAdvanceParticipant(match) !== null
    ));
    if (byeMatches.length === 0) return null;
    if (current.format === 'double-elimination') {
      return {
        count: byeMatches.length,
        text: `${byeMatches.length} 个胜者组首轮轮空：对应选手已自动进入胜者组第二轮；轮空不记作失败，也不会产生选手进入败者组。败者组的无败者空位会自动跳过。`,
      };
    }
    return {
      count: byeMatches.length,
      text: `${byeMatches.length} 个首轮轮空：对应选手已自动进入第二轮；首轮仍保留轮空签位，不需要填写比分。`,
    };
  }

</script>

  {#if !viewOnly && !readOnly && byeExplanation}
  <div class="battle-bye-explanation" role="note" data-battle-bye-count={byeExplanation.count}>
    <strong>轮空说明</strong>
    <span>{byeExplanation.text}</span>
  </div>
{/if}

{#if snapshot.format === 'single-elimination' || snapshot.format === 'avoid-first-pair'}
  {#if readOnly || viewOnly}
    <SingleBattleViewer {snapshot} layout={layout.single} {maskUnfixed} />
  {:else}
    <SingleBattleEditor {snapshot} layout={layout.single} {hiddenSlotKeys} {saving} {onMatchKeydown} {onScoreFocus} {onScoreKeydown} {onScoreChange} {onReveal} />
  {/if}
{:else if snapshot.format === 'double-elimination'}
  {#if readOnly || viewOnly}
    <DoubleBattleViewer {snapshot} {layout} {maskUnfixed} />
  {:else}
    <DoubleBattleEditor {snapshot} {layout} {hiddenSlotKeys} {saving} {onMatchKeydown} {onScoreFocus} {onScoreKeydown} {onScoreChange} {onReveal} />
  {/if}
{:else}
  <div class="battle-bracket">
    {#each layout.groups as round (round.id)}<section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}<span>{match.matchId}</span>{/each}</div></section>{/each}
  </div>
{/if}

<style>
  .battle-bye-explanation { display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--battle-text-color, var(--grouping-text-on-dark)); font-size: calc(12px * var(--font-scale, 1)); line-height: 1.55; }
  .battle-bye-explanation strong { flex: 0 0 auto; color: var(--accent); }
  .battle-bye-explanation span { min-width: 0; }
  .battle-bracket { --battle-round-width: calc(235px * var(--battle-layout-scale, 1)); display: flex; gap: calc(108px * var(--battle-layout-scale, 1)); margin-top: 18px; overflow: auto; transition: opacity 180ms ease; }
  .battle-round { flex: 0 0 var(--battle-round-width); }
  .battle-round h3 { display: inline; font-size: calc(14px * var(--font-scale, 1)); }
  .battle-round > div { display: grid; gap: calc(36px * var(--battle-layout-scale, 1)); margin-top: 9px; }
</style>
