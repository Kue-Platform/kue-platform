import { Injectable } from '@nestjs/common';
import { TraverseService } from '../graph/traverse.service';
import { GraphService } from '../graph/graph.service';
import { LoggerService } from '../observability/logger.service';

@Injectable()
export class NetworkService {
  constructor(
    private readonly traverse: TraverseService,
    private readonly graph: GraphService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get full network overview for a user
   */
  async getNetworkOverview(userId: string) {
    const stats = await this.traverse.getNetworkStats(userId);

    return {
      totalContacts: stats.totalContacts,
      companies: stats.companies,
      averageStrength: Math.round(stats.avgStrength * 100) / 100,
      sourceBreakdown: stats.sources,
    };
  }

  /**
   * Get second-degree connections for a user
   */
  async getSecondDegreeConnections(
    userId: string,
    options: { limit?: number; minStrength?: number } = {},
  ) {
    const { limit = 20, minStrength = 0 } = options;
    return this.traverse.findSecondDegree(userId, { limit, minStrength });
  }

  /**
   * Find intro path to a target person
   */
  async findIntroPath(userId: string, targetPersonId: string) {
    const path = await this.traverse.findIntroPath(userId, targetPersonId);

    if (!path) {
      return null;
    }

    return {
      from: path.from,
      to: path.to,
      via: path.via,
      totalStrength: Math.round(path.totalStrength * 100) / 100,
      degrees: path.via.length + 1,
    };
  }
}
