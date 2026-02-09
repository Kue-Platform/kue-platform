import { INestApplication } from '@nestjs/common';

/**
 * Global reference to the NestJS application instance.
 * Set during bootstrap in main.ts, used by Inngest functions
 * to resolve NestJS services from the DI container.
 */
let appInstance: INestApplication | null = null;

export function setAppInstance(app: INestApplication): void {
  appInstance = app;
}

export function getAppInstance(): INestApplication {
  if (!appInstance) {
    throw new Error(
      'NestJS app instance not set. Ensure setAppInstance() is called in main.ts bootstrap.',
    );
  }
  return appInstance;
}
