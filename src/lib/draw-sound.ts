export type DrawSoundOutcome = 'success' | 'retry' | 'eliminated';

export interface DrawSoundController {
  startSpin(durationMs: number): void;
  stopSpin(): void;
  playResult(outcome: DrawSoundOutcome): void;
  dispose(): void;
}

export interface SpinMusicStep {
  offset: number;
  duration: number;
  section: 'intro' | 'groove' | 'build' | 'brake';
  chordFrequencies: readonly number[];
  melodyFrequency: number | null;
  bassFrequency: number | null;
  kick: boolean;
  snare: boolean;
  hat: boolean;
  intensity: number;
}

export interface ResultNote {
  frequency: number;
  offset: number;
  duration: number;
  volume: number;
  timbre: 'bell' | 'soft';
}

const MINIMUM_GAIN = 0.0001;
const SPIN_BEAT_SECONDS = 60 / 132;

const SPIN_CHORDS = [
  { pad: [261.63, 329.63, 392], melody: [523.25, 659.25, 783.99, 659.25], bass: 130.81 },
  { pad: [220, 261.63, 329.63], melody: [440, 523.25, 659.25, 523.25], bass: 110 },
  { pad: [174.61, 220, 261.63], melody: [349.23, 440, 523.25, 440], bass: 87.31 },
  { pad: [196, 246.94, 293.66], melody: [392, 493.88, 587.33, 493.88], bass: 98 },
] as const;

const SPIN_BUILD_MELODIES = [
  [523.25, 659.25, 783.99, 1046.5],
  [587.33, 783.99, 987.77, 1174.66],
] as const;

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

/** 生成有引子、主段、推进和刹车四段结构的转动配乐。 */
export function spinMusicPlan(durationMs: number): SpinMusicStep[] {
  const duration = Math.max(0.25, durationMs / 1000);
  const baseStep = SPIN_BEAT_SECONDS / 2;
  const steps: SpinMusicStep[] = [];
  let offset = 0;
  let stepIndex = 0;
  let previousSection: SpinMusicStep['section'] | null = null;
  let sectionStepIndex = 0;

  while (offset < duration - 0.035) {
    const progress = offset / duration;
    const ending = Math.max(0, (progress - 0.68) / 0.32);
    const stepDuration = baseStep * (1 + 0.72 * ending * ending);
    const section: SpinMusicStep['section'] = progress < 0.16
      ? 'intro'
      : progress < 0.55 ? 'groove'
        : progress < 0.8 ? 'build' : 'brake';
    if (section !== previousSection) sectionStepIndex = 0;
    const chordIndex = section === 'intro' ? 0
      : section === 'groove' ? (sectionStepIndex < 4 ? 1 : 2)
        : section === 'build' ? (sectionStepIndex < 4 ? 2 : 3)
          : 3;
    const chord = SPIN_CHORDS[chordIndex] ?? SPIN_CHORDS[0];
    const hasRoomForPad = duration - offset >= baseStep * 1.5;
    const melody = section === 'intro'
      ? [523.25, null, 783.99, null][sectionStepIndex % 4] ?? null
      : section === 'build'
        ? (SPIN_BUILD_MELODIES[chordIndex === 3 ? 1 : 0][sectionStepIndex % 4] ?? null)
        : chord.melody[sectionStepIndex % 4] ?? null;
    const intensity = section === 'intro' ? 0.72
      : section === 'build' ? 1.2
        : section === 'brake' ? 0.82 : 1;
    steps.push({
      offset,
      duration: Math.min(stepDuration, duration - offset),
      section,
      chordFrequencies: sectionStepIndex % 4 === 0 && hasRoomForPad ? [...chord.pad] : [],
      melodyFrequency: melody,
      bassFrequency: section === 'intro'
        ? sectionStepIndex === 0 ? chord.bass : null
        : section === 'brake'
          ? sectionStepIndex === 0 ? chord.bass : null
          : sectionStepIndex % 2 === 0 ? chord.bass : null,
      kick: section === 'intro' || section === 'brake'
        ? sectionStepIndex === 0
        : section === 'build' ? sectionStepIndex % 2 === 0 : sectionStepIndex % 4 === 0,
      snare: section === 'build'
        ? sectionStepIndex % 2 === 1 && progress < 0.8
        : section === 'groove' && sectionStepIndex % 4 === 2,
      hat: section === 'groove' || section === 'build',
      intensity,
    });
    offset += stepDuration;
    stepIndex += 1;
    sectionStepIndex += 1;
    previousSection = section;
  }
  return steps;
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
  let spinBus: GainNode | null = null;
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
    const length = Math.max(1, Math.round(current.sampleRate * 0.16));
    noiseBuffer = current.createBuffer(1, length, current.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      const fade = 1 - index / channel.length;
      channel[index] = (Math.random() * 2 - 1) * fade * fade;
    }
    return noiseBuffer;
  }

  function stopSpin() {
    for (const source of spinSources) {
      try {
        source.stop();
      } catch {
        // 已按计划停止的节点无需再次处理。
      }
    }
    spinSources.clear();
    spinBus?.disconnect();
    spinBus = null;
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

  function playSpinPad(
    current: AudioContext,
    frequencies: readonly number[],
    start: number,
    duration: number,
    intensity: number,
    destination: AudioNode,
  ) {
    const filter = current.createBiquadFilter();
    const volume = current.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1450, start);
    filter.frequency.exponentialRampToValueAtTime(720, start + duration);
    volume.gain.setValueAtTime(MINIMUM_GAIN, start);
    volume.gain.exponentialRampToValueAtTime(0.014 * intensity, start + Math.min(0.06, duration / 3));
    volume.gain.setValueAtTime(0.014 * intensity, Math.max(start + 0.061, start + duration - 0.16));
    volume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, start + duration);
    filter.connect(volume).connect(destination);

    for (const frequency of frequencies) {
      const oscillator = current.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.detune.value = frequency === frequencies[1] ? 3 : -3;
      oscillator.connect(filter);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.015);
      registerSource(oscillator, spinSources);
    }
  }

  function playSpinPluck(
    current: AudioContext,
    frequency: number,
    start: number,
    duration: number,
    intensity: number,
    destination: AudioNode,
  ) {
    const oscillator = current.createOscillator();
    const filter = current.createBiquadFilter();
    const volume = current.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start);
    filter.type = 'lowpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(2600, start);
    filter.frequency.exponentialRampToValueAtTime(680, start + duration);
    volume.gain.setValueAtTime(MINIMUM_GAIN, start);
    volume.gain.exponentialRampToValueAtTime(0.026 * intensity, start + 0.006);
    volume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, start + duration);
    oscillator.connect(filter).connect(volume).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.012);
    registerSource(oscillator, spinSources);
  }

  function playSpinBass(
    current: AudioContext,
    frequency: number,
    start: number,
    intensity: number,
    destination: AudioNode,
  ) {
    const oscillator = current.createOscillator();
    const volume = current.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(MINIMUM_GAIN, start);
    volume.gain.exponentialRampToValueAtTime(0.032 * intensity, start + 0.008);
    volume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, start + 0.26);
    oscillator.connect(volume).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + 0.275);
    registerSource(oscillator, spinSources);
  }

  function playSpinDrums(
    current: AudioContext,
    step: SpinMusicStep,
    start: number,
    destination: AudioNode,
  ) {
    if (step.kick) {
      const kick = current.createOscillator();
      const kickVolume = current.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(125, start);
      kick.frequency.exponentialRampToValueAtTime(48, start + 0.12);
      kickVolume.gain.setValueAtTime(0.045 * step.intensity, start);
      kickVolume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, start + 0.15);
      kick.connect(kickVolume).connect(destination);
      kick.start(start);
      kick.stop(start + 0.16);
      registerSource(kick, spinSources);
    }

    if (step.hat || step.snare) {
      const noise = current.createBufferSource();
      const filter = current.createBiquadFilter();
      const volume = current.createGain();
      const noiseDuration = step.snare ? 0.105 : 0.035;
      noise.buffer = createNoiseBuffer(current);
      filter.type = step.snare ? 'bandpass' : 'highpass';
      filter.frequency.value = step.snare ? 1750 : 5200;
      filter.Q.value = step.snare ? 0.8 : 0.5;
      volume.gain.setValueAtTime((step.snare ? 0.024 : 0.009) * step.intensity, start);
      volume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, start + noiseDuration);
      noise.connect(filter).connect(volume).connect(destination);
      noise.start(start);
      noise.stop(start + noiseDuration + 0.005);
      registerSource(noise, spinSources);
    }
  }

  function playSpinRiser(
    current: AudioContext,
    start: number,
    end: number,
    destination: AudioNode,
  ) {
    if (end <= start + 0.08) return;
    const oscillator = current.createOscillator();
    const filter = current.createBiquadFilter();
    const volume = current.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(164.81, start);
    oscillator.frequency.exponentialRampToValueAtTime(783.99, end);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, start);
    filter.frequency.exponentialRampToValueAtTime(2600, end);
    volume.gain.setValueAtTime(MINIMUM_GAIN, start);
    volume.gain.exponentialRampToValueAtTime(0.006, start + (end - start) * 0.35);
    volume.gain.exponentialRampToValueAtTime(0.032, end - 0.08);
    volume.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, end);
    oscillator.connect(filter).connect(volume).connect(destination);
    oscillator.start(start);
    oscillator.stop(end + 0.015);
    registerSource(oscillator, spinSources);
  }

  function startSpin(durationMs: number) {
    stopSpin();
    stopResult();
    const current = audioContext();
    if (!current) return;
    resume(current);

    const startedAt = current.currentTime;
    const durationSeconds = Math.max(0.25, durationMs / 1000);
    spinBus = current.createGain();
    spinBus.gain.setValueAtTime(MINIMUM_GAIN, startedAt);
    spinBus.gain.exponentialRampToValueAtTime(0.9, startedAt + Math.min(0.045, durationSeconds / 4));
    spinBus.gain.setValueAtTime(0.9, startedAt + Math.max(0.05, durationSeconds - 0.3));
    spinBus.gain.exponentialRampToValueAtTime(MINIMUM_GAIN, startedAt + durationSeconds);
    spinBus.connect(output(current));

    const plan = spinMusicPlan(durationMs);
    playSpinRiser(current, startedAt + durationSeconds * 0.55, startedAt + durationSeconds * 0.79, spinBus);
    for (const step of plan) {
      const start = startedAt + step.offset;
      if (step.chordFrequencies.length > 0) {
        const padDuration = Math.min(durationSeconds - step.offset, step.duration * 4.15);
        playSpinPad(current, step.chordFrequencies, start, padDuration, step.intensity, spinBus);
      }
      if (step.melodyFrequency !== null) {
        playSpinPluck(
          current,
          step.melodyFrequency,
          start,
          Math.min(0.28, step.duration * 1.25),
          step.intensity,
          spinBus,
        );
      }
      if (step.bassFrequency !== null) {
        playSpinBass(current, step.bassFrequency, start, step.intensity, spinBus);
      }
      playSpinDrums(current, step, start, spinBus);
    }
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
