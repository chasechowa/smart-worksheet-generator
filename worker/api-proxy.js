/**
 * CF Worker — AI API 透传代理
 *
 * 绕过浏览器 CORS 限制，将前端请求转发到 AI Provider。
 * 支持：Gemini、DeepSeek、Kimi、OpenAI、Custom
 *
 * 用法：
 *   POST https://<worker>.workers.dev/
 *   Header: X-Target-URL = https://api.deepseek.com/v1/chat/completions
 *   Body:  原始请求体（含 API Key 和 prompt）
 */

export default {
  async fetch(request, env, ctx) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const targetUrl = request.headers.get('X-Target-URL');
    if (!targetUrl) {
      return new Response('Missing X-Target-URL header', { status: 400 });
    }

    try {
      // 复制请求体
      const body = request.body;

      // 构建转发请求
      const forwardHeaders = new Headers();
      for (const [key, value] of request.headers.entries()) {
        // 跳过内部 header 和 host
        if (key.startsWith('x-target-') || key === 'host' || key === 'cf-connecting-ip') continue;
        forwardHeaders.set(key, value);
      }

      // 确保有 Content-Type
      if (!forwardHeaders.has('content-type')) {
        forwardHeaders.set('content-type', 'application/json');
      }

      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body,
      });

      const responseBody = await upstream.text();

      return new Response(responseBody, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    } catch (err) {
      return new Response(`Proxy Error: ${err.message}`, {
        status: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
