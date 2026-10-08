import express from "express";
import multer from "multer";
import path from "path";
import os from "os";
import { existsSync } from "fs";
import { db, transacao, resumo, listarContas, listarVendas, listarRecebimentos, Periodo, FORMAS } from "./db.js";
import { parseMovimento, MovimentoImportado } from "./parser.js";
import { gerarPdf, gerarExcel, TipoRel } from "./relatorios.js";
const tipoRel = (q: any): TipoRel => (["vendas", "contas"].includes(String(q.tipo)) ? q.tipo : "completo");
const nomeRel: Record<TipoRel, string> = { completo: "relatorio", vendas: "relatorio_vendas", contas: "relatorio_contas_pagas" };
import { registrarCobranca } from "./cobranca.js";

const app = express();
app.use(express.json({ limit: "5mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const periodo = (q: any): Periodo => ({ de: String(q.de || hoje().slice(0, 8) + "01"), ate: String(q.ate || hoje()) });
const valorOk = (v: any) => typeof v === "number" && isFinite(v) && v > 0;
const dataOk = (d: any) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

const rota = (fn: (req: express.Request, res: express.Response) => any) => async (req: express.Request, res: express.Response) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e: any) {
    res.status(400).json({ erro: e?.message ?? String(e) });
  }
};

app.get("/api/formas", rota(() => FORMAS));

for (const tabela of ["bancos", "categorias"] as const) {
  app.get(`/api/${tabela}`, rota(() => db.prepare(`SELECT * FROM ${tabela} ORDER BY nome`).all()));
  app.post(`/api/${tabela}`, rota((req) => {
    const nome = String(req.body?.nome ?? "").trim();
    if (!nome) throw new Error("Informe o nome.");
    const r = db.prepare(`INSERT INTO ${tabela} (nome) VALUES (?)`).run(nome);
    return { id: Number(r.lastInsertRowid) };
  }));
  app.delete(`/api/${tabela}/:id`, rota((req) => {
    const col = tabela === "bancos" ? "banco_id" : "categoria_id";
    const uso = (db.prepare(`SELECT COUNT(*) c FROM contas WHERE ${col}=?`).get(String(req.params.id)) as any).c;
    if (uso) throw new Error(`Não dá para excluir: usado em ${uso} conta(s).`);
    db.prepare(`DELETE FROM ${tabela} WHERE id=?`).run(String(req.params.id));
    return { ok: true };
  }));
}

const validarConta = (b: any) => {
  if (!dataOk(b.data)) throw new Error("Data inválida.");
  if (!String(b.descricao ?? "").trim()) throw new Error("Informe o que está sendo pago.");
  if (!valorOk(b.valor)) throw new Error("Valor inválido.");
  return [b.data, b.categoria_id || null, String(b.descricao).trim(), b.valor, b.banco_id || null];
};
app.get("/api/contas", rota((req) => listarContas(periodo(req.query))));
app.post("/api/contas", rota((req) => ({ id: Number(db.prepare("INSERT INTO contas (data,categoria_id,descricao,valor,banco_id) VALUES (?,?,?,?,?)").run(...(validarConta(req.body) as any[])).lastInsertRowid) })));
app.put("/api/contas/:id", rota((req) => { db.prepare("UPDATE contas SET data=?,categoria_id=?,descricao=?,valor=?,banco_id=? WHERE id=?").run(...(validarConta(req.body) as any[]), String(req.params.id)); return { ok: true }; }));
app.delete("/api/contas/:id", rota((req) => { db.prepare("DELETE FROM contas WHERE id=?").run(String(req.params.id)); return { ok: true }; }));

app.get("/api/vendas", rota((req) => listarVendas(periodo(req.query))));
app.post("/api/vendas/dia", rota((req) => {
  const { data, itens, obs, cliente } = req.body ?? {};
  if (!dataOk(data)) throw new Error("Data inválida.");
  const validos = (itens ?? []).filter((i: any) => valorOk(i.valor) && i.forma);
  if (!validos.length) throw new Error("Informe pelo menos um valor.");
  const ins = db.prepare("INSERT INTO vendas (data,forma,valor,bruto,obs,cliente) VALUES (?,?,?,?,?,?)");
  transacao(() => validos.forEach((i: any) => ins.run(data, String(i.forma).toUpperCase(), i.valor, i.valor, obs || null, cliente || null)));
  return { ok: true, inseridos: validos.length };
}));
app.delete("/api/vendas/:id", rota((req) => { db.prepare("DELETE FROM vendas WHERE id=?").run(String(req.params.id)); return { ok: true }; }));

app.get("/api/recebimentos", rota((req) => listarRecebimentos(periodo(req.query))));
app.post("/api/recebimentos", rota((req) => {
  const b = req.body ?? {};
  if (!dataOk(b.data)) throw new Error("Data inválida.");
  if (!String(b.cliente ?? "").trim()) throw new Error("Informe o cliente.");
  if (!valorOk(b.recebido)) throw new Error("Valor inválido.");
  const r = db.prepare("INSERT INTO recebimentos (data,cliente,titulo,vencimento,valor,recebido,forma) VALUES (?,?,?,?,?,?,?)")
    .run(b.data, String(b.cliente).trim().toUpperCase(), b.titulo || null, b.vencimento || null, b.recebido, b.recebido, String(b.forma || "DINHEIRO").toUpperCase());
  return { id: Number(r.lastInsertRowid) };
}));
app.delete("/api/recebimentos/:id", rota((req) => { db.prepare("DELETE FROM recebimentos WHERE id=?").run(String(req.params.id)); return { ok: true }; }));

app.get("/api/movimentos", rota(() => db.prepare("SELECT * FROM movimentos ORDER BY data DESC, id DESC LIMIT 200").all()));
app.delete("/api/movimentos/:id", rota((req) => { db.prepare("DELETE FROM movimentos WHERE id=?").run(String(req.params.id)); return { ok: true }; }));

app.post("/api/importar/ler", upload.single("arquivo"), rota(async (req) => {
  if (!req.file) throw new Error("Envie o PDF do movimento de caixa.");
  const mov = await parseMovimento(new Uint8Array(req.file.buffer));
  const existente = mov.movimento ? db.prepare("SELECT id, data, importado_em FROM movimentos WHERE numero=?").get(mov.movimento) : null;
  return { ...mov, existente };
}));

app.post("/api/importar/confirmar", rota((req) => {
  const m = req.body as MovimentoImportado & { substituir?: boolean };
  if (!dataOk(m?.data) || !Array.isArray(m.vendas)) throw new Error("Dados de importação inválidos.");
  return transacao(() => {
    if (m.movimento) {
      const ex = db.prepare("SELECT id FROM movimentos WHERE numero=?").get(m.movimento) as any;
      if (ex && !m.substituir) throw new Error(`O movimento nº ${m.movimento} já foi importado.`);
      if (ex) db.prepare("DELETE FROM movimentos WHERE id=?").run(ex.id);
    }
    const sangrias = (m.sangrias ?? []).reduce((s, x) => s + x.valor, 0);
    const movId = db.prepare("INSERT INTO movimentos (numero,data,responsavel,abertura,total_vendas,total_recebimentos,sangrias) VALUES (?,?,?,?,?,?,?)")
      .run(m.movimento || null, m.data, m.responsavel, m.abertura, m.totalVendas, m.totalRecebimentos, sangrias).lastInsertRowid;
    const iv = db.prepare("INSERT INTO vendas (data,forma,valor,bruto,desconto,codigo,cliente,funcionario,movimento_id) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const v of m.vendas) iv.run(m.data, v.forma, v.liquido, v.total, v.desconto, v.codigo, v.cliente || null, v.funcionario, movId);
    const ir = db.prepare("INSERT INTO recebimentos (data,cliente,titulo,vencimento,valor,recebido,forma,movimento_id) VALUES (?,?,?,?,?,?,?,?)");
    for (const r of m.recebimentos ?? []) ir.run(m.data, r.cliente, r.titulo, r.vencimento, r.valor, r.recebido, r.forma, movId);
    return { ok: true, vendas: m.vendas.length, recebimentos: (m.recebimentos ?? []).length };
  });
}));

app.get("/api/resumo", rota((req) => resumo(periodo(req.query))));

app.get("/api/relatorio.pdf", rota((req, res) => {
  const p = periodo(req.query);
  const t = tipoRel(req.query);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${nomeRel[t]}_${p.de}_a_${p.ate}.pdf"`);
  gerarPdf(p, t).pipe(res);
}));
app.get("/api/relatorio.xlsx", rota(async (req, res) => {
  const p = periodo(req.query);
  const t = tipoRel(req.query);
  const buf = await gerarExcel(p, t);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nomeRel[t]}_${p.de}_a_${p.ate}.xlsx"`);
  res.end(buf);
}));

registrarCobranca(app, upload, rota);

if (process.env.SEM_BUILD !== "1") {
  console.log("Preparando a tela do sistema...");
  try {
    const { build } = await import("vite");
    await build({ logLevel: "warn" });
  } catch (e: any) {
    console.error("Não consegui gerar a tela:", e?.message ?? e);
  }
}

const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const PORTA = Number(process.env.PORTA ?? 3000);
app.listen(PORTA, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i!.address);
  console.log(`\nSistema do Depósito WM rodando!`);
  console.log(`  Nesta máquina:   http://localhost:${PORTA}`);
  for (const ip of ips) console.log(`  Na outra máquina: http://${ip}:${PORTA}`);
  console.log("");
});
