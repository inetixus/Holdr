import { Alert, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import type { User } from './data';

// Complete the auth session if we are redirected back to the app on web/mobile
WebBrowser.maybeCompleteAuthSession();

const WEB_CLIENT_ID = '636307355753-v4fg1vorhqs12dj8urmsrca5a56ld27a.apps.googleusercontent.com';

export function isGoogleSignInAvailable(): boolean {
  // Always available on mobile devices via the system web browser
  return Platform.OS !== 'web';
}

export async function signInWithGoogle(): Promise<{ user: User; accessToken: string }> {
  // Use Vercel redirect proxy to satisfy Google's policy on custom/shared domains
  const redirectUri = 'https://holdr-nu.vercel.app/redirect.html';
  
  // Dynamically resolve local Expo Go return address (e.g. exp://192.168...)
  const localRedirect = AuthSession.makeRedirectUri({
    preferLocal: true,
  });

  // Construct the actual Google OAuth 2.0 authorization URL
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + 
    new URLSearchParams({
      client_id: WEB_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'token',
      scope: 'openid profile email https://www.googleapis.com/auth/gmail.readonly',
      prompt: 'select_account',
      state: localRedirect,
    }).toString();

  try {
    // Open the secure browser popup
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (result.type === 'success' && result.url) {
      // Parse the access token from the redirect URL
      const url = new URL(result.url);
      const hashParams = new URLSearchParams(url.hash.substring(1) || url.search);
      const accessToken = hashParams.get('access_token');

      if (!accessToken) {
        throw new Error('Google did not return an access token.');
      }

      // Fetch actual real profile information from Google using the access token
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error('Failed to retrieve user profile from Google.');
      }

      const userInfo = await response.json();

      if (!userInfo.email) {
        throw new Error('Google account did not provide an email address.');
      }

      return {
        user: {
          id: userInfo.sub,
          name: userInfo.given_name || userInfo.name || 'Google User',
          email: userInfo.email,
        },
        accessToken,
      };
    } else {
      throw new Error('Google Sign-In was cancelled or failed to complete.');
    }
  } catch (error) {
    console.error('Google Sign-In Error:', error);
    const message = error instanceof Error ? error.message : 'Something went wrong during Google Sign-In.';
    Alert.alert('Google Sign-In Failed', message);
    throw error;
  }
}
