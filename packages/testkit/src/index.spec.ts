import { fixtureUuid, fixtureUuids } from './index';

describe('fixture identity', () => {
  it('produces a UUID that is unique within a test', () => {
    const first = fixtureUuid();
    const second = fixtureUuid();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first).not.toBe(second);
  });

  it('does not depend on execution order', () => {
    // Master Plan §36.1 T-6: no test may depend on execution order.
    const generatedOutOfOrder = [fixtureUuid(), fixtureUuid(), fixtureUuid()];

    expect(new Set(generatedOutOfOrder).size).toBe(3);
  });

  it('builds the requested number of distinct identifiers', () => {
    expect(fixtureUuids(5)).toHaveLength(5);
    expect(new Set(fixtureUuids(5)).size).toBe(5);
  });

  it('returns an empty collection for a count of zero', () => {
    expect(fixtureUuids(0)).toEqual([]);
  });

  it('rejects a count that is not a non-negative integer', () => {
    expect(() => fixtureUuids(-1)).toThrow(RangeError);
    expect(() => fixtureUuids(1.5)).toThrow(RangeError);
  });
});
