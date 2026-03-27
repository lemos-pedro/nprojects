import { SafeAuthUser } from './auth.service';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SafeAuthUser;
  }
}
