/// §38.8.1 `operation_type`: the four operations the mutation ledger admits.
///
/// A closed set — a fifth operation would be a contract change, not a new
/// value (mirrors `OPERATION_TYPES` in the M1b-S2 sync contract). Members are
/// lowerCamelCase Dart identifiers; `wireName` is the exact stored/wire value.
enum OperationType {
  create('CREATE'),
  voidOperation('VOID'),
  returnOperation('RETURN'),
  reverseOperation('REVERSE');

  const OperationType(this.wireName);

  /// The §38.8.1 name stored in `outbox.operation_type`.
  final String wireName;

  /// Parses a stored or wire name, rejecting anything outside the contract.
  static OperationType fromWire(String value) {
    for (final operation in OperationType.values) {
      if (operation.wireName == value) return operation;
    }
    throw UnknownOperationTypeException(value);
  }
}

/// An `operation_type` string outside §38.8.1's closed set.
class UnknownOperationTypeException implements Exception {
  UnknownOperationTypeException(this.value);

  final String value;

  @override
  String toString() =>
      'UnknownOperationTypeException: "$value" is not one of CREATE, VOID, RETURN, REVERSE (§38.8.1)';
}
