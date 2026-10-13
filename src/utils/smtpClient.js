const tls = require('tls');
const net = require('net');

function base64Encode(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

function base64Folded(str) {
  const lines = [];
  for (let i = 0; i < str.length; i += 76) {
    lines.push(str.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

function toBase64Content(content) {
  if (Buffer.isBuffer(content)) return content.toString('base64');
  return String(content);
}

function encodeSubject(subject) {
  return '=?UTF-8?B?' + base64Encode(subject) + '?=';
}

function readResponse(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let timer = null;
    const onData = (chunk) => {
      buf += chunk.toString('utf-8');
      const lines = buf.split(/\r?\n/);
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (/^\d{3} /.test(line)) {
          cleanup();
          resolve({ code: parseInt(line.slice(0, 3), 10), message: line });
          return;
        }
      }
    };
    const onError = (e) => { cleanup(); reject(e); };
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    socket.on('data', onData);
    socket.on('error', onError);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('SMTP 读取超时: ' + buf));
    }, timeoutMs || 15000);
  });
}

function writeLine(socket, line) {
  socket.write(line + '\r\n');
}

function writeRaw(socket, data) {
  socket.write(data);
}

/**
 * Build MIME body. With inline attachments → multipart/related wrapping
 * multipart/alternative (text + html) + image parts with Content-ID.
 * Without attachments → multipart/alternative only (legacy).
 *
 * attachments: [{ filename, contentId, content (base64|Buffer), mimeType, inline }]
 */
function buildMimeBody({ subject, from, toAddrs, html, text, attachments }) {
  const inlineParts = (attachments || []).filter((a) => a && a.inline !== false && (a.contentId || a.filename));
  const plain = text || '请使用支持 HTML 的客户端查看本邮件。';
  const stamp = Date.now();

  if (!inlineParts.length) {
    const boundary = '----=_Part_' + stamp;
    const headers = [
      `From: ${from}`,
      `To: ${toAddrs.join(', ')}`,
      `Subject: ${encodeSubject(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      '',
    ].join('\r\n');
    const textPart = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Folded(base64Encode(plain)),
      '',
    ].join('\r\n');
    const htmlPart = [
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Folded(base64Encode(html)),
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return headers + textPart + '\r\n' + htmlPart;
  }

  const relatedBoundary = '----=_Related_' + stamp;
  const altBoundary = '----=_Alt_' + stamp;
  const headers = [
    `From: ${from}`,
    `To: ${toAddrs.join(', ')}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; type="multipart/alternative"; boundary="${relatedBoundary}"`,
    '',
    '',
  ].join('\r\n');

  const altOpen = [
    `--${relatedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    '',
  ].join('\r\n');

  const textPart = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Folded(base64Encode(plain)),
    '',
  ].join('\r\n');

  const htmlPart = [
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Folded(base64Encode(html)),
    '',
    `--${altBoundary}--`,
    '',
  ].join('\r\n');

  let imageParts = '';
  for (const att of inlineParts) {
    const cid = String(att.contentId || att.filename).replace(/^<|>$/g, '');
    const filename = att.filename || cid;
    const mime = att.mimeType || 'image/png';
    const b64 = toBase64Content(att.content);
    imageParts += [
      `--${relatedBoundary}`,
      `Content-Type: ${mime}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${cid}>`,
      `Content-Disposition: inline; filename="${filename}"`,
      '',
      base64Folded(b64),
      '',
    ].join('\r\n');
  }

  const close = `--${relatedBoundary}--\r\n`;
  return headers + altOpen + textPart + '\r\n' + htmlPart + '\r\n' + imageParts + close;
}

async function smtpDialog({ host, port, secure, user, pass, from, to, subject, html, text, attachments }) {
  const useTls = secure || port === 465;
  let socket;
  if (useTls) {
    socket = tls.connect({ host, port, rejectUnauthorized: true }, () => {});
  } else {
    socket = net.connect({ host, port }, () => {});
  }

  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('connect', resolve);
    socket.once('error', reject);
  });

  try {
    await readResponse(socket);

    writeLine(socket, 'EHLO portfolio-brief-bot');
    await readResponse(socket);

    writeLine(socket, 'AUTH LOGIN');
    await readResponse(socket);

    writeLine(socket, base64Encode(user));
    await readResponse(socket);

    writeLine(socket, base64Encode(pass));
    const authRes = await readResponse(socket);
    if (authRes.code !== 235) {
      throw new Error('SMTP 认证失败: ' + authRes.message);
    }

    const fromAddr = extractAddr(from);
    const toAddrs = String(to).split(',').map((s) => s.trim()).filter(Boolean);

    writeLine(socket, `MAIL FROM:<${fromAddr}>`);
    await readResponse(socket);

    for (const a of toAddrs) {
      writeLine(socket, `RCPT TO:<${extractAddr(a)}>`);
      await readResponse(socket);
    }

    writeLine(socket, 'DATA');
    await readResponse(socket);

    const mime = buildMimeBody({ subject, from, toAddrs, html, text, attachments });
    // DATA payload ends with CRLF . CRLF; ensure body uses CRLF and no lone dots.
    writeRaw(socket, mime.replace(/^\./gm, '..'));
    writeLine(socket, '.');
    const sendRes = await readResponse(socket);

    writeLine(socket, 'QUIT');
    try { await readResponse(socket, 5000); } catch (_) {}

    socket.end();
    return { messageId: sendRes.message, response: sendRes.message };
  } catch (e) {
    try { writeLine(socket, 'QUIT'); } catch (_) {}
    try { socket.destroy(); } catch (_) {}
    throw e;
  }
}

function extractAddr(str) {
  const m = String(str).match(/<([^>]+)>/);
  return m ? m[1] : String(str).trim();
}

module.exports = { smtpDialog, encodeSubject, buildMimeBody };
