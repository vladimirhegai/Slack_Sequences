/**
 * Side-effect env setter for asset-flag browser/plugin tests. The asset
 * `asset-<id>` kinds join PLUGIN_CATALOG at pluginContract MODULE LOAD, so the
 * flag must be set before that module evaluates — import this file FIRST
 * (ESM evaluates imports in declaration order).
 */
process.env.SLACK_SEQUENCES_ASSETS = "1";
