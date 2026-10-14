/// The grace-record signature verification seam — Master Plan §38.16.3,
/// §38.17, §40.5 (M1b-S8).
///
/// §38.16.3 says the cached authorisation snapshot "is validated locally
/// against the stored signature before use", and §38.17 says "Signature
/// verified locally before every privileged action." The offline session is
/// therefore only as strong as the client's ability to check that the snapshot
/// really came from the server.
///
/// This file is the **port**. It says what verification is asked, not how the
/// bytes are checked. The concrete asymmetric verifier — the server's public
/// key, its distribution to the device, and the key-rotation story — is issued
/// by the identity and permission-snapshot slices (§40.6 M2-S3, "signed
/// snapshot issuance"), exactly as the push transport's concrete HTTP client
/// is M1b-S5's seam and not M1b-S8's.
///
/// The M1b-S8 slice deliberately ships **no accepting default**. A device that
/// cannot verify a signature must refuse the session, not guess; a permissive
/// fallback would make §38.16.3's "validated locally" a comment rather than a
/// control.
library;

import 'package:my_shop_desktop/core/offline/grace/offline_grace_record.dart';

/// Verifies that an [OfflineGraceRecord] was signed by the server.
///
/// Implementations must verify [OfflineGraceRecord.signedPayload] against
/// [OfflineGraceRecord.signature] using the server's published key. They must
/// be **pure and side-effect free**: the same record and key always yield the
/// same answer, and verification never writes anything.
abstract interface class GraceSignatureVerifier {
  /// True when [record] carries a valid server signature.
  bool verify(OfflineGraceRecord record);
}
