import { Injectable, type BeforeApplicationShutdown } from "@nestjs/common";

/**
 * Tracks whether this process has begun a graceful shutdown. Load balancers use
 * readiness, rather than liveness, to avoid routing new requests to an
 * instance that is being removed from service.
 */
@Injectable()
export class ApplicationLifecycleService implements BeforeApplicationShutdown {
  private draining = false;

  isDraining(): boolean {
    return this.draining;
  }

  beforeApplicationShutdown(): void {
    this.draining = true;
  }
}
