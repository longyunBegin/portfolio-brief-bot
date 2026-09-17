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

async function smtpDialog({ host, port, secure, user, pass, from, to, subject, html }) {
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

    const boundary = '----=_Part_' + Date.now();
    const headers = [
      `From: ${from}`,
      `To: ${toAddrs.join(', ')}`,
      `Subject: ${encodeSubject(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      'Content-Transfer-Encoding: 8bit',
      '',
    ];
    writeLine(socket, headers.join('\r\n'));

    const textPart = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Folded(base64Encode('请使用支持 HTML 的客户端查看本邮件。')),
      '',
    ].join('\r\n');
    writeLine(socket, textPart);

    const htmlPart = [
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Folded(base64Encode(html)),
      '',
    ].join('\r\n');
    writeLine(socket, htmlPart);

    writeLine(socket, `--${boundary}--`);
    writeLine(socket, '');
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

module.exports = { smtpDialog, encodeSubject };