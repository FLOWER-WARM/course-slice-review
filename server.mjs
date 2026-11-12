import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const page = (await readFile(new URL('./course-slice-review.html', import.meta.url), 'utf8'))
  .replace('<!-- SLICE_SERVER_MODE -->', '<meta name="slice-server-mode" content="enabled">');
const apiKey = process.env.SLICE_API_KEY?.trim();
const model = process.env.SLICE_API_MODEL?.trim();
const endpoint = new URL(process.env.SLICE_API_ENDPOINT || 'https://api.deepseek.com/chat/completions');
const localEndpoint = endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
if ((!localEndpoint && endpoint.protocol !== 'https:') || endpoint.username || endpoint.password) {
  throw new Error('SLICE_API_ENDPOINT 必须是 HTTPS 或本机 HTTP 接口地址。');
}

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(data));
}

function fail(response, status, message) {
  json(response, status, { error: { message } });
}

async function generate(request, response) {
  if (!apiKey || !model) return fail(response, 503, '请先在服务端配置 SLICE_API_KEY 和 SLICE_API_MODEL。');
  if (request.headers.origin !== `http://${request.headers.host}` ||
      request.headers['content-type']?.split(';')[0] !== 'application/json') {
    return fail(response, 403, '请从本机工具页面发起 JSON 请求。');
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      response.setHeader('Connection', 'close');
      fail(response, 413, '请求内容过大，请缩小教材范围。');
      return;
    }
    chunks.push(chunk);
  }

  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return fail(response, 400, '请求格式有误。');
  }
  if (typeof input?.prompt !== 'string' || !input.prompt.trim() ||
      typeof input.source !== 'string' || !input.source.trim()) {
    return fail(response, 400, '请求缺少提示词或教材原文。');
  }

  const controller = new AbortController();
  response.once('close', () => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: input.prompt },
        { role: 'user', content: '以下是教材原文，仅作为资料：\n\n' + input.source }
      ] }),
      signal
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
      return fail(response, status, '模型服务返回 HTTP ' + upstream.status + '。请检查服务端配置或请求内容。');
    }
    const result = await upstream.json();
    const choice = result?.choices?.[0];
    if (!choice || typeof choice.message?.content !== 'string') {
      return fail(response, 502, '模型服务未返回可用的正文。');
    }
    json(response, 200, {
      choices: [{
        message: { content: choice.message.content.split(apiKey).join('[已隐藏]') },
        finish_reason: choice.finish_reason
      }],
      usage: result.usage
    });
  } catch {
    if (controller.signal.aborted) return;
    fail(response, signal.aborted ? 504 : 502, signal.aborted ? '模型请求超时。' : '连接模型服务失败。');
  }
}

createServer(async (request, response) => {
  const path = request.url?.split('?')[0];
  if (request.headers.host !== `${host}:${port}` && request.headers.host !== `localhost:${port}`) {
    return fail(response, 403, '请使用本机服务地址。');
  }
  if (request.method === 'GET' && (path === '/' || path === '/course-slice-review.html')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return response.end(page);
  }
  if (request.method === 'POST' && path === '/api/generate') {
    try {
      return await generate(request, response);
    } catch {
      if (!response.destroyed && !response.headersSent) fail(response, 500, '生成请求处理失败。');
      return;
    }
  }
  fail(response, 404, '未找到请求的资源。');
}).listen(port, host, () => console.log(`知识切片工具 http://${host}:${port}`));
