const { AuthProvider } = require('./authProvider');

// Not implemented — exists so authProvider.js's contract is proven
// against a second, differently-shaped provider before a real second
// vendor is needed, the same role twilioVerifyProvider.js already plays
// in services/trustpay-backend for phone verification. Firebase Auth
// chosen deliberately, not a placeholder name: AuthCore's own docs
// position it explicitly as a Firebase Auth replacement ("Firebase
// Migration" guide), so this is the concrete second market this
// platform would actually reach for, not a theoretical one.
//
// TODO before this can back a real merchant:
//   - sendOtp: Firebase Admin SDK has no email-OTP primitive of its own —
//     would need Firebase's email-link ("passwordless") sign-in flow,
//     generateSignInWithEmailLink(), and a way to receive the completed
//     link server-side.
//   - verifyOtp: verify the resulting Firebase ID token via
//     admin.auth().verifyIdToken(), map its `uid` to providerUid.
class FirebaseAuthProvider extends AuthProvider {
  constructor(config) {
    super('firebase');
    this.projectId = config.projectId;
    this.serviceAccountKey = config.serviceAccountKey;
  }
}

module.exports = { FirebaseAuthProvider };
