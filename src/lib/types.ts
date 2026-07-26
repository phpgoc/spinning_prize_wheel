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

export type CommonSelectionPrize = Omit<Prize, 'weight'>;

export interface CommonSelection {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  prizes: CommonSelectionPrize[];
}

export interface SavedDraw {
  version: 1;
  id: string;
  createdAt: number;
  mode: DrawMode;
  rewardAmount: number;
  prizes: Prize[];
  records: DrawRecord[];
}

export interface WheelOption {
  id: string;
  slotId?: string;
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
  rewardAmount: number;
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

export interface AliasRecord {
  id: number;
  name: string;
  userId: number;
}

export interface RankedUser {
  id: number;
  name: string;
  rank: number;
  aliases: AliasRecord[];
}

export interface ResolvedGroupingName {
  inputName: string;
  known: boolean;
  userId: number | null;
  canonicalName: string | null;
  rank: number | null;
}

export interface SavedGrouping {
  id: string;
  createdAt: number;
  title?: string | null;
  input: unknown;
  result: unknown;
}

/** 历史列表只返回轻量元数据；完整内容在查看、编辑或导出时按 id 加载。 */
export interface HistoryListItem {
  id: string;
  createdAt: number;
  displayName: string;
}
