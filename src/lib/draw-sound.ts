export type DrawSoundOutcome = 'success' | 'retry' | 'eliminated';

export interface DrawSoundController {
  startSpin(durationMs: number): void;
  stopSpin(): void;
  playResult(outcome: DrawSoundOutcome): void;
  dispose(): void;
}

export interface SpinTickShape {
  intervalMs: number;
  frequency: number;
  volume: number;
  accent: boolean;
}

export interface ResultNote {
  frequency: number;
  offset: number;
  duration: number;
  volume: number;
  timbre: 'bell' | 'soft';
}

const MINIMUM_GAIN = 0.0001;

const RESULT_NOTES: Record<DrawSoundOutcome, readonly ResultNote[]> = {
  success: [
    { frequency: 523.25, offset: 0, duration: 0.48, volume: 0.036, timbre: 'bell' },
    { frequency: 659.25, offset: 0.075, duration: 0.52, volume: 0.034, timbre: 'bell' },
    { frequency: 783.99, offset: 0.15, duration: 0.58, volume: 0.034, timbre: 'bell' },
    { frequency: 1046.5, offset: 0.27, duration: 0.82, volume: 0.044, timbre: 'bell' },
  ],
  retry: [
    { frequency: 440, offset: 0, duration: 0.28, volume: 0.028, timbre: 'soft' },
    { frequency: 587.33, offset: 0.13, duration: 0.42, volume: 0.034, timbre: 'bell' },
  ],
  eliminated: [
    { frequency: 392, offset: 0, duration: 0.28, volume: 0.028, timbre: 'soft' },
    { frequency: 293.66, offset: 0.105, duration: 0.36, volume: 0.031, timbre: 'soft' },
    { frequency: 196, offset: 0.22, duration: 0.5, volume: 0.036, timbre: 'soft' },
  ],
};

/** 转动越接近结束，触点节拍越慢、越沉，听感与画面的减速保持一致。 */
export function spinTickShape(progress: number, tickIndex: number): SpinTickShape {
  const normalized = Math.max(0, Math.min(1, progress));
  const slowdown = normalized ** 2.2;
  const accent = tickIndex % 4 === 0;
  const pitchPattern = [1, 0.94, 1.03, 0.96][tickIndex % 4] ?? 1;
  return {
    intervalMs: 76 + 194 * slowdown,
    frequency: (1040 - 430 * normalized) * pitchPattern,
    volume: (accent ? 0.018 : 0.013) + normalized * 0.005,
    accent,
  };
}

/** 返回只读副本，防止播放方意外改变后续揭晓旋律。 */
export function resultNotes(outcome: DrawSoundOutcome): ResultNote[] {
  return RESULT_NOTES[outcome].map((note) => ({ ...note }));
}

/** 用 Web Audio 合成音效，避免桌面安装包携带额外音频文件。 */
export function createDrawSoundController(): DrawSoundController {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let spinSources = new Set<AudioScheduledSourceNode>();
  let resultSources = new Set<AudioScheduledSourceNode>();
  let spinTimer: ReturnType<typeof setTimeout> | null = null;
  let spinGeneration = 0;
  let noiseBuffer: AudioBuffer | null = null;

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

  function output(current: AudioContext): AudioNode {
    if (master) return master;
    const compressor = current.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 16;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    master = current.createGain();
    master.gain.value = 0.82;
    master.connect(compressor).connect(current.destination);
    return master;
  }

  function registerSource(
    source: AudioScheduledSourceNode,
    sources: Set<AudioScheduledSourceNode>,
  ) {
    sources.add(source);
    source.addEventListener('ended', () => sources.delete(source), { once: true });
  }

  function createNoiseBuffer(current: AudioContext): AudioBuffer {
    if (noiseBuffer) return noiseBuffer;
    const length = Math.max(1, Math.round(current.sampleRate * 0.025));
    noiseBuffer = current.createBuffer(1, length, current.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      const fade = 1 - index / channel.length;
      channel[index] = (Math.random() * 2 - 1) * fade * fade;
    }
    return noiseBuffer;
  }

  function stopSpin() {
    spinGeneration += 1;
    if (spinTimer !== null) {
      clearTimeout(spinTimer);
      spinTimer = null;
    }
    for (const source of spinSources) {
      try {
        source.stop();
      } catch {
        // 已按计划停止的节点无需再次处理。
      }
    }
    spinSources.clear();
  }

  function stopResult() {
    for (const source of resultSources) {
      try {
        source.stop();
      } catch {
        // 已自然结束的尾音无需再次处理。
      }
    }
    resultSources.clear();
  }

  function playSpinTick(current: AudioContext, shape: SpinTickShape) {
    const now = current.currentTime;
    const destination = output(current);

    // 三角波提供柔和的触点主体，极短噪声只负责补足真实机械质感。
    const body = current.createOscillator();
    const bodyVolume = current.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(shape.frequency, now);
    body.frequency.exponentialRampToValueAtTime(shape.frequency * 0.56, now + 0.036);
    bodyVolume.gain.setValueAtTime(MINIMUM_GAIN, now);
    bodyVolume.gain.exponentialRampToValueAtTime(shape.volume, now + 0.003);
    bodyVolume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, now + 0.045);
    body.connect(bodyVolume).connect(destination);
    body.start(now);
    body.stop(now + 0.05);
    registerSource(body, spinSources);

    const click = current.createBufferSource();
    const clickFilter = current.createBiquadFilter();
    const clickVolume = current.createGain();
    click.buffer = createNoiseBuffer(current);
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = shape.accent ? 1850 : 2250;
    clickFilter.Q.value = 0.75;
    clickVolume.gain.setValueAtTime(shape.accent ? 0.009 : 0.006, now);
    clickVolume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, now + 0.022);
    click.connect(clickFilter).connect(clickVolume).connect(destination);
    click.start(now);
    registerSource(click, spinSources);
  }

  function startSpin(durationMs: number) {
    stopSpin();
    stopResult();
    const current = audioContext();
    if (!current) return;
    resume(current);

    const generation = spinGeneration;
    const startedAt = current.currentTime;
    const durationSeconds = Math.max(0.25, durationMs / 1000);
    let tickIndex = 0;

    const scheduleTick = () => {
      if (generation !== spinGeneration) return;
      const elapsed = current.currentTime - startedAt;
      if (elapsed >= durationSeconds) {
        spinTimer = null;
        return;
      }
      const shape = spinTickShape(elapsed / durationSeconds, tickIndex);
      playSpinTick(current, shape);
      tickIndex += 1;
      spinTimer = setTimeout(scheduleTick, shape.intervalMs);
    };
    scheduleTick();
  }

  function playTone(current: AudioContext, note: ResultNote, startedAt: number) {
    const start = startedAt + note.offset;
    const destination = output(current);
    const partials = note.timbre === 'bell'
      ? [[1, 1, note.duration], [2.01, 0.2, note.duration * 0.58], [3.98, 0.055, note.duration * 0.34]]
      : [[1, 1, note.duration], [2, 0.085, note.duration * 0.5]];

    for (const [frequencyRatio, volumeRatio, duration] of partials) {
      const oscillator = current.createOscillator();
      const volume = current.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency * frequencyRatio, start);
      volume.gain.setValueAtTime(MINIMUM_GAIN, start);
      volume.gain.exponentialRampToValueAtTime(note.volume * volumeRatio, start + 0.008);
      volume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, start + duration);
      oscillator.connect(volume).connect(destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
      registerSource(oscillator, resultSources);
    }
  }

  function playResult(outcome: DrawSoundOutcome) {
    stopSpin();
    stopResult();
    const current = audioContext();
    if (!current) return;
    resume(current);
    const startedAt = current.currentTime + 0.012;
    for (const note of resultNotes(outcome)) playTone(current, note, startedAt);
  }

  function dispose() {
    stopSpin();
    stopResult();
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    context = null;
    master = null;
    noiseBuffer = null;
  }

  return { startSpin, stopSpin, playResult, dispose };
}
