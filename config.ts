export type AppConfig = {
  turso: {
    databaseUrl: string;
    authToken: string;
  };
};

/**
 * Configuration layer for Holdr.
 * 
 * This safely loads environment variables at runtime.
 * - In Expo client environments, it falls back to EXPO_PUBLIC_ variables.
 * - In Node/Backend environments, it reads the direct variables to keep them secret.
 */
export const config: AppConfig = {
  turso: {
    databaseUrl: process.env.TURSO_DATABASE_URL ?? process.env.EXPO_PUBLIC_TURSO_DATABASE_URL ?? '',
    authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.EXPO_PUBLIC_TURSO_AUTH_TOKEN ?? '',
  },
};

/**
 * Validates that the required configuration is present.
 * This can be called at startup or before initializing the database connection.
 */
export const validateConfig = (): void => {
  const missing: string[] = [];

  if (!config.turso.databaseUrl) {
    missing.push('TURSO_DATABASE_URL');
  }

  if (!config.turso.authToken) {
    missing.push('TURSO_AUTH_TOKEN');
  }

  if (missing.length > 0) {
    console.warn(`[Config] Missing required environment variables: ${missing.join(', ')}`);
  }
};
