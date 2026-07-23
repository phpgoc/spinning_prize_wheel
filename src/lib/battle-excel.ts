import ExcelJS from 'exceljs';
import {
  battleRoundLabel,
  battleTmpWinnerId,
  type BattleTmpMatch,
  type BattleTmpSnapshot,
} from './battle';

const HEADER_FILL = 'FFE7EFBC';
const SECTION_FILL = 'FF30352A';
const SLOT_FILL = 'FFF7F8F1';
const WINNER_FILL = 'FFF0F7CF';
const BORDER_COLOR = 'FFABB296';

/** Excel 面向人工查看，使用合并单元格绘制签表，不复刻数据库行结构。 */
export async function createBattleBracketWorkbook(snapshot: BattleTmpSnapshot): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '转盘';
  workbook.created = new Date(snapshot.updatedAt);
  const worksheet = workbook.addWorksheet('对战签表', {
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    },
    views: [{ state: 'frozen', ySplit: 3 }],
  });
  const nameById = new Map(snapshot.participants.map((participant) => [participant.id, participant.name]));
  const singleLike = snapshot.format === 'single-elimination' || snapshot.format === 'avoid-first-pair';
  const singleLevels = singleLike
    ? groupedLevels(snapshot.matches.filter((match) => match.stage === 'single'), snapshot.format, 'single')
    : [];
  const singleLayout = singleLike ? createSingleExcelLayout(singleLevels.length) : null;
  const doubleLevels = snapshot.format === 'double-elimination'
    ? {
      winner: groupedLevels(snapshot.matches.filter((match) => match.stage === 'winner'), snapshot.format, 'winner'),
      loser: groupedLevels(snapshot.matches.filter((match) => match.stage === 'loser'), snapshot.format, 'loser'),
      final: groupedLevels(snapshot.matches.filter((match) => match.stage === 'final'), snapshot.format, 'final'),
    }
    : null;
  const doubleLayout = doubleLevels
    ? createDoubleExcelLayout(
      Math.max(doubleLevels.winner.length, doubleLevels.loser.length),
      doubleLevels.final.length,
    )
    : null;
  const lastColumn = singleLayout?.lastColumn ?? doubleLayout?.lastColumn ?? 2;

  worksheet.mergeCells(1, 1, 1, lastColumn);
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = `${battleFormatLabel(snapshot)}对战签表`;
  titleCell.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = solidFill(SECTION_FILL);
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells(2, 1, 2, lastColumn);
  const metadataCell = worksheet.getCell(2, 1);
  metadataCell.value = [
    `${snapshot.participantCount} 人`,
    `${snapshot.bracketSize} 签位`,
    snapshot.orderMode === 'rank' ? '按排名' : '按输入顺序',
    `规则 v${snapshot.rulesVersion}`,
    new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(snapshot.updatedAt)),
  ].join(' · ');
  metadataCell.font = { size: 10, color: { argb: 'FF59604E' } };
  metadataCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(2).height = 22;

  const startRow = 4;
  if (singleLayout) {
    renderSingleEliminationSection(
      worksheet,
      snapshot,
      singleLevels,
      singleLayout,
      startRow,
      nameById,
    );
  } else if (doubleLevels && doubleLayout) {
    renderDoubleEliminationSection(
      worksheet,
      snapshot,
      doubleLevels,
      doubleLayout,
      startRow,
      nameById,
    );
  }

  for (let column = 1; column <= lastColumn; column += 1) {
    worksheet.getColumn(column).width = singleLayout
      ? singleLayout.spacerColumns.has(column)
        ? 3
        : column === singleLayout.final.name
          ? 24
          : column === singleLayout.final.score
            ? 10
            : singleLayout.scoreColumns.has(column) ? 8 : 18
      : doubleLayout
        ? doubleLayout.spacerColumns.has(column)
          ? 3
          : doubleLayout.emphasisColumns.has(column)
            ? doubleLayout.scoreColumns.has(column) ? 10 : 24
            : doubleLayout.scoreColumns.has(column) ? 8 : 18
        : 18;
  }
  worksheet.properties.defaultRowHeight = 22;
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

interface BattleExcelSection {
  title: string;
  levels: { label: string; matches: BattleTmpMatch[] }[];
}

interface SingleExcelRoundColumns {
  name: number;
  score: number;
}

interface SingleExcelLayout {
  lastColumn: number;
  left: SingleExcelRoundColumns[];
  right: SingleExcelRoundColumns[];
  final: SingleExcelRoundColumns;
  spacerColumns: Set<number>;
  scoreColumns: Set<number>;
}

function createSingleExcelLayout(levelCount: number): SingleExcelLayout {
  const sideLevelCount = Math.max(0, levelCount - 1);
  const lastColumn = sideLevelCount * 6 + 2;
  const left = Array.from({ length: sideLevelCount }, (_, index) => ({
    name: index * 3 + 1,
    score: index * 3 + 2,
  }));
  const right = Array.from({ length: sideLevelCount }, (_, index) => ({
    name: lastColumn - index * 3,
    score: lastColumn - index * 3 - 1,
  }));
  const final = { name: sideLevelCount * 3 + 1, score: sideLevelCount * 3 + 2 };
  const spacerColumns = new Set([
    ...left.map((columns) => columns.score + 1),
    ...right.map((columns) => columns.score - 1),
  ]);
  const scoreColumns = new Set([
    ...left.map((columns) => columns.score),
    ...right.map((columns) => columns.score),
    final.score,
  ]);
  return { lastColumn, left, right, final, spacerColumns, scoreColumns };
}

interface DoubleExcelLayout {
  lastColumn: number;
  groupRounds: SingleExcelRoundColumns[];
  finals: SingleExcelRoundColumns[];
  champion: SingleExcelRoundColumns;
  spacerColumns: Set<number>;
  scoreColumns: Set<number>;
  emphasisColumns: Set<number>;
}

function createDoubleExcelLayout(groupLevelCount: number, finalLevelCount: number): DoubleExcelLayout {
  const blockCount = groupLevelCount + finalLevelCount + 1;
  const columns = Array.from({ length: blockCount }, (_, index) => ({
    name: index * 3 + 1,
    score: index * 3 + 2,
  }));
  const groupRounds = columns.slice(0, groupLevelCount);
  const finals = columns.slice(groupLevelCount, groupLevelCount + finalLevelCount);
  const champion = columns.at(-1)!;
  const spacerColumns = new Set(
    Array.from({ length: blockCount - 1 }, (_, index) => index * 3 + 3),
  );
  const scoreColumns = new Set(columns.map((round) => round.score));
  const emphasisColumns = new Set([
    ...finals.flatMap((round) => [round.name, round.score]),
    champion.name,
    champion.score,
  ]);
  return {
    lastColumn: blockCount * 3 - 1,
    groupRounds,
    finals,
    champion,
    spacerColumns,
    scoreColumns,
    emphasisColumns,
  };
}

function renderDoubleEliminationSection(
  worksheet: ExcelJS.Worksheet,
  snapshot: BattleTmpSnapshot,
  levels: {
    winner: BattleExcelSection['levels'];
    loser: BattleExcelSection['levels'];
    final: BattleExcelSection['levels'];
  },
  layout: DoubleExcelLayout,
  startRow: number,
  nameById: Map<number, string>,
): number {
  const groupLastColumn = layout.groupRounds.at(-1)?.score ?? 2;
  const winnerTitleRow = startRow;
  const winnerHeaderRow = winnerTitleRow + 1;
  const winnerDataStartRow = winnerHeaderRow + 1;
  const winnerDataRows = Math.max(4, ...levels.winner.map((level) => roundOccupiedRows(level.matches.length)));
  const winnerDataEndRow = winnerDataStartRow + winnerDataRows - 1;

  renderSectionTitle(worksheet, winnerTitleRow, groupLastColumn, '胜者组');
  levels.winner.forEach((level, levelIndex) => {
    const columns = layout.groupRounds[levelIndex];
    renderRoundHeader(worksheet, winnerHeaderRow, columns, level.label);
    renderAlignedRound(
      worksheet,
      level.matches,
      columns,
      winnerDataStartRow,
      winnerDataRows,
      'bottom',
      nameById,
    );
  });

  const loserTitleRow = winnerDataEndRow + 2;
  const loserHeaderRow = loserTitleRow + 1;
  const loserDataStartRow = loserHeaderRow + 1;
  const loserDataRows = Math.max(4, ...levels.loser.map((level) => roundOccupiedRows(level.matches.length)));
  const loserDataEndRow = loserDataStartRow + loserDataRows - 1;

  renderSectionTitle(worksheet, loserTitleRow, groupLastColumn, '败者组');
  levels.loser.forEach((level, levelIndex) => {
    const columns = layout.groupRounds[levelIndex];
    renderRoundHeader(worksheet, loserHeaderRow, columns, level.label);
    renderAlignedRound(
      worksheet,
      level.matches,
      columns,
      loserDataStartRow,
      loserDataRows,
      'top',
      nameById,
    );
  });

  const winnerFinalStartRow = winnerDataEndRow - 3;
  const loserFinalStartRow = loserDataStartRow;
  const convergingCenter = (
    winnerFinalStartRow + 1.5 + loserFinalStartRow + 1.5
  ) / 2;
  const finalStartRow = Math.round(convergingCenter - 1.5);
  const finalHeaderRow = finalStartRow - 1;
  levels.final.forEach((level, levelIndex) => {
    const columns = layout.finals[levelIndex];
    renderRoundHeader(
      worksheet,
      finalHeaderRow,
      columns,
      levelIndex === 0 ? '总决赛' : '必要时重赛',
    );
    renderSingleRound(
      worksheet,
      level.matches,
      columns,
      finalStartRow,
      4,
      nameById,
    );
  });

  renderRoundHeader(worksheet, finalHeaderRow, layout.champion, '总冠军');
  renderDoubleChampion(
    worksheet,
    snapshot,
    layout.champion,
    finalStartRow,
    finalStartRow + 3,
    nameById,
  );
  return loserDataEndRow + 2;
}

function roundOccupiedRows(matchCount: number): number {
  return Math.max(0, matchCount * 4 + Math.max(0, matchCount - 1));
}

function renderSectionTitle(
  worksheet: ExcelJS.Worksheet,
  row: number,
  lastColumn: number,
  title: string,
) {
  worksheet.mergeCells(row, 1, row, lastColumn);
  const sectionCell = worksheet.getCell(row, 1);
  sectionCell.value = title;
  sectionCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sectionCell.fill = solidFill(SECTION_FILL);
  sectionCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
}

function renderAlignedRound(
  worksheet: ExcelJS.Worksheet,
  matches: BattleTmpMatch[],
  columns: SingleExcelRoundColumns,
  dataStartRow: number,
  dataRows: number,
  alignment: 'top' | 'bottom',
  nameById: Map<number, string>,
) {
  const occupiedRows = roundOccupiedRows(matches.length);
  const alignedStartRow = dataStartRow + (alignment === 'bottom' ? dataRows - occupiedRows : 0);
  matches.forEach((match, matchIndex) => {
    const matchStartRow = alignedStartRow + matchIndex * 5;
    renderBattleSlot(
      worksheet,
      matchStartRow,
      matchStartRow + 1,
      columns.name,
      columns.score,
      match.up,
      match.upResult,
      battleTmpWinnerId(match) === match.up,
      nameById,
    );
    renderBattleSlot(
      worksheet,
      matchStartRow + 2,
      matchStartRow + 3,
      columns.name,
      columns.score,
      match.down,
      match.downResult,
      battleTmpWinnerId(match) === match.down,
      nameById,
    );
  });
}

function renderDoubleChampion(
  worksheet: ExcelJS.Worksheet,
  snapshot: BattleTmpSnapshot,
  columns: SingleExcelRoundColumns,
  startRow: number,
  endRow: number,
  nameById: Map<number, string>,
) {
  worksheet.mergeCells(startRow, columns.name, endRow, columns.name);
  worksheet.mergeCells(startRow, columns.score, endRow, columns.score);
  const championId = battleChampionId(snapshot);
  const nameCell = worksheet.getCell(startRow, columns.name);
  const labelCell = worksheet.getCell(startRow, columns.score);
  nameCell.value = championId === null
    ? '等待总决赛'
    : nameById.get(championId) ?? `#${championId}`;
  labelCell.value = '冠军';
  for (const cell of [nameCell, labelCell]) {
    cell.font = {
      bold: true,
      color: { argb: championId === null ? 'FF69705D' : 'FF3E4B16' },
    };
    cell.fill = solidFill(HEADER_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = thinBorder();
  }
}

function renderSingleEliminationSection(
  worksheet: ExcelJS.Worksheet,
  snapshot: BattleTmpSnapshot,
  levels: BattleExcelSection['levels'],
  layout: SingleExcelLayout,
  startRow: number,
  nameById: Map<number, string>,
): number {
  const sectionCell = worksheet.getCell(startRow, 1);
  worksheet.mergeCells(startRow, 1, startRow, layout.lastColumn);
  sectionCell.value = snapshot.format === 'avoid-first-pair' ? '同组不对战 1 对 2' : '单败';
  sectionCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sectionCell.fill = solidFill(SECTION_FILL);
  sectionCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const headerRow = startRow + 1;
  const dataStartRow = startRow + 2;
  const firstSideMatchCount = Math.max(1, Math.ceil((levels[0]?.matches.length ?? 2) / 2));
  // 每场比赛固定占四行，相邻比赛之间至少留一整行，后续轮次在对应区域居中。
  const dataRows = Math.max(7, firstSideMatchCount * 4 + (firstSideMatchCount - 1));
  const sideLevels = levels.slice(0, -1);

  sideLevels.forEach((level, levelIndex) => {
    const sideMatchCount = Math.ceil(level.matches.length / 2);
    const leftMatches = level.matches.slice(0, sideMatchCount);
    const rightMatches = level.matches.slice(sideMatchCount);
    const label = snapshot.format === 'avoid-first-pair' && levelIndex === 0
      ? '1 对 2'
      : level.label;

    renderRoundHeader(worksheet, headerRow, layout.left[levelIndex], label);
    renderRoundHeader(worksheet, headerRow, layout.right[levelIndex], label);
    renderSingleRound(
      worksheet,
      leftMatches,
      layout.left[levelIndex],
      dataStartRow,
      dataRows,
      nameById,
    );
    renderSingleRound(
      worksheet,
      rightMatches,
      layout.right[levelIndex],
      dataStartRow,
      dataRows,
      nameById,
    );
  });

  const finalLevel = levels.at(-1);
  renderRoundHeader(worksheet, headerRow, layout.final, '决赛');
  if (finalLevel?.matches[0]) {
    renderSingleRound(
      worksheet,
      [finalLevel.matches[0]],
      layout.final,
      dataStartRow,
      dataRows,
      nameById,
      3,
    );
  }

  const championRow = dataStartRow + dataRows + 1;
  const championId = battleChampionId(snapshot);
  const championNameCell = worksheet.getCell(championRow, layout.final.name);
  const championLabelCell = worksheet.getCell(championRow, layout.final.score);
  championNameCell.value = championId === null
    ? '等待决赛'
    : nameById.get(championId) ?? `#${championId}`;
  championLabelCell.value = '冠军';
  for (const cell of [championNameCell, championLabelCell]) {
    cell.font = {
      bold: true,
      color: { argb: championId === null ? 'FF69705D' : 'FF3E4B16' },
    };
    cell.fill = solidFill(HEADER_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = thinBorder();
  }
  worksheet.getRow(championRow).height = 30;

  return championRow + 2;
}

function renderRoundHeader(
  worksheet: ExcelJS.Worksheet,
  row: number,
  columns: SingleExcelRoundColumns,
  label: string,
) {
  worksheet.mergeCells(row, columns.name, row, columns.score);
  const header = worksheet.getCell(row, Math.min(columns.name, columns.score));
  header.value = label;
  header.font = { bold: true, color: { argb: 'FF30352A' } };
  header.fill = solidFill(HEADER_FILL);
  header.alignment = { vertical: 'middle', horizontal: 'center' };
  header.border = thinBorder();
}

function renderSingleRound(
  worksheet: ExcelJS.Worksheet,
  matches: BattleTmpMatch[],
  columns: SingleExcelRoundColumns,
  dataStartRow: number,
  dataRows: number,
  nameById: Map<number, string>,
  slotRows = 2,
) {
  matches.forEach((match, matchIndex) => {
    const matchRows = slotRows * 2;
    const matchStart = dataStartRow + Math.max(0, Math.round(
      (matchIndex + 0.5) * dataRows / matches.length - matchRows / 2,
    ));
    renderBattleSlot(
      worksheet,
      matchStart,
      matchStart + slotRows - 1,
      columns.name,
      columns.score,
      match.up,
      match.upResult,
      battleTmpWinnerId(match) === match.up,
      nameById,
    );
    renderBattleSlot(
      worksheet,
      matchStart + slotRows,
      matchStart + matchRows - 1,
      columns.name,
      columns.score,
      match.down,
      match.downResult,
      battleTmpWinnerId(match) === match.down,
      nameById,
    );
  });
}

function groupedLevels(
  matches: BattleTmpMatch[],
  format: BattleTmpSnapshot['format'],
  stage: BattleTmpMatch['stage'],
) {
  const byLevel = new Map<number, BattleTmpMatch[]>();
  for (const match of matches) {
    const levelMatches = byLevel.get(match.level) ?? [];
    levelMatches.push(match);
    byLevel.set(match.level, levelMatches);
  }
  return [...byLevel.entries()]
    .sort(([left], [right]) => left - right)
    .map(([level, levelMatches]) => ({
      matches: levelMatches.sort((left, right) => left.position - right.position),
      label: battleRoundLabel(format, stage, level, levelMatches.length).replace('1对2', '1 对 2'),
    }));
}

function renderBattleSlot(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  nameColumn: number,
  scoreColumn: number,
  participantId: number | null,
  score: number | null,
  winner: boolean,
  nameById: Map<number, string>,
) {
  if (endRow > startRow) {
    worksheet.mergeCells(startRow, nameColumn, endRow, nameColumn);
    worksheet.mergeCells(startRow, scoreColumn, endRow, scoreColumn);
  }
  const nameCell = worksheet.getCell(startRow, nameColumn);
  const scoreCell = worksheet.getCell(startRow, scoreColumn);
  nameCell.value = participantId === null ? '等待上游' : nameById.get(participantId) ?? `#${participantId}`;
  scoreCell.value = score ?? '';
  for (const cell of [nameCell, scoreCell]) {
    cell.font = { bold: winner, color: { argb: participantId === null ? 'FF979C8D' : 'FF30352A' } };
    cell.fill = solidFill(winner ? WINNER_FILL : SLOT_FILL);
    cell.alignment = { vertical: 'middle', horizontal: 'center', indent: cell === nameCell ? 1 : 0 };
    cell.border = thinBorder();
  }
}

function battleChampionId(snapshot: BattleTmpSnapshot): number | null {
  if (snapshot.format === 'single-elimination' || snapshot.format === 'avoid-first-pair') {
    const final = snapshot.matches
      .filter((match) => match.stage === 'single')
      .sort((left, right) => right.level - left.level)[0];
    return final ? battleTmpWinnerId(final) : null;
  }
  const reset = snapshot.matches.find((match) => match.stage === 'final' && match.level === 2);
  const grandFinal = snapshot.matches.find((match) => match.stage === 'final' && match.level === 1);
  if (!reset) return grandFinal ? battleTmpWinnerId(grandFinal) : null;
  if (reset?.status === 'completed') return battleTmpWinnerId(reset);
  if (reset?.status !== 'skipped') return null;
  return grandFinal ? battleTmpWinnerId(grandFinal) : null;
}

function battleFormatLabel(snapshot: BattleTmpSnapshot): string {
  if (snapshot.format === 'single-elimination') return '单败';
  if (snapshot.format === 'double-elimination') return '双败';
  return '同组不对战1对2';
}

function solidFill(color: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side = { style: 'thin' as const, color: { argb: BORDER_COLOR } };
  return { top: side, left: side, bottom: side, right: side };
}
