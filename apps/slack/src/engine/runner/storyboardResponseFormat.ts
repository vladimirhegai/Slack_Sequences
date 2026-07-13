import type { CompleteOptions } from "@sequences/platform/providers";
import { loadCapabilityIndex } from "../../agent/capabilityIndex.ts";
import { CUT_SHAPE_HINTS, CUT_STYLES } from "../cutContract.ts";
import { CAMERA_MOVES, SEQUENCES_EASES } from "../cameraContract.ts";
import { CONTINUITY_ENTITY_KINDS } from "../continuityGraph.ts";
import {
  PLANNER_COMPONENT_BEAT_KINDS,
  PLANNER_COMPONENT_KINDS,
} from "../componentContract.ts";
import { MAX_RECIPES_PER_FILM } from "../recipeContract.ts";
import { MAX_PLUGINS_PER_FILM, PLUGIN_KINDS } from "../pluginContract.ts";

export function storyboardResponseFormat(): NonNullable<CompleteOptions["responseFormat"]> {
  const capabilityIds = loadCapabilityIndex().capabilities.map((capability) => capability.id);
  return {
    type: "json_schema",
    json_schema: {
      name: "sequences_storyboard",
      strict: true,
      schema: {
        type: "object",
        properties: {
          productionBasis: { type: "string", enum: ["light", "dark"] },
          storyboard: {
            type: "array",
            minItems: 3,
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                purpose: { type: "string" },
                incomingIdea: { type: "string" },
                foreground: { type: "string" },
                background: { type: "string" },
                cameraIntent: { type: "string" },
                startSec: { type: "number" },
                durationSec: { type: "number" },
                blueprint: { type: "string" },
                rules: { type: "array", items: { type: "string" } },
                capabilityIds: {
                  type: "array",
                  items: { type: "string", enum: capabilityIds },
                },
                continuityAnchor: { type: "string" },
                outgoingCut: { type: "string" },
                componentEntranceFamily: {
                  type: "string",
                  enum: ["rise", "assemble", "materialize"],
                },
                displayType: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    kind: { type: "string", enum: ["ghost-word"] },
                    text: { type: "string" },
                    atSec: { type: "number" },
                    focalPart: { type: "string" },
                  },
                  required: ["version", "kind", "text", "atSec"],
                  additionalProperties: false,
                },
                cut: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    style: { type: "string", enum: [...CUT_STYLES] },
                    travelPx: { type: "number" },
                    exitSec: { type: "number" },
                    entrySec: { type: "number" },
                    focalPartOut: { type: "string" },
                    focalPartIn: { type: "string" },
                    shapeOut: { type: "string", enum: [...CUT_SHAPE_HINTS] },
                    shapeIn: { type: "string", enum: [...CUT_SHAPE_HINTS] },
                  },
                  required: ["version", "style"],
                  additionalProperties: false,
                },
                timeRamp: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    atSec: { type: "number" },
                    slowTo: { type: "number" },
                    holdSec: { type: "number" },
                    recoverSec: { type: "number" },
                  },
                  required: ["version"],
                  additionalProperties: false,
                },
                camera: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    path: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          version: { type: "number", enum: [1] },
                          move: { type: "string", enum: [...CAMERA_MOVES] },
                          toRegion: { type: "string" },
                          toPart: { type: "string" },
                          fromRegion: { type: "string" },
                          fromPart: { type: "string" },
                          zoom: { type: "number" },
                          arcDeg: { type: "number" },
                          focus: {
                            type: "object",
                            properties: {
                              part: { type: "string" },
                              depth: { type: "number" },
                              blurMaxPx: { type: "number" },
                            },
                            additionalProperties: false,
                          },
                          startSec: { type: "number" },
                          durationSec: { type: "number" },
                          ease: {
                            type: "string",
                            enum: [
                              ...SEQUENCES_EASES,
                              "power2.inOut",
                              "power3.out",
                              "expo.out",
                              "sine.inOut",
                              "none",
                            ],
                          },
                        },
                        required: ["version", "move", "startSec", "durationSec"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["version", "path"],
                  additionalProperties: false,
                },
                components: {
                  type: "array",
                  maxItems: 6,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      kind: { type: "string", enum: [...PLANNER_COMPONENT_KINDS] },
                      region: { type: "string" },
                      role: { type: "string", enum: ["hero", "support"] },
                      entityId: { type: "string" },
                    },
                    required: ["version", "id", "kind"],
                    additionalProperties: false,
                  },
                },
                continuity: {
                  type: "array",
                  maxItems: 4,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      entityId: { type: "string" },
                      part: { type: "string" },
                      kind: { type: "string", enum: [...CONTINUITY_ENTITY_KINDS] },
                      representation: { type: "string" },
                    },
                    required: ["version", "entityId", "part"],
                    additionalProperties: false,
                  },
                },
                beats: {
                  type: "array",
                  maxItems: 10,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      component: { type: "string" },
                      kind: { type: "string", enum: [...PLANNER_COMPONENT_BEAT_KINDS] },
                      atSec: { type: "number" },
                      durationSec: { type: "number" },
                      text: { type: "string" },
                      value: { type: "number" },
                      item: { type: "number" },
                      toState: { type: "string" },
                      morphTo: { type: "string" },
                      follows: { type: "string" },
                      lagMs: { type: "number" },
                      ease: {
                        type: "string",
                        enum: [
                          ...SEQUENCES_EASES,
                          "power2.out",
                          "power3.out",
                          "expo.out",
                          "none",
                        ],
                      },
                    },
                    required: ["version", "id", "component", "kind", "atSec"],
                    additionalProperties: false,
                  },
                },
                recipes: {
                  type: "array",
                  maxItems: MAX_RECIPES_PER_FILM,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      region: { type: "string" },
                      params: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            value: { type: ["string", "number"] },
                          },
                          required: ["name", "value"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["version", "id", "params"],
                    additionalProperties: false,
                  },
                },
                plugins: {
                  type: "array",
                  maxItems: MAX_PLUGINS_PER_FILM,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      kind: { type: "string", enum: [...PLUGIN_KINDS] },
                      id: { type: "string" },
                      region: { type: "string" },
                      params: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            value: { type: ["string", "number"] },
                          },
                          required: ["name", "value"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["version", "kind", "params"],
                    additionalProperties: false,
                  },
                },
                spatialIntent: {
                  type: "object",
                  properties: {
                    version: { type: "number", enum: [1] },
                    focalPart: { type: "string" },
                    composition: { type: "string" },
                    frameAnchor: {
                      type: "string",
                      enum: [
                        "frame:center",
                        "frame:top-left",
                        "frame:top-right",
                        "frame:bottom-left",
                        "frame:bottom-right",
                        "frame:left-third",
                        "frame:right-third",
                      ],
                    },
                    opticalBias: {
                      type: "object",
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                      },
                      required: ["x", "y"],
                      additionalProperties: false,
                    },
                    relationships: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["version", "focalPart", "composition", "relationships"],
                  additionalProperties: false,
                },
                moments: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      atSec: { type: "number" },
                      title: { type: "string" },
                      visualState: { type: "string" },
                      change: { type: "string" },
                      motionIntent: { type: "string" },
                      importance: { type: "string", enum: ["primary", "supporting"] },
                    },
                    required: [
                      "version", "id", "atSec", "title", "visualState", "change",
                      "motionIntent", "importance",
                    ],
                    additionalProperties: false,
                  },
                },
                interactions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      version: { type: "number", enum: [1] },
                      id: { type: "string" },
                      sceneId: { type: "string" },
                      cursorId: { type: "string" },
                      targetPart: { type: "string" },
                      item: { type: "number" },
                      action: {
                        type: "string",
                        enum: ["move", "hover", "click", "focus", "drag"],
                      },
                      startSec: { type: "number" },
                      arriveSec: { type: "number" },
                      pressSec: { type: "number" },
                      releaseSec: { type: "number" },
                      holdUntilSec: { type: "number" },
                      from: { type: "string" },
                      path: {
                        type: "string",
                        enum: ["direct", "arc", "human", "custom"],
                      },
                      bend: { type: "number" },
                      ease: { type: "string" },
                      aimX: { type: "number" },
                      aimY: { type: "number" },
                      offsetX: { type: "number" },
                      offsetY: { type: "number" },
                      hitInsetPx: { type: "number" },
                      feedback: {
                        type: "string",
                        enum: ["none", "press", "ripple", "press-ripple", "custom"],
                      },
                      ripplePart: { type: "string" },
                      dragTargetPart: { type: "string" },
                      cursorScale: { type: "number" },
                      targetScale: { type: "number" },
                      waypoints: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            x: { type: "number" },
                            y: { type: "number" },
                          },
                          required: ["x", "y"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: [
                      "version", "id", "sceneId", "cursorId", "targetPart", "action",
                      "startSec", "arriveSec", "from", "path", "aimX", "aimY", "feedback",
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: [
                "id", "title", "purpose", "incomingIdea", "foreground", "background",
                "cameraIntent", "startSec", "durationSec", "blueprint", "rules",
                "capabilityIds", "continuityAnchor", "outgoingCut", "cut", "timeRamp",
                "camera", "components", "beats", "recipes", "plugins", "spatialIntent",
                "moments", "interactions",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["productionBasis", "storyboard"],
        additionalProperties: false,
      },
    },
  };
}
