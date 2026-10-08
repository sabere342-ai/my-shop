/// Errors raised by the outbox that are not state-machine or vocabulary
/// errors (those live beside the enums they describe).
library;

/// The device binding is absent from `local_meta`.
///
/// §38.8.1 is unambiguous: `organization_id` and `device_id` come "from device
/// binding (§38.16), never from user input". The writer therefore *reads*
/// them from `local_meta` and refuses to enqueue anything when they are
/// missing — there is no parameter through which a caller could supply them.
class MissingDeviceBindingException implements Exception {
  MissingDeviceBindingException(this.missingKeys);

  final List<String> missingKeys;

  @override
  String toString() =>
      'MissingDeviceBindingException: device binding key(s) not present in '
      'local_meta: ${missingKeys.join(', ')} (§38.8.1)';
}

/// A mutation id with no outbox row.
class OutboxRecordNotFoundException implements Exception {
  OutboxRecordNotFoundException(this.mutationId);

  final String mutationId;

  @override
  String toString() => 'OutboxRecordNotFoundException: $mutationId';
}
