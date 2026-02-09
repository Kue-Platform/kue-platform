import { Injectable } from '@nestjs/common';
import { Neo4jService } from '../database/neo4j.service';
import { LoggerService } from '../observability/logger.service';

export interface NetworkNode {
  id: string;
  email: string;
  name: string;
  title?: string;
  company?: string;
  degree: number;
  strength: number;
}

export interface NetworkPath {
  from: NetworkNode;
  to: NetworkNode;
  via: NetworkNode[];
  totalStrength: number;
}

@Injectable()
export class TraverseService {
  constructor(
    private readonly neo4j: Neo4jService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Find second-degree connections (friends-of-friends)
   */
  async findSecondDegree(
    userId: string,
    options: { limit?: number; minStrength?: number } = {},
  ): Promise<NetworkNode[]> {
    const { limit = 50, minStrength = 0 } = options;

    const result = await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[r1:KNOWS]->(p1:Person)-[:COLLEAGUES_WITH|KNOWS*1..2]->(p2:Person)
      WHERE p2.ownerId <> $userId
        AND NOT (u)-[:KNOWS]->(p2)
        AND r1.strength >= $minStrength
      RETURN DISTINCT p2 {
        .id, .email, .name, .title, .company,
        degree: 2,
        strength: r1.strength
      } AS node
      ORDER BY r1.strength DESC
      LIMIT $limit
      `,
      { userId, minStrength, limit },
      'second_degree',
    );

    return result.records.map((r) => r.get('node'));
  }

  /**
   * Find the shortest intro path between user and a target person
   */
  async findIntroPath(
    userId: string,
    targetPersonId: string,
  ): Promise<NetworkPath | null> {
    const result = await this.neo4j.runQuery(
      `
      MATCH path = shortestPath(
        (u:KueUser {id: $userId})-[:KNOWS*..4]-(target:Person {id: $targetPersonId})
      )
      WITH path, nodes(path) AS pathNodes, relationships(path) AS rels
      RETURN [n IN pathNodes | n {
        .id, .email, .name, .title, .company,
        labels: labels(n)
      }] AS nodes,
      [r IN rels | r {
        .strength, .source
      }] AS relationships
      `,
      { userId, targetPersonId },
      'intro_path',
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    const nodes = record.get('nodes') as Record<string, unknown>[];
    const rels = record.get('relationships') as Record<string, unknown>[];

    if (nodes.length < 2) return null;

    const totalStrength = rels.reduce(
      (sum, r) => sum + ((r.strength as number) || 0),
      0,
    ) / rels.length;

    return {
      from: nodes[0] as unknown as NetworkNode,
      to: nodes[nodes.length - 1] as unknown as NetworkNode,
      via: nodes.slice(1, -1) as unknown as NetworkNode[],
      totalStrength,
    };
  }

  /**
   * Get network overview stats for a user
   */
  async getNetworkStats(userId: string): Promise<{
    totalContacts: number;
    companies: number;
    sources: Record<string, number>;
    avgStrength: number;
  }> {
    const result = await this.neo4j.runQuery(
      `
      MATCH (u:KueUser {id: $userId})-[r:KNOWS]->(p:Person {ownerId: $userId})
      OPTIONAL MATCH (p)-[:WORKS_AT]->(c:Company)
      WITH p, r, c
      RETURN
        count(DISTINCT p) AS totalContacts,
        count(DISTINCT c) AS companies,
        avg(r.strength) AS avgStrength,
        collect(DISTINCT p.source) AS allSources
      `,
      { userId },
      'network_stats',
    );

    const record = result.records[0];
    if (!record) {
      return { totalContacts: 0, companies: 0, sources: {}, avgStrength: 0 };
    }

    // Flatten sources array and count
    const allSources: string[][] = record.get('allSources') || [];
    const sourceCount: Record<string, number> = {};
    for (const sources of allSources) {
      if (Array.isArray(sources)) {
        for (const s of sources) {
          sourceCount[s] = (sourceCount[s] || 0) + 1;
        }
      }
    }

    return {
      totalContacts: record.get('totalContacts')?.toNumber?.() || record.get('totalContacts') || 0,
      companies: record.get('companies')?.toNumber?.() || record.get('companies') || 0,
      sources: sourceCount,
      avgStrength: record.get('avgStrength') || 0,
    };
  }
}
