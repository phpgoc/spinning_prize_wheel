<script lang="ts">
  import { parseOptionText } from './parse-options';
  import type { AppVariant } from './app-variant';
  import {
    battleFixedSeedOptions,
    createAvoidSameGroupPlan,
    createFixedBattlePositions,
    createSeededBattlePlan,
    type BattleEntrySource,
    type BattleFormat,
    type BattleOrderMode,
    type BattlePlan,
    type BattlePosition,
  } from './battle';

  export let desktopRuntime = false;
  export let variant: AppVariant = 'standard';

  let sourceText = '';
  let confirmedNames: string[] = [];
  let plan: BattlePlan | null = null;
  let planSignature = '';
  let error = '';
  let rankingOpen = true;
  let historyOpen = false;
  let battleMode: BattleFormat = 'avoid-first-pair';
  let orderMode: BattleOrderMode = 'input';
  let fixedSeedCount = 2;

  $: names = parseOptionText(sourceText);
  $: participantCount = names.length;
  $: validParticipantCount = participantCount >= 2;
  $: sourceDirty = sourceText !== confirmedNames.join('\n');
  $: fixedSeedOptions = battleFixedSeedOptions(participantCount);
  $: if (fixedSeedOptions.length > 0 && !fixedSeedOptions.includes(fixedSeedCount)) {
    fixedSeedCount = fixedSeedOptions[0];
  }
  $: battleModeLabel = battleMode === 'avoid-first-pair'
    ? '同组不对战1对2'
    : battleMode === 'single-elimination'
      ? '单败'
      : '双败';
  $: configuredFixedSeedCount = fixedSeedOptions.length > 0 ? fixedSeedCount : 0;
  $: canExecute = battleMode === 'avoid-first-pair'
    ? participantCount >= 4 && participantCount % 2 === 0
    : validParticipantCount;
  $: configurationSignature = [
    names.join('\u0000'),
    battleMode,
    orderMode,
    configuredFixedSeedCount,
  ].join('|');
  $: planOutdated = plan !== null && planSignature !== configurationSignature;
  $: fixedPreviewPositions = battleMode !== 'avoid-first-pair' && validParticipantCount
    ? createFixedBattlePositions(names, configuredFixedSeedCount)
    : [];
  $: fixedPreviewMatches = pairPositions(fixedPreviewPositions);

  function startBattle() {
    error = '';
    if (!canExecute) {
      error = battleMode === 'avoid-first-pair'
        ? `同组不对战1对2需要偶数名单且至少 4 项，当前为 ${participantCount} 项。`
        : `至少需要 2 名参赛者，当前为 ${participantCount} 项。`;
      return;
    }
    confirmedNames = [...names];
    sourceText = confirmedNames.join('\n');
    try {
      plan = battleMode === 'avoid-first-pair'
        ? createAvoidSameGroupPlan(confirmedNames)
        : createSeededBattlePlan(confirmedNames, {
          format: battleMode,
          orderMode,
          fixedSeedCount: configuredFixedSeedCount,
        });
      planSignature = configurationSignature;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }

  function clearInput() {
    sourceText = '';
    confirmedNames = [];
    plan = null;
    planSignature = '';
    error = '';
  }

  function pairPositions(positions: readonly BattlePosition[]): [BattlePosition, BattlePosition][] {
    return Array.from({ length: positions.length / 2 }, (_, index) => [
      positions[index * 2],
      positions[index * 2 + 1],
    ]);
  }

  function entryLabel(entry: BattleEntrySource): string {
    if (!entry) return '轮空';
    if (entry.kind === 'participant') return entry.participant.name;
    return `${entry.matchId} ${entry.kind === 'winner' ? '胜者' : '败者'}`;
  }

  function entryDetail(entry: BattleEntrySource): string {
    if (!entry || entry.kind !== 'participant') return '';
    if (entry.participant.groupRank) {
      return `第 ${entry.participant.groupIndex! + 1} 组 · 第 ${entry.participant.groupRank}`;
    }
    return `顺位 ${entry.participant.seed}`;
  }

  function entryFixed(entry: BattleEntrySource): boolean {
    return Boolean(
      entry?.kind === 'participant'
      && plan
      && entry.participant.seed <= plan.fixedSeedCount,
    );
  }
</script>

<main class:caimi={variant === 'caimi'} class="battle-page" id="battle">
  <div class:desktop={desktopRuntime} class="battle-workbench">
    {#if desktopRuntime}
      <aside class:ranking-open={rankingOpen} class:history-open={historyOpen} class="battle-sidebar">
      <section class:open={rankingOpen} class="battle-accordion">
        <button type="button" class="battle-accordion-toggle" on:click={() => (rankingOpen = !rankingOpen)}>
          <span>排名</span><strong>待接入</strong><i>{rankingOpen ? '−' : '+'}</i>
        </button>
        {#if rankingOpen}
          <div class="battle-accordion-content">
            <div class="battle-sidebar-empty"><strong>排名</strong><span>对战排名将在这里展示</span></div>
          </div>
        {/if}
      </section>
      <section class:open={historyOpen} class="battle-accordion">
        <button type="button" class="battle-accordion-toggle" on:click={() => (historyOpen = !historyOpen)}>
          <span>历史</span><strong>最近 5 条</strong><i>{historyOpen ? '−' : '+'}</i>
        </button>
        {#if historyOpen}
          <div class="battle-accordion-content">
            <div class="battle-sidebar-empty"><strong>对战历史</strong><span>生成结果后可在这里查看</span></div>
          </div>
        {/if}
      </section>
      </aside>
    {/if}

    <section class="battle-center" aria-live="polite">
      <div class="battle-panel battle-preview">
        <div class="battle-heading">
          <div><span>02</span><div><h2>对战预览</h2><p>确认输入后在这里检查参赛名单</p></div></div>
          <strong>{participantCount}<small>项</small></strong>
        </div>
        {#if names.length > 0}
          <div class="battle-preview-list">
            {#each names as name, index}
              <div class="battle-preview-row"><span>{String(index + 1).padStart(2, '0')}</span><strong>{name}</strong></div>
            {/each}
          </div>
        {:else}
          <div class="battle-empty-preview"><div class="empty-grid"><i>A</i><i>B</i><i>C</i><i>D</i></div><span>右侧输入名单后显示预览</span></div>
        {/if}
      </div>

      <div class="battle-panel battle-result">
        <div class="battle-heading">
          <div><span>03</span><div><h2>对战</h2><p>{plan ? `${battleModeLabel} · ${plan.participantCount} 项` : fixedPreviewMatches.length > 0 ? '固定签位会立即显示，其他位置执行时随机' : '点击右侧执行后生成对战'}</p></div></div>
        </div>
        {#if plan}
          {#if planOutdated}<div class="battle-outdated">名单或配置已变化，请重新执行。</div>{/if}
          <div class:outdated={planOutdated} class="battle-bracket">
            {#each plan.rounds as round (round.id)}
              <section class="battle-round">
                <h3>{round.label}</h3>
                <span>{round.matches.length} 场</span>
                <div>
                  {#each round.matches as match (match.id)}
                    <article class="battle-match">
                      <small>{match.id}</small>
                      {#each match.entries as entry}
                        <div class:fixed={entryFixed(entry)} class:waiting={entry?.kind !== 'participant'}>
                          <strong>{entryLabel(entry)}</strong>
                          {#if entryDetail(entry)}<span>{entryDetail(entry)}</span>{/if}
                        </div>
                      {/each}
                    </article>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        {:else if fixedPreviewMatches.length > 0}
          <div class="battle-fixed-preview">
            {#each fixedPreviewMatches as positions, index}
              <article class="battle-match">
                <small>首轮 · 第 {index + 1} 场</small>
                {#each positions as position}
                  <div class:fixed={position.fixed} class:waiting={!position.participant}>
                    <strong>{position.participant?.name ?? '待随机'}</strong>
                    <span>{position.fixed ? `顺位 ${position.participant?.seed} · 已固定` : `签位 ${position.seedNumber}`}</span>
                  </div>
                {/each}
              </article>
            {/each}
          </div>
        {:else}
          <div class="battle-result-placeholder">
            <div class="battle-match-mark"><i>A</i><b>VS</b><i>B</i></div>
            <strong>等待执行对战</strong>
            <span>{battleMode === 'avoid-first-pair' ? '名单前半为各组第 1，后半为对应组第 2' : '输入名单并选择固定位置'}</span>
          </div>
        {/if}
      </div>
    </section>

    <aside class="battle-config">
      <div class="battle-heading">
        <div><span>01</span><h2>输入</h2></div>
        <strong>{participantCount}<small>项</small></strong>
      </div>
      <label class="battle-names-field">
        <span>每行一个，也支持空格、逗号和 Excel 粘贴</span>
        <textarea bind:value={sourceText} placeholder="粘贴参赛名单…" spellcheck="false"></textarea>
      </label>

      <div class:valid={validParticipantCount} class:invalid={participantCount > 0 && !validParticipantCount} class="battle-count-status" role="status">
        {#if participantCount === 0}
          等待输入名单
        {:else if battleMode === 'avoid-first-pair' && !canExecute}
          该赛制需要偶数名单且至少 4 项（当前 {participantCount} 项）
        {:else if validParticipantCount}
          人数符合要求，可以开始
        {:else}
          至少输入 2 项（当前 {participantCount} 项）
        {/if}
      </div>

      <fieldset class="battle-radio-group battle-mode-group">
        <legend>赛制</legend>
        <label><input type="radio" name="battle-mode" value="avoid-first-pair" bind:group={battleMode} /><span>同组不对战1对2</span></label>
        <label><input type="radio" name="battle-mode" value="single-elimination" bind:group={battleMode} /><span>单败</span></label>
        <label><input type="radio" name="battle-mode" value="double-elimination" bind:group={battleMode} /><span>双败</span></label>
      </fieldset>

      {#if battleMode !== 'avoid-first-pair'}
        <fieldset class="battle-radio-group">
          <legend>名单顺序</legend>
          <label title={desktopRuntime ? '' : '网页版没有排名数据库'}><input type="radio" name="battle-order" value="rank" bind:group={orderMode} disabled={!desktopRuntime} /><span>按排名</span></label>
          <label><input type="radio" name="battle-order" value="input" bind:group={orderMode} /><span>按输入顺序</span></label>
        </fieldset>
        <fieldset class="battle-radio-group battle-seed-group">
          <legend>固定位置</legend>
          {#each fixedSeedOptions as count}
            <label><input type="radio" name="battle-fixed-seeds" value={count} bind:group={fixedSeedCount} /><span>前 {count} 固定</span></label>
          {:else}
            <div class="battle-radio-empty">输入至少 3 项后生成选项</div>
          {/each}
        </fieldset>
      {/if}

      {#if error}<div class="battle-error" role="alert">{error}</div>{/if}
      <div class="battle-input-actions">
        <button type="button" class="clear-battle" disabled={participantCount === 0} on:click={clearInput}>清空</button>
        <button type="button" class="start-battle" disabled={!canExecute} on:click={startBattle}>
          {plan && !planOutdated && !sourceDirty ? '重新执行' : '执行'} <i>→</i>
        </button>
      </div>
    </aside>
  </div>
</main>

<style>
  .battle-page {
    --battle-muted-on-dark: #d9dbd2;
    --battle-dim-on-dark: #c4c7bd;
    --battle-muted-on-light: #34362f;
    min-height: 0;
    padding: clamp(24px, 4vw, 58px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 25px;
    overflow: hidden;
    background:
      radial-gradient(circle at 82% 8%, rgba(231, 255, 114, 0.09), transparent 28%),
      #20211b;
    color: #f6f3ea;
    box-shadow: 0 28px 80px rgba(0, 0, 0, 0.28);
  }

  .battle-workbench {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 370px);
    align-items: stretch;
    gap: clamp(14px, 1.8vw, 25px);
    max-width: 1580px;
    min-height: calc(100vh - 196px);
    margin: 0 auto;
  }

  .battle-workbench.desktop {
    grid-template-columns: minmax(260px, 310px) minmax(0, 1fr) minmax(300px, 360px);
  }

  .battle-sidebar,
  .battle-center,
  .battle-config { min-width: 0; }
  .battle-sidebar { display: grid; align-content: start; gap: 12px; }
  .battle-accordion,
  .battle-panel,
  .battle-config { border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 19px; }
  .battle-accordion { overflow: hidden; background: rgba(11, 12, 9, 0.27); }
  .battle-accordion-toggle {
    display: grid;
    width: 100%;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 15px 17px;
    border: 0;
    background: transparent;
    color: #f6f3ea;
    text-align: left;
  }
  .battle-accordion-toggle span { font-size: calc(14px * var(--font-scale, 1)); font-weight: 800; }
  .battle-accordion-toggle strong { color: var(--battle-dim-on-dark); font-size: calc(11px * var(--font-scale, 1)); font-weight: 500; }
  .battle-accordion-toggle i { color: #e7ff72; font-family: var(--font-mono); font-size: 18px; font-style: normal; }
  .battle-accordion-content { padding: 0 13px 13px; }
  .battle-sidebar-empty { display: grid; gap: 6px; min-height: 125px; place-content: center; border: 1px dashed rgba(255, 255, 255, 0.16); border-radius: 12px; color: var(--battle-dim-on-dark); text-align: center; }
  .battle-sidebar-empty strong { color: #f6f3ea; font-size: calc(13px * var(--font-scale, 1)); }
  .battle-sidebar-empty span { font-size: calc(11px * var(--font-scale, 1)); }

  .battle-center { display: grid; grid-template-rows: minmax(250px, 0.88fr) minmax(270px, 1fr); gap: 14px; }
  .battle-panel { min-width: 0; padding: clamp(20px, 2.5vw, 30px); background: rgba(11, 12, 9, 0.27); }
  .battle-heading { display: flex; align-items: center; justify-content: space-between; gap: 15px; }
  .battle-heading > div { display: flex; align-items: baseline; gap: 9px; min-width: 0; }
  .battle-heading > div > span { color: #c9d66f; font-family: var(--font-mono); font-size: calc(12px * var(--font-scale, 1)); letter-spacing: 0.14em; }
  .battle-heading h2 { font-size: calc(23px * var(--font-scale, 1)); letter-spacing: -0.04em; }
  .battle-heading p { margin-top: 3px; color: var(--battle-muted-on-dark); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-heading > strong { font-size: calc(27px * var(--font-scale, 1)); }
  .battle-heading > strong small { margin-left: 2px; color: var(--battle-muted-on-dark); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-preview-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 20px; }
  .battle-preview-row { display: flex; min-width: 0; align-items: center; gap: 9px; padding: 10px 11px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 9px; background: rgba(255, 255, 255, 0.04); }
  .battle-preview-row span { color: #c9d66f; font-family: var(--font-mono); font-size: 11px; }
  .battle-preview-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .battle-empty-preview,
  .battle-result-placeholder { display: grid; min-height: 170px; align-content: center; justify-items: center; gap: 8px; color: var(--battle-dim-on-dark); text-align: center; }
  .battle-empty-preview span,
  .battle-result-placeholder span { font-size: calc(12px * var(--font-scale, 1)); }
  .empty-grid { display: grid; grid-template-columns: repeat(4, 42px); gap: 7px; margin-bottom: 7px; }
  .empty-grid i { display: grid; height: 42px; place-items: center; border: 1px solid rgba(231, 255, 114, 0.35); border-radius: 8px; color: #e7ff72; font-family: var(--font-mono); font-style: normal; }
  .battle-result-placeholder { min-height: 220px; }
  .battle-result-placeholder strong { color: #f6f3ea; font-size: calc(16px * var(--font-scale, 1)); }
  .battle-match-mark { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .battle-match-mark i { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid rgba(231, 255, 114, 0.45); border-radius: 10px; color: #e7ff72; font-family: var(--font-mono); font-size: 19px; font-style: normal; }
  .battle-match-mark b { color: var(--battle-dim-on-dark); font-family: var(--font-mono); font-size: 12px; }
  .battle-outdated { margin-top: 15px; padding: 9px 11px; border-radius: 8px; background: rgba(218, 91, 63, 0.14); color: #ffd3c9; font-size: calc(12px * var(--font-scale, 1)); }
  .battle-bracket { display: flex; gap: 13px; margin-top: 18px; overflow: auto; transition: opacity 180ms ease; }
  .battle-bracket.outdated { opacity: 0.45; }
  .battle-round { flex: 0 0 min(235px, 74vw); }
  .battle-round h3 { display: inline; font-size: calc(14px * var(--font-scale, 1)); }
  .battle-round > span { float: right; color: var(--battle-dim-on-dark); font-size: calc(10px * var(--font-scale, 1)); }
  .battle-round > div { display: grid; gap: 10px; margin-top: 9px; }
  .battle-fixed-preview { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin-top: 18px; }
  .battle-match { min-width: 0; padding: 9px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 11px; background: rgba(255, 255, 255, 0.035); }
  .battle-match > small { display: block; margin-bottom: 6px; color: var(--battle-dim-on-dark); font-family: var(--font-mono); font-size: calc(9px * var(--font-scale, 1)); }
  .battle-match > div { min-width: 0; padding: 8px 9px; border-left: 2px solid rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.13); }
  .battle-match > div + div { margin-top: 5px; }
  .battle-match > div.fixed { border-left-color: #e7ff72; background: rgba(231, 255, 114, 0.08); }
  .battle-match > div.waiting { color: var(--battle-dim-on-dark); }
  .battle-match strong { display: block; overflow: hidden; font-size: calc(12px * var(--font-scale, 1)); text-overflow: ellipsis; white-space: nowrap; }
  .battle-match span { display: block; margin-top: 2px; color: var(--battle-dim-on-dark); font-size: calc(9px * var(--font-scale, 1)); }

  .battle-config { align-self: start; padding: 22px; background: #efede6; color: #24251f; }
  .battle-config .battle-heading > div > span { color: #626d1f; }
  .battle-config .battle-heading > strong { color: #24251f; }
  .battle-config .battle-heading > strong small { color: var(--battle-muted-on-light); }
  .battle-names-field { display: block; margin-top: 18px; }
  .battle-names-field > span { color: var(--battle-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  textarea { width: 100%; min-height: 220px; margin-top: 8px; padding: 13px; border: 1px solid rgba(36, 37, 31, 0.13); border-radius: 11px; outline: 0; resize: vertical; background: #f8f6f0; color: #24251f; font-family: var(--font-mono); font-size: calc(15px * var(--font-scale, 1)); line-height: 1.7; }
  textarea::placeholder { color: var(--battle-muted-on-light); opacity: 1; }
  textarea:focus { border-color: #8a993e; box-shadow: 0 0 0 3px rgba(138, 153, 62, 0.12); }
  .battle-count-status,
  .battle-error { margin-top: 10px; padding: 9px 11px; border-radius: 8px; color: var(--battle-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-count-status.valid { background: rgba(138, 153, 62, 0.13); color: #52601d; }
  .battle-count-status.invalid,
  .battle-error { background: rgba(218, 91, 63, 0.1); color: #ad4b35; }
  .battle-radio-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin: 17px 0 0; padding: 0; border: 0; }
  .battle-mode-group { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .battle-seed-group { grid-template-columns: repeat(auto-fit, minmax(95px, 1fr)); }
  .battle-radio-group legend { width: 100%; margin-bottom: 7px; color: var(--battle-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-radio-group label { display: flex; min-width: 0; align-items: center; gap: 6px; padding: 9px 10px; border: 1px solid rgba(36, 37, 31, 0.13); border-radius: 8px; background: #f8f6f0; color: #34362f; font-size: calc(12px * var(--font-scale, 1)); }
  .battle-radio-group input { accent-color: #7d9134; }
  .battle-radio-group label:has(input:disabled) { cursor: not-allowed; opacity: 0.48; }
  .battle-radio-empty { grid-column: 1 / -1; padding: 9px 10px; border: 1px dashed rgba(36, 37, 31, 0.2); border-radius: 8px; color: var(--battle-muted-on-light); font-size: calc(12px * var(--font-scale, 1)); }
  .battle-input-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 17px; }
  .battle-input-actions button { padding: 8px 10px; border: 1px solid rgba(36, 37, 31, 0.24); border-radius: 8px; cursor: pointer; font-size: calc(12px * var(--font-scale, 1)); font-weight: 750; }
  .clear-battle { background: #fffdf8; color: #7e3c31; }
  .start-battle { flex: 1; background: #22231d; color: #f8f6ef; }
  .start-battle i { float: right; color: var(--accent); font-family: var(--font-mono); font-size: 18px; font-style: normal; }

  @media (max-width: 1120px) {
    .battle-workbench.desktop { grid-template-columns: minmax(215px, 0.72fr) minmax(0, 1.28fr); }
    .battle-workbench.desktop .battle-config { grid-column: 2; grid-row: 2; }
    .battle-workbench.desktop .battle-center { grid-column: 2; grid-row: 1; }
    .battle-workbench.desktop .battle-sidebar { grid-column: 1; grid-row: 1 / span 2; }
  }

  @media (max-width: 720px) {
    .battle-page { padding: 24px 14px; }
    .battle-workbench,
    .battle-workbench.desktop { grid-template-columns: minmax(0, 1fr); min-height: 0; }
    .battle-sidebar,
    .battle-center,
    .battle-config { grid-column: 1; grid-row: auto; }
    .battle-sidebar { order: 3; }
    .battle-center { order: 1; grid-template-rows: auto auto; }
    .battle-config { order: 2; }
    .battle-panel { padding: 18px; }
    .battle-mode-group { grid-template-columns: minmax(0, 1fr); }
  }
</style>
