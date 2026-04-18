import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError, Method } from 'axios';

@Injectable()
export class GatewayService {
  private readonly authServiceUrl = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
  private readonly projectServiceUrl = process.env.PROJECT_SERVICE_URL ?? 'http://localhost:3003';
  private readonly commServiceUrl = process.env.COMM_SERVICE_URL ?? 'http://communication-service:3004';
  private readonly videoServiceUrl = process.env.VIDEO_SERVICE_URL ?? 'http://video-service:3005';

  health(): Record<string, unknown> {
    return {
      service: 'api-gateway',
      status: 'ok',
      dependencies: {
        authServiceUrl: this.authServiceUrl,
        projectServiceUrl: this.projectServiceUrl,
        commServiceUrl: this.commServiceUrl,
        videoServiceUrl: this.videoServiceUrl,
      },
    };
  }

  private async forward<T>(
    method: Method,
    baseUrl: string,
    path: string,
    serviceName: string,
    body?: Record<string, unknown>,
    authorization?: string,
    params?: Record<string, string | undefined>,
  ): Promise<T> {
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? '';
    const headers: Record<string, string> = {
      'x-internal-service-token': internalToken,
    };
    if (authorization) {
      headers['authorization'] = authorization;
    }

    try {
      const response = await axios.request<T>({
        method,
        url: `${baseUrl}${path}`,
        data: body ?? {},
        params,
        headers,
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      if (axiosError.response?.status) {
        throw new HttpException(
          axiosError.response.data?.message ?? `${serviceName} request failed`,
          axiosError.response.status,
        );
      }
      throw new ServiceUnavailableException(
        axiosError.response?.data?.message ?? `${serviceName} unavailable`,
      );
    }
  }

  async forwardAuthRequest<T>(
    method: Method, 
    path: string, 
    body?: Record<string, unknown>, 
    authorization?: string,
    params?: Record<string, string | undefined>,
  ): Promise<T> {
    // Adiciona /api/v1 automaticamente se não existir
    let fullPath = path;
    if (!fullPath.startsWith('/api/v1')) {
      fullPath = fullPath.startsWith('/') 
        ? `/api/v1${fullPath}` 
        : `/api/v1/${fullPath}`;
    }

    return this.forward<T>(method, this.authServiceUrl, fullPath, 'auth-service', body, authorization, params);
  }

  async forwardProjectRequest<T>(method: Method, path: string, body?: Record<string, unknown>, authorization?: string, params?: Record<string, string | undefined>): Promise<T> {
    return this.forward<T>(method, this.projectServiceUrl, path, 'project-service', body, authorization, params);
  }

  async forwardCommRequest<T>(method: Method, path: string, body?: Record<string, unknown>, authorization?: string, params?: Record<string, string | undefined>): Promise<T> {
    return this.forward<T>(method, this.commServiceUrl, path, 'communication-service', body, authorization, params);
  }

  async forwardVideoRequest<T>(method: Method, path: string, body?: Record<string, unknown>, authorization?: string, params?: Record<string, string | undefined>): Promise<T> {
    return this.forward<T>(method, this.videoServiceUrl, path, 'video-service', body, authorization, params);
  }

  async forwardAuthHealth<T>(): Promise<T> {
    return this.forward<T>('get', this.authServiceUrl, '/api/v1/auth/health', 'auth-service');
  }
}
