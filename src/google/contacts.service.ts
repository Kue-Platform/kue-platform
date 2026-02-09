import { Injectable } from '@nestjs/common';
import { google, people_v1 } from 'googleapis';
import type { Auth } from 'googleapis';
import { LoggerService } from '../observability/logger.service';
import { SentryService } from '../observability/sentry.service';
import { Contact } from '../common/types';

export interface ContactsSyncResult {
  contacts: Contact[];
  totalSynced: number;
  syncToken: string | null;
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Fetch contacts from Google People API
   * Supports full sync (no syncToken) and incremental (with syncToken)
   */
  async fetchContacts(
    authClient: Auth.OAuth2Client,
    options: {
      pageSize?: number;
      syncToken?: string;
    } = {},
  ): Promise<ContactsSyncResult> {
    const peopleService = google.people({ version: 'v1', auth: authClient });
    const { pageSize = 100, syncToken } = options;
    const startTime = Date.now();

    try {
      const allContacts: Contact[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | null = null;

      while (true) {
        const params: people_v1.Params$Resource$People$Connections$List = {
          resourceName: 'people/me',
          pageSize: Math.min(pageSize, 1000),
          personFields: 'names,emailAddresses,phoneNumbers,organizations,photos,metadata',
          pageToken,
        };

        if (syncToken) {
          params.syncToken = syncToken;
        }

        const response = await peopleService.people.connections.list(params);

        const connections = response.data.connections || [];

        for (const person of connections) {
          const contact = this.parseGoogleContact(person);
          if (contact) {
            allContacts.push(contact);
          }
        }

        nextSyncToken = response.data.nextSyncToken || null;
        pageToken = response.data.nextPageToken || undefined;

        if (!pageToken) break;
      }

      this.logger.info('Google Contacts sync complete', {
        contactsFound: allContacts.length,
        isIncremental: !!syncToken,
        durationMs: Date.now() - startTime,
      });

      return {
        contacts: allContacts,
        totalSynced: allContacts.length,
        syncToken: nextSyncToken,
      };
    } catch (error: any) {
      // Handle expired syncToken
      if (error?.code === 410 && syncToken) {
        this.logger.warn('Google Contacts syncToken expired, triggering full sync');
        return this.fetchContacts(authClient, { pageSize });
      }

      this.sentry.captureException(error as Error, { context: 'google_contacts_sync' });
      this.logger.error('Google Contacts sync failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Parse a Google People API person into our Contact type
   */
  private parseGoogleContact(person: people_v1.Schema$Person): Contact | null {
    const primaryEmail = person.emailAddresses?.find((e) => e.metadata?.primary)
      || person.emailAddresses?.[0];

    if (!primaryEmail?.value) {
      return null; // Skip contacts without email
    }

    const primaryName = person.names?.find((n) => n.metadata?.primary)
      || person.names?.[0];

    const primaryOrg = person.organizations?.find((o) => o.metadata?.primary)
      || person.organizations?.[0];

    const primaryPhone = person.phoneNumbers?.find((p) => p.metadata?.primary)
      || person.phoneNumbers?.[0];

    return {
      email: primaryEmail.value.toLowerCase().trim(),
      name: primaryName?.displayName || undefined,
      firstName: primaryName?.givenName || undefined,
      lastName: primaryName?.familyName || undefined,
      company: primaryOrg?.name || undefined,
      title: primaryOrg?.title || undefined,
      phone: primaryPhone?.value || undefined,
      source: 'google_contacts',
    };
  }
}
