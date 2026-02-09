import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { NetworkService } from './network.service';

@ApiTags('Network')
@Controller('network')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class NetworkController {
  constructor(private readonly network: NetworkService) {}

  @Get()
  @ApiOperation({ summary: 'Get network overview and statistics' })
  @ApiResponse({ status: 200, description: 'Network overview' })
  async getNetworkOverview(@CurrentUser() user: AuthenticatedUser) {
    const overview = await this.network.getNetworkOverview(user.id);

    return {
      statusCode: HttpStatus.OK,
      data: overview,
    };
  }

  @Get('second-degree')
  @ApiOperation({ summary: 'Get second-degree connections' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max results (default: 20)' })
  @ApiQuery({ name: 'minStrength', required: false, type: Number, description: 'Minimum relationship strength (0-100)' })
  @ApiResponse({ status: 200, description: 'Second-degree connections' })
  async getSecondDegree(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('minStrength') minStrength?: string,
  ) {
    const connections = await this.network.getSecondDegreeConnections(user.id, {
      limit: limit ? parseInt(limit, 10) : 20,
      minStrength: minStrength ? parseFloat(minStrength) : 0,
    });

    return {
      statusCode: HttpStatus.OK,
      data: connections,
      count: connections.length,
    };
  }

  @Get('intro-path')
  @ApiOperation({ summary: 'Find introduction path to a target person' })
  @ApiQuery({ name: 'targetId', required: true, type: String, description: 'Target person ID' })
  @ApiResponse({ status: 200, description: 'Intro path found' })
  @ApiResponse({ status: 404, description: 'No path found' })
  async findIntroPath(
    @CurrentUser() user: AuthenticatedUser,
    @Query('targetId') targetId: string,
  ) {
    if (!targetId) {
      throw new NotFoundException('Target person ID is required');
    }

    const path = await this.network.findIntroPath(user.id, targetId);

    if (!path) {
      throw new NotFoundException(
        'No introduction path found to the target person',
      );
    }

    return {
      statusCode: HttpStatus.OK,
      data: path,
    };
  }
}
