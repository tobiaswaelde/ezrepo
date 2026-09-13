import { Module } from '@nestjs/common';

import { CaslModule } from '../../casl/casl.module.js';
import { IssuesQueryService } from './issues-query.service.js';
import { IssuesController } from './issues.controller.js';

@Module({
  imports: [CaslModule],
  controllers: [IssuesController],
  providers: [IssuesQueryService],
  exports: [IssuesQueryService],
})
export class IssuesModule {}
