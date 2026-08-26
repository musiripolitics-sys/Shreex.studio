import net from "net";

/** Minimal SMTP server that accepts everything and captures messages. */
export function startSink(port = 2526) {
  const messages = [];
  const server = net.createServer((sock) => {
    let buf = "", inData = false, data = "";
    sock.write("220 localhost ESMTP sink\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") { inData = false; messages.push(data); data = ""; sock.write("250 OK\r\n"); }
          else data += line + "\n";
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
          sock.write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n");
        } else if (cmd.startsWith("AUTH")) {
          sock.write("235 Authentication successful\r\n");
        } else if (cmd.startsWith("MAIL FROM") || cmd.startsWith("RCPT TO")) {
          sock.write("250 OK\r\n");
        } else if (cmd === "DATA") {
          inData = true; sock.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (cmd === "QUIT") {
          sock.write("221 Bye\r\n"); sock.end();
        } else {
          sock.write("250 OK\r\n");
        }
      }
    });
    sock.on("error", () => {});
  });
  return new Promise((res) => server.listen(port, "127.0.0.1", () => res({ server, messages })));
}
