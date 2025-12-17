import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Session Parser', () => {
  test('should parse sample fixture', () => {
    const fixturePath = join(__dirname, '..', 'fixtures', 'sample-session.jsonl');
    const content = readFileSync(fixturePath, 'utf-8');
    const lines = content.trim().split('\n');

    assert.ok(lines.length > 0, 'Fixture should have lines');

    // Parse each line as JSON
    const parsed = lines.map(line => JSON.parse(line));

    // Check structure
    assert.ok(parsed.some(p => p.type === 'summary'), 'Should have summary');
    assert.ok(parsed.some(p => p.type === 'user'), 'Should have user messages');
    assert.ok(parsed.some(p => p.type === 'assistant'), 'Should have assistant messages');
    assert.ok(parsed.some(p => p.type === 'tool_use'), 'Should have tool uses');
    assert.ok(parsed.some(p => p.type === 'result'), 'Should have result');
  });

  test('should extract token counts from result', () => {
    const fixturePath = join(__dirname, '..', 'fixtures', 'sample-session.jsonl');
    const content = readFileSync(fixturePath, 'utf-8');
    const lines = content.trim().split('\n');
    const parsed = lines.map(line => JSON.parse(line));

    const result = parsed.find(p => p.type === 'result');
    assert.ok(result, 'Should have result entry');
    assert.ok(result.cost, 'Result should have cost');
    assert.ok(result.cost.input_tokens > 0, 'Should have input tokens');
    assert.ok(result.cost.output_tokens > 0, 'Should have output tokens');
  });

  test('should have valid timestamps', () => {
    const fixturePath = join(__dirname, '..', 'fixtures', 'sample-session.jsonl');
    const content = readFileSync(fixturePath, 'utf-8');
    const lines = content.trim().split('\n');
    const parsed = lines.map(line => JSON.parse(line));

    for (const entry of parsed) {
      assert.ok(entry.timestamp, `Entry of type ${entry.type} should have timestamp`);
      const date = new Date(entry.timestamp);
      assert.ok(!isNaN(date.getTime()), 'Timestamp should be valid date');
    }
  });
});
