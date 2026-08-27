import { createRuntimeBearerJwtAssertionVerifier } from '../src/http/bearer-jwt-assertion.js';
import { createDlqAdminHttpHandler } from '../src/http/dlq-admin-handler.js';
import { DlqAdminService } from '../src/modules/dlq/dlq-admin-service.js';

const handler = createDlqAdminHttpHandler({
  service: new DlqAdminService(),
  assertionVerifier: createRuntimeBearerJwtAssertionVerifier(),
});

export default handler;
