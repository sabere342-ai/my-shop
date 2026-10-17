/**
 * The offline-mutation ingress re-validator, in isolation (Master Plan §9.4
 * T-8…T-12; M2-S4).
 *
 * The §38.16 push boundary proves a batch is authenticated and asserts its own
 * tenant — nothing about what its actor may *still* do. This validator is the
 * per-mutation re-proof that runs inside the ledger's tenant transaction, and
 * every case here pins one of its four refusals or its one admission:
 *
 * - no verified actor in the trusted context → `UNAUTHENTICATED` (T-8);
 * - no live membership for the actor → the §11 reader's
 *   `ORGANIZATION_FORBIDDEN`, carried through unchanged (T-9);
 * - an admission without a mapped permission, or a live permission set without
 *   the required one → `PERMISSION_DENIED` (T-10/T-11);
 * - all three proven → admitted, silently (T-12).
 *
 * The authorization reader is a double that records its arguments: the unit here
 * proves the *validator's contract* — which transaction it reads inside, which
 * identity it consults, which error vocabulary it speaks — exactly once. The
 * real membership/permission read and its end-to-end composition with the ledger
 * are proven against real PostgreSQL in the acceptance suite (§36.1 T-2), which
 * is also where the double-style substitution is structurally absent: this
 * validator's production semantics are the database-backed ones the acceptance
 * cases drive.
 */

import type { Prisma } from '@prisma/client';
import { DomainError } from '../../errors/domain.error';
import { ERROR_CODES } from '../../errors/problem';
import {
  MembershipPermissionRevalidator,
  requiredPermissionOf,
  type SyncIngressRevalidator,
} from './ingress-revalidation';
import type { EffectiveAuthorization } from '../../tenancy/authorization/authorization.service';
import type { AuthorizationService } from '../../tenancy/authorization/authorization.service';
import type { MutationPayload } from '../sync.contract';
import type { SyncTrustedContext } from './sync-auth';

/** The canonical ids the fixtures use; shapes are validated before any DB call. */
const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';

/** A fake transaction client: only ever handed to the reader double. */
const TX = {} as Prisma.TransactionClient;

/** One recorded admissible mutation (the map's only entry, §9.4). */
function saleCreate(overrides: Partial<Record<string, unknown>> = {}): MutationPayload {
  return {
    mutationId: '44444444-4444-4444-8444-444444444444',
    organizationId: ORG,
    deviceId: DEVICE,
    actorUserId: ACTOR,
    aggregateType: 'SALE',
    aggregateId: '55555555-5555-4555-8555-555555555555',
    operationType: 'CREATE',
    payload: {},
    ...overrides,
  } as MutationPayload;
}

/** The reader double: records the (tx, organizationId, userId) it was handed. */
interface CapturedReader {
  service: AuthorizationService;
  readEffectiveInTransaction: jest.Mock<Promise<EffectiveAuthorization>, [Prisma.TransactionClient, string, string]>;
}

function authorizationReturning(effective: EffectiveAuthorization): CapturedReader {
  const readEffectiveInTransaction = jest.fn().mockResolvedValue(effective);
  const service = { readEffectiveInTransaction } as unknown as AuthorizationService;
  return { service, readEffectiveInTransaction };
}

/** The validator under test, built over the given reader double. */
function validatorOf(reader: AuthorizationService): SyncIngressRevalidator {
  return new MembershipPermissionRevalidator(reader);
}

const effectiveWith = (permissions: readonly string[]): EffectiveAuthorization => ({
  organizationId: ORG,
  userId: ACTOR,
  isOwner: false,
  role: null,
  permissions,
  permissionsVersion: 0,
});

const SELLER: EffectiveAuthorization = effectiveWith(['sales.create']);

describe('MembershipPermissionRevalidator', () => {
  function context(actorUserId?: string): SyncTrustedContext {
    return {
      organizationId: ORG,
      deviceId: DEVICE,
      ...(actorUserId === undefined ? {} : { actorUserId }),
    };
  }

  it('T-12: a verified actor with a live membership and the required permission is admitted silently', async () => {
    const { service, readEffectiveInTransaction } = authorizationReturning(SELLER);

    await expect(validatorOf(service).revalidate(TX, context(ACTOR), saleCreate())).resolves.toBeUndefined();

    // One read, of the trusted identity, inside the caller's transaction —
    // the same tx the effect will commit in, never a second moment or scope.
    expect(readEffectiveInTransaction).toHaveBeenCalledTimes(1);
    expect(readEffectiveInTransaction).toHaveBeenCalledWith(TX, ORG, ACTOR);
  });

  it('T-8: a verified context without an actor is refused UNAUTHENTICATED without touching the reader', async () => {
    const { service, readEffectiveInTransaction } = authorizationReturning(SELLER);

    await expect(
      validatorOf(service).revalidate(TX, context(undefined), saleCreate({ actorUserId: ACTOR })),
    ).rejects.toMatchObject({ name: 'MutationRejectedError', code: ERROR_CODES.UNAUTHENTICATED });

    // The §38.16 key point: the body's actorUserId is an assertion, not authority.
    if (readEffectiveInTransaction.mock.calls.length !== 0) {
      throw new Error('the revalidator consulted the authorization reader without a verified actor');
    }
  });

  it('T-9: the missing-membership refusal of the §11 reader is carried through as MutationRejectedError', async () => {
    const { service, readEffectiveInTransaction } = authorizationReturning(SELLER);
    readEffectiveInTransaction.mockRejectedValue(
      new DomainError(ERROR_CODES.ORGANIZATION_FORBIDDEN, 'no membership row for the actor'),
    );

    await expect(validatorOf(service).revalidate(TX, context(ACTOR), saleCreate())).rejects.toMatchObject({
      name: 'MutationRejectedError',
      code: ERROR_CODES.ORGANIZATION_FORBIDDEN,
    });
  });

  it('an unexpected reader fault is never converted into a business refusal', async () => {
    const { service } = authorizationReturning(SELLER);
    const fault = new Error('the connection ended');
    jest.spyOn(service, 'readEffectiveInTransaction').mockRejectedValue(fault);

    await expect(validatorOf(service).revalidate(TX, context(ACTOR), saleCreate())).rejects.toBe(fault);
  });

  it('T-10: a live membership without the required permission is refused PERMISSION_DENIED', async () => {
    const { service } = authorizationReturning(effectiveWith(['customers.view']));

    await expect(validatorOf(service).revalidate(TX, context(ACTOR), saleCreate())).rejects.toMatchObject({
      name: 'MutationRejectedError',
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it('T-11: an empty effective set — role lost, not edited — is refused the same way', async () => {
    const { service } = authorizationReturning(effectiveWith([]));

    await expect(validatorOf(service).revalidate(TX, context(ACTOR), saleCreate())).rejects.toMatchObject({
      name: 'MutationRejectedError',
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  });

  it('an admission with no mapped permission is refused rather than guessed (fail-closed map)', async () => {
    const { service } = authorizationReturning(SELLER);

    await expect(
      validatorOf(service).revalidate(TX, context(ACTOR), saleCreate({ aggregateType: 'STOCK_FUTURE' })),
    ).rejects.toMatchObject({ name: 'MutationRejectedError', code: ERROR_CODES.PERMISSION_DENIED });
  });
});

describe('requiredPermissionOf', () => {
  it('maps the one admitted composition of this slice: a SALE created', () => {
    expect(requiredPermissionOf(saleCreate())).toBe('sales.create');
  });

  it('refuses to guess for an unknown aggregate or an unknown operation', () => {
    expect(requiredPermissionOf(saleCreate({ aggregateType: 'DEVICE_ENROLMENT' }))).toBeNull();
    expect(
      requiredPermissionOf(
        saleCreate({ aggregateType: 'SALE', operationType: 'AMEND' as unknown as MutationPayload['operationType'] }),
      ),
    ).toBeNull();
  });
});
