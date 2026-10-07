import type { Express, Request, Response } from "express";
import type { Multer } from "multer";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { db, transacao } from "./db.js";
import { parsePedidos, PedidoLido } from "./pedidos.js";

db.exec(`
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  endereco TEXT,
  celular TEXT
);
CREATE TABLE IF NOT EXISTS produtos (
  codigo TEXT PRIMARY KEY,
  descricao TEXT,
  unidade TEXT
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  hora TEXT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  forma TEXT,
  vendedor TEXT,
  desconto_texto TEXT,
  desconto_valor REAL DEFAULT 0,
  total REAL NOT NULL,
  importado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pedido_itens (
  id INTEGER PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  ordem INTEGER,
  codigo TEXT,
  descricao TEXT,
  qtd REAL,
  preco REAL,
  total REAL,
  preco_promo REAL,
  total_promo REAL
);
CREATE TABLE IF NOT EXISTS precos_cliente (
  cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  preco_promo REAL NOT NULL,
  PRIMARY KEY (cliente_id, codigo)
);
CREATE TABLE IF NOT EXISTS fechamentos (
  id INTEGER PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  de TEXT NOT NULL,
  ate TEXT NOT NULL,
  vencimento TEXT,
  arredondamento REAL DEFAULT 0,
  total_original REAL,
  total_desconto REAL,
  total_pagar REAL,
  status TEXT DEFAULT 'aberto',
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS fechamento_pedidos (
  fechamento_id INTEGER NOT NULL REFERENCES fechamentos(id) ON DELETE CASCADE,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  PRIMARY KEY (fechamento_id, pedido_id)
);
CREATE INDEX IF NOT EXISTS ix_pedidos_cli ON pedidos(cliente_id, data);
CREATE INDEX IF NOT EXISTS ix_itens_ped ON pedido_itens(pedido_id);
`);

const EMPRESA = process.env.NOME_EMPRESA ?? "Depósito WM";
const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;
const brl = (n: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (s: string) => (s ? s.split("-").reverse().join("/") : "");
const qtdTxt = (q: number, u?: string | null) => `${q.toLocaleString("pt-BR")}${u ? " " + u : ""}`;
const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
const get = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as any;
const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);

export interface ItemCalc {
  id: number; codigo: string; descricao: string; unidade: string | null; qtd: number;
  preco: number; total: number; preco_ef: number; total_ef: number; desconto: number; promo: boolean;
}
export interface PedidoCalc {
  id: number; numero: string; data: string; forma: string; total_pdf: number; desconto_pedido: number;
  itens: ItemCalc[]; original: number; comDesconto: number; desconto: number; fechamento_id: number | null;
}

function calcPedido(p: any): PedidoCalc {
  const itens: ItemCalc[] = all(
    `SELECT i.*, pr.unidade FROM pedido_itens i LEFT JOIN produtos pr ON pr.codigo = i.codigo WHERE i.pedido_id = ? ORDER BY i.ordem, i.id`, p.id
  ).map((i) => {
    const preco_ef = i.preco_promo ?? i.preco;
    const total_ef = r2(i.total_promo ?? (i.preco_promo != null ? i.qtd * i.preco_promo : i.total));
    return { id: i.id, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, qtd: i.qtd, preco: i.preco, total: i.total, preco_ef, total_ef, desconto: r2(i.total - total_ef), promo: i.preco_promo != null };
  });
  const original = r2(itens.reduce((s, i) => s + i.total, 0));
  const desconto_pedido = r2(p.desconto_valor ?? 0);
  const comDesconto = r2(itens.reduce((s, i) => s + i.total_ef, 0) - desconto_pedido);
  return { id: p.id, numero: p.numero, data: p.data, forma: p.forma, total_pdf: p.total, desconto_pedido, itens, original, comDesconto, desconto: r2(original - comDesconto), fechamento_id: p.fechamento_id ?? null };
}

const SQL_PEDIDOS = `SELECT p.*, c.nome cliente, (SELECT fp.fechamento_id FROM fechamento_pedidos fp WHERE fp.pedido_id = p.id LIMIT 1) fechamento_id FROM pedidos p JOIN clientes c ON c.id = p.cliente_id`;

function clienteId(nome: string, endereco: string, celular: string): number {
  const n = nome.trim().toUpperCase();
  const ex = get("SELECT id, endereco, celular FROM clientes WHERE nome = ?", n);
  if (ex) {
    if ((!ex.endereco && endereco) || (!ex.celular && celular)) run("UPDATE clientes SET endereco = COALESCE(endereco, ?), celular = COALESCE(celular, ?) WHERE id = ?", endereco || null, celular || null, ex.id);
    return ex.id;
  }
  return Number(run("INSERT INTO clientes (nome, endereco, celular) VALUES (?, ?, ?)", n, endereco || null, celular || null).lastInsertRowid);
}

function importarPedido(p: PedidoLido, substituir: boolean) {
  const ex = get("SELECT id FROM pedidos WHERE numero = ?", p.numero);
  if (ex) {
    const cobrado = get("SELECT 1 FROM fechamento_pedidos WHERE pedido_id = ?", ex.id);
    if (!substituir) return "existente";
    if (cobrado) return "cobrado";
    run("DELETE FROM pedidos WHERE id = ?", ex.id);
  }
  const cid = clienteId(p.cliente, p.endereco, p.celular);
  const pid = Number(run(
    "INSERT INTO pedidos (numero, data, hora, cliente_id, forma, vendedor, desconto_texto, desconto_valor, total) VALUES (?,?,?,?,?,?,?,?,?)",
    p.numero, p.data, p.hora || null, cid, p.forma || null, p.vendedor || null, p.descontoTexto || null, p.descontoValor || 0, p.total
  ).lastInsertRowid);
  p.itens.forEach((i, ordem) => {
    run("INSERT INTO produtos (codigo, descricao) VALUES (?, ?) ON CONFLICT(codigo) DO UPDATE SET descricao = excluded.descricao", i.codigo, i.descricao);
    const combinado = get("SELECT preco_promo FROM precos_cliente WHERE cliente_id = ? AND codigo = ?", cid, i.codigo);
    const pp = combinado && combinado.preco_promo < i.preco ? combinado.preco_promo : null;
    run("INSERT INTO pedido_itens (pedido_id, ordem, codigo, descricao, qtd, preco, total, preco_promo, total_promo) VALUES (?,?,?,?,?,?,?,?,?)",
      pid, ordem, i.codigo, i.descricao, i.qtd, i.preco, i.total, pp, pp != null ? r2(i.qtd * pp) : null);
  });
  return "ok";
}

function arredondar(valor: number, modo: string, manual?: number): number {
  if (modo === "manual") return r2(manual ?? 0);
  if (modo === "inteiro") return r2(Math.floor(valor) - valor);
  if (modo === "cinco") return r2(Math.floor(valor / 5) * 5 - valor);
  return 0;
}

export function montarFechamento(cliente_id: number, pedidoIds: number[], vencimento: string | null, modo: string, manual?: number) {
  const cliente = get("SELECT * FROM clientes WHERE id = ?", cliente_id);
  if (!cliente) throw new Error("Cliente não encontrado.");
  const pedidos = pedidoIds.length
    ? all(`${SQL_PEDIDOS} WHERE p.id IN (${pedidoIds.map(() => "?").join(",")}) AND p.cliente_id = ? ORDER BY p.data, CAST(p.numero AS INTEGER)`, ...pedidoIds, cliente_id).map(calcPedido)
    : [];
  const original = r2(pedidos.reduce((s, p) => s + p.original, 0));
  const comDesconto = r2(pedidos.reduce((s, p) => s + p.comDesconto, 0));
  const arred = arredondar(comDesconto, modo, manual);
  return { cliente, pedidos, original, comDesconto, desconto: r2(original - comDesconto), arredondamento: arred, totalPagar: r2(comDesconto + arred), vencimento };
}

type Fech = ReturnType<typeof montarFechamento> & { de: string; ate: string };
const titulo = (f: Fech) => `Fechamento cliente ${f.cliente.nome} período ${dt(f.de)} a ${dt(f.ate)}`;
const temDesconto = (f: Fech) => f.pedidos.some((p) => p.desconto > 0.004);

async function excelFechamento(f: Fech): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = EMPRESA;
  const ws = wb.addWorksheet("Fechamento", { views: [{ showGridLines: false }], pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } } });
  const desc = temDesconto(f);
  const MOEDA = '"R$" #,##0.00;-"R$" #,##0.00';
  const VERM = "FFB91C1C";
  const VERM_ESC = "FF8B1414";
  const ROSA = "FFFDE8E8";
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
  const fino = { style: "thin" as const, color: { argb: "FFE5C4C4" } };

  const cols = desc
    ? [["Produto", 34], ["Qtd", 10], ["Preço unit. original", 15], ["Preço unit. com desconto", 15], ["Total original", 15], ["Total com desconto", 16], ["Desconto", 13]]
    : [["Produto", 40], ["Qtd", 10], ["Preço unit.", 15], ["Total", 16]];
  ws.columns = cols.map(([, w]) => ({ width: w as number }));
  const n = cols.length;
  const ultima = ws.getColumn(n).letter;

  ws.mergeCells(`A1:${ultima}1`);
  const t = ws.getCell("A1");
  t.value = titulo(f);
  t.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = fill(VERM);
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(`A2:${ultima}2`);
  const sub = ws.getCell("A2");
  sub.value = [EMPRESA, f.vencimento ? `Vencimento ${dt(f.vencimento)}` : ""].filter(Boolean).join("   |   ");
  sub.font = { size: 10, color: { argb: VERM_ESC }, italic: true };
  sub.alignment = { indent: 1 };

  const cab = ws.getRow(4);
  cols.forEach(([nome], i) => {
    const c = cab.getCell(i + 1);
    c.value = nome as string;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill(VERM_ESC);
    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle", wrapText: true };
  });
  cab.height = 32;

  let r = 5;
  const subtotais: number[] = [];
  for (const p of f.pedidos) {
    ws.mergeCells(r, 1, r, n);
    const g = ws.getCell(r, 1);
    g.value = `Nota de controle ${p.numero}  |  ${dt(p.data)}`;
    g.font = { bold: true, color: { argb: VERM_ESC } };
    for (let c = 1; c <= n; c++) ws.getCell(r, c).fill = fill(ROSA);
    r++;
    const ini = r;
    for (const i of p.itens) {
      const row = ws.getRow(r);
      row.getCell(1).value = i.descricao;
      row.getCell(2).value = i.qtd;
      row.getCell(2).numFmt = i.unidade ? `#,##0.##" ${i.unidade.replace(/"/g, "")}"` : "#,##0.##";
      row.getCell(2).alignment = { horizontal: "center" };
      if (desc) {
        row.getCell(3).value = i.preco;
        row.getCell(4).value = i.preco_ef;
        row.getCell(5).value = { formula: `B${r}*C${r}`, result: i.total };
        row.getCell(6).value = i.total_ef;
        row.getCell(7).value = { formula: `E${r}-F${r}`, result: i.desconto };
        if (i.promo) row.getCell(4).font = { bold: true, color: { argb: VERM } };
      } else {
        row.getCell(3).value = i.preco_ef;
        row.getCell(4).value = i.total_ef;
      }
      for (let c = 3; c <= n; c++) row.getCell(c).numFmt = MOEDA;
      for (let c = 1; c <= n; c++) row.getCell(c).border = { bottom: fino };
      r++;
    }
    if (p.desconto_pedido > 0) {
      const row = ws.getRow(r);
      row.getCell(1).value = "Desconto no pedido";
      row.getCell(1).font = { italic: true };
      if (desc) { row.getCell(6).value = -p.desconto_pedido; row.getCell(7).value = p.desconto_pedido; row.getCell(5).value = 0; }
      else row.getCell(4).value = -p.desconto_pedido;
      for (let c = 3; c <= n; c++) row.getCell(c).numFmt = MOEDA;
      r++;
    }
    const fim = r - 1;
    const st = ws.getRow(r);
    st.getCell(desc ? 4 : 3).value = "Subtotal";
    if (desc) {
      st.getCell(5).value = { formula: `SUM(E${ini}:E${fim})`, result: p.original };
      st.getCell(6).value = { formula: `SUM(F${ini}:F${fim})`, result: p.comDesconto };
      st.getCell(7).value = { formula: `SUM(G${ini}:G${fim})`, result: p.desconto };
    } else st.getCell(4).value = { formula: `SUM(D${ini}:D${fim})`, result: p.comDesconto };
    for (let c = desc ? 4 : 3; c <= n; c++) {
      const cell = st.getCell(c);
      cell.font = { bold: true };
      cell.border = { top: { style: "thin", color: { argb: VERM_ESC } } };
      if (c > (desc ? 4 : 3)) cell.numFmt = MOEDA;
    }
    subtotais.push(r);
    r += 1;
  }

  r++;
  const soma = (col: string) => subtotais.length ? subtotais.map((x) => `${col}${x}`).join("+") : "0";
  const tot = ws.getRow(r);
  tot.getCell(desc ? 4 : 3).value = "Total";
  if (desc) {
    tot.getCell(5).value = { formula: soma("E"), result: f.original };
    tot.getCell(6).value = { formula: soma("F"), result: f.comDesconto };
    tot.getCell(7).value = { formula: soma("G"), result: f.desconto };
  } else tot.getCell(4).value = { formula: soma("D"), result: f.comDesconto };
  for (let c = desc ? 4 : 3; c <= n; c++) { tot.getCell(c).font = { bold: true }; if (c > (desc ? 4 : 3)) tot.getCell(c).numFmt = MOEDA; }
  const linhaTotal = r;
  r++;

  const colPagar = desc ? "F" : "D";
  if (Math.abs(f.arredondamento) > 0.004) {
    const ar = ws.getRow(r);
    ar.getCell(desc ? 4 : 3).value = "Arredondamento";
    ar.getCell(desc ? 6 : 4).value = f.arredondamento;
    if (desc) ar.getCell(7).value = { formula: `-F${r}`, result: r2(-f.arredondamento) };
    for (let c = desc ? 4 : 3; c <= n; c++) { ar.getCell(c).fill = fill(ROSA); ar.getCell(c).font = { bold: true, color: { argb: VERM_ESC } }; if (c > (desc ? 4 : 3)) ar.getCell(c).numFmt = MOEDA; }
    r++;
  }
  const pg = ws.getRow(r);
  pg.getCell(desc ? 4 : 3).value = "TOTAL A PAGAR";
  pg.getCell(desc ? 6 : 4).value = { formula: Math.abs(f.arredondamento) > 0.004 ? `${colPagar}${linhaTotal}+${colPagar}${r - 1}` : `${colPagar}${linhaTotal}`, result: f.totalPagar };
  if (desc) pg.getCell(7).value = { formula: Math.abs(f.arredondamento) > 0.004 ? `G${linhaTotal}+G${r - 1}` : `G${linhaTotal}`, result: r2(f.original - f.totalPagar) };
  for (let c = desc ? 4 : 3; c <= n; c++) {
    const cell = pg.getCell(c);
    cell.fill = fill(VERM);
    cell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
    if (c > (desc ? 4 : 3)) cell.numFmt = MOEDA;
  }
  pg.height = 22;
  ws.pageSetup.printArea = `A1:${ultima}${r}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function pdfFechamento(f: Fech): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: titulo(f) } });
  const L = 36;
  const W = doc.page.width - 72;
  const VERM = "#b91c1c", ESC = "#8b1414", ROSA = "#fde8e8", TXT = "#1f2937", LINHA = "#efd5d5";
  const desc = temDesconto(f);
  const pesos = desc ? [3.2, 0.9, 1.1, 1.1, 1.2, 1.25, 1] : [4, 1, 1.4, 1.5];
  const soma = pesos.reduce((a, b) => a + b, 0);
  const ws = pesos.map((p) => (p / soma) * W);
  const xs = ws.map((_, i) => L + ws.slice(0, i).reduce((a, b) => a + b, 0));
  const nomes = desc ? ["Produto", "Qtd", "Unit. original", "Unit. c/ desc.", "Total original", "Total c/ desc.", "Desconto"] : ["Produto", "Qtd", "Preço unit.", "Total"];
  const fim = () => doc.page.height - 50;

  doc.font("Helvetica-Bold").fontSize(15);
  const hT = doc.heightOfString(titulo(f), { width: W });
  const hFaixa = 30 + hT + 22;
  doc.rect(0, 0, doc.page.width, hFaixa).fill(VERM);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(15).text(titulo(f), L, 20, { width: W });
  doc.font("Helvetica").fontSize(9.5).fillColor("#fde2e2").text([EMPRESA, f.vencimento ? `Vencimento ${dt(f.vencimento)}` : ""].filter(Boolean).join("   |   "), L, 24 + hT, { width: W });
  doc.y = hFaixa + 18;

  const celula = (txt: string, i: number, y: number, h: number, opt: { bold?: boolean; cor?: string; size?: number } = {}) => {
    doc.font(opt.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opt.size ?? 8.5).fillColor(opt.cor ?? TXT)
      .text(txt, xs[i] + 4, y + (h - (opt.size ?? 8.5)) / 2 - 1, { width: ws[i] - 8, align: i === 0 ? "left" : i === 1 ? "center" : "right", lineBreak: false, ellipsis: true });
  };
  const cab = () => {
    const y = doc.y;
    doc.rect(L, y, W, 22).fill(ESC);
    nomes.forEach((nm, i) => celula(nm, i, y, 22, { bold: true, cor: "#fff", size: 8 }));
    doc.y = y + 22;
  };
  const espaco = (h: number) => { if (doc.y + h > fim()) { doc.addPage(); doc.y = 40; cab(); } };
  cab();

  for (const p of f.pedidos) {
    espaco(18 + 16 * Math.min(p.itens.length, 3) + 18);
    let y = doc.y;
    doc.rect(L, y, W, 18).fill(ROSA);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(ESC).text(`Nota de controle ${p.numero}  |  ${dt(p.data)}`, L + 4, y + 5);
    doc.y = y + 18;
    for (const i of p.itens) {
      espaco(16);
      y = doc.y;
      const v = desc
        ? [i.descricao, qtdTxt(i.qtd, i.unidade), brl(i.preco), brl(i.preco_ef), brl(i.total), brl(i.total_ef), brl(i.desconto)]
        : [i.descricao, qtdTxt(i.qtd, i.unidade), brl(i.preco_ef), brl(i.total_ef)];
      v.forEach((t, k) => celula(t, k, y, 16, desc && k === 3 && i.promo ? { bold: true, cor: VERM } : {}));
      doc.moveTo(L, y + 16).lineTo(L + W, y + 16).lineWidth(0.5).strokeColor(LINHA).stroke();
      doc.y = y + 16;
    }
    if (p.desconto_pedido > 0) {
      y = doc.y;
      celula("Desconto no pedido", 0, y, 16);
      celula(`-${brl(p.desconto_pedido)}`, desc ? 5 : 3, y, 16);
      if (desc) celula(brl(p.desconto_pedido), 6, y, 16);
      doc.y = y + 16;
    }
    y = doc.y;
    const k0 = desc ? 3 : 2;
    doc.moveTo(xs[k0], y).lineTo(L + W, y).lineWidth(0.8).strokeColor(ESC).stroke();
    celula("Subtotal", k0, y, 17, { bold: true });
    if (desc) { celula(brl(p.original), 4, y, 17, { bold: true }); celula(brl(p.comDesconto), 5, y, 17, { bold: true }); celula(brl(p.desconto), 6, y, 17, { bold: true }); }
    else celula(brl(p.comDesconto), 3, y, 17, { bold: true });
    doc.y = y + 23;
  }

  espaco(70);
  const k0 = desc ? 3 : 2;
  const xr = desc ? xs[3] : xs[1];
  const wr = (desc ? xs[5] : xs[3]) - xr;
  const rotulo = (txt: string, y: number, h: number, cor: string, size: number) =>
    doc.font("Helvetica-Bold").fontSize(size).fillColor(cor).text(txt, xr + 4, y + (h - size) / 2 - 1, { width: wr - 8, align: "right", lineBreak: false });
  let y = doc.y + 4;
  celula("Total", k0, y, 18, { bold: true, size: 9.5 });
  if (desc) { celula(brl(f.original), 4, y, 18, { bold: true, size: 9.5 }); celula(brl(f.comDesconto), 5, y, 18, { bold: true, size: 9.5 }); celula(brl(f.desconto), 6, y, 18, { bold: true, size: 9.5 }); }
  else celula(brl(f.comDesconto), 3, y, 18, { bold: true, size: 9.5 });
  y += 20;
  if (Math.abs(f.arredondamento) > 0.004) {
    doc.rect(xr, y, L + W - xr, 18).fill(ROSA);
    rotulo("Arredondamento", y, 18, ESC, 8.5);
    celula(brl(f.arredondamento), desc ? 5 : 3, y, 18, { bold: true, cor: ESC });
    if (desc) celula(brl(r2(-f.arredondamento)), 6, y, 18, { bold: true, cor: ESC });
    y += 20;
  }
  doc.rect(xr, y, L + W - xr, 24).fill(VERM);
  rotulo("TOTAL A PAGAR", y, 24, "#fff", 10.5);
  celula(brl(f.totalPagar), desc ? 5 : 3, y, 24, { bold: true, cor: "#fff", size: 10.5 });
  if (desc) celula(brl(r2(f.original - f.totalPagar)), 6, y, 24, { bold: true, cor: "#fff", size: 9 });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor("#9ca3af").text(`${EMPRESA}  |  Página ${i + 1} de ${range.count}`, L, doc.page.height - 30, { width: W, align: "right", lineBreak: false });
  }
  doc.end();
  return doc;
}

function carregarFechamento(id: number): Fech {
  const fe = get("SELECT * FROM fechamentos WHERE id = ?", id);
  if (!fe) throw new Error("Fechamento não encontrado.");
  const ids = all("SELECT pedido_id FROM fechamento_pedidos WHERE fechamento_id = ?", id).map((x) => x.pedido_id);
  const f = montarFechamento(fe.cliente_id, ids, fe.vencimento, "manual", fe.arredondamento);
  return { ...f, de: fe.de, ate: fe.ate };
}

const nomeArquivo = (f: Fech, ext: string) =>
  `Fechamento ${f.cliente.nome} ${dt(f.de).replace(/\//g, "-")} a ${dt(f.ate).replace(/\//g, "-")}.${ext}`.replace(/[\\/:*?"<>|]/g, "");

type H = (req: Request, res: Response) => any;

export function registrarCobranca(app: Express, upload: Multer, rota: (fn: H) => any) {
  const id = (req: Request) => Number(req.params.id);

  app.get("/api/clientes", rota(() => all(`
    SELECT c.*, COUNT(p.id) pedidos,
      SUM(CASE WHEN fp.pedido_id IS NULL THEN 1 ELSE 0 END) em_aberto,
      ROUND(COALESCE(SUM(CASE WHEN fp.pedido_id IS NULL THEN p.total END), 0), 2) valor_aberto,
      MIN(CASE WHEN fp.pedido_id IS NULL THEN p.data END) desde
    FROM clientes c LEFT JOIN pedidos p ON p.cliente_id = c.id LEFT JOIN fechamento_pedidos fp ON fp.pedido_id = p.id
    GROUP BY c.id ORDER BY valor_aberto DESC, c.nome`)));

  app.put("/api/clientes/:id", rota((req) => {
    const { nome, celular, endereco } = req.body ?? {};
    if (!String(nome ?? "").trim()) throw new Error("Informe o nome.");
    run("UPDATE clientes SET nome = ?, celular = ?, endereco = ? WHERE id = ?", String(nome).trim().toUpperCase(), celular || null, endereco || null, id(req));
    return { ok: true };
  }));

  app.post("/api/clientes/:id/juntar", rota((req) => {
    const destino = Number(req.body?.destino);
    const origem = id(req);
    if (!destino || destino === origem) throw new Error("Escolha outro cliente.");
    transacao(() => {
      run("UPDATE pedidos SET cliente_id = ? WHERE cliente_id = ?", destino, origem);
      run("UPDATE fechamentos SET cliente_id = ? WHERE cliente_id = ?", destino, origem);
      run("INSERT OR IGNORE INTO precos_cliente (cliente_id, codigo, preco_promo) SELECT ?, codigo, preco_promo FROM precos_cliente WHERE cliente_id = ?", destino, origem);
      run("DELETE FROM clientes WHERE id = ?", origem);
    });
    return { ok: true };
  }));

  app.get("/api/pedidos", rota((req) => {
    const w: string[] = [];
    const p: any[] = [];
    if (req.query.cliente_id) { w.push("p.cliente_id = ?"); p.push(Number(req.query.cliente_id)); }
    if (req.query.de) { w.push("p.data >= ?"); p.push(String(req.query.de)); }
    if (req.query.ate) { w.push("p.data <= ?"); p.push(String(req.query.ate)); }
    if (req.query.abertos === "1") w.push("NOT EXISTS (SELECT 1 FROM fechamento_pedidos fp WHERE fp.pedido_id = p.id)");
    const linhas = all(`${SQL_PEDIDOS} ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY p.data DESC, CAST(p.numero AS INTEGER) DESC LIMIT 500`, ...p);
    return linhas.map((l) => { const c = calcPedido(l); return { ...c, cliente: l.cliente, cliente_id: l.cliente_id, vendedor: l.vendedor }; });
  }));

  app.get("/api/pedidos/:id", rota((req) => {
    const l = get(`${SQL_PEDIDOS} WHERE p.id = ?`, id(req));
    if (!l) throw new Error("Pedido não encontrado.");
    return { ...calcPedido(l), cliente: l.cliente, cliente_id: l.cliente_id, vendedor: l.vendedor };
  }));

  app.delete("/api/pedidos/:id", rota((req) => {
    if (get("SELECT 1 FROM fechamento_pedidos WHERE pedido_id = ?", id(req))) throw new Error("Este pedido já está num fechamento. Exclua o fechamento antes.");
    run("DELETE FROM pedidos WHERE id = ?", id(req));
    return { ok: true };
  }));

  app.post("/api/pedidos/ler", upload.array("arquivos", 100), rota(async (req) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length) throw new Error("Envie os PDFs dos pedidos.");
    const out: any[] = [];
    for (const f of files) {
      try {
        for (const p of await parsePedidos(new Uint8Array(f.buffer))) {
          const ex = get("SELECT p.id, EXISTS (SELECT 1 FROM fechamento_pedidos fp WHERE fp.pedido_id = p.id) cobrado FROM pedidos p WHERE numero = ?", p.numero);
          out.push({ ...p, arquivo: f.originalname, existente: !!ex, cobrado: !!ex?.cobrado });
        }
      } catch (e: any) {
        out.push({ arquivo: f.originalname, erro: e.message });
      }
    }
    return out;
  }));

  app.post("/api/pedidos/importar", rota((req) => {
    const lista: PedidoLido[] = req.body?.pedidos ?? [];
    const substituir = !!req.body?.substituir;
    const r = { ok: 0, existente: 0, cobrado: 0 };
    transacao(() => { for (const p of lista) if (p.numero && p.data && p.cliente) r[importarPedido(p, substituir) as keyof typeof r]++; });
    return r;
  }));

  app.put("/api/itens/:id", rota((req) => {
    const it = get("SELECT i.*, p.cliente_id FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id WHERE i.id = ?", id(req));
    if (!it) throw new Error("Item não encontrado.");
    const v = req.body?.preco_promo;
    if (v === null || v === "" || v === undefined || Number(v) === it.preco) {
      run("UPDATE pedido_itens SET preco_promo = NULL, total_promo = NULL WHERE id = ?", it.id);
      if (req.body?.lembrar !== false) run("DELETE FROM precos_cliente WHERE cliente_id = ? AND codigo = ?", it.cliente_id, it.codigo);
    } else {
      const pp = r2(Number(v));
      if (!(pp >= 0)) throw new Error("Preço inválido.");
      run("UPDATE pedido_itens SET preco_promo = ?, total_promo = ? WHERE id = ?", pp, r2(it.qtd * pp), it.id);
      if (req.body?.lembrar !== false) run("INSERT INTO precos_cliente (cliente_id, codigo, preco_promo) VALUES (?,?,?) ON CONFLICT(cliente_id, codigo) DO UPDATE SET preco_promo = excluded.preco_promo", it.cliente_id, it.codigo, pp);
    }
    return { ok: true };
  }));

  app.post("/api/pedidos/:id/combinar", rota((req) => {
    const ped = get("SELECT * FROM pedidos WHERE id = ?", id(req));
    if (!ped) throw new Error("Pedido não encontrado.");
    const itens = all("SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY ordem, id", ped.id);
    const original = r2(itens.reduce((s, i) => s + i.total, 0));
    const alvo = req.body?.total;
    transacao(() => {
      if (alvo === null || alvo === "" || alvo === undefined) {
        run("UPDATE pedido_itens SET preco_promo = NULL, total_promo = NULL WHERE pedido_id = ?", ped.id);
        return;
      }
      const total = r2(Number(alvo) + (ped.desconto_valor ?? 0));
      if (!(total > 0) || !original) throw new Error("Total inválido.");
      const fator = total / original;
      let acumulado = 0;
      itens.forEach((i, k) => {
        const pp = r2(i.preco * fator);
        let tp = r2(i.qtd * pp);
        if (k === itens.length - 1) tp = r2(total - acumulado);
        acumulado = r2(acumulado + tp);
        run("UPDATE pedido_itens SET preco_promo = ?, total_promo = ? WHERE id = ?", pp, tp, i.id);
      });
    });
    return { ok: true };
  }));

  app.put("/api/produtos/:codigo", rota((req) => {
    run("INSERT INTO produtos (codigo, unidade) VALUES (?, ?) ON CONFLICT(codigo) DO UPDATE SET unidade = excluded.unidade", req.params.codigo, String(req.body?.unidade ?? "").trim() || null);
    return { ok: true };
  }));

  app.post("/api/fechamentos/previa", rota((req) => {
    const { cliente_id, pedidoIds, vencimento, modo, manual, de, ate } = req.body ?? {};
    return { ...montarFechamento(Number(cliente_id), (pedidoIds ?? []).map(Number), vencimento || null, modo ?? "nenhum", Number(manual) || 0), de, ate };
  }));

  app.post("/api/fechamentos", rota((req) => {
    const { cliente_id, pedidoIds, vencimento, modo, manual, de, ate } = req.body ?? {};
    if (!de || !ate) throw new Error("Informe o período.");
    const ids: number[] = (pedidoIds ?? []).map(Number);
    if (!ids.length) throw new Error("Selecione pelo menos um pedido.");
    const ja = all(`SELECT p.numero FROM fechamento_pedidos fp JOIN pedidos p ON p.id = fp.pedido_id WHERE fp.pedido_id IN (${ids.map(() => "?").join(",")})`, ...ids);
    if (ja.length) throw new Error(`Pedido(s) já cobrado(s) em outro fechamento: ${ja.map((x) => x.numero).join(", ")}`);
    const f = montarFechamento(Number(cliente_id), ids, vencimento || null, modo ?? "nenhum", Number(manual) || 0);
    return transacao(() => {
      const fid = Number(run("INSERT INTO fechamentos (cliente_id, de, ate, vencimento, arredondamento, total_original, total_desconto, total_pagar) VALUES (?,?,?,?,?,?,?,?)",
        f.cliente.id, de, ate, f.vencimento, f.arredondamento, f.original, f.desconto, f.totalPagar).lastInsertRowid);
      for (const p of f.pedidos) run("INSERT INTO fechamento_pedidos (fechamento_id, pedido_id) VALUES (?, ?)", fid, p.id);
      return { id: fid };
    });
  }));

  app.get("/api/fechamentos", rota(() => all(`SELECT f.*, c.nome cliente, (SELECT COUNT(*) FROM fechamento_pedidos fp WHERE fp.fechamento_id = f.id) qtd_pedidos FROM fechamentos f JOIN clientes c ON c.id = f.cliente_id ORDER BY f.id DESC LIMIT 300`)));

  app.patch("/api/fechamentos/:id", rota((req) => {
    const s = String(req.body?.status ?? "");
    if (!["aberto", "enviado", "pago"].includes(s)) throw new Error("Status inválido.");
    run("UPDATE fechamentos SET status = ? WHERE id = ?", s, id(req));
    return { ok: true };
  }));

  app.delete("/api/fechamentos/:id", rota((req) => { run("DELETE FROM fechamentos WHERE id = ?", id(req)); return { ok: true }; }));

  app.get("/api/fechamentos/:id/planilha.xlsx", rota(async (req, res) => {
    const f = carregarFechamento(id(req));
    const buf = await excelFechamento(f);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(nomeArquivo(f, "xlsx"))}`);
    res.end(buf);
  }));

  app.get("/api/fechamentos/:id/fechamento.pdf", rota((req, res) => {
    const f = carregarFechamento(id(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(nomeArquivo(f, "pdf"))}`);
    pdfFechamento(f).pipe(res);
  }));
}
