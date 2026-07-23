<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let value: number | string = '';
  export let min: number | undefined = undefined;
  export let max: number | undefined = undefined;
  export let step: number | 'any' = 1;
  export let disabled = false;

  const dispatch = createEventDispatcher<{
    value: number | string;
    input: { sourceEvent: Event };
    change: { sourceEvent: Event };
    focus: { sourceEvent: FocusEvent };
    blur: { sourceEvent: FocusEvent };
    keydown: { sourceEvent: KeyboardEvent };
  }>();

  let input: HTMLInputElement;
  let changedWithAlt = false;

  function numericValue(raw: string): number | string {
    if (raw.trim() === '') return '';
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : '';
  }

  function emitValue(event: Event) {
    value = numericValue((event.currentTarget as HTMLInputElement).value);
    dispatch('value', value);
  }

  function handleInput(event: Event) {
    emitValue(event);
    dispatch('input', { sourceEvent: event });
  }

  function handleChange(event: Event) {
    emitValue(event);
    dispatch('change', { sourceEvent: event });
  }

  function handleFocus(event: FocusEvent) {
    dispatch('focus', { sourceEvent: event });
  }

  function handleBlur(event: FocusEvent) {
    if (changedWithAlt) {
      changedWithAlt = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    dispatch('blur', { sourceEvent: event });
  }

  function roundToStep(next: number): number {
    if (step === 'any' || !Number.isFinite(step) || step <= 0) return next;
    const decimals = Math.max(0, String(step).split('.')[1]?.length ?? 0);
    return Number(next.toFixed(decimals));
  }

  function adjustWithAltArrow(event: KeyboardEvent) {
    if (disabled || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const amount = step === 'any' || !Number.isFinite(step) || step <= 0 ? 1 : step;
    const current = Number(input.value);
    const base = Number.isFinite(current) ? current : (min ?? 0);
    const direction = event.key === 'ArrowUp' ? 1 : -1;
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, base + direction * amount));
    input.value = String(roundToStep(bounded));
    input.focus({ preventScroll: true });
    changedWithAlt = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // 某些 Chromium 版本会把 Alt+方向键的焦点移到页面，下一帧恢复到数字框，便于连续调整。
    window.setTimeout(() => {
      if (!input.disabled && document.activeElement !== input) input.focus({ preventScroll: true });
    }, 0);
  }

  function handleKeydown(event: KeyboardEvent) {
    adjustWithAltArrow(event);
    dispatch('keydown', { sourceEvent: event });
  }
</script>

<input
  {...$$restProps}
  bind:this={input}
  class="ui-number-input {$$restProps.class ?? ''}"
  type="number"
  {min}
  {max}
  {step}
  {disabled}
  {value}
  on:input={handleInput}
  on:change={handleChange}
  on:focus={handleFocus}
  on:blur={handleBlur}
  on:keydown={handleKeydown}
/>

<style>
  .ui-number-input {
    appearance: textfield;
    min-width: 0;
  }

  .ui-number-input::-webkit-inner-spin-button,
  .ui-number-input::-webkit-outer-spin-button {
    margin: 0;
    appearance: none;
  }
</style>
