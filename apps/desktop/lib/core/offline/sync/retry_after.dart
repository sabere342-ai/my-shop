/// Utilities to honour `Retry-After` — Master Plan §38.10.4, §40.5 C4.
///
/// `Retry-After` is parsed from both the push transport and, defensively, from a
/// probe response. Three guarantees are implemented:
///
/// * **A server directive wins.** When valid and positive, it overrides the
///   local exponential backoff (§38.10.4: "honour `Retry-After`").
/// * **It must not be shortened accidentally.** The caller compares the parsed
///   value against the ladder delay and takes the larger one (and this module
///   never subtracts jitter). The parser also never produces a past value.
/// * **Invalid headers fall back.** A non-numeric or unparseable HTTP-date,
///   `0`, a negative number, or a past HTTP-date must not produce a busy-loop:
///   the parser returns `null` so the caller falls back to its local policy.
/// * **Large values must not overflow scheduling.** The caller caps by the
///   policy's ceiling (`BackoffPolicy.maxDelay` for sync; a probe cap for
///   connectivity probes). This module can also cap to a safety ceiling.
/// * **Date parsing is testable.** [parseRetryAfter] takes an injected [now].
library;

import 'dart:io';

/// Safety ceiling for a server-directed delay. A 24h ceiling is generous for
/// a POS that loses connectivity: a maintenance window of days is not
/// reasonable to "wait for", and a very large directive could hold an idle
/// device hostage to a bad clock. Documented as a safety cap, not a correctness
/// constraint of the protocol.
const Duration defaultRetryAfterCap = Duration(hours: 24);

/// Parse a `Retry-After` header value.
///
/// * Returns `null` if [value] is `null`, blank, non-numeric, an unparseable
///   HTTP-date, `<= 0`, or in the past.
/// * For numeric seconds, the ceiling [cap] applies; values above [cap] become
///   [cap].
/// * For HTTP-date, [date.difference(now)] is returned; if it is <= 0, returns
///   `null` (past). The ceiling [cap] also applies.
///
/// This is a pure function so HTTP-date and seconds can be tested with a
/// deterministic [now] (UTC DateTime is expected for HTTP dates; [HttpDate.parse]
/// returns UTC).
Duration? parseRetryAfter(
  String? value, {
  required DateTime now,
  Duration cap = defaultRetryAfterCap,
}) {
  if (value == null) return null;
  final String trimmed = value.trim();
  if (trimmed.isEmpty) return null;

  final Duration? parsed =
      _parseDelaySeconds(trimmed) ?? _parseHttpDate(trimmed, now);
  if (parsed == null) return null;
  if (parsed <= Duration.zero) return null;
  if (cap > Duration.zero && parsed > cap) return cap;
  return parsed;
}

Duration? _parseDelaySeconds(String trimmed) {
  // Disallow leading '+' to keep the header shape unambiguous.
  if (trimmed.startsWith('+')) return null;
  // Reject signs other than a single minus (handled later as <=0).
  final RegExp secondsRe = RegExp(r'^-?\d+$');
  if (!secondsRe.hasMatch(trimmed)) return null;
  final int seconds;
  try {
    seconds = int.parse(trimmed);
  } on FormatException {
    return null;
  }
  if (seconds <= 0) return Duration.zero; // upstream will return null
  return Duration(seconds: seconds);
}

Duration? _parseHttpDate(String trimmed, DateTime now) {
  final DateTime date;
  try {
    date = HttpDate.parse(trimmed);
  } on FormatException {
    return null;
  } on HttpException {
    // `HttpDate.parse` throws `HttpException` (not `FormatException`) for an
    // invalid date, so it must be caught explicitly — otherwise a malformed
    // header would escape the parser and violate the "invalid falls back"
    // guarantee (§38.10.4).
    return null;
  }
  final Duration diff = date.difference(now);
  if (diff <= Duration.zero) return Duration.zero; // past → null
  return diff;
}
