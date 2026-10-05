import { CONTRACT_VERSION } from '@my-shop/contracts';
import { describeApi } from './main';

describe('backend bootstrap descriptor', () => {
  it('reports the same contract version as the shared package', () => {
    // A mismatch here is contract drift, which Master Plan §7.1 makes a
    // compile-time failure. The assertion keeps it visible if resolution ever
    // regresses to two copies of the package.
    expect(describeApi().contractVersion).toBe(CONTRACT_VERSION);
  });

  it('serves the versioned REST namespace', () => {
    expect(describeApi().namespace).toBe('/api/v1');
  });
});
