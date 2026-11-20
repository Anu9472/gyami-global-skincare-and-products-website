import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuth2Client } from "google-auth-library";

export interface GoogleIdentity {
  email: string;
  firstName: string;
  lastName: string;
}

@Injectable()
export class GoogleIdentityService {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    const audience = this.config.get<string>("GOOGLE_OAUTH_CLIENT_ID");
    if (!audience) {
      throw new ServiceUnavailableException("Google sign-in is not configured");
    }
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.email || payload.email_verified !== true) {
        throw new UnauthorizedException("Google did not verify this email address");
      }
      return {
        email: payload.email.toLowerCase(),
        firstName: payload.given_name?.trim() || "Google",
        lastName: payload.family_name?.trim() || "Customer",
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new BadRequestException("Google sign-in token is invalid or expired");
    }
  }
}
