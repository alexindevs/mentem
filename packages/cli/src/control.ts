import { createConnection } from "node:net";

export type ControlCommand = "pause" | "resume" | "skip" | "done" | "refresh";

/** Sends one timer command to the running app and returns what it said. */
export function sendControl(path: string, command: ControlCommand, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = "";
    const fail = () => reject(new Error("Mentem isn't running. Open the app to control the timer."));
    const timer = setTimeout(() => {
      socket.destroy();
      fail();
    }, timeoutMs);
    socket.on("connect", () => socket.write(`${JSON.stringify({ command })}\n`));
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (data.includes("\n")) {
        clearTimeout(timer);
        socket.end();
        try {
          const reply = JSON.parse(data) as { ok: boolean; message: string };
          if (reply.ok) resolve(reply.message);
          else reject(new Error(reply.message));
        } catch {
          reject(new Error("The app sent something unexpected."));
        }
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      fail();
    });
  });
}
