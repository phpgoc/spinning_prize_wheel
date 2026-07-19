/** 单行文本使用回车确认，组合键留给文本区和系统操作。 */
export function isSingleLineTextConfirm(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && !event.shiftKey;
}

/** 多行文本保留普通回车换行，统一使用 Alt+回车确认。 */
export function isMultilineTextConfirm(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    && event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey;
}

/** 局部文本编辑统一使用 Esc 取消。 */
export function isTextEditCancel(event: KeyboardEvent): boolean {
  return event.key === 'Escape'
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && !event.shiftKey;
}
