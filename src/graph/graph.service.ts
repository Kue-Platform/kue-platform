import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../database/neo4j.service';
import { LoggerService } from '../observability/logger.service';
import { SentryService } from '../observability/sentry.service';
import { Contact } from '../common/types';

export interface UpsertPersonResult {
  id: string;
  email: string;
  isNew: boolean;
}

export interface UpsertCompanyResult {
  id: string;
  name: string;
  domain: string | null;
  isNew: boolean;
}

@Injectable()
export class GraphService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Upsert a Person node in Neo4j from a Contact
   * Merges on email, updates all other fields
   */
  async upsertPerson(
    contact: Contact,
    ownerId: string,
  ): Promise<UpsertPersonResult> {
    const result = await this.neo4j.runQuery(
      `
      MERGE (p:Person {email: $email, ownerId: $ownerId})
      ON CREATE SET
        p.id = randomUUID(),
        p.name = COALESCE($name, p.name, $email),
        p.firstName = COALESCE($firstName, p.firstName),
        p.lastName = COALESCE($lastName, p.lastName),
        p.phone = COALESCE($phone, p.phone),
        p.title = COALESCE($title, p.title),
        p.company = COALESCE($company, p.company),
        p.linkedinUrl = COALESCE($linkedinUrl, p.linkedinUrl),
        p.source = [$source],
        p.createdAt = datetime(),
        p.updatedAt = datetime(),
        p._isNew = true
      ON MATCH SET
        p.name = COALESCE($name, p.name),
        p.firstName = COALESCE($firstName, p.firstName),
        p.lastName = COALESCE($lastName, p.lastName),
        p.phone = COALESCE($phone, p.phone),
        p.title = COALESCE($title, p.title),
        p.company = COALESCE($company, p.company),
        p.linkedinUrl = COALESCE($linkedinUrl, p.linkedinUrl),
        p.source = CASE
          WHEN NOT $source IN p.source THEN p.source + $source
          ELSE p.source
        END,
        p.updatedAt = datetime(),
        p._isNew = false
      WITH p, p._isNew AS isNew
      REMOVE p._isNew
      RETURN p.id AS id, p.email AS email, isNew
      `,
      {
        email: contact.email,
        name: contact.name || null,
        firstName: contact.firstName || null,
        lastName: contact.lastName || null,
        phone: contact.phone || null,
        title: contact.title || null,
        company: contact.company || null,
        linkedinUrl: contact.linkedinUrl || null,
        source: contact.source,
        ownerId,
      },
      'upsert_person',
    );

    const record = result.records[0];
    return {
      id: record.get('id'),
      email: record.get('email'),
      isNew: record.get('isNew'),
    };
  }

  /**
   * Upsert a Company node, matched by domain (or name if no domain)
   */
  async upsertCompany(
    name: string,
    domain: string | null,
  ): Promise<UpsertCompanyResult> {
    const matchField = domain ? 'domain' : 'name';
    const matchValue = domain || name;

    const result = await this.neo4j.runQuery(
      `
      MERGE (c:Company {${matchField}: $matchValue})
      ON CREATE SET
        c.id = randomUUID(),
        c.name = $name,
        c.domain = $domain,
        c.createdAt = datetime(),
        c._isNew = true
      ON MATCH SET
        c.name = COALESCE($name, c.name),
        c._isNew = false
      WITH c, c._isNew AS isNew
      REMOVE c._isNew
      RETURN c.id AS id, c.name AS name, c.domain AS domain, isNew
      `,
      { name, domain, matchValue },
      'upsert_company',
    );

    const record = result.records[0];
    return {
      id: record.get('id'),
      name: record.get('name'),
      domain: record.get('domain'),
      isNew: record.get('isNew'),
    };
  }

  /**
   * Create or update KNOWS relationship between KueUser and Person
   */
  async upsertKnowsRelationship(
    userId: string,
    personEmail: string,
    source: string,
  ): Promise<void> {
    await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})
      MATCH (p:Person {email: $personEmail, ownerId: $userId})
      MERGE (u)-[r:KNOWS]->(p)
      ON CREATE SET
        r.source = $source,
        r.strength = 0.0,
        r.interactionCount = 1,
        r.firstContact = datetime(),
        r.lastContact = datetime()
      ON MATCH SET
        r.interactionCount = r.interactionCount + 1,
        r.lastContact = datetime(),
        r.source = CASE
          WHEN r.source <> $source THEN $source
          ELSE r.source
        END
      `,
      { userId, personEmail, source },
      'upsert_knows',
    );
  }

  /**
   * Create WORKS_AT relationship between Person and Company
   */
  async upsertWorksAt(
    personEmail: string,
    companyName: string,
    ownerId: string,
  ): Promise<void> {
    await this.neo4j.runQuery(
      `
      MATCH (p:Person {email: $personEmail, ownerId: $ownerId})
      MATCH (c:Company {name: $companyName})
      MERGE (p)-[r:WORKS_AT]->(c)
      ON CREATE SET
        r.since = datetime()
      `,
      { personEmail, companyName, ownerId },
      'upsert_works_at',
    );
  }

  /**
   * Ensure the KueUser node exists in Neo4j
   */
  async ensureKueUser(userId: string, email: string, name?: string): Promise<void> {
    await this.neo4j.runQuery(
      `
      MERGE (u:KueUser {id: $userId})
      ON CREATE SET
        u.email = $email,
        u.name = $name,
        u.createdAt = datetime()
      ON MATCH SET
        u.email = $email,
        u.name = COALESCE($name, u.name)
      `,
      { userId, email, name: name || null },
      'ensure_kue_user',
    );
  }

  /**
   * Batch ingest contacts — upserts persons, companies, and relationships
   */
  async batchIngestContacts(
    contacts: Contact[],
    userId: string,
    userEmail: string,
  ): Promise<{
    newPersons: number;
    updatedPersons: number;
    newCompanies: number;
    relationships: number;
  }> {
    const startTime = Date.now();
    let newPersons = 0;
    let updatedPersons = 0;
    let newCompanies = 0;
    let relationships = 0;

    try {
      // Ensure the KueUser node exists
      await this.ensureKueUser(userId, userEmail);

      // Process contacts in batches to avoid overwhelming Neo4j
      const batchSize = 50;
      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize);

        for (const contact of batch) {
          try {
            // Upsert Person
            const personResult = await this.upsertPerson(contact, userId);
            if (personResult.isNew) {
              newPersons++;
            } else {
              updatedPersons++;
            }

            // Upsert KNOWS relationship
            await this.upsertKnowsRelationship(userId, contact.email, contact.source);
            relationships++;

            // Upsert Company if present
            if (contact.company) {
              const domain = this.extractDomain(contact.email);
              const companyResult = await this.upsertCompany(contact.company, domain);
              if (companyResult.isNew) {
                newCompanies++;
              }

              // Link Person to Company
              await this.upsertWorksAt(contact.email, contact.company, userId);
            }
          } catch (error) {
            this.logger.error('Failed to ingest contact', {
              email: contact.email,
              error: error instanceof Error ? error.message : String(error),
            });
            // Continue with other contacts
          }
        }

        this.logger.debug('Batch ingest progress', {
          processed: Math.min(i + batchSize, contacts.length),
          total: contacts.length,
        });
      }

      const duration = Date.now() - startTime;
      this.logger.info('Batch ingest complete', {
        userId,
        newPersons,
        updatedPersons,
        newCompanies,
        relationships,
        totalContacts: contacts.length,
        durationMs: duration,
      });

      return { newPersons, updatedPersons, newCompanies, relationships };
    } catch (error) {
      this.sentry.captureException(error as Error, {
        userId,
        context: 'batch_ingest',
        contactCount: contacts.length,
      });
      throw error;
    }
  }

  /**
   * Get count of contacts for a user
   */
  async getContactCount(userId: string): Promise<number> {
    const result = await this.neo4j.runQuery(
      `
      MATCH (p:Person {ownerId: $userId})
      RETURN count(p) AS count
      `,
      { userId },
      'contact_count',
    );

    return result.records[0]?.get('count')?.toNumber() || 0;
  }

  /**
   * Get contacts for a user with pagination
   */
  async getContacts(
    userId: string,
    options: { skip?: number; limit?: number; sortBy?: string } = {},
  ): Promise<Record<string, unknown>[]> {
    const { skip = 0, limit = 50, sortBy = 'name' } = options;

    const result = await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {ownerId: $userId})
      OPTIONAL MATCH (p)-[:WORKS_AT]->(c:Company)
      RETURN p {
        .id, .email, .name, .firstName, .lastName, .title, .phone,
        .company, .source, .linkedinUrl, .location,
        .createdAt, .updatedAt,
        strength: r.strength,
        interactionCount: r.interactionCount,
        lastContact: r.lastContact,
        companyInfo: c { .name, .domain, .industry, .size }
      } AS contact
      ORDER BY p.${sortBy === 'strength' ? 'name' : sortBy}
      SKIP $skip
      LIMIT $limit
      `,
      { userId, skip: neo4jInt(skip), limit: neo4jInt(limit) },
      'get_contacts',
    );

    return result.records.map((r) => r.get('contact'));
  }

  private extractDomain(email: string): string | null {
    const parts = email.split('@');
    if (parts.length !== 2) return null;
    const domain = parts[1].toLowerCase();

    // Skip common free email providers
    const freeProviders = [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
      'aol.com', 'icloud.com', 'mail.com', 'protonmail.com',
    ];
    if (freeProviders.includes(domain)) return null;

    return domain;
  }
}

// Helper to create Neo4j integer from JS number
function neo4jInt(value: number): number {
  return value;
}
