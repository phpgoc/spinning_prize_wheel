<script lang="ts">
  import {
    battleTmpScoreLocked,
    battleTmpSlotOrigin,
    battleTmpWinnerId,
    type BattleTmpMatch,
    type BattleTmpSnapshot,
  } from './battle';

  type BattleSide = 'up' | 'down';
  const BATTLE_SIDES: BattleSide[] = ['up', 'down'];
  type BattleRoundGroup = {
    id: string;
    label: string;
    stage: BattleTmpMatch['stage'];
    matches: BattleTmpMatch[];
  };
  type BattleBracketLayout = {
    groups: BattleRoundGroup[];
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
  export let hiddenSlotKeys: ReadonlySet<string> = new Set();
  export let saving = false;
  export let onMatchKeydown: ((event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreFocus: ((event: FocusEvent) => void) | undefined = undefined;
  export let onScoreKeydown: ((match: BattleTmpMatch, side: BattleSide, event: KeyboardEvent) => void) | undefined = undefined;
  export let onScoreChange: ((match: BattleTmpMatch, side: BattleSide, event: Event) => void) | undefined = undefined;
  export let onReveal: ((match: BattleTmpMatch, side: BattleSide) => void) | undefined = undefined;

  $: layout = createBattleBracketLayout(snapshot);

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
      label: battleTmpColumnLabel(group.stage, group.matches[0].level, group.matches.length),
    }));
  }

  function createSingleBattleLayout(current: BattleTmpSnapshot, groups: BattleRoundGroup[]) {
    if (current.format !== 'single-elimination') {
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
      matches: group.matches.slice(Math.ceil(group.matches.length / 2)).reverse(),
    })).reverse();
    return { left, right, final: finalGroup?.matches[0] ?? null };
  }

  function createBattleBracketLayout(current: BattleTmpSnapshot): BattleBracketLayout {
    const groups = groupBattleTmpMatches(current);
    return {
      groups,
      winner: groups.filter((group) => group.stage === 'winner'),
      loser: groups.filter((group) => group.stage === 'loser'),
      final: groups.filter((group) => group.stage === 'final'),
      single: createSingleBattleLayout(current, groups),
    };
  }

  function battleTmpColumnLabel(
    stage: BattleTmpMatch['stage'],
    level: number,
    matchCount: number,
  ): string {
    if (stage === 'pairing') return '1对2';
    if (stage === 'final') return level === 2 ? '重赛' : '总决赛';
    if (matchCount === 1) return '决赛';
    if (matchCount === 2) return '半决赛';
    return `1/${matchCount}`;
  }

  function battleTmpMatchCode(match: BattleTmpMatch): string {
    const stage = match.stage === 'pairing' ? 'P'
      : match.stage === 'single' ? 'S'
        : match.stage === 'winner' ? 'W'
          : match.stage === 'loser' ? 'L'
            : 'F';
    return `${stage}${match.level} P${match.position}`;
  }

  function battleTmpParticipantName(id: number | null): string {
    if (id === null) return '等待上游';
    return snapshot.participants.find((participant) => participant.id === id)?.name ?? `#${id}`;
  }

  function battleTmpSlotName(match: BattleTmpMatch, side: BattleSide): string {
    const participantId = side === 'up' ? match.up : match.down;
    const origin = battleTmpSlotOrigin(snapshot, match, side);
    if (maskUnfixed && match.level > 1) {
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
    if (!origin) return '待定';
    const originMatch = snapshot.matches.find((candidate) => candidate.matchId === origin.matchId);
    return originMatch ? battleTmpMatchCode(originMatch) : '待定';
  }

  function battleTmpParticipantWon(match: BattleTmpMatch, id: number | null): boolean {
    return id !== null && battleTmpWinnerId(match) === id;
  }

  function battleTmpParticipantFixed(id: number | null): boolean {
    if (id === null) return false;
    const participant = snapshot.participants.find((item) => item.id === id);
    return Boolean(participant && participant.seed <= snapshot.fixedSeedCount);
  }

  function scoreValue(match: BattleTmpMatch, side: BattleSide): number | '' {
    if (maskUnfixed) return '';
    return (side === 'up' ? match.upResult : match.downResult) ?? '';
  }

  function slotHidden(match: BattleTmpMatch, side: BattleSide): boolean {
    return !readOnly && hiddenSlotKeys.has(`${match.matchId}:${side}`);
  }
</script>

{#snippet battleMatchCard(match: BattleTmpMatch)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <article
    class:read-only={readOnly}
    class="battle-match"
    tabindex={readOnly ? undefined : 0}
    aria-label={`${battleTmpMatchCode(match)} 对战`}
    data-battle-stage={match.stage}
    data-battle-level={match.level}
    data-battle-position={match.position}
    on:keydown={readOnly ? undefined : onMatchKeydown}
  >
    <small>{battleTmpMatchCode(match)}</small>
    {#each BATTLE_SIDES as side (side)}
      <div
        class:fixed={battleTmpParticipantFixed(match[side])}
        class:winner={battleTmpParticipantWon(match, match[side])}
        class:waiting={match[side] === null}
        class="battle-side"
      >
        <div>
          {#if slotHidden(match, side)}
            <button type="button" class="battle-reveal-slot" aria-label={`揭晓 ${battleTmpSlotName(match, side)}`} on:click|stopPropagation={() => onReveal?.(match, side)}>·</button>
            <span class="visually-hidden">{battleTmpSlotName(match, side)}</span>
          {:else}
            <strong>{battleTmpSlotName(match, side)}</strong>
          {/if}
        </div>
        <input
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          data-battle-match-id={match.matchId}
          data-battle-side={side}
          aria-label={`${battleTmpSlotName(match, side)} ${side === 'up' ? '上方' : '下方'}比分`}
          value={scoreValue(match, side)}
          disabled={readOnly || match.up === null || match.down === null || saving || match.status === 'skipped' || battleTmpScoreLocked(snapshot, match, side)}
          title={!readOnly && battleTmpScoreLocked(snapshot, match, side) ? '下游已有比分' : ''}
          on:focus={readOnly ? undefined : onScoreFocus}
          on:keydown={readOnly ? undefined : (event) => onScoreKeydown?.(match, side, event)}
          on:change={readOnly ? undefined : (event) => onScoreChange?.(match, side, event)}
        />
      </div>
    {/each}
  </article>
{/snippet}

{#if snapshot.format === 'single-elimination'}
  <div class:read-only={readOnly} class:mask-unfixed={maskUnfixed} class="single-battle-bracket">
    <div class="single-bracket-side left">
      {#each layout.single.left as round (round.id)}
        <section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>
      {/each}
    </div>
    <section class="single-bracket-final">
      <h3>决赛</h3>
      {#if layout.single.final}{@render battleMatchCard(layout.single.final)}{/if}
    </section>
    <div class="single-bracket-side right">
      {#each layout.single.right as round (round.id)}
        <section class="battle-round"><h3>{round.label}</h3><div>{#each round.matches as match (match.matchId)}{@render battleMatchCard(match)}{/each}</div></section>
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
    aria-keyshortcuts={readOnly ? undefined : 'I J K L'}
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
  .battle-bracket { display: flex; gap: 13px; margin-top: 18px; overflow: auto; transition: opacity 180ms ease; }
  .single-battle-bracket { display: grid; grid-template-columns: minmax(max-content, 1fr) minmax(220px, 250px) minmax(max-content, 1fr); gap: 16px; align-items: center; margin-top: 18px; overflow: auto; transition: opacity 180ms ease; }
  .single-bracket-side { display: flex; align-items: stretch; gap: 13px; }
  .single-bracket-side.left { justify-content: flex-end; }
  .single-bracket-side.right { justify-content: flex-start; }
  .single-bracket-side .battle-round { display: flex; min-width: calc(220px * var(--battle-layout-scale, 1)); flex-direction: column; justify-content: center; }
  .single-bracket-final { min-width: calc(220px * var(--battle-layout-scale, 1)); padding: calc(12px * var(--battle-layout-scale, 1)); border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); border-radius: 13px; background: color-mix(in srgb, var(--accent) 4.5%, transparent); }
  .single-bracket-final > h3 { margin-bottom: 9px; color: var(--accent); text-align: center; }
  .single-bracket-side.right .battle-match { direction: rtl; }
  .single-bracket-side.right .battle-match > * { direction: ltr; }
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
  .double-final-section > .battle-bracket { min-height: 180px; align-items: center; margin-top: 0; }
  .double-final-section .battle-round { position: relative; justify-content: center; }
  .double-final-section .battle-round > h3 { position: absolute; bottom: calc(100% + 9px); left: 0; }
  .double-final-section .battle-round > div { margin-top: 0; }
  .double-battle-bracket .battle-round { display: flex; flex-direction: column; }
  .double-battle-bracket .battle-round > div { flex: 1; }
  .double-winner-section .battle-round > div { align-content: end; }
  .double-loser-section .battle-round > div { align-content: start; }
  .double-battle-bracket .battle-match { padding: 6px; }
  .double-battle-bracket .battle-match > small { margin-bottom: 3px; font-size: calc(8px * var(--font-scale, 1)); }
  .double-battle-bracket .battle-match > div { padding: 4px 6px; }
  .double-battle-bracket .battle-match > div + div { margin-top: 2px; }
  .double-battle-bracket .battle-match > .battle-side { gap: 6px; }
  .double-battle-bracket .battle-side input { min-height: 30px; }
  :global(.battle-fullscreen) .double-battle-scroll { margin-top: 10px; }
  .battle-round { flex: 0 0 min(calc(235px * var(--battle-layout-scale, 1)), 74vw); }
  .battle-round h3 { display: inline; font-size: calc(14px * var(--font-scale, 1)); }
  .battle-round > div { display: grid; gap: calc(10px * var(--battle-layout-scale, 1)); margin-top: 9px; }
  .single-bracket-side.left .battle-round:first-child > div,
  .single-bracket-side.right .battle-round:last-child > div { gap: calc(16px * var(--battle-layout-scale, 1)); }
  .mask-unfixed .battle-match.read-only input { visibility: hidden; }
  .mask-unfixed .battle-match.read-only .battle-side:not(.fixed) strong { color: color-mix(in srgb, var(--battle-text-color) 42%, transparent); }
  .battle-match { min-width: 0; padding: calc(9px * var(--battle-layout-scale, 1)); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: calc(11px * var(--battle-layout-scale, 1)); background: var(--battle-match-color, rgba(255, 255, 255, 0.035)); }
  .battle-match > small { display: block; margin-bottom: calc(6px * var(--battle-layout-scale, 1)); color: color-mix(in srgb, var(--battle-text-color, var(--lineup-dim-on-dark)) 72%, transparent); font-family: var(--font-mono); font-size: calc(9px * var(--font-scale, 1)); }
  .battle-match > div { width: 100%; min-width: 0; padding: calc(8px * var(--battle-layout-scale, 1)) calc(9px * var(--battle-layout-scale, 1)); border: 0; border-left: 2px solid rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.13); color: inherit; font: inherit; text-align: left; }
  .battle-match > div + div { margin-top: calc(5px * var(--battle-layout-scale, 1)); }
  .battle-match > div.fixed { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .battle-match > div.waiting { color: var(--lineup-dim-on-dark); }
  .battle-match > .battle-side { display: flex; align-items: center; gap: 8px; }
  .battle-side > div { min-width: 0; flex: 1; }
  .battle-side.winner { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
  .battle-side input {
    width: calc(48px * var(--battle-layout-scale, 1));
    min-height: calc(36px * var(--battle-layout-scale, 1));
    padding: 4px 5px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 7px;
    outline: 0;
    background: rgba(0, 0, 0, 0.2);
    color: #f4f5ec;
    font-family: var(--font-mono);
    font-size: calc(14px * var(--font-scale, 1));
    font-weight: 800;
    text-align: center;
  }
  .battle-side input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }
  .battle-side input:disabled { opacity: 0.4; }
  .battle-match strong { display: block; overflow: hidden; color: var(--battle-participant-color, inherit); font-size: calc(24px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  .battle-reveal-slot {
    display: block;
    width: 100%;
    min-height: 24px;
    padding: 0;
    border: 1px dashed color-mix(in srgb, var(--accent) 42%, transparent);
    border-radius: 6px;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: calc(21px * var(--font-scale, 1));
    line-height: 1;
  }
  .battle-reveal-slot:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
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
