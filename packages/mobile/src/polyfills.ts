/**
 * Polyfills that must load BEFORE amazon-cognito-identity-js.
 *
 * The Cognito SDK assumes a browser: it references `global.crypto` (for SRP
 * random bytes) and `global.Buffer`. React Native's Hermes engine ships
 * neither, so we install them here and import this module first from the
 * root layout.
 */
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer as unknown as typeof global.Buffer;
}
