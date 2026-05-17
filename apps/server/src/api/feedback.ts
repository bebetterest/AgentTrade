import type { FastifyInstance } from "fastify";
import { getApiOperation } from "@agentrade/contracts";
import {
  type Address,
  type FeedbackReportType,
  ServerAuditCategory
} from "@agentrade/types";
import { DomainError } from "../domain/errors.js";
import type { AppServices } from "./services.js";
import {
  parseOperationBody,
  parseOperationParams,
  parseOperationQuery,
  toServerRoutePath,
  toWriteAuditContext,
  validateFeedbackReportInput,
  validateOperationResponse
} from "./services.js";

const createOperation = getApiOperation("feedbackCreateV2");
const listOperation = getApiOperation("feedbackListV2");
const getOperation = getApiOperation("feedbackGetV2");

export const registerFeedbackRoutes = (app: FastifyInstance, services: AppServices): void => {
  app.post(
    toServerRoutePath(createOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireActiveAgent] },
    async (request) => {
      const body = parseOperationBody<{
        type: FeedbackReportType;
        title: string;
        bodyMd: string;
      }>(createOperation, request);
      validateFeedbackReportInput(body, services.config);

      const reporterAddress = request.agentAddress as Address;
      const writeMeta = services.writeMeta({
        request,
        operation: "feedback.submit",
        actor: reporterAddress,
        auditCategory: ServerAuditCategory.DOMAIN_WRITE,
        targetType: "feedback-report",
        details: {
          type: body.type
        }
      });
      const create = () =>
        services.createFeedbackReport({
          type: body.type,
          title: body.title,
          bodyMd: body.bodyMd,
          reporterAddress,
          auditContext: toWriteAuditContext(writeMeta)
        });
      const report = services.stateRepository
        ? await services.mutateDirect(create, writeMeta)
        : await create();

      return validateOperationResponse(createOperation, report);
    }
  );

  app.get(
    toServerRoutePath(listOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (request) => {
      const query = parseOperationQuery<{
        cursor?: string;
        limit?: number;
        type?: FeedbackReportType;
        reporter?: Address;
      }>(listOperation, request);
      return validateOperationResponse(
        listOperation,
        await services.listFeedbackReports({
          cursor: query.cursor,
          limit: query.limit ?? 20,
          type: query.type,
          reporter: query.reporter
        })
      );
    }
  );

  app.get(
    toServerRoutePath(getOperation.pathTemplate),
    { preHandler: [app.authenticate, app.requireAdmin] },
    async (request) => {
      const params = parseOperationParams<{ id: string }>(getOperation, request);
      const report = await services.getFeedbackReport(params.id);
      if (!report) {
        throw new DomainError("FEEDBACK_REPORT_NOT_FOUND", "feedback report not found", 404);
      }
      return validateOperationResponse(getOperation, report);
    }
  );
};
