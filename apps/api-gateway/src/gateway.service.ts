import { HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios, { AxiosError, Method } from 'axios';

@Injectable()
export class GatewayService {
  private readonly authServiceUrl = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
  private readonly projectServiceUrl = process.env.PROJECT_SERVICE_URL ?? 'http://localhost:3003';

  health(): Record<string, unknown> {
    return {
      service: 'api-gateway',
      status: 'ok',
      dependencies: {
        authServiceUrl: this.authServiceUrl,
        projectServiceUrl: this.projectServiceUrl,
      },
    };
  }

  async forwardAuthRequest<T>(
    method: Method,
    path: string,
    body?: Record<string, unknown>,
    authorization?: string,
  ): Promise<T> {
    try {
      const response = await axios.request<T>({
        method,
        url: `${this.authServiceUrl}${path}`,
        data: body ?? {},
        headers: authorization ? { authorization } : undefined,
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      if (axiosError.response?.status) {
        throw new HttpException(
          axiosError.response.data?.message ?? 'auth-service request failed',
          axiosError.response.status,
        );
      }

      throw new ServiceUnavailableException(
        axiosError.response?.data?.message ?? 'auth-service unavailable',
      );
    }
  }

  async forwardProjectRequest<T>(
    method: Method,
    path: string,
    body?: Record<string, unknown>,
    authorization?: string,
    params?: Record<string, string | undefined>,
  ): Promise<T> {
    try {
      const response = await axios.request<T>({
        method,
        url: `${this.projectServiceUrl}${path}`,
        data: body ?? {},
        params,
        headers: authorization ? { authorization } : undefined,
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      if (axiosError.response?.status) {
        throw new HttpException(
          axiosError.response.data?.message ?? 'project-service request failed',
          axiosError.response.status,
        );
      }

      throw new ServiceUnavailableException(
        axiosError.response?.data?.message ?? 'project-service unavailable',
      );
    }
  }

  async forwardAuthHealth<T>(): Promise<T> {
    try {
      const response = await axios.get<T>(`${this.authServiceUrl}/api/v1/auth/health`);
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError<{ message?: string }>;
      if (axiosError.response?.status) {
        throw new HttpException(
          axiosError.response.data?.message ?? 'auth-service request failed',
          axiosError.response.status,
        );
      }

      throw new ServiceUnavailableException(
        axiosError.response?.data?.message ?? 'auth-service unavailable',
      );
    }
  }
}
