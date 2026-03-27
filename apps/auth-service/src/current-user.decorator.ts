import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { SafeAuthUser } from './auth.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SafeAuthUser => {
    const request = context.switchToHttp().getRequest();
    return request.user as SafeAuthUser;
  },
);
