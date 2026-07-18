export type AnimationStyle = 'simple' | 'luxury' | 'threeD';
export type DrawMode = 'selected' | 'roulette';
export type DrawOutcome = 'selected' | 'retry' | 'eliminated' | 'winner';

export interface Prize {
  id: string;
  name: string;
  weight: number;
  color: string;
  enabled: boolean;
}

export interface WheelOption {
  id: string;
  label: string;
  weight: number;
  color: string;
  isRetry: boolean;
}

export interface DrawRecord {
  id: string;
  sequence: number;
  round: number;
  attempt: number;
  optionId: string;
  label: string;
  outcome: DrawOutcome;
  detail: string;
  mode: DrawMode;
  createdAt: number;
  source: 'single' | 'batch';
}

export interface SimulationEvent {
  round: number;
  attempt: number;
  optionId: string;
  label: string;
  outcome: DrawOutcome;
  detail: string;
}

export interface BatchSimulation {
  mode: DrawMode;
  requested: number;
  completed: number;
  attempts: number;
  retryCount: number;
  prizeCounts: Record<string, number>;
  events: SimulationEvent[];
}
