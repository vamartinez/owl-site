/**
 * Runtime configuration, read from `expo.extra` in app.json (or the values
 * an EAS build injects). NEVER hardcode secrets here — the API URL and the
 * Cognito pool/client ids are public config, and the app talks to Cognito
 * directly, so there is no client secret to hide.
 */
import Constants from 'expo-constants';

interface AppConfig {
  apiUrl: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<AppConfig>;

export const config: AppConfig = {
  apiUrl: extra.apiUrl ?? '',
  cognitoUserPoolId: extra.cognitoUserPoolId ?? '',
  cognitoClientId: extra.cognitoClientId ?? '',
};

export function assertApiConfigured(): void {
  if (!config.apiUrl) {
    throw new Error(
      'apiUrl is not configured. Set expo.extra.apiUrl in app.json (the API Gateway base URL).'
    );
  }
}

export function assertCognitoConfigured(): void {
  if (!config.cognitoUserPoolId || !config.cognitoClientId) {
    throw new Error(
      'Cognito is not configured. Set expo.extra.cognitoUserPoolId and cognitoClientId in app.json.'
    );
  }
}
