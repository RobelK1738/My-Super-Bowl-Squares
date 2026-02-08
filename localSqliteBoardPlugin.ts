import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginOption } from "vite";
import Database from "better-sqlite3";

type BoardRow = {
  data: string;
};

const API_PREFIX = "/api/board-state/";
const MAX_BODY_BYTES = 1024 * 1024;

const sendJson = (
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += piece.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(piece);
  }

  return Buffer.concat(chunks).toString("utf8");
};

export const localSqliteBoardPlugin = (): PluginOption => {
  return {
    name: "local-sqlite-board-plugin",
    apply: "serve",
    configureServer(server) {
      const dataDir = path.resolve(process.cwd(), ".data");
      fs.mkdirSync(dataDir, { recursive: true });

      const dbPath = path.join(dataDir, "board-state.sqlite");
      const db = new Database(dbPath);

      db.exec(`
        create table if not exists board_state (
          id text primary key,
          data text not null,
          updated_at text not null default (datetime('now'))
        );
      `);

      const selectStmt = db.prepare("select data from board_state where id = ?");
      const upsertStmt = db.prepare(`
        insert into board_state (id, data, updated_at)
        values (@id, @data, datetime('now'))
        on conflict(id) do update set
          data = excluded.data,
          updated_at = datetime('now')
      `);

      server.middlewares.use(async (req, res, next) => {
        const method = req.method ?? "GET";
        const rawUrl = req.url ?? "/";
        const url = new URL(rawUrl, "http://localhost");

        if (!url.pathname.startsWith(API_PREFIX)) {
          next();
          return;
        }

        const encodedId = url.pathname.slice(API_PREFIX.length);
        const boardId = decodeURIComponent(encodedId);

        if (!boardId) {
          sendJson(res, 400, { error: "Missing board id" });
          return;
        }

        try {
          if (method === "GET") {
            const row = selectStmt.get(boardId) as BoardRow | undefined;
            sendJson(res, 200, { data: row ? JSON.parse(row.data) : null });
            return;
          }

          if (method === "PUT" || method === "POST") {
            const body = await readBody(req);
            const parsed = body ? (JSON.parse(body) as { data?: unknown }) : {};

            if (parsed.data === undefined) {
              sendJson(res, 400, { error: "Request must include data" });
              return;
            }

            upsertStmt.run({ id: boardId, data: JSON.stringify(parsed.data) });
            sendJson(res, 200, { ok: true });
            return;
          }

          sendJson(res, 405, { error: "Method not allowed" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          sendJson(res, 500, { error: message });
        }
      });

      server.httpServer?.once("close", () => {
        db.close();
      });
    },
  };
};
