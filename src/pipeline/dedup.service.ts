import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../database/neo4j.service';
import { LoggerService } from '../observability/logger.service';
import { Contact } from '../common/types';

export interface DedupResult {
  originalCount: number;
  dedupedCount: number;
  mergedCount: number;
}

@Injectable()
export class DedupService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Deduplicate a list of contacts against each other and against
   * existing contacts in Neo4j for a given user.
   *
   * Strategy (in priority order):
   * 1. Exact email match — same person, merge data
   * 2. Fuzzy name + company match — likely same person
   * 3. Domain + first name match — possible same person
   *
   * Returns the deduplicated contact list (merged contacts carry enriched data).
   */
  async deduplicateContacts(
    contacts: Contact[],
    userId: string,
  ): Promise<Contact[]> {
    const startTime = Date.now();

    // Step 1: Dedup within the input list itself (by email)
    const emailMap = new Map<string, Contact>();
    for (const contact of contacts) {
      const key = contact.email.toLowerCase().trim();

      if (emailMap.has(key)) {
        // Merge: prefer non-null values from the new contact
        const existing = emailMap.get(key)!;
        emailMap.set(key, this.mergeContacts(existing, contact));
      } else {
        emailMap.set(key, contact);
      }
    }

    const internalDeduped = Array.from(emailMap.values());
    const internalMerged = contacts.length - internalDeduped.length;

    // Step 2: Check against existing contacts in Neo4j
    const finalContacts: Contact[] = [];
    let crossSourceMerges = 0;

    for (const contact of internalDeduped) {
      // Skip placeholder emails — they need fuzzy matching
      const isPlaceholder = contact.email.endsWith('@linkedin.placeholder');

      if (!isPlaceholder) {
        // Try exact email match in Neo4j
        const existingByEmail = await this.findByEmail(
          contact.email,
          userId,
        );

        if (existingByEmail) {
          // Contact already exists — enrich with new data (source will be merged by graph upsert)
          const enriched = this.enrichExistingContact(
            existingByEmail,
            contact,
          );
          finalContacts.push(enriched);
          crossSourceMerges++;
          continue;
        }
      }

      if (isPlaceholder && contact.firstName && contact.company) {
        // Try fuzzy match: first name + company
        const fuzzyMatch = await this.findByNameAndCompany(
          contact.firstName,
          contact.company,
          userId,
        );

        if (fuzzyMatch) {
          // Use the existing email, enrich with LinkedIn data
          const enriched = this.enrichExistingContact(fuzzyMatch, contact);
          finalContacts.push(enriched);
          crossSourceMerges++;
          continue;
        }

        // Try domain + first name match
        if (contact.lastName) {
          const domainMatch = await this.findByDomainAndName(
            contact.firstName,
            contact.lastName,
            contact.company,
            userId,
          );

          if (domainMatch) {
            const enriched = this.enrichExistingContact(domainMatch, contact);
            finalContacts.push(enriched);
            crossSourceMerges++;
            continue;
          }
        }
      }

      // No match found — this is a new contact
      // If it had a placeholder email, skip it (no reliable identifier)
      if (isPlaceholder) {
        continue;
      }

      finalContacts.push(contact);
    }

    const duration = Date.now() - startTime;
    this.logger.info('Contact deduplication complete', {
      userId,
      originalCount: contacts.length,
      afterInternalDedup: internalDeduped.length,
      internalMerges: internalMerged,
      crossSourceMerges,
      finalCount: finalContacts.length,
      durationMs: duration,
    });

    return finalContacts;
  }

  /**
   * Find duplicates within a user's existing graph and merge them.
   * This is a maintenance operation, not part of the ingestion flow.
   */
  async findAndMergeDuplicates(userId: string): Promise<DedupResult> {
    const startTime = Date.now();

    // Find Person nodes with the same email (shouldn't happen, but safety check)
    const emailDupes = await this.neo4j.runQuery(
      `
      MATCH (p:Person {ownerId: $userId})
      WITH p.email AS email, collect(p) AS persons
      WHERE size(persons) > 1
      RETURN email, [p IN persons | p { .id, .name, .source, .title, .company }] AS duplicates
      `,
      { userId },
      'find_email_dupes',
    );

    let mergedCount = 0;

    for (const record of emailDupes.records) {
      const duplicates = record.get('duplicates') as Record<string, unknown>[];
      if (duplicates.length > 1) {
        // Keep the one with the most data, merge others into it
        await this.mergePersonNodes(
          duplicates.map((d) => d.id as string),
          userId,
        );
        mergedCount += duplicates.length - 1;
      }
    }

    // Find fuzzy duplicates: same name + same company but different emails
    const nameDupes = await this.neo4j.runQuery(
      `
      MATCH (p:Person {ownerId: $userId})
      WHERE p.firstName IS NOT NULL AND p.company IS NOT NULL
      WITH toLower(p.firstName) + '|' + toLower(p.company) AS key, collect(p) AS persons
      WHERE size(persons) > 1
      RETURN key, [p IN persons | p { .id, .email, .name, .source, .title }] AS duplicates
      LIMIT 100
      `,
      { userId },
      'find_name_dupes',
    );

    // For fuzzy matches, we log but don't auto-merge (could be different people)
    const duration = Date.now() - startTime;
    this.logger.info('Duplicate scan complete', {
      userId,
      emailDuplicates: emailDupes.records.length,
      nameSimilar: nameDupes.records.length,
      merged: mergedCount,
      durationMs: duration,
    });

    return {
      originalCount: 0, // Not tracked in maintenance mode
      dedupedCount: 0,
      mergedCount,
    };
  }

  /**
   * Find an existing contact by email
   */
  private async findByEmail(
    email: string,
    userId: string,
  ): Promise<Contact | null> {
    const result = await this.neo4j.runQuery(
      `
      MATCH (p:Person {email: $email, ownerId: $userId})
      RETURN p { .email, .name, .firstName, .lastName, .phone, .company, .title, .linkedinUrl, .source } AS contact
      LIMIT 1
      `,
      { email: email.toLowerCase(), userId },
      'dedup_find_email',
    );

    if (result.records.length === 0) return null;

    const c = result.records[0].get('contact');
    return {
      email: c.email,
      name: c.name,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      company: c.company,
      title: c.title,
      linkedinUrl: c.linkedinUrl,
      source: Array.isArray(c.source) ? c.source[0] : c.source,
    };
  }

  /**
   * Find an existing contact by first name + company (fuzzy)
   */
  private async findByNameAndCompany(
    firstName: string,
    company: string,
    userId: string,
  ): Promise<Contact | null> {
    const result = await this.neo4j.runQuery(
      `
      MATCH (p:Person {ownerId: $userId})
      WHERE toLower(p.firstName) = toLower($firstName)
        AND toLower(p.company) = toLower($company)
      RETURN p { .email, .name, .firstName, .lastName, .phone, .company, .title, .linkedinUrl, .source } AS contact
      LIMIT 1
      `,
      { firstName, company, userId },
      'dedup_find_name_company',
    );

    if (result.records.length === 0) return null;

    const c = result.records[0].get('contact');
    return {
      email: c.email,
      name: c.name,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      company: c.company,
      title: c.title,
      linkedinUrl: c.linkedinUrl,
      source: Array.isArray(c.source) ? c.source[0] : c.source,
    };
  }

  /**
   * Find contact by company domain + name pattern
   */
  private async findByDomainAndName(
    firstName: string,
    lastName: string,
    company: string,
    userId: string,
  ): Promise<Contact | null> {
    // Try to find someone at the same company with matching first+last name
    const result = await this.neo4j.runQuery(
      `
      MATCH (p:Person {ownerId: $userId})
      WHERE toLower(p.company) = toLower($company)
        AND toLower(p.firstName) = toLower($firstName)
        AND toLower(p.lastName) = toLower($lastName)
      RETURN p { .email, .name, .firstName, .lastName, .phone, .company, .title, .linkedinUrl, .source } AS contact
      LIMIT 1
      `,
      { firstName, lastName, company, userId },
      'dedup_find_domain_name',
    );

    if (result.records.length === 0) return null;

    const c = result.records[0].get('contact');
    return {
      email: c.email,
      name: c.name,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      company: c.company,
      title: c.title,
      linkedinUrl: c.linkedinUrl,
      source: Array.isArray(c.source) ? c.source[0] : c.source,
    };
  }

  /**
   * Merge two contacts, preferring non-null values from the newer one
   */
  private mergeContacts(existing: Contact, incoming: Contact): Contact {
    return {
      email: existing.email, // Keep existing email
      name: incoming.name || existing.name,
      firstName: incoming.firstName || existing.firstName,
      lastName: incoming.lastName || existing.lastName,
      phone: incoming.phone || existing.phone,
      company: incoming.company || existing.company,
      title: incoming.title || existing.title,
      linkedinUrl: incoming.linkedinUrl || existing.linkedinUrl,
      source: existing.source, // Source will be merged by graph upsert
    };
  }

  /**
   * Enrich an existing contact with data from a new source
   */
  private enrichExistingContact(
    existing: Contact,
    incoming: Contact,
  ): Contact {
    return {
      email: existing.email, // Always keep the real email
      name: incoming.name || existing.name,
      firstName: incoming.firstName || existing.firstName,
      lastName: incoming.lastName || existing.lastName,
      phone: incoming.phone || existing.phone,
      company: incoming.company || existing.company,
      title: incoming.title || existing.title,
      linkedinUrl: incoming.linkedinUrl || existing.linkedinUrl,
      source: incoming.source, // Use new source for graph upsert source tracking
    };
  }

  /**
   * Merge multiple Person nodes in Neo4j (keep first, transfer relationships from others)
   */
  private async mergePersonNodes(
    personIds: string[],
    userId: string,
  ): Promise<void> {
    if (personIds.length < 2) return;

    const [keepId, ...removeIds] = personIds;

    for (const removeId of removeIds) {
      // Transfer all relationships from duplicate to the kept node
      await this.neo4j.runQuery(
        `
        MATCH (keep:Person {id: $keepId, ownerId: $userId})
        MATCH (dupe:Person {id: $removeId, ownerId: $userId})

        // Merge source arrays
        SET keep.source = [x IN keep.source + dupe.source WHERE x IS NOT NULL | x]

        // Transfer KNOWS relationships
        WITH keep, dupe
        OPTIONAL MATCH (u:KueUser)-[r:KNOWS]->(dupe)
        DELETE r
        WITH keep, dupe, u
        WHERE u IS NOT NULL
        MERGE (u)-[:KNOWS]->(keep)

        // Delete the duplicate
        WITH dupe
        DETACH DELETE dupe
        `,
        { keepId, removeId, userId },
        'merge_person_nodes',
      );
    }

    this.logger.info('Merged duplicate person nodes', {
      keptId: keepId,
      removedIds: removeIds,
      userId,
    });
  }
}
