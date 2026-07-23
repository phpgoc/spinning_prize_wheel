<script lang="ts">
  import { tick } from 'svelte';
  import {
    battleTmpSlotOrigin,
    battleRoundLabel,
    type BattleTmpMatch,
    type BattleTmpSnapshot,
  } from '../lib/battle';
  import BattleMatchCard from './BattleMatchCard.svelte';

  type BattleSide = 'up' | 'down';
  type BattleScorePosition = 'left' | 'right';
  const BATTLE_SIDES: BattleSide[] = ['up', 'down'];
  type BattleRoundGroup = {
    id: string;
    label: string;
    stage: BattleTmpMatch['stage'];
    matches: BattleTmpMatch[];
  };
  type BattleBracketLayout = {
    groups: BattleRoundGroup[];
    preview: BattleRoundGroup[];
    winner: BattleRoundGroup[];
    loser: BattleRoundGroup[];
    final: BattleRoundGroup[];
    single: {
      left: BattleRoundGroup[];
      right: BattleRoundGroup[];
      final: BattleTmpMatch | null;
    };
  };

  export let snapshot: BattleTmpSnapshot;
  export let readOnly = false;
  export let maskUnfixed = false;
  export let previewOnly = false;
  export let hiddenSlotKeys: ReadonlySet<string> = new Set();
  export let saving = false;
  export let onMatchKeydown: ((event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreFocus: ((event: FocusEvent) => void) | undefined = undefined;
  export let onScoreKeydown: ((match: BattleTmpMatch, side: BattleSide, event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreChange: ((match: BattleTmpMatch, side: BattleSide, event: Event) => void) | undefined = undefined;
  export let onReveal: ((match: BattleTmpMatch, side: BattleSide) => void) | undefined = undefined;

  let singleConnectorPaths: string[] = [];
  let singleConnectorWidth = 0;
  let singleConnectorHeight = 0;

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

  function groupBattleTmpMatches(current: BattleTmpSnapshot): BattleRoundGroup[] {
    const groups = new Map<string, BattleRoundGroup>();
    for (const match of current.matches) {
      const id = `${match.stage}-${match.level}`;
      const group = groups.get(id) ?? { id, label: '', stage: match.stage, matches: [] };
      group.matches.push(match);
      groups.set(id, group);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      label: battleRoundLabel(current.format, group.stage, group.matches[0].level, group.matches.length),
    }));
  }

  function createSingleBattleLayout(current: BattleTmpSnapshot, groups: BattleRoundGroup[]) {
    if (current.format !== 'single-elimination' && current.format !== 'avoid-first-pair') {
      return { left: [], right: [], final: null };
    }
    const levels = groups.filter((group) => group.stage === 'single');
    const finalGroup = levels.at(-1);
    const sideLevels = levels.slice(0, -1);
    const left = sideLevels.map((group) => ({
      ...group,
      matches: group.matches.slice(0, Math.ceil(group.matches.length / 2)),
    }));
    const right = sideLevels.map((group) => ({
      ...group,
      matches: group.matches.slice(Math.ceil(group.matches.length / 2)),
    })).reverse();
    return { left, right, final: finalGroup?.matches[0] ?? null };
  }

  function createBattleBracketLayout(current: BattleTmpSnapshot): BattleBracketLayout {
    const groups = groupBattleTmpMatches(current);
    return {
      groups,
      // 抽签前没有任何晋级结果，因此不预先渲染败者组、决赛等未来场次。
      preview: groups.filter((group) => (
        group.matches[0].level === 1
        && (group.stage === 'single' || group.stage === 'winner' || group.stage === 'pairing')
      )),
      winner: groups.filter((group) => group.stage === 'winner'),
      loser: groups.filter((group) => group.stage === 'loser'),
      final: groups.filter((group) => group.stage === 'final'),
      single: createSingleBattleLayout(current, groups),
    };
  }

  function observeSingleBracket(node: HTMLElement) {
    let frame = 0;
    const observer = new ResizeObserver(() => schedule());

    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.querySelectorAll<HTMLElement>('.battle-match[data-battle-match-id]').forEach((match) => observer.observe(match));
        updateSingleConnectors(node);
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

  function updateSingleConnectors(node: HTMLElement) {
    if (snapshot.format !== 'single-elimination' && snapshot.format !== 'avoid-first-pair') {
      singleConnectorPaths = [];
      return;
    }
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
        const sourceCenterX = sourceRect.left + sourceRect.width / 2;
        const targetCenterX = targetRect.left + targetRect.width / 2;
        const leftToRight = sourceCenterX < targetCenterX;
        const sourceX = (leftToRight ? sourceRect.right : sourceRect.left) - rootRect.left + node.scrollLeft;
        const targetX = (leftToRight ? targetRect.left : targetRect.right) - rootRect.left + node.scrollLeft;
        const sourceY = sourceRect.top + sourceRect.height / 2 - rootRect.top + node.scrollTop;
        const targetY = targetRect.top + targetRect.height / 2 - rootRect.top + node.scrollTop;
        const middleX = (sourceX + targetX) / 2;
        nextPaths.push(`M ${sourceX} ${sourceY} H ${middleX} V ${targetY} H ${targetX}`);
      }
    }

    singleConnectorWidth = node.scrollWidth;
    singleConnectorHeight = node.scrollHeight;
    if (nextPaths.join('|') !== singleConnectorPaths.join('|')) singleConnectorPaths = nextPaths;
  }

</script>

{#snippet battleMatchCard(match: BattleTmpMatch, scorePosition: BattleScorePosition = 'right')}
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

{#if !previewOnly && byeExplanation}
  <div class="battle-bye-explanation" role="note" data-battle-bye-count={byeExplanation.count}>
    <strong>轮空说明</strong>
    <span>{byeExplanation.text}</span>
  </div>
{/if}

{#if previewOnly}
  <div class:read-only={readOnly} class:mask-unfixed={maskUnfixed} class="battle-bracket battle-preview-rounds">
    {#each layout.preview as round (round.id)}
      <section class="battle-round"><h3>首轮签位</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>
    {/each}
  </div>
{:else if snapshot.format === 'single-elimination' || snapshot.format === 'avoid-first-pair'}
  <div use:observeSingleBracket class:read-only={readOnly} class:mask-unfixed={maskUnfixed} class="single-battle-bracket">
    {#if singleConnectorPaths.length > 0}
      <svg
        class="single-bracket-connectors"
        width={singleConnectorWidth}
        height={singleConnectorHeight}
        viewBox={`0 0 ${singleConnectorWidth} ${singleConnectorHeight}`}
        aria-hidden="true"
      >
        {#each singleConnectorPaths as path}<path d={path}></path>{/each}
      </svg>
    {/if}
    <div class="single-bracket-side left">
      {#each layout.single.left as round (round.id)}
        <section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match, 'right')}{/each}</div></section>
      {/each}
    </div>
    <section class="single-bracket-final">
      <h3>决赛</h3>
      {#if layout.single.final}{@render battleMatchCard(layout.single.final, 'right')}{/if}
    </section>
    <div class="single-bracket-side right">
      {#each layout.single.right as round (round.id)}
        <section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match, 'left')}{/each}</div></section>
      {/each}
    </div>
  </div>
{:else if snapshot.format === 'double-elimination'}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class:read-only={readOnly}
    class:mask-unfixed={maskUnfixed}
    class="double-battle-scroll"
    tabindex={readOnly ? undefined : 0}
    role={readOnly ? undefined : 'application'}
    aria-label={readOnly ? '双败签表预览' : '双败横向签表'}
    aria-keyshortcuts={readOnly ? undefined : 'U J H K L'}
  >
    <div class="double-battle-bracket">
      <div class="double-battle-groups">
        <section class="double-stage-section double-winner-section"><h3>胜者组</h3><div class="battle-bracket">{#each layout.winner as round, levelIndex (round.id)}<section class="battle-round" data-level-index={levelIndex}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}</div></section>
        <section class="double-stage-section double-loser-section"><h3>败者组</h3><div class="battle-bracket">{#each layout.loser as round, levelIndex (round.id)}<section class="battle-round" data-level-index={levelIndex}><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}</div></section>
      </div>
      <section class="double-final-section"><div class="battle-bracket">{#each layout.final as round (round.id)}<section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}</div></section>
    </div>
  </div>
{:else}
  <div class:read-only={readOnly} class:mask-unfixed={maskUnfixed} class="battle-bracket">
    {#each layout.groups as round (round.id)}<section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>{/each}
  </div>
{/if}

<style>
  .battle-bye-explanation { display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--battle-text-color, var(--lineup-text-on-dark)); font-size: calc(12px * var(--font-scale, 1)); line-height: 1.55; }
  .battle-bye-explanation strong { flex: 0 0 auto; color: var(--accent); }
  .battle-bye-explanation span { min-width: 0; }
  .battle-bracket { --battle-round-width: calc(235px * var(--battle-layout-scale, 1)); display: flex; gap: 13px; margin-top: 18px; overflow: auto; transition: opacity 180ms ease; }
  .single-battle-bracket { --battle-round-width: calc(235px * var(--battle-layout-scale, 1)); position: relative; display: grid; min-width: 0; grid-template-columns: max-content var(--battle-round-width) max-content; gap: calc(16px * var(--battle-layout-scale, 1)); align-items: center; margin-top: 18px; overflow: auto; isolation: isolate; transition: opacity 180ms ease; }
  .single-bracket-connectors { position: absolute; z-index: 0; top: 0; left: 0; overflow: visible; pointer-events: none; }
  .single-bracket-connectors path { fill: none; stroke: color-mix(in srgb, var(--accent) 42%, transparent); stroke-width: calc(2px * var(--battle-layout-scale, 1)); stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  .single-bracket-side { position: relative; z-index: 1; display: flex; align-items: stretch; gap: 13px; }
  .single-bracket-side.left { justify-content: flex-end; }
  .single-bracket-side.right { justify-content: flex-start; }
  .single-bracket-side .battle-round { display: flex; flex-direction: column; justify-content: center; }
  .single-bracket-final { position: relative; z-index: 1; min-width: 0; padding: calc(12px * var(--battle-layout-scale, 1)); border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); border-radius: 13px; background: color-mix(in srgb, var(--battle-background-color, #282c34) 96%, transparent); }
  .single-bracket-final > h3 { margin-bottom: 9px; color: var(--accent); text-align: center; }
  .double-battle-scroll { margin-top: 18px; outline: 0; overflow: auto; scroll-behavior: smooth; }
  .double-battle-scroll:focus { box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--accent) 34%, transparent); }
  .double-battle-bracket { display: grid; width: max-content; min-width: 100%; grid-template-columns: max-content max-content; grid-template-rows: max-content max-content; align-items: start; column-gap: clamp(42px, 5vw, 86px); row-gap: clamp(34px, 5vh, 62px); transition: opacity 180ms ease; }
  .double-battle-groups { display: contents; }
  .double-stage-section,
  .double-final-section { display: flex; min-width: 0; padding: 13px; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 13px; background: rgba(255, 255, 255, 0.018); flex-direction: column; }
  .double-stage-section { padding: 0; border: 0; background: transparent; }
  .double-stage-section > h3 { color: var(--accent); font-size: calc(15px * var(--font-scale, 1)); }
  .double-battle-bracket .battle-bracket { gap: clamp(32px, 4vw, 68px); margin-top: 10px; overflow: visible; align-items: stretch; }
  .double-stage-section > .battle-bracket { min-height: 0; }
  .double-winner-section { grid-column: 1; grid-row: 1; }
  .double-loser-section { grid-column: 1; grid-row: 2; }
  .double-final-section { grid-column: 2; grid-row: 2; align-self: start; transform: translateY(-50%); }
  .double-final-section > .battle-bracket { min-height: 180px; align-items: center; margin-top: 0; transform: translateY(6px); }
  .double-final-section .battle-round { position: relative; justify-content: center; }
  .double-final-section .battle-round > h3 { position: absolute; bottom: calc(100% + 9px); left: 0; }
  .double-final-section .battle-round > div { margin-top: 0; }
  .double-battle-bracket .battle-round { display: flex; flex-direction: column; }
  .double-battle-bracket .battle-round > div { flex: 1; }
  .double-winner-section .battle-round > div { align-content: end; }
  .double-loser-section .battle-round > div { align-content: start; }
  :global(.battle-fullscreen) .double-battle-scroll { margin-top: 10px; }
  .battle-round { flex: 0 0 var(--battle-round-width); }
  .battle-round h3 { display: inline; font-size: calc(14px * var(--font-scale, 1)); }
  .battle-round > div { display: grid; gap: calc(10px * var(--battle-layout-scale, 1)); margin-top: 9px; }
  .single-bracket-side.left .battle-round:first-child > div,
  .single-bracket-side.right .battle-round:last-child > div { gap: calc(16px * var(--battle-layout-scale, 1)); }
</style>
