import { emit, propertyType, type EmitDocument } from './emit';

const fixture: EmitDocument = {
  openapi: '3.0.0',
  info: { title: 'Fixture API', version: '1' },
  components: {
    schemas: {
      Widget: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          label: { type: 'string' },
        },
        required: ['id'],
      },
      Box: {
        type: 'object',
        properties: {
          widget: { $ref: '#/components/schemas/Widget' },
          colors: { type: 'array', items: { type: 'string' } },
        },
      },
      Status: {
        type: 'object',
        properties: {
          state: { enum: ['ok', 'bad'] },
        },
        required: ['state'],
      },
      Selection: {
        type: 'object',
        properties: {
          entries: { type: 'object', additionalProperties: { $ref: '#/components/schemas/Widget' } },
        },
        required: ['entries'],
      },
    },
  },
};

describe('contracts emitter', () => {
  it('maps the primitive schema types onto TypeScript', () => {
    expect(propertyType({ type: 'string' })).toBe('string');
    expect(propertyType({ type: 'boolean' })).toBe('boolean');
    expect(propertyType({ type: 'integer' })).toBe('number');
    expect(propertyType({ type: 'number' })).toBe('number');
  });

  it('resolves $refs and enum unions', () => {
    expect(propertyType({ $ref: '#/components/schemas/Widget' })).toBe('Widget');
    expect(propertyType({ enum: ['ok', 'bad'] })).toBe("'ok' | 'bad'");
  });

  it('types arrays and maps without losing the record shape', () => {
    expect(propertyType({ type: 'array', items: { $ref: '#/components/schemas/Widget' } })).toBe('readonly Widget[]');
    expect(propertyType({ type: 'object', additionalProperties: { $ref: '#/components/schemas/Widget' } })).toBe(
      'Readonly<Record<string, Widget>>',
    );
  });

  it('rejects a reference that does not name a plain identifier', () => {
    // A `$ref` is interpolated into the generated source; it must never be able
    // to smuggle text into the module.
    expect(() => propertyType({ $ref: '#/components/schemas/a; console' })).toThrow(/unsafe schema reference/);
  });

  it('emits one readonly interface per schema in stable order', () => {
    const source = emit(fixture);

    // Sorted by name: Box, Selection, Status, Widget.
    const boxIndex = source.indexOf('export interface Box {');
    const selectionIndex = source.indexOf('export interface Selection {');
    const statusIndex = source.indexOf('export interface Status {');
    const widgetIndex = source.indexOf('export interface Widget {');
    expect(boxIndex).toBeGreaterThan(-1);
    expect(selectionIndex).toBeGreaterThan(boxIndex);
    expect(statusIndex).toBeGreaterThan(selectionIndex);
    expect(widgetIndex).toBeGreaterThan(statusIndex);

    const widget = source.slice(source.indexOf('export interface Widget {') ?? 0);
    expect(widget).toContain('export interface Widget {');
    expect(widget).toContain('  readonly id: number;');
    expect(widget).toContain('  readonly label?: string;');
  });

  it('marks required members and only required members as such', () => {
    const source = emit(fixture);

    expect(source).toContain("  readonly state: 'ok' | 'bad';");
    expect(source).toContain('  readonly colors?: readonly string[];');
    expect(source).toContain('  readonly widget?: Widget;');
    expect(source).toContain('  readonly entries: Readonly<Record<string, Widget>>;');
  });

  it('is deterministic for the same input', () => {
    expect(emit(fixture)).toBe(emit(fixture));
    expect(emit(fixture)).toBe(emit(JSON.parse(JSON.stringify(fixture)) as EmitDocument));
  });
});
