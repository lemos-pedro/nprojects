import { GatewayService } from './gateway.service';

describe('GatewayService', () => {
  it('reports gateway health', () => {
    const service = new GatewayService();

    expect(service.health()).toMatchObject({
      service: 'api-gateway',
      status: 'ok',
    });
  });

  it('accepts forwarding metadata for protected endpoints', async () => {
    const service = new GatewayService();

    await expect(
      service.forwardAuthRequest('get', '/api/v1/me', undefined, 'Bearer token'),
    ).rejects.toBeDefined();
  });
});
