export type DrawSoundOutcome = 'success' | 'retry' | 'eliminated';

export interface DrawSoundController {
  startSpin(durationMs: number): void;
  stopSpin(): void;
  playResult(outcome: DrawSoundOutcome): void;
  dispose(): void;
}

/** 用 Web Audio 合成短音效，避免桌面安装包再携带音频文件。 */
export function createDrawSoundController(): DrawSoundController {
  let context: AudioContext | null = null;
  let spinSources: AudioScheduledSourceNode[] = [];

  function audioContext(): AudioContext | null {
    if (context) return context;
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    return context;
  }

  function resume(current: AudioContext) {
    if (current.state === 'suspended') void current.resume().catch(() => undefined);
  }

  function stopSpin() {
    for (const source of spinSources) {
      try {
        source.stop();
      } catch {
        // 已按计划停止的节点无需再次处理。
      }
    }
    spinSources = [];
  }

  function startSpin(durationMs: number) {
    stopSpin();
    const current = audioContext();
    if (!current) return;
    resume(current);

    const now = current.currentTime;
    const end = now + Math.max(0.2, durationMs / 1000);
    const oscillator = current.createOscillator();
    const pulse = current.createOscillator();
    const pulseDepth = current.createGain();
    const volume = current.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(105, now);
    oscillator.frequency.exponentialRampToValueAtTime(185, end);
    pulse.type = 'sine';
    pulse.frequency.setValueAtTime(7, now);
    pulseDepth.gain.setValueAtTime(16, now);
    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(0.035, now + 0.04);
    volume.gain.setValueAtTime(0.035, Math.max(now + 0.04, end - 0.08));
    volume.gain.exponentialRampToValueAtTime(0.0001, end);

    pulse.connect(pulseDepth).connect(oscillator.frequency);
    oscillator.connect(volume).connect(current.destination);
    oscillator.start(now);
    pulse.start(now);
    oscillator.stop(end);
    pulse.stop(end);
    spinSources = [oscillator, pulse];
  }

  function playResult(outcome: DrawSoundOutcome) {
    stopSpin();
    const current = audioContext();
    if (!current) return;
    resume(current);

    const notes = outcome === 'success'
      ? [523.25, 659.25, 783.99]
      : outcome === 'retry' ? [392, 329.63] : [329.63, 220];
    const now = current.currentTime;
    notes.forEach((frequency, index) => {
      const start = now + index * 0.09;
      const end = start + (outcome === 'success' ? 0.24 : 0.2);
      const oscillator = current.createOscillator();
      const volume = current.createGain();
      oscillator.type = outcome === 'eliminated' ? 'sawtooth' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(0.06, start + 0.025);
      volume.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(volume).connect(current.destination);
      oscillator.start(start);
      oscillator.stop(end);
    });
  }

  function dispose() {
    stopSpin();
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    context = null;
  }

  return { startSpin, stopSpin, playResult, dispose };
}
