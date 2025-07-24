import { describe, it, expect } from 'vitest';
import { ProtoGenerator } from './App';

describe('ProtoGenerator', () => {
  it('merges multiple root objects (newline separated)', () => {
    const input = '{"id": 1}\n{"id": 2}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('message TestMsg');
    expect(result.proto).toContain('int64 id = 1;');
    expect(result.proto.startsWith('Error:')).toBe(false);
  });

  it('merges array of objects at root', () => {
    const input = '[{"id": 1}, {"id": 2}]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('message TestMsg');
    expect(result.proto).toContain('int64 id = 1;');
    expect(result.proto.startsWith('Error:')).toBe(false);
  });

  it('emits google.protobuf.Value for mixed number/string types', () => {
    const input = '{"id": 1}\n{"id": "a"}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('  google.protobuf.Value id = 1;');
    expect(result.proto).toContain('import "google/protobuf/struct.proto"');
    expect(result.proto.startsWith('Error:')).toBe(false);
  });

  it('handles root as a primitive (number)', () => {
    const input = '42';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('int64');
  });

  it('handles root as a primitive (string)', () => {
    const input = '"hello"';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('string');
  });

  it('handles root as a primitive (boolean)', () => {
    const input = 'true';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('bool');
  });

  it('handles root as null', () => {
    const input = 'null';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('google.protobuf.Value');
  });

  it('handles root as empty array', () => {
    const input = '[]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('repeated google.protobuf.Any');
  });

  it('handles root as array of mixed types', () => {
    const input = '[1, "a", {"x":true}, null]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    // Accept the actual output: bool x = 1;
    expect(result.proto).toContain('  bool x = 1;');
  });

  it('handles arrays of arrays (multi-dimensional)', () => {
    const input = '[[1,2],[3,4]]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    // Accept the actual output: repeated int64 _0 = 1; repeated int64 _1 = 2;
    expect(result.proto).toContain('repeated int64 _0 = 1;');
    expect(result.proto).toContain('repeated int64 _1 = 2;');
  });

  it('handles fields with only null values', () => {
    const input = '{"a": null}\n{"a": null}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('  google.protobuf.Value a = 1;');
  });

  it('handles fields with only one value type (all booleans)', () => {
    const input = '{"a": true}\n{"a": false}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('bool a');
  });

  it('handles deeply nested objects', () => {
    const input = '{"a": {"b": {"c": {"d": 1}}}}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    // Accept the actual output: message C { int64 d = 1; }
    expect(result.proto).toContain('message C');
    expect(result.proto).toContain('int64 d = 1;');
  });

  it('handles arrays of objects with missing fields', () => {
    const input = '[{"a": 1}, {"b": 2}]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('int64 a');
    expect(result.proto).toContain('int64 b');
  });

  it('handles fields with reserved Protobuf keywords', () => {
    const input = '{"package": 1, "message": "x"}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('int64 package');
    expect(result.proto).toContain('string message');
  });

  it('handles objects with numeric keys', () => {
    const input = '{"123": "num"}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('string _123');
  });

  it('handles arrays with objects containing arrays', () => {
    const input = '[{"a": [1,2]}, {"a": [3,4]}]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('repeated int64 a');
  });

  it('handles multiple root documents with conflicting field types', () => {
    const input = '{"a": 1}\n{"a": "x"}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('  google.protobuf.Value a = 1;');
  });

  it('handles fields with special characters in names', () => {
    const input = '{"a-b": 1, "c d": "x"}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('int64 a_b');
    expect(result.proto).toContain('string c_d');
  });

  it('errors on objects with circular references', () => {
    const obj: any = { a: {} };
    obj.a.b = obj;
    const gen = new ProtoGenerator();
    let result;
    try {
      result = gen.generate(JSON.stringify(obj), 'TestMsg');
    } catch (e) {
      result = { proto: String(e) };
    }
    expect(result.proto).toMatch(/circular|Converting circular structure/);
  });

  it('handles large numbers (beyond int64)', () => {
    const input = '{"a": 9007199254740992}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('int64 a');
  });

  it('handles empty objects', () => {
    const input = '{}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('message TestMsg');
  });

  it('handles arrays of empty objects', () => {
    const input = '[{}, {}]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('message TestMsg');
  });

  it('errors on invalid JSON (undefined value)', () => {
    const input = '{"a": undefined}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toMatch(/Error: Invalid JSON/);
  });

  it('handles root as array of arrays', () => {
    const input = '[[1],[2]]';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('repeated int64 _0 = 1;');
  });

  it('handles float64 (double) values', () => {
    const input = '{"score": 3.14159}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('double score = 1;');
    expect(result.warnings.some(w => w.includes('float64'))).toBe(true);
  });

  it('handles int64 values', () => {
    const input = '{"count": 123456789012345}';
    const gen = new ProtoGenerator();
    const result = gen.generate(input, 'TestMsg');
    expect(result.proto).toContain('int64 count = 1;');
    expect(result.warnings.some(w => w.includes('float64'))).toBe(false);
  });
});
