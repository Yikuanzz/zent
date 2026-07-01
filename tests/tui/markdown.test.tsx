import { test, expect, describe } from 'bun:test';
import { splitIntoBlocks, type ParsedTable } from '../../src/tui/markdown.tsx';

describe('splitIntoBlocks', () => {
  test('parses a standard GFM table', () => {
    const text = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
    const blocks = splitIntoBlocks(text, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('table');
    const table = (blocks[0] as { table: ParsedTable }).table;
    expect(table.headers).toEqual(['Name', 'Age']);
    expect(table.aligns).toEqual(['left', 'left']);
    expect(table.rows).toEqual([
      ['Alice', '30'],
      ['Bob', '25'],
    ]);
  });

  test('recognizes column alignments', () => {
    const text = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
    const blocks = splitIntoBlocks(text, false);
    expect(blocks).toHaveLength(1);
    const table = (blocks[0] as { table: ParsedTable }).table;
    expect(table.aligns).toEqual(['left', 'center', 'right']);
  });

  test('does not treat a single pipe line as a table', () => {
    const text = 'foo | bar\nbaz';
    const blocks = splitIntoBlocks(text, false);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('paragraph');
  });

  test('does not parse tables while streaming', () => {
    const text = '| Name | Age |\n| --- | --- |\n| Alice | 30 |';
    const blocks = splitIntoBlocks(text, true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('paragraph');
    expect((blocks[0] as { lines: string[] }).lines).toHaveLength(3);
  });

  test('preserves paragraphs before and after a table', () => {
    const text = 'Intro line\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro line';
    const blocks = splitIntoBlocks(text, false);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.type).toBe('paragraph');
    expect(blocks[1]!.type).toBe('table');
    expect(blocks[2]!.type).toBe('paragraph');
  });

  test('pads short rows to match header column count', () => {
    const text = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |';
    const blocks = splitIntoBlocks(text, false);
    const table = (blocks[0] as { table: ParsedTable }).table;
    expect(table.rows[0]).toEqual(['1', '2', '']);
  });
});
