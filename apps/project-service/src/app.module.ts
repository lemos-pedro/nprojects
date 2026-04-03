import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ProjectController } from './project.controller';
import { ProjectAuthGuard } from './project-auth.guard';
import { ProjectService } from './project.service';

@Module({
  controllers: [ProjectController],
  providers: [
    ProjectService,
    {
      provide: APP_GUARD,
      useClass: ProjectAuthGuard,
    },
  ],
})
export class AppModule {}
