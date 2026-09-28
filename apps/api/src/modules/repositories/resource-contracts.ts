import type { AppAbility } from '../../casl/types.js';
import {
  RepositoryDto,
  WorkflowRunDto,
  type RepositoryResourceModel,
  type WorkflowRunResourceModel,
} from './dto/resource.dto.js';

/** API endpoint response mapping for queryable ezRepo resources. */
export interface EzRepoEndpointTypeMap {
  repositories: RepositoryDto;
  workflowRuns: WorkflowRunDto;
}

/** Query Kit mapper contracts used by repository and workflow-run endpoints. */
export const resourceMappers = {
  /**
   * Project a tracked repository into its permission-filtered API representation.
   *
   * @param model - Repository record and relations loaded by the query service.
   * @param ability - Optional CASL ability controlling which DTO fields may be exposed.
   * @returns The public repository DTO.
   */
  repositories: (model: RepositoryResourceModel, ability?: AppAbility) => RepositoryDto.fromModel(model, ability),
  /**
   * Project a normalized workflow run into its permission-filtered API representation.
   *
   * @param model - Workflow run and relations loaded by the query service.
   * @param ability - Optional CASL ability controlling which DTO fields may be exposed.
   * @returns The public workflow-run DTO.
   */
  workflowRuns: (model: WorkflowRunResourceModel, ability?: AppAbility) => WorkflowRunDto.fromModel(model, ability),
};
