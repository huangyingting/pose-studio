// A stand-in for the upstream Responses API during e2e tests (OPENAI_BASE_URL points here).
// First call: ask the studio to switch to the anime style; after the tool result: answer.
import { createServer } from 'node:http';

const port = Number(process.env.MOCK_AI_PORT ?? 3299);

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return res.end('ok');
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const data = JSON.parse(body || '{}');
    res.setHeader('Content-Type', 'application/json');
    // The server must add the studio's instructions and tools itself.
    if (req.url !== '/v1/responses' || !data.instructions || !Array.isArray(data.tools) || data.model !== 'mock') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: 'unexpected request' } }));
    }
    const result = (data.input ?? []).find((i) => i.type === 'function_call_output');
    const output = result
      ? [{ type: 'message', content: [{ type: 'output_text', text: `Switched to anime. (${result.output})` }] }]
      : [{ type: 'function_call', name: 'set_style', arguments: JSON.stringify({ style: 'anime' }), call_id: 'call_1' }];
    res.end(JSON.stringify({ id: `resp_${Date.now()}`, output, usage: { input_tokens: 100, output_tokens: 10 } }));
  });
}).listen(port, '127.0.0.1');
