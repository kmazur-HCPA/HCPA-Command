import { createServer } from "node:http";
// Deterministic local stand-in for the Claude Messages streaming API. Never hosted.
// `reply(request)` returns { text } or { tool: { name, input } } for each call.
export async function fakeClaude(reply) {
  const inputs = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    inputs.push(request);
    const answer = await reply(request, inputs.length - 1);
    const events = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: "msg_fixture_" + inputs.length,
            type: "message",
            role: "assistant",
            model: request.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: answer.tool
            ? {
                type: "tool_use",
                id: "toolu_fixture_" + inputs.length,
                name: answer.tool.name,
                input: {},
              }
            : { type: "text", text: "" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: answer.tool
            ? {
                type: "input_json_delta",
                partial_json: JSON.stringify(answer.tool.input),
              }
            : { type: "text_delta", text: answer.text },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: {
            stop_reason: answer.tool ? "tool_use" : "end_turn",
            stop_sequence: null,
          },
          usage: { output_tokens: 1 },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    ];
    if (!request.stream) {
      // Non-streaming callers (the brief writer) get the assembled message.
      const message = events[0][1].message;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ...message,
          content: [
            answer.tool
              ? { ...events[1][1].content_block, input: answer.tool.input }
              : { type: "text", text: answer.text },
          ],
          stop_reason: events[4][1].delta.stop_reason,
        }),
      );
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      events
        .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        .join(""),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    inputs,
    baseURL: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
// True when the latest request carries results from the previous tool round.
export const hasToolResult = (request) =>
  request.messages.some(
    (m) =>
      Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"),
  );
