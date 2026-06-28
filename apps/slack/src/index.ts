import "dotenv/config";
import { App } from "@slack/bolt";

const botToken = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;

if (!botToken) {
    throw new Error("Missing SLACK_BOT_TOKEN in .env");
}

if (!appToken) {
    throw new Error("Missing SLACK_APP_TOKEN in .env");
}

const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
});

app.command("/sequences", async ({ command, ack, respond }) => {
    await ack();

    const input = command.text.trim();

    if (input === "demo") {
        await respond({
            response_type: "ephemeral",
            text: [
                "*Sequences test passed.*",
                "",
                "This is deterministic test output.",
                "",
                "*Command received:* `/sequences demo`",
                "*Next milestone:* open a modal, then connect to the real Sequences engine.",
            ].join("\n"),
        });

        return;
    }

    await respond({
        response_type: "ephemeral",
        text: [
            "*Sequences is running.*",
            "",
            "Try:",
            "`/sequences demo`",
        ].join("\n"),
    });
});

app.event("app_mention", async ({ say }) => {
    await say("Sequences is online. Try `/sequences demo`.");
});

await app.start();

console.log("Sequences Slack app is running with Socket Mode.");
console.log("Try typing /sequences demo in Slack.");