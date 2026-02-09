import { Injectable } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import type { Auth } from 'googleapis';
import { LoggerService } from '../observability/logger.service';
import { SentryService } from '../observability/sentry.service';
import { Contact } from '../common/types';

export interface CalendarSyncResult {
  contacts: Contact[];
  eventsProcessed: number;
  syncToken: string | null;
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Fetch calendar events and extract attendee contacts
   * Supports full sync and incremental sync via syncToken
   */
  async fetchAndExtractAttendees(
    authClient: Auth.OAuth2Client,
    options: {
      maxResults?: number;
      syncToken?: string;
      timeMin?: string; // ISO date string
      userEmail?: string;
    } = {},
  ): Promise<CalendarSyncResult> {
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    const {
      maxResults = 500,
      syncToken,
      timeMin = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year ago
      userEmail,
    } = options;
    const startTime = Date.now();

    try {
      const contactMap = new Map<string, Contact>();
      let eventsProcessed = 0;
      let pageToken: string | undefined;
      let nextSyncToken: string | null = null;

      while (eventsProcessed < maxResults) {
        const params: calendar_v3.Params$Resource$Events$List = {
          calendarId: 'primary',
          maxResults: Math.min(250, maxResults - eventsProcessed),
          singleEvents: true,
          orderBy: 'startTime',
          pageToken,
        };

        if (syncToken) {
          params.syncToken = syncToken;
        } else {
          params.timeMin = timeMin;
        }

        const response = await calendar.events.list(params);

        const events = response.data.items || [];
        for (const event of events) {
          this.extractAttendeesFromEvent(event, contactMap, userEmail);
          eventsProcessed++;
        }

        nextSyncToken = response.data.nextSyncToken || null;
        pageToken = response.data.nextPageToken || undefined;

        if (!pageToken) break;
      }

      this.logger.info('Calendar sync complete', {
        contactsFound: contactMap.size,
        eventsProcessed,
        isIncremental: !!syncToken,
        durationMs: Date.now() - startTime,
      });

      return {
        contacts: Array.from(contactMap.values()),
        eventsProcessed,
        syncToken: nextSyncToken,
      };
    } catch (error: any) {
      // Handle expired syncToken
      if (error?.code === 410 && syncToken) {
        this.logger.warn('Calendar syncToken expired, triggering full sync');
        return this.fetchAndExtractAttendees(authClient, {
          maxResults,
          timeMin,
          userEmail,
        });
      }

      this.sentry.captureException(error as Error, { context: 'calendar_sync' });
      this.logger.error('Calendar sync failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Extract attendees from a single calendar event
   */
  private extractAttendeesFromEvent(
    event: calendar_v3.Schema$Event,
    contactMap: Map<string, Contact>,
    userEmail?: string,
  ): void {
    const attendees = event.attendees || [];

    for (const attendee of attendees) {
      if (!attendee.email) continue;

      const email = attendee.email.toLowerCase().trim();

      // Skip the user's own email
      if (userEmail && email === userEmail.toLowerCase()) continue;

      // Skip resource rooms and group calendars
      if (attendee.resource) continue;
      if (email.includes('calendar.google.com')) continue;
      if (email.includes('group.calendar')) continue;

      if (contactMap.has(email)) continue;

      const displayName = attendee.displayName;
      const nameParts = displayName ? displayName.split(/\s+/) : [];

      contactMap.set(email, {
        email,
        name: displayName || undefined,
        firstName: nameParts[0] || undefined,
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined,
        source: 'calendar',
      });
    }
  }
}
