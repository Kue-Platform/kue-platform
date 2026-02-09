import { Injectable } from '@nestjs/common';
import { google, gmail_v1 } from 'googleapis';
import type { Auth } from 'googleapis';
import { LoggerService } from '../observability/logger.service';
import { MetricsService } from '../observability/metrics.service';
import { SentryService } from '../observability/sentry.service';
import { Contact } from '../common/types';

export interface GmailSyncResult {
  contacts: Contact[];
  messagesProcessed: number;
  historyId: string | null;
}

export interface GmailMessageMeta {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: Date;
  direction: 'sent' | 'received';
}

@Injectable()
export class GmailService {
  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Fetch messages from Gmail and extract contacts
   * Supports full sync (no historyId) and incremental sync (with historyId)
   */
  async fetchAndExtractContacts(
    authClient: Auth.OAuth2Client,
    options: {
      maxResults?: number;
      historyId?: string;
      userEmail?: string;
    } = {},
  ): Promise<GmailSyncResult> {
    const gmail = google.gmail({ version: 'v1', auth: authClient });
    const { maxResults = 500, historyId, userEmail } = options;
    const startTime = Date.now();

    try {
      let messages: gmail_v1.Schema$Message[];

      if (historyId) {
        // Incremental sync using history API
        messages = await this.fetchMessagesByHistory(gmail, historyId);
      } else {
        // Full sync — fetch recent messages
        messages = await this.fetchRecentMessages(gmail, maxResults);
      }

      this.logger.info('Gmail messages fetched', {
        count: messages.length,
        isIncremental: !!historyId,
      });

      // Extract contacts from message headers
      const contactMap = new Map<string, Contact>();
      const senderEmail = userEmail?.toLowerCase();

      for (const msg of messages) {
        if (!msg.id) continue;

        try {
          const meta = await this.getMessageMetadata(gmail, msg.id, senderEmail);
          if (!meta) continue;

          // Add all participants as contacts
          this.addContactFromHeader(contactMap, meta.from, 'gmail');
          for (const to of meta.to) {
            this.addContactFromHeader(contactMap, to, 'gmail');
          }
          for (const cc of meta.cc) {
            this.addContactFromHeader(contactMap, cc, 'gmail');
          }
        } catch (error) {
          // Skip individual message errors, continue with others
          this.logger.debug('Failed to process Gmail message', {
            messageId: msg.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Remove the user's own email from contacts
      if (senderEmail) {
        contactMap.delete(senderEmail);
      }

      // Get latest historyId for future incremental syncs
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const latestHistoryId = profile.data.historyId || null;

      const duration = Date.now() - startTime;
      this.logger.info('Gmail contact extraction complete', {
        contactsFound: contactMap.size,
        messagesProcessed: messages.length,
        durationMs: duration,
      });

      return {
        contacts: Array.from(contactMap.values()),
        messagesProcessed: messages.length,
        historyId: latestHistoryId,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, { context: 'gmail_sync' });
      this.logger.error('Gmail sync failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Fetch recent messages (full sync)
   */
  private async fetchRecentMessages(
    gmail: gmail_v1.Gmail,
    maxResults: number,
  ): Promise<gmail_v1.Schema$Message[]> {
    const allMessages: gmail_v1.Schema$Message[] = [];
    let pageToken: string | undefined;

    while (allMessages.length < maxResults) {
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(100, maxResults - allMessages.length),
        pageToken,
        q: 'in:inbox OR in:sent', // Focus on inbox and sent
      });

      const messages = response.data.messages || [];
      allMessages.push(...messages);

      pageToken = response.data.nextPageToken || undefined;
      if (!pageToken) break;
    }

    return allMessages;
  }

  /**
   * Fetch messages updated since a history ID (incremental sync)
   */
  private async fetchMessagesByHistory(
    gmail: gmail_v1.Gmail,
    startHistoryId: string,
  ): Promise<gmail_v1.Schema$Message[]> {
    const allMessages: gmail_v1.Schema$Message[] = [];
    let pageToken: string | undefined;

    try {
      while (true) {
        const response = await gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded'],
          pageToken,
        });

        const history = response.data.history || [];
        for (const entry of history) {
          const messages = entry.messagesAdded || [];
          for (const added of messages) {
            if (added.message) {
              allMessages.push(added.message);
            }
          }
        }

        pageToken = response.data.nextPageToken || undefined;
        if (!pageToken) break;
      }
    } catch (error: any) {
      // If historyId is too old, fall back to full sync
      if (error?.code === 404) {
        this.logger.warn('History ID expired, will need full sync');
        return [];
      }
      throw error;
    }

    return allMessages;
  }

  /**
   * Get message metadata (headers only, not full body)
   */
  private async getMessageMetadata(
    gmail: gmail_v1.Gmail,
    messageId: string,
    senderEmail?: string,
  ): Promise<GmailMessageMeta | null> {
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
    });

    const headers = response.data.payload?.headers || [];
    const getHeader = (name: string): string =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('From');
    const to = getHeader('To');
    const cc = getHeader('Cc');
    const subject = getHeader('Subject');
    const dateStr = getHeader('Date');

    if (!from) return null;

    const fromEmail = this.extractEmail(from)?.toLowerCase();
    const direction: 'sent' | 'received' =
      senderEmail && fromEmail === senderEmail ? 'sent' : 'received';

    return {
      id: messageId,
      from,
      to: to ? to.split(',').map((t) => t.trim()).filter(Boolean) : [],
      cc: cc ? cc.split(',').map((c) => c.trim()).filter(Boolean) : [],
      subject,
      date: dateStr ? new Date(dateStr) : new Date(),
      direction,
    };
  }

  /**
   * Parse "Name <email@example.com>" or "email@example.com" format
   */
  private addContactFromHeader(
    contactMap: Map<string, Contact>,
    headerValue: string,
    source: string,
  ): void {
    const email = this.extractEmail(headerValue);
    if (!email) return;

    const normalizedEmail = email.toLowerCase().trim();

    // Skip noreply, system emails, etc.
    if (this.isSystemEmail(normalizedEmail)) return;

    if (contactMap.has(normalizedEmail)) return;

    const name = this.extractName(headerValue);
    const nameParts = name ? name.split(/\s+/) : [];

    contactMap.set(normalizedEmail, {
      email: normalizedEmail,
      name: name || undefined,
      firstName: nameParts[0] || undefined,
      lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined,
      source,
    });
  }

  private extractEmail(header: string): string | null {
    // Match "Name <email>" or just "email"
    const angleMatch = header.match(/<([^>]+)>/);
    if (angleMatch) return angleMatch[1];

    const emailMatch = header.match(/[\w.+-]+@[\w.-]+\.\w+/);
    return emailMatch ? emailMatch[0] : null;
  }

  private extractName(header: string): string | null {
    // Match "Name <email>" — extract name part
    const match = header.match(/^"?([^"<]+)"?\s*</);
    if (match) {
      return match[1].trim().replace(/"/g, '');
    }
    return null;
  }

  private isSystemEmail(email: string): boolean {
    const systemPatterns = [
      'noreply',
      'no-reply',
      'donotreply',
      'do-not-reply',
      'mailer-daemon',
      'postmaster',
      'notifications',
      'alert',
      'bounce',
      'unsubscribe',
    ];
    const localPart = email.split('@')[0];
    return systemPatterns.some((p) => localPart.includes(p));
  }
}
