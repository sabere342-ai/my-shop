/// RFC 9562 UUID version 7, as required by Master Plan 38.8.1 `mutation_id`:
/// time-ordered (the 48-bit big-endian unix millisecond prefix sorts
/// lexicographically in time order) and collision-resistant (74 random bits).
///
/// Generated on the client, never issued by the server: the identity must
/// exist the moment the business transaction commits, online or not.
library;

import 'dart:math';

final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
);

final RegExp _uuidV7Pattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
);

/// True for any canonical lowercase UUID (versions 1-8).
bool isUuid(String value) => _uuidPattern.hasMatch(value);

/// True only for a version-7 UUID.
bool isUuidV7(String value) => _uuidV7Pattern.hasMatch(value);

/// Generates one UUIDv7.
///
/// [time] and [random] are injectable so tests can pin the timestamp and the
/// entropy without touching the clock. The default entropy source is the
/// platform CSPRNG; a mutation id is an accountability identifier (38.8.1,
/// 38.30), so a predictable generator would be a defect.
String generateUuidV7({DateTime? time, Random? random}) {
  final Random entropy = random ?? Random.secure();
  final int milliseconds = (time ?? DateTime.now()).toUtc().millisecondsSinceEpoch;

  final List<int> bytes = List<int>.filled(16, 0);

  // 48-bit unix timestamp, big-endian (RFC 9562 section 5.1).
  for (var shift = 0; shift < 6; shift++) {
    bytes[5 - shift] = (milliseconds >> (8 * shift)) & 0xff;
  }

  // Version 7: the high nibble of byte 6 is 0111.
  bytes[6] = 0x70 | (entropy.nextInt(256) & 0x0f);
  // rand_a: the low nibble of byte 6 and all of byte 7.
  bytes[7] = entropy.nextInt(256);
  // Variant: the high nibble of byte 8 is 10xx (RFC 9562 section 4.2).
  bytes[8] = 0x80 | (entropy.nextInt(256) & 0x3f);
  for (var i = 9; i < 16; i++) {
    bytes[i] = entropy.nextInt(256);
  }

  final StringBuffer hex = StringBuffer();
  for (var i = 0; i < 16; i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) hex.write('-');
    hex.write(bytes[i].toRadixString(16).padLeft(2, '0'));
  }
  return hex.toString();
}
