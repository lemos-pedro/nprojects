import { Test, TestingModule } from '@nestjs/testing';

import { AppModule } from './app.module';

describe('CommunicationService AppModule', () => {
  it('builds the module', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(module).toBeDefined();
  });
});
