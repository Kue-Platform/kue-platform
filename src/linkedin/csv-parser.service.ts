import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { LoggerService } from '../observability/logger.service';
import { SentryService } from '../observability/sentry.service';
import { Contact } from '../common/types';

/**
 * LinkedIn CSV column headers (from "Connections" export)
 *
 * Standard LinkedIn CSV format:
 * First Name, Last Name, Email Address, Company, Position, Connected On, URL
 *
 * Some exports may also have:
 * First Name, Last Name, URL, Email Address, Company, Position, Connected On
 */

export interface LinkedInConnection {
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
  position: string | null;
  connectedOn: string | null;
  linkedinUrl: string | null;
}

export interface CsvParseResult {
  contacts: Contact[];
  skipped: number;
  errors: string[];
  totalRows: number;
}

@Injectable()
export class CsvParserService {
  constructor(
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Parse a LinkedIn Connections CSV export buffer into Contact objects
   */
  parseLinkedInCSV(buffer: Buffer | string): CsvParseResult {
    const startTime = Date.now();
    const contacts: Contact[] = [];
    const errors: string[] = [];
    let skipped = 0;

    try {
      const content = typeof buffer === 'string' ? buffer : buffer.toString('utf-8');

      // LinkedIn CSVs often have notes at the top; skip lines until we find the header
      const lines = content.split('\n');
      let headerIndex = -1;

      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const lower = lines[i].toLowerCase();
        if (
          lower.includes('first name') ||
          lower.includes('firstname') ||
          (lower.includes('first') && lower.includes('last'))
        ) {
          headerIndex = i;
          break;
        }
      }

      const csvContent =
        headerIndex > 0
          ? lines.slice(headerIndex).join('\n')
          : content;

      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      });

      for (const row of records) {
        try {
          const connection = this.mapRowToConnection(row);

          // Skip entries without email (LinkedIn doesn't always export emails)
          if (!connection.email) {
            // Still create a contact with a generated placeholder if we have name + company
            if (connection.firstName && connection.company) {
              const contact = this.connectionToContact(connection);
              if (contact) {
                contacts.push(contact);
                continue;
              }
            }
            skipped++;
            continue;
          }

          const contact = this.connectionToContact(connection);
          if (contact) {
            contacts.push(contact);
          } else {
            skipped++;
          }
        } catch (rowError) {
          errors.push(
            `Row error: ${rowError instanceof Error ? rowError.message : String(rowError)}`,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.info('LinkedIn CSV parsed', {
        totalRows: records.length,
        contactsExtracted: contacts.length,
        skipped,
        errors: errors.length,
        durationMs: duration,
      });

      return {
        contacts,
        skipped,
        errors,
        totalRows: records.length,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, {
        context: 'linkedin_csv_parse',
      });
      this.logger.error('LinkedIn CSV parsing failed', {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Map a CSV row to a LinkedInConnection, handling various column name formats
   */
  private mapRowToConnection(
    row: Record<string, string>,
  ): LinkedInConnection {
    // Normalize column names — LinkedIn exports use inconsistent casing/spacing
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key.toLowerCase().trim().replace(/\s+/g, '_')] = value?.trim() || '';
    }

    return {
      firstName:
        normalized['first_name'] ||
        normalized['firstname'] ||
        normalized['first'] ||
        '',
      lastName:
        normalized['last_name'] ||
        normalized['lastname'] ||
        normalized['last'] ||
        '',
      email:
        normalized['email_address'] ||
        normalized['email'] ||
        normalized['e-mail'] ||
        null,
      company:
        normalized['company'] ||
        normalized['organization'] ||
        null,
      position:
        normalized['position'] ||
        normalized['title'] ||
        normalized['job_title'] ||
        null,
      connectedOn:
        normalized['connected_on'] ||
        normalized['connected'] ||
        normalized['date_connected'] ||
        null,
      linkedinUrl:
        normalized['url'] ||
        normalized['profile_url'] ||
        normalized['linkedin_url'] ||
        null,
    };
  }

  /**
   * Convert a LinkedInConnection to our Contact type
   */
  private connectionToContact(
    connection: LinkedInConnection,
  ): Contact | null {
    const { firstName, lastName, email, company, position, linkedinUrl } =
      connection;

    if (!firstName && !lastName && !email) {
      return null;
    }

    const name = [firstName, lastName].filter(Boolean).join(' ').trim();

    // If no email, create a synthetic identifier using name + company
    // This allows dedup to match later when email is discovered
    const contactEmail = email
      ? email.toLowerCase().trim()
      : `${firstName.toLowerCase()}.${lastName.toLowerCase()}@linkedin.placeholder`.replace(
          /\s+/g,
          '',
        );

    return {
      email: contactEmail,
      name: name || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      company: company || undefined,
      title: position || undefined,
      linkedinUrl: linkedinUrl || undefined,
      source: 'linkedin',
    };
  }
}
