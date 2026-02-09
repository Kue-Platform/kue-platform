import { Injectable } from '@nestjs/common';
import { LoggerService } from '../observability/logger.service';
import type { SearchIntent } from '../common/types';

export interface CypherQuery {
  cypher: string;
  params: Record<string, unknown>;
  queryType: string;
}

@Injectable()
export class CypherBuilderService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Convert a SearchIntent into a Cypher query for Neo4j.
   */
  build(intent: SearchIntent, userId: string): CypherQuery {
    switch (intent.queryType) {
      case 'person_search':
        return this.buildPersonSearch(intent, userId);
      case 'company_search':
        return this.buildCompanySearch(intent, userId);
      case 'relationship_query':
        return this.buildRelationshipQuery(intent, userId);
      case 'intro_path':
        return this.buildIntroPathQuery(intent, userId);
      case 'general':
      default:
        return this.buildGeneralSearch(intent, userId);
    }
  }

  /**
   * Person search: find contacts matching role, company, location, name, etc.
   */
  private buildPersonSearch(intent: SearchIntent, userId: string): CypherQuery {
    const { filters } = intent;
    const conditions: string[] = [];
    const params: Record<string, unknown> = { userId };

    // Determine degree — 1st degree by default
    const degree = filters.degree || 1;

    let matchClause: string;
    let returnFields: string;

    if (degree === 1) {
      matchClause = `MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {ownerId: $userId})`;
      returnFields = `p {
        .id, .email, .name, .firstName, .lastName, .title, .company,
        .location, .linkedinUrl, .source,
        strength: r.strength,
        degree: 1
      } AS result`;
    } else {
      // 2nd+ degree: friends-of-friends
      matchClause = `MATCH (u:KueUser {id: $userId})-[r1:KNOWS]->(p1:Person)-[:COLLEAGUES_WITH|KNOWS*1..${degree - 1}]->(p:Person)
      WHERE NOT (u)-[:KNOWS]->(p) AND p.ownerId <> $userId`;
      returnFields = `p {
        .id, .email, .name, .firstName, .lastName, .title, .company,
        .location, .linkedinUrl,
        strength: r1.strength,
        degree: ${degree},
        via: p1 { .id, .name, .email, .title, .company }
      } AS result`;
    }

    // Optional company match
    let companyMatch = '';
    if (filters.companies?.length || filters.industries?.length) {
      companyMatch = `\nOPTIONAL MATCH (p)-[:WORKS_AT]->(c:Company)`;
    }

    // Build WHERE conditions
    if (filters.name) {
      conditions.push(`(toLower(p.name) CONTAINS toLower($nameFilter) OR toLower(p.firstName) CONTAINS toLower($nameFilter) OR toLower(p.lastName) CONTAINS toLower($nameFilter))`);
      params.nameFilter = filters.name;
    }

    if (filters.title) {
      conditions.push(`toLower(p.title) CONTAINS toLower($titleFilter)`);
      params.titleFilter = filters.title;
    }

    if (filters.roles?.length) {
      const roleConditions = filters.roles.map((_, i) => `toLower(p.title) CONTAINS toLower($role${i})`);
      conditions.push(`(${roleConditions.join(' OR ')})`);
      filters.roles.forEach((role, i) => { params[`role${i}`] = role; });
    }

    if (filters.companies?.length) {
      const companyConditions = filters.companies.map((_, i) => `(toLower(p.company) CONTAINS toLower($company${i}) OR toLower(c.name) CONTAINS toLower($company${i}))`);
      conditions.push(`(${companyConditions.join(' OR ')})`);
      filters.companies.forEach((company, i) => { params[`company${i}`] = company; });
    }

    if (filters.locations?.length) {
      const locConditions = filters.locations.map((_, i) => `toLower(p.location) CONTAINS toLower($location${i})`);
      conditions.push(`(${locConditions.join(' OR ')})`);
      filters.locations.forEach((loc, i) => { params[`location${i}`] = loc; });
    }

    if (filters.industries?.length) {
      const indConditions = filters.industries.map((_, i) => `toLower(c.industry) CONTAINS toLower($industry${i})`);
      conditions.push(`(${indConditions.join(' OR ')})`);
      filters.industries.forEach((ind, i) => { params[`industry${i}`] = ind; });
    }

    // Build WHERE clause
    const whereClause = conditions.length > 0
      ? `\nWHERE ${conditions.join('\n  AND ')}`
      : '';

    // Sort order
    const sortClause = this.buildSortClause(filters.sort, degree === 1 ? 'r' : 'r1');

    const cypher = `${matchClause}${companyMatch}${whereClause}
RETURN DISTINCT ${returnFields}
${sortClause}
LIMIT 50`;

    this.logger.debug('Built person search Cypher', {
      queryType: 'person_search',
      degree,
      filterCount: conditions.length,
    });

    return { cypher, params, queryType: 'person_search' };
  }

  /**
   * Company search: find companies and people who work there
   */
  private buildCompanySearch(intent: SearchIntent, userId: string): CypherQuery {
    const { filters } = intent;
    const conditions: string[] = [];
    const params: Record<string, unknown> = { userId };

    let companyFilter = '';
    if (filters.companies?.length) {
      const companyConditions = filters.companies.map((_, i) => `toLower(c.name) CONTAINS toLower($company${i})`);
      companyFilter = `WHERE ${companyConditions.join(' OR ')}`;
      filters.companies.forEach((company, i) => { params[`company${i}`] = company; });
    } else if (filters.name) {
      companyFilter = `WHERE toLower(c.name) CONTAINS toLower($nameFilter)`;
      params.nameFilter = filters.name;
    }

    if (filters.industries?.length) {
      const indConditions = filters.industries.map((_, i) => `toLower(c.industry) CONTAINS toLower($industry${i})`);
      const prefix = companyFilter ? ' AND ' : 'WHERE ';
      companyFilter += `${prefix}(${indConditions.join(' OR ')})`;
      filters.industries.forEach((ind, i) => { params[`industry${i}`] = ind; });
    }

    const cypher = `MATCH (c:Company)
${companyFilter}
OPTIONAL MATCH (p:Person {ownerId: $userId})-[:WORKS_AT]->(c)
OPTIONAL MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p)
RETURN c {
  .id, .name, .domain, .industry, .size, .location,
  contacts: collect(DISTINCT p {
    .id, .email, .name, .title,
    strength: r.strength
  })
} AS result
ORDER BY size(result.contacts) DESC
LIMIT 20`;

    return { cypher, params, queryType: 'company_search' };
  }

  /**
   * Relationship query: find contacts with specific relationship attributes
   */
  private buildRelationshipQuery(intent: SearchIntent, userId: string): CypherQuery {
    const { filters } = intent;
    const conditions: string[] = [];
    const params: Record<string, unknown> = { userId };

    // Filter by strength
    if (filters.sort === 'strength') {
      conditions.push('r.strength > 50');
    }

    // Filter by recency
    if (filters.sort === 'recency') {
      conditions.push('r.lastContact IS NOT NULL');
    }

    const whereClause = conditions.length > 0
      ? `\nWHERE ${conditions.join(' AND ')}`
      : '';

    const sortClause = this.buildSortClause(filters.sort, 'r');

    const cypher = `MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {ownerId: $userId})
OPTIONAL MATCH (p)-[:WORKS_AT]->(c:Company)${whereClause}
RETURN p {
  .id, .email, .name, .firstName, .lastName, .title, .company,
  .location, .linkedinUrl, .source,
  strength: r.strength,
  lastContact: r.lastContact,
  interactionCount: r.interactionCount,
  degree: 1,
  companyInfo: c { .name, .domain, .industry }
} AS result
${sortClause}
LIMIT 50`;

    return { cypher, params, queryType: 'relationship_query' };
  }

  /**
   * Intro path query: find how to reach a target person
   */
  private buildIntroPathQuery(intent: SearchIntent, userId: string): CypherQuery {
    const { filters } = intent;
    const params: Record<string, unknown> = { userId };

    // Try to identify the target person by name or email
    let targetMatch = '';
    if (filters.name) {
      targetMatch = `WHERE toLower(target.name) CONTAINS toLower($targetName)`;
      params.targetName = filters.name;
    }

    const cypher = `MATCH (target:Person)
${targetMatch}
WITH target LIMIT 1
MATCH path = shortestPath(
  (u:KueUser {id: $userId})-[:KNOWS*..4]-(target)
)
WITH path, nodes(path) AS pathNodes, relationships(path) AS rels
RETURN [n IN pathNodes | n {
  .id, .email, .name, .title, .company,
  labels: labels(n)
}] AS nodes,
[r IN rels | r {
  .strength, .source
}] AS relationships,
length(path) AS pathLength`;

    return { cypher, params, queryType: 'intro_path' };
  }

  /**
   * General/keyword search: full-text search across Person and Company nodes
   */
  private buildGeneralSearch(intent: SearchIntent, userId: string): CypherQuery {
    const params: Record<string, unknown> = { userId };
    const query = intent.naturalLanguage.trim();

    // Use Neo4j full-text index for fuzzy matching
    // Escape special Lucene characters and append wildcard
    const sanitized = this.sanitizeLuceneQuery(query);
    params.searchTerm = `${sanitized}~`;
    params.exactTerm = query.toLowerCase();

    const cypher = `CALL db.index.fulltext.queryNodes('person_search', $searchTerm) YIELD node AS p, score
WHERE p.ownerId = $userId
OPTIONAL MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p)
OPTIONAL MATCH (p)-[:WORKS_AT]->(c:Company)
RETURN p {
  .id, .email, .name, .firstName, .lastName, .title, .company,
  .location, .linkedinUrl, .source,
  strength: COALESCE(r.strength, 0),
  degree: CASE WHEN r IS NOT NULL THEN 1 ELSE 0 END,
  relevanceScore: score,
  companyInfo: c { .name, .domain, .industry }
} AS result
ORDER BY score DESC, COALESCE(r.strength, 0) DESC
LIMIT 50`;

    return { cypher, params, queryType: 'general_search' };
  }

  /**
   * Build ORDER BY clause based on sort preference
   */
  private buildSortClause(sort: string | undefined, relAlias: string): string {
    switch (sort) {
      case 'strength':
        return `ORDER BY ${relAlias}.strength DESC`;
      case 'recency':
        return `ORDER BY ${relAlias}.lastContact DESC`;
      case 'relevance':
      default:
        return `ORDER BY ${relAlias}.strength DESC`;
    }
  }

  /**
   * Sanitize a string for use in Lucene full-text queries.
   * Escapes special characters that have meaning in Lucene syntax.
   */
  private sanitizeLuceneQuery(query: string): string {
    // Lucene special chars: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
    return query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
  }
}
