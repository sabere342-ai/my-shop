// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $LocalMetaTable extends LocalMeta
    with TableInfo<$LocalMetaTable, LocalMetaData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalMetaTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_meta';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalMetaData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  LocalMetaData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalMetaData(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $LocalMetaTable createAlias(String alias) {
    return $LocalMetaTable(attachedDatabase, alias);
  }
}

class LocalMetaData extends DataClass implements Insertable<LocalMetaData> {
  final String key;
  final String value;
  const LocalMetaData({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  LocalMetaCompanion toCompanion(bool nullToAbsent) {
    return LocalMetaCompanion(key: Value(key), value: Value(value));
  }

  factory LocalMetaData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalMetaData(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  LocalMetaData copyWith({String? key, String? value}) =>
      LocalMetaData(key: key ?? this.key, value: value ?? this.value);
  LocalMetaData copyWithCompanion(LocalMetaCompanion data) {
    return LocalMetaData(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalMetaData(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalMetaData &&
          other.key == this.key &&
          other.value == this.value);
}

class LocalMetaCompanion extends UpdateCompanion<LocalMetaData> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const LocalMetaCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalMetaCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<LocalMetaData> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalMetaCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return LocalMetaCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalMetaCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $OutboxTable extends Outbox with TableInfo<$OutboxTable, OutboxData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OutboxTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _mutationIdMeta = const VerificationMeta(
    'mutationId',
  );
  @override
  late final GeneratedColumn<String> mutationId = GeneratedColumn<String>(
    'mutation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _organizationIdMeta = const VerificationMeta(
    'organizationId',
  );
  @override
  late final GeneratedColumn<String> organizationId = GeneratedColumn<String>(
    'organization_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deviceIdMeta = const VerificationMeta(
    'deviceId',
  );
  @override
  late final GeneratedColumn<String> deviceId = GeneratedColumn<String>(
    'device_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _actorUserIdMeta = const VerificationMeta(
    'actorUserId',
  );
  @override
  late final GeneratedColumn<String> actorUserId = GeneratedColumn<String>(
    'actor_user_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _actorRoleSnapshotMeta = const VerificationMeta(
    'actorRoleSnapshot',
  );
  @override
  late final GeneratedColumn<String> actorRoleSnapshot =
      GeneratedColumn<String>(
        'actor_role_snapshot',
        aliasedName,
        false,
        type: DriftSqlType.string,
        requiredDuringInsert: true,
      );
  static const VerificationMeta _aggregateTypeMeta = const VerificationMeta(
    'aggregateType',
  );
  @override
  late final GeneratedColumn<String> aggregateType = GeneratedColumn<String>(
    'aggregate_type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _aggregateIdMeta = const VerificationMeta(
    'aggregateId',
  );
  @override
  late final GeneratedColumn<String> aggregateId = GeneratedColumn<String>(
    'aggregate_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _operationTypeMeta = const VerificationMeta(
    'operationType',
  );
  @override
  late final GeneratedColumn<String> operationType = GeneratedColumn<String>(
    'operation_type',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadVersionMeta = const VerificationMeta(
    'payloadVersion',
  );
  @override
  late final GeneratedColumn<int> payloadVersion = GeneratedColumn<int>(
    'payload_version',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _deviceLocalSequenceMeta =
      const VerificationMeta('deviceLocalSequence');
  @override
  late final GeneratedColumn<int> deviceLocalSequence = GeneratedColumn<int>(
    'device_local_sequence',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _localCreatedAtMeta = const VerificationMeta(
    'localCreatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> localCreatedAt =
      GeneratedColumn<DateTime>(
        'local_created_at',
        aliasedName,
        false,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: true,
      );
  static const VerificationMeta _syncStateMeta = const VerificationMeta(
    'syncState',
  );
  @override
  late final GeneratedColumn<String> syncState = GeneratedColumn<String>(
    'sync_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _attemptCountMeta = const VerificationMeta(
    'attemptCount',
  );
  @override
  late final GeneratedColumn<int> attemptCount = GeneratedColumn<int>(
    'attempt_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _lastErrorCodeMeta = const VerificationMeta(
    'lastErrorCode',
  );
  @override
  late final GeneratedColumn<String> lastErrorCode = GeneratedColumn<String>(
    'last_error_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _lastAttemptAtMeta = const VerificationMeta(
    'lastAttemptAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastAttemptAt =
      GeneratedColumn<DateTime>(
        'last_attempt_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _deviceIdempotencyKeyMeta =
      const VerificationMeta('deviceIdempotencyKey');
  @override
  late final GeneratedColumn<String> deviceIdempotencyKey =
      GeneratedColumn<String>(
        'device_idempotency_key',
        aliasedName,
        false,
        type: DriftSqlType.string,
        requiredDuringInsert: true,
      );
  @override
  List<GeneratedColumn> get $columns => [
    mutationId,
    organizationId,
    deviceId,
    actorUserId,
    actorRoleSnapshot,
    aggregateType,
    aggregateId,
    operationType,
    payload,
    payloadVersion,
    deviceLocalSequence,
    localCreatedAt,
    syncState,
    attemptCount,
    lastErrorCode,
    lastAttemptAt,
    deviceIdempotencyKey,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'outbox';
  @override
  VerificationContext validateIntegrity(
    Insertable<OutboxData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('mutation_id')) {
      context.handle(
        _mutationIdMeta,
        mutationId.isAcceptableOrUnknown(data['mutation_id']!, _mutationIdMeta),
      );
    } else if (isInserting) {
      context.missing(_mutationIdMeta);
    }
    if (data.containsKey('organization_id')) {
      context.handle(
        _organizationIdMeta,
        organizationId.isAcceptableOrUnknown(
          data['organization_id']!,
          _organizationIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_organizationIdMeta);
    }
    if (data.containsKey('device_id')) {
      context.handle(
        _deviceIdMeta,
        deviceId.isAcceptableOrUnknown(data['device_id']!, _deviceIdMeta),
      );
    } else if (isInserting) {
      context.missing(_deviceIdMeta);
    }
    if (data.containsKey('actor_user_id')) {
      context.handle(
        _actorUserIdMeta,
        actorUserId.isAcceptableOrUnknown(
          data['actor_user_id']!,
          _actorUserIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_actorUserIdMeta);
    }
    if (data.containsKey('actor_role_snapshot')) {
      context.handle(
        _actorRoleSnapshotMeta,
        actorRoleSnapshot.isAcceptableOrUnknown(
          data['actor_role_snapshot']!,
          _actorRoleSnapshotMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_actorRoleSnapshotMeta);
    }
    if (data.containsKey('aggregate_type')) {
      context.handle(
        _aggregateTypeMeta,
        aggregateType.isAcceptableOrUnknown(
          data['aggregate_type']!,
          _aggregateTypeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_aggregateTypeMeta);
    }
    if (data.containsKey('aggregate_id')) {
      context.handle(
        _aggregateIdMeta,
        aggregateId.isAcceptableOrUnknown(
          data['aggregate_id']!,
          _aggregateIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_aggregateIdMeta);
    }
    if (data.containsKey('operation_type')) {
      context.handle(
        _operationTypeMeta,
        operationType.isAcceptableOrUnknown(
          data['operation_type']!,
          _operationTypeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_operationTypeMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('payload_version')) {
      context.handle(
        _payloadVersionMeta,
        payloadVersion.isAcceptableOrUnknown(
          data['payload_version']!,
          _payloadVersionMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_payloadVersionMeta);
    }
    if (data.containsKey('device_local_sequence')) {
      context.handle(
        _deviceLocalSequenceMeta,
        deviceLocalSequence.isAcceptableOrUnknown(
          data['device_local_sequence']!,
          _deviceLocalSequenceMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_deviceLocalSequenceMeta);
    }
    if (data.containsKey('local_created_at')) {
      context.handle(
        _localCreatedAtMeta,
        localCreatedAt.isAcceptableOrUnknown(
          data['local_created_at']!,
          _localCreatedAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_localCreatedAtMeta);
    }
    if (data.containsKey('sync_state')) {
      context.handle(
        _syncStateMeta,
        syncState.isAcceptableOrUnknown(data['sync_state']!, _syncStateMeta),
      );
    } else if (isInserting) {
      context.missing(_syncStateMeta);
    }
    if (data.containsKey('attempt_count')) {
      context.handle(
        _attemptCountMeta,
        attemptCount.isAcceptableOrUnknown(
          data['attempt_count']!,
          _attemptCountMeta,
        ),
      );
    }
    if (data.containsKey('last_error_code')) {
      context.handle(
        _lastErrorCodeMeta,
        lastErrorCode.isAcceptableOrUnknown(
          data['last_error_code']!,
          _lastErrorCodeMeta,
        ),
      );
    }
    if (data.containsKey('last_attempt_at')) {
      context.handle(
        _lastAttemptAtMeta,
        lastAttemptAt.isAcceptableOrUnknown(
          data['last_attempt_at']!,
          _lastAttemptAtMeta,
        ),
      );
    }
    if (data.containsKey('device_idempotency_key')) {
      context.handle(
        _deviceIdempotencyKeyMeta,
        deviceIdempotencyKey.isAcceptableOrUnknown(
          data['device_idempotency_key']!,
          _deviceIdempotencyKeyMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_deviceIdempotencyKeyMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {mutationId};
  @override
  List<Set<GeneratedColumn>> get uniqueKeys => [
    {deviceLocalSequence},
    {deviceIdempotencyKey},
  ];
  @override
  OutboxData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OutboxData(
      mutationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}mutation_id'],
      )!,
      organizationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}organization_id'],
      )!,
      deviceId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}device_id'],
      )!,
      actorUserId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}actor_user_id'],
      )!,
      actorRoleSnapshot: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}actor_role_snapshot'],
      )!,
      aggregateType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}aggregate_type'],
      )!,
      aggregateId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}aggregate_id'],
      )!,
      operationType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}operation_type'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      payloadVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}payload_version'],
      )!,
      deviceLocalSequence: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}device_local_sequence'],
      )!,
      localCreatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}local_created_at'],
      )!,
      syncState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sync_state'],
      )!,
      attemptCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempt_count'],
      )!,
      lastErrorCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error_code'],
      ),
      lastAttemptAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_attempt_at'],
      ),
      deviceIdempotencyKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}device_idempotency_key'],
      )!,
    );
  }

  @override
  $OutboxTable createAlias(String alias) {
    return $OutboxTable(attachedDatabase, alias);
  }
}

class OutboxData extends DataClass implements Insertable<OutboxData> {
  final String mutationId;

  /// §38.8.1: tenant scope, from the device binding, never user input.
  final String organizationId;
  final String deviceId;
  final String actorUserId;

  /// JSON: effective permissions at the time of the mutation (§38.17).
  final String actorRoleSnapshot;

  /// Open vocabulary — §38.8.1 ends its list with an ellipsis.
  final String aggregateType;
  final String aggregateId;

  /// Stored as the §38.8.1 wire name (`CREATE`, `VOID`, `RETURN`, `REVERSE`).
  final String operationType;

  /// JSON, append-only after commit (§38.8.2).
  final String payload;
  final int payloadVersion;
  final int deviceLocalSequence;
  final DateTime localCreatedAt;

  /// Stored as the §38.13 wire name (`LOCAL_ONLY` … `PERMANENT_REJECTED`).
  final String syncState;
  final int attemptCount;
  final String? lastErrorCode;
  final DateTime? lastAttemptAt;
  final String deviceIdempotencyKey;
  const OutboxData({
    required this.mutationId,
    required this.organizationId,
    required this.deviceId,
    required this.actorUserId,
    required this.actorRoleSnapshot,
    required this.aggregateType,
    required this.aggregateId,
    required this.operationType,
    required this.payload,
    required this.payloadVersion,
    required this.deviceLocalSequence,
    required this.localCreatedAt,
    required this.syncState,
    required this.attemptCount,
    this.lastErrorCode,
    this.lastAttemptAt,
    required this.deviceIdempotencyKey,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['mutation_id'] = Variable<String>(mutationId);
    map['organization_id'] = Variable<String>(organizationId);
    map['device_id'] = Variable<String>(deviceId);
    map['actor_user_id'] = Variable<String>(actorUserId);
    map['actor_role_snapshot'] = Variable<String>(actorRoleSnapshot);
    map['aggregate_type'] = Variable<String>(aggregateType);
    map['aggregate_id'] = Variable<String>(aggregateId);
    map['operation_type'] = Variable<String>(operationType);
    map['payload'] = Variable<String>(payload);
    map['payload_version'] = Variable<int>(payloadVersion);
    map['device_local_sequence'] = Variable<int>(deviceLocalSequence);
    map['local_created_at'] = Variable<DateTime>(localCreatedAt);
    map['sync_state'] = Variable<String>(syncState);
    map['attempt_count'] = Variable<int>(attemptCount);
    if (!nullToAbsent || lastErrorCode != null) {
      map['last_error_code'] = Variable<String>(lastErrorCode);
    }
    if (!nullToAbsent || lastAttemptAt != null) {
      map['last_attempt_at'] = Variable<DateTime>(lastAttemptAt);
    }
    map['device_idempotency_key'] = Variable<String>(deviceIdempotencyKey);
    return map;
  }

  OutboxCompanion toCompanion(bool nullToAbsent) {
    return OutboxCompanion(
      mutationId: Value(mutationId),
      organizationId: Value(organizationId),
      deviceId: Value(deviceId),
      actorUserId: Value(actorUserId),
      actorRoleSnapshot: Value(actorRoleSnapshot),
      aggregateType: Value(aggregateType),
      aggregateId: Value(aggregateId),
      operationType: Value(operationType),
      payload: Value(payload),
      payloadVersion: Value(payloadVersion),
      deviceLocalSequence: Value(deviceLocalSequence),
      localCreatedAt: Value(localCreatedAt),
      syncState: Value(syncState),
      attemptCount: Value(attemptCount),
      lastErrorCode: lastErrorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(lastErrorCode),
      lastAttemptAt: lastAttemptAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastAttemptAt),
      deviceIdempotencyKey: Value(deviceIdempotencyKey),
    );
  }

  factory OutboxData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OutboxData(
      mutationId: serializer.fromJson<String>(json['mutationId']),
      organizationId: serializer.fromJson<String>(json['organizationId']),
      deviceId: serializer.fromJson<String>(json['deviceId']),
      actorUserId: serializer.fromJson<String>(json['actorUserId']),
      actorRoleSnapshot: serializer.fromJson<String>(json['actorRoleSnapshot']),
      aggregateType: serializer.fromJson<String>(json['aggregateType']),
      aggregateId: serializer.fromJson<String>(json['aggregateId']),
      operationType: serializer.fromJson<String>(json['operationType']),
      payload: serializer.fromJson<String>(json['payload']),
      payloadVersion: serializer.fromJson<int>(json['payloadVersion']),
      deviceLocalSequence: serializer.fromJson<int>(
        json['deviceLocalSequence'],
      ),
      localCreatedAt: serializer.fromJson<DateTime>(json['localCreatedAt']),
      syncState: serializer.fromJson<String>(json['syncState']),
      attemptCount: serializer.fromJson<int>(json['attemptCount']),
      lastErrorCode: serializer.fromJson<String?>(json['lastErrorCode']),
      lastAttemptAt: serializer.fromJson<DateTime?>(json['lastAttemptAt']),
      deviceIdempotencyKey: serializer.fromJson<String>(
        json['deviceIdempotencyKey'],
      ),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'mutationId': serializer.toJson<String>(mutationId),
      'organizationId': serializer.toJson<String>(organizationId),
      'deviceId': serializer.toJson<String>(deviceId),
      'actorUserId': serializer.toJson<String>(actorUserId),
      'actorRoleSnapshot': serializer.toJson<String>(actorRoleSnapshot),
      'aggregateType': serializer.toJson<String>(aggregateType),
      'aggregateId': serializer.toJson<String>(aggregateId),
      'operationType': serializer.toJson<String>(operationType),
      'payload': serializer.toJson<String>(payload),
      'payloadVersion': serializer.toJson<int>(payloadVersion),
      'deviceLocalSequence': serializer.toJson<int>(deviceLocalSequence),
      'localCreatedAt': serializer.toJson<DateTime>(localCreatedAt),
      'syncState': serializer.toJson<String>(syncState),
      'attemptCount': serializer.toJson<int>(attemptCount),
      'lastErrorCode': serializer.toJson<String?>(lastErrorCode),
      'lastAttemptAt': serializer.toJson<DateTime?>(lastAttemptAt),
      'deviceIdempotencyKey': serializer.toJson<String>(deviceIdempotencyKey),
    };
  }

  OutboxData copyWith({
    String? mutationId,
    String? organizationId,
    String? deviceId,
    String? actorUserId,
    String? actorRoleSnapshot,
    String? aggregateType,
    String? aggregateId,
    String? operationType,
    String? payload,
    int? payloadVersion,
    int? deviceLocalSequence,
    DateTime? localCreatedAt,
    String? syncState,
    int? attemptCount,
    Value<String?> lastErrorCode = const Value.absent(),
    Value<DateTime?> lastAttemptAt = const Value.absent(),
    String? deviceIdempotencyKey,
  }) => OutboxData(
    mutationId: mutationId ?? this.mutationId,
    organizationId: organizationId ?? this.organizationId,
    deviceId: deviceId ?? this.deviceId,
    actorUserId: actorUserId ?? this.actorUserId,
    actorRoleSnapshot: actorRoleSnapshot ?? this.actorRoleSnapshot,
    aggregateType: aggregateType ?? this.aggregateType,
    aggregateId: aggregateId ?? this.aggregateId,
    operationType: operationType ?? this.operationType,
    payload: payload ?? this.payload,
    payloadVersion: payloadVersion ?? this.payloadVersion,
    deviceLocalSequence: deviceLocalSequence ?? this.deviceLocalSequence,
    localCreatedAt: localCreatedAt ?? this.localCreatedAt,
    syncState: syncState ?? this.syncState,
    attemptCount: attemptCount ?? this.attemptCount,
    lastErrorCode: lastErrorCode.present
        ? lastErrorCode.value
        : this.lastErrorCode,
    lastAttemptAt: lastAttemptAt.present
        ? lastAttemptAt.value
        : this.lastAttemptAt,
    deviceIdempotencyKey: deviceIdempotencyKey ?? this.deviceIdempotencyKey,
  );
  OutboxData copyWithCompanion(OutboxCompanion data) {
    return OutboxData(
      mutationId: data.mutationId.present
          ? data.mutationId.value
          : this.mutationId,
      organizationId: data.organizationId.present
          ? data.organizationId.value
          : this.organizationId,
      deviceId: data.deviceId.present ? data.deviceId.value : this.deviceId,
      actorUserId: data.actorUserId.present
          ? data.actorUserId.value
          : this.actorUserId,
      actorRoleSnapshot: data.actorRoleSnapshot.present
          ? data.actorRoleSnapshot.value
          : this.actorRoleSnapshot,
      aggregateType: data.aggregateType.present
          ? data.aggregateType.value
          : this.aggregateType,
      aggregateId: data.aggregateId.present
          ? data.aggregateId.value
          : this.aggregateId,
      operationType: data.operationType.present
          ? data.operationType.value
          : this.operationType,
      payload: data.payload.present ? data.payload.value : this.payload,
      payloadVersion: data.payloadVersion.present
          ? data.payloadVersion.value
          : this.payloadVersion,
      deviceLocalSequence: data.deviceLocalSequence.present
          ? data.deviceLocalSequence.value
          : this.deviceLocalSequence,
      localCreatedAt: data.localCreatedAt.present
          ? data.localCreatedAt.value
          : this.localCreatedAt,
      syncState: data.syncState.present ? data.syncState.value : this.syncState,
      attemptCount: data.attemptCount.present
          ? data.attemptCount.value
          : this.attemptCount,
      lastErrorCode: data.lastErrorCode.present
          ? data.lastErrorCode.value
          : this.lastErrorCode,
      lastAttemptAt: data.lastAttemptAt.present
          ? data.lastAttemptAt.value
          : this.lastAttemptAt,
      deviceIdempotencyKey: data.deviceIdempotencyKey.present
          ? data.deviceIdempotencyKey.value
          : this.deviceIdempotencyKey,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OutboxData(')
          ..write('mutationId: $mutationId, ')
          ..write('organizationId: $organizationId, ')
          ..write('deviceId: $deviceId, ')
          ..write('actorUserId: $actorUserId, ')
          ..write('actorRoleSnapshot: $actorRoleSnapshot, ')
          ..write('aggregateType: $aggregateType, ')
          ..write('aggregateId: $aggregateId, ')
          ..write('operationType: $operationType, ')
          ..write('payload: $payload, ')
          ..write('payloadVersion: $payloadVersion, ')
          ..write('deviceLocalSequence: $deviceLocalSequence, ')
          ..write('localCreatedAt: $localCreatedAt, ')
          ..write('syncState: $syncState, ')
          ..write('attemptCount: $attemptCount, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('lastAttemptAt: $lastAttemptAt, ')
          ..write('deviceIdempotencyKey: $deviceIdempotencyKey')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    mutationId,
    organizationId,
    deviceId,
    actorUserId,
    actorRoleSnapshot,
    aggregateType,
    aggregateId,
    operationType,
    payload,
    payloadVersion,
    deviceLocalSequence,
    localCreatedAt,
    syncState,
    attemptCount,
    lastErrorCode,
    lastAttemptAt,
    deviceIdempotencyKey,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OutboxData &&
          other.mutationId == this.mutationId &&
          other.organizationId == this.organizationId &&
          other.deviceId == this.deviceId &&
          other.actorUserId == this.actorUserId &&
          other.actorRoleSnapshot == this.actorRoleSnapshot &&
          other.aggregateType == this.aggregateType &&
          other.aggregateId == this.aggregateId &&
          other.operationType == this.operationType &&
          other.payload == this.payload &&
          other.payloadVersion == this.payloadVersion &&
          other.deviceLocalSequence == this.deviceLocalSequence &&
          other.localCreatedAt == this.localCreatedAt &&
          other.syncState == this.syncState &&
          other.attemptCount == this.attemptCount &&
          other.lastErrorCode == this.lastErrorCode &&
          other.lastAttemptAt == this.lastAttemptAt &&
          other.deviceIdempotencyKey == this.deviceIdempotencyKey);
}

class OutboxCompanion extends UpdateCompanion<OutboxData> {
  final Value<String> mutationId;
  final Value<String> organizationId;
  final Value<String> deviceId;
  final Value<String> actorUserId;
  final Value<String> actorRoleSnapshot;
  final Value<String> aggregateType;
  final Value<String> aggregateId;
  final Value<String> operationType;
  final Value<String> payload;
  final Value<int> payloadVersion;
  final Value<int> deviceLocalSequence;
  final Value<DateTime> localCreatedAt;
  final Value<String> syncState;
  final Value<int> attemptCount;
  final Value<String?> lastErrorCode;
  final Value<DateTime?> lastAttemptAt;
  final Value<String> deviceIdempotencyKey;
  final Value<int> rowid;
  const OutboxCompanion({
    this.mutationId = const Value.absent(),
    this.organizationId = const Value.absent(),
    this.deviceId = const Value.absent(),
    this.actorUserId = const Value.absent(),
    this.actorRoleSnapshot = const Value.absent(),
    this.aggregateType = const Value.absent(),
    this.aggregateId = const Value.absent(),
    this.operationType = const Value.absent(),
    this.payload = const Value.absent(),
    this.payloadVersion = const Value.absent(),
    this.deviceLocalSequence = const Value.absent(),
    this.localCreatedAt = const Value.absent(),
    this.syncState = const Value.absent(),
    this.attemptCount = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.lastAttemptAt = const Value.absent(),
    this.deviceIdempotencyKey = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  OutboxCompanion.insert({
    required String mutationId,
    required String organizationId,
    required String deviceId,
    required String actorUserId,
    required String actorRoleSnapshot,
    required String aggregateType,
    required String aggregateId,
    required String operationType,
    required String payload,
    required int payloadVersion,
    required int deviceLocalSequence,
    required DateTime localCreatedAt,
    required String syncState,
    this.attemptCount = const Value.absent(),
    this.lastErrorCode = const Value.absent(),
    this.lastAttemptAt = const Value.absent(),
    required String deviceIdempotencyKey,
    this.rowid = const Value.absent(),
  }) : mutationId = Value(mutationId),
       organizationId = Value(organizationId),
       deviceId = Value(deviceId),
       actorUserId = Value(actorUserId),
       actorRoleSnapshot = Value(actorRoleSnapshot),
       aggregateType = Value(aggregateType),
       aggregateId = Value(aggregateId),
       operationType = Value(operationType),
       payload = Value(payload),
       payloadVersion = Value(payloadVersion),
       deviceLocalSequence = Value(deviceLocalSequence),
       localCreatedAt = Value(localCreatedAt),
       syncState = Value(syncState),
       deviceIdempotencyKey = Value(deviceIdempotencyKey);
  static Insertable<OutboxData> custom({
    Expression<String>? mutationId,
    Expression<String>? organizationId,
    Expression<String>? deviceId,
    Expression<String>? actorUserId,
    Expression<String>? actorRoleSnapshot,
    Expression<String>? aggregateType,
    Expression<String>? aggregateId,
    Expression<String>? operationType,
    Expression<String>? payload,
    Expression<int>? payloadVersion,
    Expression<int>? deviceLocalSequence,
    Expression<DateTime>? localCreatedAt,
    Expression<String>? syncState,
    Expression<int>? attemptCount,
    Expression<String>? lastErrorCode,
    Expression<DateTime>? lastAttemptAt,
    Expression<String>? deviceIdempotencyKey,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (mutationId != null) 'mutation_id': mutationId,
      if (organizationId != null) 'organization_id': organizationId,
      if (deviceId != null) 'device_id': deviceId,
      if (actorUserId != null) 'actor_user_id': actorUserId,
      if (actorRoleSnapshot != null) 'actor_role_snapshot': actorRoleSnapshot,
      if (aggregateType != null) 'aggregate_type': aggregateType,
      if (aggregateId != null) 'aggregate_id': aggregateId,
      if (operationType != null) 'operation_type': operationType,
      if (payload != null) 'payload': payload,
      if (payloadVersion != null) 'payload_version': payloadVersion,
      if (deviceLocalSequence != null)
        'device_local_sequence': deviceLocalSequence,
      if (localCreatedAt != null) 'local_created_at': localCreatedAt,
      if (syncState != null) 'sync_state': syncState,
      if (attemptCount != null) 'attempt_count': attemptCount,
      if (lastErrorCode != null) 'last_error_code': lastErrorCode,
      if (lastAttemptAt != null) 'last_attempt_at': lastAttemptAt,
      if (deviceIdempotencyKey != null)
        'device_idempotency_key': deviceIdempotencyKey,
      if (rowid != null) 'rowid': rowid,
    });
  }

  OutboxCompanion copyWith({
    Value<String>? mutationId,
    Value<String>? organizationId,
    Value<String>? deviceId,
    Value<String>? actorUserId,
    Value<String>? actorRoleSnapshot,
    Value<String>? aggregateType,
    Value<String>? aggregateId,
    Value<String>? operationType,
    Value<String>? payload,
    Value<int>? payloadVersion,
    Value<int>? deviceLocalSequence,
    Value<DateTime>? localCreatedAt,
    Value<String>? syncState,
    Value<int>? attemptCount,
    Value<String?>? lastErrorCode,
    Value<DateTime?>? lastAttemptAt,
    Value<String>? deviceIdempotencyKey,
    Value<int>? rowid,
  }) {
    return OutboxCompanion(
      mutationId: mutationId ?? this.mutationId,
      organizationId: organizationId ?? this.organizationId,
      deviceId: deviceId ?? this.deviceId,
      actorUserId: actorUserId ?? this.actorUserId,
      actorRoleSnapshot: actorRoleSnapshot ?? this.actorRoleSnapshot,
      aggregateType: aggregateType ?? this.aggregateType,
      aggregateId: aggregateId ?? this.aggregateId,
      operationType: operationType ?? this.operationType,
      payload: payload ?? this.payload,
      payloadVersion: payloadVersion ?? this.payloadVersion,
      deviceLocalSequence: deviceLocalSequence ?? this.deviceLocalSequence,
      localCreatedAt: localCreatedAt ?? this.localCreatedAt,
      syncState: syncState ?? this.syncState,
      attemptCount: attemptCount ?? this.attemptCount,
      lastErrorCode: lastErrorCode ?? this.lastErrorCode,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
      deviceIdempotencyKey: deviceIdempotencyKey ?? this.deviceIdempotencyKey,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (mutationId.present) {
      map['mutation_id'] = Variable<String>(mutationId.value);
    }
    if (organizationId.present) {
      map['organization_id'] = Variable<String>(organizationId.value);
    }
    if (deviceId.present) {
      map['device_id'] = Variable<String>(deviceId.value);
    }
    if (actorUserId.present) {
      map['actor_user_id'] = Variable<String>(actorUserId.value);
    }
    if (actorRoleSnapshot.present) {
      map['actor_role_snapshot'] = Variable<String>(actorRoleSnapshot.value);
    }
    if (aggregateType.present) {
      map['aggregate_type'] = Variable<String>(aggregateType.value);
    }
    if (aggregateId.present) {
      map['aggregate_id'] = Variable<String>(aggregateId.value);
    }
    if (operationType.present) {
      map['operation_type'] = Variable<String>(operationType.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (payloadVersion.present) {
      map['payload_version'] = Variable<int>(payloadVersion.value);
    }
    if (deviceLocalSequence.present) {
      map['device_local_sequence'] = Variable<int>(deviceLocalSequence.value);
    }
    if (localCreatedAt.present) {
      map['local_created_at'] = Variable<DateTime>(localCreatedAt.value);
    }
    if (syncState.present) {
      map['sync_state'] = Variable<String>(syncState.value);
    }
    if (attemptCount.present) {
      map['attempt_count'] = Variable<int>(attemptCount.value);
    }
    if (lastErrorCode.present) {
      map['last_error_code'] = Variable<String>(lastErrorCode.value);
    }
    if (lastAttemptAt.present) {
      map['last_attempt_at'] = Variable<DateTime>(lastAttemptAt.value);
    }
    if (deviceIdempotencyKey.present) {
      map['device_idempotency_key'] = Variable<String>(
        deviceIdempotencyKey.value,
      );
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OutboxCompanion(')
          ..write('mutationId: $mutationId, ')
          ..write('organizationId: $organizationId, ')
          ..write('deviceId: $deviceId, ')
          ..write('actorUserId: $actorUserId, ')
          ..write('actorRoleSnapshot: $actorRoleSnapshot, ')
          ..write('aggregateType: $aggregateType, ')
          ..write('aggregateId: $aggregateId, ')
          ..write('operationType: $operationType, ')
          ..write('payload: $payload, ')
          ..write('payloadVersion: $payloadVersion, ')
          ..write('deviceLocalSequence: $deviceLocalSequence, ')
          ..write('localCreatedAt: $localCreatedAt, ')
          ..write('syncState: $syncState, ')
          ..write('attemptCount: $attemptCount, ')
          ..write('lastErrorCode: $lastErrorCode, ')
          ..write('lastAttemptAt: $lastAttemptAt, ')
          ..write('deviceIdempotencyKey: $deviceIdempotencyKey, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalAuditEventsTable extends LocalAuditEvents
    with TableInfo<$LocalAuditEventsTable, LocalAuditEvent> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalAuditEventsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _eventTimeMeta = const VerificationMeta(
    'eventTime',
  );
  @override
  late final GeneratedColumn<DateTime> eventTime = GeneratedColumn<DateTime>(
    'event_time',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _mutationIdMeta = const VerificationMeta(
    'mutationId',
  );
  @override
  late final GeneratedColumn<String> mutationId = GeneratedColumn<String>(
    'mutation_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _fromStateMeta = const VerificationMeta(
    'fromState',
  );
  @override
  late final GeneratedColumn<String> fromState = GeneratedColumn<String>(
    'from_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _toStateMeta = const VerificationMeta(
    'toState',
  );
  @override
  late final GeneratedColumn<String> toState = GeneratedColumn<String>(
    'to_state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _attemptCountMeta = const VerificationMeta(
    'attemptCount',
  );
  @override
  late final GeneratedColumn<int> attemptCount = GeneratedColumn<int>(
    'attempt_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _errorCodeMeta = const VerificationMeta(
    'errorCode',
  );
  @override
  late final GeneratedColumn<String> errorCode = GeneratedColumn<String>(
    'error_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    eventTime,
    mutationId,
    fromState,
    toState,
    attemptCount,
    errorCode,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_audit_events';
  @override
  VerificationContext validateIntegrity(
    Insertable<LocalAuditEvent> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('event_time')) {
      context.handle(
        _eventTimeMeta,
        eventTime.isAcceptableOrUnknown(data['event_time']!, _eventTimeMeta),
      );
    } else if (isInserting) {
      context.missing(_eventTimeMeta);
    }
    if (data.containsKey('mutation_id')) {
      context.handle(
        _mutationIdMeta,
        mutationId.isAcceptableOrUnknown(data['mutation_id']!, _mutationIdMeta),
      );
    } else if (isInserting) {
      context.missing(_mutationIdMeta);
    }
    if (data.containsKey('from_state')) {
      context.handle(
        _fromStateMeta,
        fromState.isAcceptableOrUnknown(data['from_state']!, _fromStateMeta),
      );
    } else if (isInserting) {
      context.missing(_fromStateMeta);
    }
    if (data.containsKey('to_state')) {
      context.handle(
        _toStateMeta,
        toState.isAcceptableOrUnknown(data['to_state']!, _toStateMeta),
      );
    } else if (isInserting) {
      context.missing(_toStateMeta);
    }
    if (data.containsKey('attempt_count')) {
      context.handle(
        _attemptCountMeta,
        attemptCount.isAcceptableOrUnknown(
          data['attempt_count']!,
          _attemptCountMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_attemptCountMeta);
    }
    if (data.containsKey('error_code')) {
      context.handle(
        _errorCodeMeta,
        errorCode.isAcceptableOrUnknown(data['error_code']!, _errorCodeMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  LocalAuditEvent map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalAuditEvent(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      eventTime: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}event_time'],
      )!,
      mutationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}mutation_id'],
      )!,
      fromState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}from_state'],
      )!,
      toState: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}to_state'],
      )!,
      attemptCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempt_count'],
      )!,
      errorCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}error_code'],
      ),
    );
  }

  @override
  $LocalAuditEventsTable createAlias(String alias) {
    return $LocalAuditEventsTable(attachedDatabase, alias);
  }
}

class LocalAuditEvent extends DataClass implements Insertable<LocalAuditEvent> {
  final int id;
  final DateTime eventTime;
  final String mutationId;
  final String fromState;
  final String toState;

  /// The outbox `attempt_count` as of the transition, so retry accounting can
  /// be reconstructed from the log alone.
  final int attemptCount;
  final String? errorCode;
  const LocalAuditEvent({
    required this.id,
    required this.eventTime,
    required this.mutationId,
    required this.fromState,
    required this.toState,
    required this.attemptCount,
    this.errorCode,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['event_time'] = Variable<DateTime>(eventTime);
    map['mutation_id'] = Variable<String>(mutationId);
    map['from_state'] = Variable<String>(fromState);
    map['to_state'] = Variable<String>(toState);
    map['attempt_count'] = Variable<int>(attemptCount);
    if (!nullToAbsent || errorCode != null) {
      map['error_code'] = Variable<String>(errorCode);
    }
    return map;
  }

  LocalAuditEventsCompanion toCompanion(bool nullToAbsent) {
    return LocalAuditEventsCompanion(
      id: Value(id),
      eventTime: Value(eventTime),
      mutationId: Value(mutationId),
      fromState: Value(fromState),
      toState: Value(toState),
      attemptCount: Value(attemptCount),
      errorCode: errorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(errorCode),
    );
  }

  factory LocalAuditEvent.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalAuditEvent(
      id: serializer.fromJson<int>(json['id']),
      eventTime: serializer.fromJson<DateTime>(json['eventTime']),
      mutationId: serializer.fromJson<String>(json['mutationId']),
      fromState: serializer.fromJson<String>(json['fromState']),
      toState: serializer.fromJson<String>(json['toState']),
      attemptCount: serializer.fromJson<int>(json['attemptCount']),
      errorCode: serializer.fromJson<String?>(json['errorCode']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'eventTime': serializer.toJson<DateTime>(eventTime),
      'mutationId': serializer.toJson<String>(mutationId),
      'fromState': serializer.toJson<String>(fromState),
      'toState': serializer.toJson<String>(toState),
      'attemptCount': serializer.toJson<int>(attemptCount),
      'errorCode': serializer.toJson<String?>(errorCode),
    };
  }

  LocalAuditEvent copyWith({
    int? id,
    DateTime? eventTime,
    String? mutationId,
    String? fromState,
    String? toState,
    int? attemptCount,
    Value<String?> errorCode = const Value.absent(),
  }) => LocalAuditEvent(
    id: id ?? this.id,
    eventTime: eventTime ?? this.eventTime,
    mutationId: mutationId ?? this.mutationId,
    fromState: fromState ?? this.fromState,
    toState: toState ?? this.toState,
    attemptCount: attemptCount ?? this.attemptCount,
    errorCode: errorCode.present ? errorCode.value : this.errorCode,
  );
  LocalAuditEvent copyWithCompanion(LocalAuditEventsCompanion data) {
    return LocalAuditEvent(
      id: data.id.present ? data.id.value : this.id,
      eventTime: data.eventTime.present ? data.eventTime.value : this.eventTime,
      mutationId: data.mutationId.present
          ? data.mutationId.value
          : this.mutationId,
      fromState: data.fromState.present ? data.fromState.value : this.fromState,
      toState: data.toState.present ? data.toState.value : this.toState,
      attemptCount: data.attemptCount.present
          ? data.attemptCount.value
          : this.attemptCount,
      errorCode: data.errorCode.present ? data.errorCode.value : this.errorCode,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalAuditEvent(')
          ..write('id: $id, ')
          ..write('eventTime: $eventTime, ')
          ..write('mutationId: $mutationId, ')
          ..write('fromState: $fromState, ')
          ..write('toState: $toState, ')
          ..write('attemptCount: $attemptCount, ')
          ..write('errorCode: $errorCode')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    eventTime,
    mutationId,
    fromState,
    toState,
    attemptCount,
    errorCode,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalAuditEvent &&
          other.id == this.id &&
          other.eventTime == this.eventTime &&
          other.mutationId == this.mutationId &&
          other.fromState == this.fromState &&
          other.toState == this.toState &&
          other.attemptCount == this.attemptCount &&
          other.errorCode == this.errorCode);
}

class LocalAuditEventsCompanion extends UpdateCompanion<LocalAuditEvent> {
  final Value<int> id;
  final Value<DateTime> eventTime;
  final Value<String> mutationId;
  final Value<String> fromState;
  final Value<String> toState;
  final Value<int> attemptCount;
  final Value<String?> errorCode;
  const LocalAuditEventsCompanion({
    this.id = const Value.absent(),
    this.eventTime = const Value.absent(),
    this.mutationId = const Value.absent(),
    this.fromState = const Value.absent(),
    this.toState = const Value.absent(),
    this.attemptCount = const Value.absent(),
    this.errorCode = const Value.absent(),
  });
  LocalAuditEventsCompanion.insert({
    this.id = const Value.absent(),
    required DateTime eventTime,
    required String mutationId,
    required String fromState,
    required String toState,
    required int attemptCount,
    this.errorCode = const Value.absent(),
  }) : eventTime = Value(eventTime),
       mutationId = Value(mutationId),
       fromState = Value(fromState),
       toState = Value(toState),
       attemptCount = Value(attemptCount);
  static Insertable<LocalAuditEvent> custom({
    Expression<int>? id,
    Expression<DateTime>? eventTime,
    Expression<String>? mutationId,
    Expression<String>? fromState,
    Expression<String>? toState,
    Expression<int>? attemptCount,
    Expression<String>? errorCode,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (eventTime != null) 'event_time': eventTime,
      if (mutationId != null) 'mutation_id': mutationId,
      if (fromState != null) 'from_state': fromState,
      if (toState != null) 'to_state': toState,
      if (attemptCount != null) 'attempt_count': attemptCount,
      if (errorCode != null) 'error_code': errorCode,
    });
  }

  LocalAuditEventsCompanion copyWith({
    Value<int>? id,
    Value<DateTime>? eventTime,
    Value<String>? mutationId,
    Value<String>? fromState,
    Value<String>? toState,
    Value<int>? attemptCount,
    Value<String?>? errorCode,
  }) {
    return LocalAuditEventsCompanion(
      id: id ?? this.id,
      eventTime: eventTime ?? this.eventTime,
      mutationId: mutationId ?? this.mutationId,
      fromState: fromState ?? this.fromState,
      toState: toState ?? this.toState,
      attemptCount: attemptCount ?? this.attemptCount,
      errorCode: errorCode ?? this.errorCode,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (eventTime.present) {
      map['event_time'] = Variable<DateTime>(eventTime.value);
    }
    if (mutationId.present) {
      map['mutation_id'] = Variable<String>(mutationId.value);
    }
    if (fromState.present) {
      map['from_state'] = Variable<String>(fromState.value);
    }
    if (toState.present) {
      map['to_state'] = Variable<String>(toState.value);
    }
    if (attemptCount.present) {
      map['attempt_count'] = Variable<int>(attemptCount.value);
    }
    if (errorCode.present) {
      map['error_code'] = Variable<String>(errorCode.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalAuditEventsCompanion(')
          ..write('id: $id, ')
          ..write('eventTime: $eventTime, ')
          ..write('mutationId: $mutationId, ')
          ..write('fromState: $fromState, ')
          ..write('toState: $toState, ')
          ..write('attemptCount: $attemptCount, ')
          ..write('errorCode: $errorCode')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $LocalMetaTable localMeta = $LocalMetaTable(this);
  late final $OutboxTable outbox = $OutboxTable(this);
  late final $LocalAuditEventsTable localAuditEvents = $LocalAuditEventsTable(
    this,
  );
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    localMeta,
    outbox,
    localAuditEvents,
  ];
}

typedef $$LocalMetaTableCreateCompanionBuilder = LocalMetaCompanion Function({
  required String key,
  required String value,
  Value<int> rowid,
});
typedef $$LocalMetaTableUpdateCompanionBuilder = LocalMetaCompanion Function({
  Value<String> key,
  Value<String> value,
  Value<int> rowid,
});

class $$LocalMetaTableFilterComposer
    extends Composer<_$AppDatabase, $LocalMetaTable> {
  $$LocalMetaTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalMetaTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalMetaTable> {
  $$LocalMetaTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalMetaTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalMetaTable> {
  $$LocalMetaTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$LocalMetaTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $LocalMetaTable,
          LocalMetaData,
          $$LocalMetaTableFilterComposer,
          $$LocalMetaTableOrderingComposer,
          $$LocalMetaTableAnnotationComposer,
          $$LocalMetaTableCreateCompanionBuilder,
          $$LocalMetaTableUpdateCompanionBuilder,
          (
            LocalMetaData,
            BaseReferences<_$AppDatabase, $LocalMetaTable, LocalMetaData>,
          ),
          LocalMetaData,
          PrefetchHooks Function()
        > {
  $$LocalMetaTableTableManager(_$AppDatabase db, $LocalMetaTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalMetaTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalMetaTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalMetaTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> key = const Value.absent(),
            Value<String> value = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) => LocalMetaCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback: ({
            required String key,
            required String value,
            Value<int> rowid = const Value.absent(),
          }) => LocalMetaCompanion.insert(key: key, value: value, rowid: rowid),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$LocalMetaTable, LocalMetaData>(table),
                  BaseReferences<_$AppDatabase, $LocalMetaTable, LocalMetaData>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalMetaTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $LocalMetaTable,
      LocalMetaData,
      $$LocalMetaTableFilterComposer,
      $$LocalMetaTableOrderingComposer,
      $$LocalMetaTableAnnotationComposer,
      $$LocalMetaTableCreateCompanionBuilder,
      $$LocalMetaTableUpdateCompanionBuilder,
      (
        LocalMetaData,
        BaseReferences<_$AppDatabase, $LocalMetaTable, LocalMetaData>,
      ),
      LocalMetaData,
      PrefetchHooks Function()
    >;
typedef $$OutboxTableCreateCompanionBuilder = OutboxCompanion Function({
  required String mutationId,
  required String organizationId,
  required String deviceId,
  required String actorUserId,
  required String actorRoleSnapshot,
  required String aggregateType,
  required String aggregateId,
  required String operationType,
  required String payload,
  required int payloadVersion,
  required int deviceLocalSequence,
  required DateTime localCreatedAt,
  required String syncState,
  Value<int> attemptCount,
  Value<String?> lastErrorCode,
  Value<DateTime?> lastAttemptAt,
  required String deviceIdempotencyKey,
  Value<int> rowid,
});
typedef $$OutboxTableUpdateCompanionBuilder = OutboxCompanion Function({
  Value<String> mutationId,
  Value<String> organizationId,
  Value<String> deviceId,
  Value<String> actorUserId,
  Value<String> actorRoleSnapshot,
  Value<String> aggregateType,
  Value<String> aggregateId,
  Value<String> operationType,
  Value<String> payload,
  Value<int> payloadVersion,
  Value<int> deviceLocalSequence,
  Value<DateTime> localCreatedAt,
  Value<String> syncState,
  Value<int> attemptCount,
  Value<String?> lastErrorCode,
  Value<DateTime?> lastAttemptAt,
  Value<String> deviceIdempotencyKey,
  Value<int> rowid,
});

class $$OutboxTableFilterComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get organizationId => $composableBuilder(
    column: $table.organizationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deviceId => $composableBuilder(
    column: $table.deviceId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get actorUserId => $composableBuilder(
    column: $table.actorUserId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get actorRoleSnapshot => $composableBuilder(
    column: $table.actorRoleSnapshot,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get aggregateType => $composableBuilder(
    column: $table.aggregateType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get aggregateId => $composableBuilder(
    column: $table.aggregateId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get operationType => $composableBuilder(
    column: $table.operationType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get payloadVersion => $composableBuilder(
    column: $table.payloadVersion,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get deviceLocalSequence => $composableBuilder(
    column: $table.deviceLocalSequence,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get localCreatedAt => $composableBuilder(
    column: $table.localCreatedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attemptCount => $composableBuilder(
    column: $table.attemptCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get deviceIdempotencyKey => $composableBuilder(
    column: $table.deviceIdempotencyKey,
    builder: (column) => ColumnFilters(column),
  );
}

class $$OutboxTableOrderingComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get organizationId => $composableBuilder(
    column: $table.organizationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deviceId => $composableBuilder(
    column: $table.deviceId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get actorUserId => $composableBuilder(
    column: $table.actorUserId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get actorRoleSnapshot => $composableBuilder(
    column: $table.actorRoleSnapshot,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get aggregateType => $composableBuilder(
    column: $table.aggregateType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get aggregateId => $composableBuilder(
    column: $table.aggregateId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get operationType => $composableBuilder(
    column: $table.operationType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get payloadVersion => $composableBuilder(
    column: $table.payloadVersion,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get deviceLocalSequence => $composableBuilder(
    column: $table.deviceLocalSequence,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get localCreatedAt => $composableBuilder(
    column: $table.localCreatedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get syncState => $composableBuilder(
    column: $table.syncState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attemptCount => $composableBuilder(
    column: $table.attemptCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get deviceIdempotencyKey => $composableBuilder(
    column: $table.deviceIdempotencyKey,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$OutboxTableAnnotationComposer
    extends Composer<_$AppDatabase, $OutboxTable> {
  $$OutboxTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get organizationId => $composableBuilder(
    column: $table.organizationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get deviceId =>
      $composableBuilder(column: $table.deviceId, builder: (column) => column);

  GeneratedColumn<String> get actorUserId => $composableBuilder(
    column: $table.actorUserId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get actorRoleSnapshot => $composableBuilder(
    column: $table.actorRoleSnapshot,
    builder: (column) => column,
  );

  GeneratedColumn<String> get aggregateType => $composableBuilder(
    column: $table.aggregateType,
    builder: (column) => column,
  );

  GeneratedColumn<String> get aggregateId => $composableBuilder(
    column: $table.aggregateId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get operationType => $composableBuilder(
    column: $table.operationType,
    builder: (column) => column,
  );

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<int> get payloadVersion => $composableBuilder(
    column: $table.payloadVersion,
    builder: (column) => column,
  );

  GeneratedColumn<int> get deviceLocalSequence => $composableBuilder(
    column: $table.deviceLocalSequence,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get localCreatedAt => $composableBuilder(
    column: $table.localCreatedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get syncState =>
      $composableBuilder(column: $table.syncState, builder: (column) => column);

  GeneratedColumn<int> get attemptCount => $composableBuilder(
    column: $table.attemptCount,
    builder: (column) => column,
  );

  GeneratedColumn<String> get lastErrorCode => $composableBuilder(
    column: $table.lastErrorCode,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get deviceIdempotencyKey => $composableBuilder(
    column: $table.deviceIdempotencyKey,
    builder: (column) => column,
  );
}

class $$OutboxTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $OutboxTable,
          OutboxData,
          $$OutboxTableFilterComposer,
          $$OutboxTableOrderingComposer,
          $$OutboxTableAnnotationComposer,
          $$OutboxTableCreateCompanionBuilder,
          $$OutboxTableUpdateCompanionBuilder,
          (OutboxData, BaseReferences<_$AppDatabase, $OutboxTable, OutboxData>),
          OutboxData,
          PrefetchHooks Function()
        > {
  $$OutboxTableTableManager(_$AppDatabase db, $OutboxTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OutboxTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OutboxTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OutboxTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> mutationId = const Value.absent(),
                Value<String> organizationId = const Value.absent(),
                Value<String> deviceId = const Value.absent(),
                Value<String> actorUserId = const Value.absent(),
                Value<String> actorRoleSnapshot = const Value.absent(),
                Value<String> aggregateType = const Value.absent(),
                Value<String> aggregateId = const Value.absent(),
                Value<String> operationType = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<int> payloadVersion = const Value.absent(),
                Value<int> deviceLocalSequence = const Value.absent(),
                Value<DateTime> localCreatedAt = const Value.absent(),
                Value<String> syncState = const Value.absent(),
                Value<int> attemptCount = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<DateTime?> lastAttemptAt = const Value.absent(),
                Value<String> deviceIdempotencyKey = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => OutboxCompanion(
                mutationId: mutationId,
                organizationId: organizationId,
                deviceId: deviceId,
                actorUserId: actorUserId,
                actorRoleSnapshot: actorRoleSnapshot,
                aggregateType: aggregateType,
                aggregateId: aggregateId,
                operationType: operationType,
                payload: payload,
                payloadVersion: payloadVersion,
                deviceLocalSequence: deviceLocalSequence,
                localCreatedAt: localCreatedAt,
                syncState: syncState,
                attemptCount: attemptCount,
                lastErrorCode: lastErrorCode,
                lastAttemptAt: lastAttemptAt,
                deviceIdempotencyKey: deviceIdempotencyKey,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String mutationId,
                required String organizationId,
                required String deviceId,
                required String actorUserId,
                required String actorRoleSnapshot,
                required String aggregateType,
                required String aggregateId,
                required String operationType,
                required String payload,
                required int payloadVersion,
                required int deviceLocalSequence,
                required DateTime localCreatedAt,
                required String syncState,
                Value<int> attemptCount = const Value.absent(),
                Value<String?> lastErrorCode = const Value.absent(),
                Value<DateTime?> lastAttemptAt = const Value.absent(),
                required String deviceIdempotencyKey,
                Value<int> rowid = const Value.absent(),
              }) => OutboxCompanion.insert(
                mutationId: mutationId,
                organizationId: organizationId,
                deviceId: deviceId,
                actorUserId: actorUserId,
                actorRoleSnapshot: actorRoleSnapshot,
                aggregateType: aggregateType,
                aggregateId: aggregateId,
                operationType: operationType,
                payload: payload,
                payloadVersion: payloadVersion,
                deviceLocalSequence: deviceLocalSequence,
                localCreatedAt: localCreatedAt,
                syncState: syncState,
                attemptCount: attemptCount,
                lastErrorCode: lastErrorCode,
                lastAttemptAt: lastAttemptAt,
                deviceIdempotencyKey: deviceIdempotencyKey,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$OutboxTable, OutboxData>(table),
                  BaseReferences<_$AppDatabase, $OutboxTable, OutboxData>(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$OutboxTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $OutboxTable,
      OutboxData,
      $$OutboxTableFilterComposer,
      $$OutboxTableOrderingComposer,
      $$OutboxTableAnnotationComposer,
      $$OutboxTableCreateCompanionBuilder,
      $$OutboxTableUpdateCompanionBuilder,
      (OutboxData, BaseReferences<_$AppDatabase, $OutboxTable, OutboxData>),
      OutboxData,
      PrefetchHooks Function()
    >;
typedef $$LocalAuditEventsTableCreateCompanionBuilder =
    LocalAuditEventsCompanion Function({
      Value<int> id,
      required DateTime eventTime,
      required String mutationId,
      required String fromState,
      required String toState,
      required int attemptCount,
      Value<String?> errorCode,
    });
typedef $$LocalAuditEventsTableUpdateCompanionBuilder =
    LocalAuditEventsCompanion Function({
      Value<int> id,
      Value<DateTime> eventTime,
      Value<String> mutationId,
      Value<String> fromState,
      Value<String> toState,
      Value<int> attemptCount,
      Value<String?> errorCode,
    });

class $$LocalAuditEventsTableFilterComposer
    extends Composer<_$AppDatabase, $LocalAuditEventsTable> {
  $$LocalAuditEventsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get eventTime => $composableBuilder(
    column: $table.eventTime,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get fromState => $composableBuilder(
    column: $table.fromState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get toState => $composableBuilder(
    column: $table.toState,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attemptCount => $composableBuilder(
    column: $table.attemptCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get errorCode => $composableBuilder(
    column: $table.errorCode,
    builder: (column) => ColumnFilters(column),
  );
}

class $$LocalAuditEventsTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalAuditEventsTable> {
  $$LocalAuditEventsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get eventTime => $composableBuilder(
    column: $table.eventTime,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get fromState => $composableBuilder(
    column: $table.fromState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get toState => $composableBuilder(
    column: $table.toState,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attemptCount => $composableBuilder(
    column: $table.attemptCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get errorCode => $composableBuilder(
    column: $table.errorCode,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$LocalAuditEventsTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalAuditEventsTable> {
  $$LocalAuditEventsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<DateTime> get eventTime =>
      $composableBuilder(column: $table.eventTime, builder: (column) => column);

  GeneratedColumn<String> get mutationId => $composableBuilder(
    column: $table.mutationId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get fromState =>
      $composableBuilder(column: $table.fromState, builder: (column) => column);

  GeneratedColumn<String> get toState =>
      $composableBuilder(column: $table.toState, builder: (column) => column);

  GeneratedColumn<int> get attemptCount => $composableBuilder(
    column: $table.attemptCount,
    builder: (column) => column,
  );

  GeneratedColumn<String> get errorCode =>
      $composableBuilder(column: $table.errorCode, builder: (column) => column);
}

class $$LocalAuditEventsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $LocalAuditEventsTable,
          LocalAuditEvent,
          $$LocalAuditEventsTableFilterComposer,
          $$LocalAuditEventsTableOrderingComposer,
          $$LocalAuditEventsTableAnnotationComposer,
          $$LocalAuditEventsTableCreateCompanionBuilder,
          $$LocalAuditEventsTableUpdateCompanionBuilder,
          (
            LocalAuditEvent,
            BaseReferences<
              _$AppDatabase,
              $LocalAuditEventsTable,
              LocalAuditEvent
            >,
          ),
          LocalAuditEvent,
          PrefetchHooks Function()
        > {
  $$LocalAuditEventsTableTableManager(
    _$AppDatabase db,
    $LocalAuditEventsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalAuditEventsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalAuditEventsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalAuditEventsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<DateTime> eventTime = const Value.absent(),
                Value<String> mutationId = const Value.absent(),
                Value<String> fromState = const Value.absent(),
                Value<String> toState = const Value.absent(),
                Value<int> attemptCount = const Value.absent(),
                Value<String?> errorCode = const Value.absent(),
              }) => LocalAuditEventsCompanion(
                id: id,
                eventTime: eventTime,
                mutationId: mutationId,
                fromState: fromState,
                toState: toState,
                attemptCount: attemptCount,
                errorCode: errorCode,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required DateTime eventTime,
                required String mutationId,
                required String fromState,
                required String toState,
                required int attemptCount,
                Value<String?> errorCode = const Value.absent(),
              }) => LocalAuditEventsCompanion.insert(
                id: id,
                eventTime: eventTime,
                mutationId: mutationId,
                fromState: fromState,
                toState: toState,
                attemptCount: attemptCount,
                errorCode: errorCode,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable<$LocalAuditEventsTable, LocalAuditEvent>(table),
                  BaseReferences<
                    _$AppDatabase,
                    $LocalAuditEventsTable,
                    LocalAuditEvent
                  >(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$LocalAuditEventsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $LocalAuditEventsTable,
      LocalAuditEvent,
      $$LocalAuditEventsTableFilterComposer,
      $$LocalAuditEventsTableOrderingComposer,
      $$LocalAuditEventsTableAnnotationComposer,
      $$LocalAuditEventsTableCreateCompanionBuilder,
      $$LocalAuditEventsTableUpdateCompanionBuilder,
      (
        LocalAuditEvent,
        BaseReferences<_$AppDatabase, $LocalAuditEventsTable, LocalAuditEvent>,
      ),
      LocalAuditEvent,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$LocalMetaTableTableManager get localMeta =>
      $$LocalMetaTableTableManager(_db, _db.localMeta);
  $$OutboxTableTableManager get outbox =>
      $$OutboxTableTableManager(_db, _db.outbox);
  $$LocalAuditEventsTableTableManager get localAuditEvents =>
      $$LocalAuditEventsTableTableManager(_db, _db.localAuditEvents);
}
