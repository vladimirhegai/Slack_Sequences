/** CSS and inline-script safety repairs. */
export {
  repairContrastAaIssues,
  quoteBareCssVarsInInlineScripts,
  lowerTemplateLiteralSelectorsInInlineScripts,
  stripInvalidSvgPathPlaceholders,
  stripUnboundConnectorSvgs,
} from "./implementation.ts";
