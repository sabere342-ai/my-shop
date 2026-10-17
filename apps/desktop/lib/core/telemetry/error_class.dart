/// A bounded, message-free classification of a caught error (§38.28.3).
///
/// The offline path must log *that* something failed and *what class* failed,
/// never *what it said*. An error message is the most common place a connection
/// string, access token, or payload fragment reaches a log line, and a
/// `toString()` is worse still: it may append a whole cause chain. Only the
/// runtime type is read, sanitised to a short identifier, so the value that
/// reaches a log record is bounded by construction rather than by a redaction
/// list that is one field behind.
library;

/// The longest class name this classifier will emit.
const int maxErrorClassNameLength = 64;

final RegExp _safeClassName = RegExp(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$');

/// Returns a short, safe class name for [error].
///
/// A type whose runtime name is not a plain identifier (a generic, a closure, a
/// record) is reported as `Object`; `null` is reported as `null`. The message,
/// the stack trace, and any nested cause are never read.
String errorClassOf(Object? error) {
  if (error == null) return 'null';
  final String name = error.runtimeType.toString();
  return _safeClassName.hasMatch(name) ? name : 'Object';
}
