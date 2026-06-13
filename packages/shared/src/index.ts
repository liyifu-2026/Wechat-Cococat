// Export types from types module
export * from "./types/index.js";

// Export HTTP client
export {
  WeChatClient,
  type WeChatClientOptions,
  type StatusResponse,
  type AuthStatus,
} from "./client.js";

export {
  getCococatConfigDir,
  getCococatDataRoot,
  getAgentWeChatDataRoot,
  getWeChatHomeHostPath,
  getAgentDataHostPath,
  getArtifactsHostPath,
  ensureHostDataDirs,
  resolveArtifactPath,
} from "./paths.js";

export { encodeChatDir } from "./chat-id.js";

export {
  AGENT_SCOPE_VERSION,
  MAX_PATH_HINTS,
  MAX_PURPOSE_CHARS,
  MAX_TAGS,
  buildAgentScopePayload,
  extractPurposeFromOverview,
  extractTagsAndPathHints,
  type AgentScopePayload,
} from "./agent-scope.js";

export {
  getAuthTokenPath,
  readAuthToken,
  ensureAuthToken,
} from "./auth.js";

export type { NewMessagesChatInfo, NewMessagesEvent } from "./types/WeChatEvents.js";
export { isNewMessagesEvent } from "./types/WeChatEvents.js";

// Export schemas (but not the inferred types which duplicate types/)
export {
  // Session schemas
  sessionStatusSchema,
  sessionSchema,
  createSessionParamsSchema,
  sessionIdParamsSchema,
  sessionNameParamsSchema,
  dbSessionRowSchema,
  // Container lifecycle schemas
  upParamsSchema,
  upResultSchema,
  statusSchema,
  // Authentication schemas
  loginStateSchema,
  loginResultSchema,
  loginSubscriptionEventSchema,
  // Chat schemas
  chatSchema,
  listChatsParamsSchema,
  findChatParamsSchema,
  getChatParamsSchema,
  openChatParamsSchema,
  openChatResultSchema,
  // Message schemas
  messageSchema,
  listMessagesParamsSchema,
  sendParamsSchema,
  sendResultSchema,
  getMediaParamsSchema,
  mediaResultSchema,
  // Agent config schema
  agentConfigSchema,
} from "./schemas/index.js";
