#!/usr/bin/env node
/**
 * Ensure canonical CocoCat host paths and auth token (used by dev.sh / stack scripts).
 * Writes only under ~/.config/cococat/; reads legacy paths via readAuthToken().
 */
import {
  ensureAuthToken,
  ensureHostDataDirs,
  getAgentDataHostPath,
  getAuthTokenPath,
  getWeChatHomeHostPath,
} from "../packages/shared/dist/index.js";

ensureHostDataDirs();
ensureAuthToken();

console.log(getAuthTokenPath());
console.log(getAgentDataHostPath());
console.log(getWeChatHomeHostPath());
