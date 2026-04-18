import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
  verified_email: boolean;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  private readonly callbackUrl = process.env.GOOGLE_CALLBACK_URL ?? 'https://app.drucci.pt/api/v1/auth/google/callback';

  /**
   * Devolve a URL para redirecionar o utilizador para o Google.
   * O `state` serve de CSRF protection — guardamos no cookie/sessão e verificamos no callback.
   */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Troca o `code` recebido no callback pelos tokens Google
   * e devolve os dados do utilizador.
   */
  async exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
    // 1. Trocar code por tokens
    let tokenResponse: GoogleTokenResponse;

    try {
      const res = await axios.post<GoogleTokenResponse>(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          redirect_uri: this.callbackUrl,
          grant_type: 'authorization_code',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      );
      tokenResponse = res.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Google token exchange failed: ${message}`);
      throw new UnauthorizedException('Google authentication failed');
    }

    // 2. Buscar dados do utilizador com o access_token
    try {
      const res = await axios.get<GoogleUserInfo>(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
          timeout: 10_000,
        },
      );

      if (!res.data.verified_email) {
        throw new UnauthorizedException('Google account email is not verified');
      }

      return res.data;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(`Google userinfo fetch failed: ${message}`);
      throw new UnauthorizedException('Failed to fetch Google user info');
    }
  }
}