const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
let converter;
let conversionQueue = Promise.resolve();

async function convertWord(html) {
  converter ??= import('pandoc-wasm').catch(error => {
    converter = undefined;
    throw error;
  });
  const { convert } = await converter;
  const parsed = await convert({ from: 'html+tex_math_single_backslash', to: 'json' }, html, {});
  const document = JSON.parse(parsed.stdout);
  document.blocks = document.blocks.map(block => {
    if (block.t !== 'Div') return block;
    const [attributes, contents] = block.c;
    if (attributes[1].includes('slice-word-page-break')) return { t: 'RawBlock', c: ['openxml', PAGE_BREAK] };
    if (attributes[2].some(([key, value]) => key === 'custom-style' && value === 'Source Code')) {
      for (const paragraph of contents) {
        if (paragraph.t === 'Para') {
          paragraph.c = paragraph.c.map(item => item.t === 'Code' ? { t: 'Str', c: item.c[1] } : item);
        }
      }
    }
    return block;
  });
  const output = await convert({ from: 'json', to: 'docx', 'output-file': 'slices.docx' },
    JSON.stringify(document), {});
  const file = output.files['slices.docx'];
  if (!file?.arrayBuffer) throw new Error('DOCX output missing');
  return Buffer.from(await file.arrayBuffer());
}

export async function exportWord(request, response) {
  if (request.headers.origin !== `http://${request.headers.host}` ||
      request.headers['content-type']?.split(';')[0] !== 'text/html') {
    response.writeHead(403);
    return response.end();
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) {
      response.writeHead(413, { Connection: 'close' });
      return response.end();
    }
    chunks.push(chunk);
  }
  const html = Buffer.concat(chunks).toString('utf8');
  if (!html.trim()) {
    response.writeHead(400);
    return response.end();
  }
  const conversion = conversionQueue.then(() => response.destroyed ? null : convertWord(html));
  conversionQueue = conversion.catch(() => {});
  const file = await conversion;
  if (!file || response.destroyed) return;
  response.writeHead(200, { 'Content-Type': DOCX_TYPE, 'Cache-Control': 'no-store' });
  response.end(file);
}
