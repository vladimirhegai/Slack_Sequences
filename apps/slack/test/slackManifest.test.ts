import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SLACK_USER_OAUTH_SCOPES } from "../src/slackOAuth.ts";

interface SlackManifest {
  features: {
    slash_commands: Array<{
      command: string;
      usage_hint?: string;
    }>;
    shortcuts?: Array<{ callback_id: string }>;
  };
  oauth_config: {
    redirect_urls?: string[];
    scopes: {
      bot: string[];
      user: string[];
    };
  };
  settings: {
    interactivity?: { is_enabled?: boolean };
    socket_mode_enabled?: boolean;
  };
}

const manifest = JSON.parse(
  readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
) as SlackManifest;

describe("Slack app manifest", () => {
  it("registers one argument-driven /sequences command", () => {
    expect(manifest.features.slash_commands).toHaveLength(1);
    expect(manifest.features.slash_commands[0]).toMatchObject({
      command: "/sequences",
      usage_hint: expect.stringContaining("assets"),
    });
    expect(manifest.features.slash_commands.every(({ command }) => !/\s/.test(command))).toBe(true);
  });

  it("declares the scopes and callback needed by the asset modal and OAuth flow", () => {
    expect(manifest.oauth_config.scopes.bot).toEqual(expect.arrayContaining([
      "commands",
      "chat:write",
      "files:read",
      "files:write",
    ]));
    expect(manifest.oauth_config.scopes.user).toEqual([...SLACK_USER_OAUTH_SCOPES]);
    expect(manifest.oauth_config.redirect_urls).toContain(
      "https://sequences-slack-production.up.railway.app/slack/oauth_redirect",
    );
    expect(manifest.features.shortcuts).toContainEqual(
      expect.objectContaining({ callback_id: "make_launch_video" }),
    );
    expect(manifest.settings).toMatchObject({
      interactivity: { is_enabled: true },
      socket_mode_enabled: true,
    });
  });
});
