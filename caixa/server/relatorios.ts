import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { db, FORMAS, Periodo, resumo, listarContas, listarVendas, listarRecebimentos, FATURADO } from "./db.js";

const EMPRESA = process.env.NOME_EMPRESA ?? "Depósito WM";
const brl = (n: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (s: string) => (s ? s.split("-").reverse().join("/") : "");
function vendasPorDia(p: Periodo) {
  const linhas = db.prepare("SELECT data, forma, ROUND(SUM(valor), 2) total FROM vendas WHERE data BETWEEN ? AND ? GROUP BY data, forma ORDER BY data").all(p.de, p.ate) as unknown as { data: string; forma: string; total: number }[];
  const ordem = (f: string) => { const i = FORMAS.indexOf(f); return i < 0 ? 50 : i; };
  const formas = [...new Set(linhas.map((l) => l.forma))].sort((a, b) => ordem(a) - ordem(b) || a.localeCompare(b));
  const dias = new Map<string, Record<string, number>>();
  for (const l of linhas) dias.set(l.data, { ...(dias.get(l.data) ?? {}), [l.forma]: l.total });
  return { formas, dias: [...dias.entries()].map(([data, v]) => ({ data, v, total: Math.round(Object.values(v).reduce((s, x) => s + x, 0) * 100) / 100 })) };
}

export type TipoRel = "completo" | "vendas" | "contas";
const NOME_REL: Record<TipoRel, string> = { completo: "Relatório financeiro", vendas: "Relatório de vendas", contas: "Relatório de contas pagas" };
const nomeForma = (f: string) => (f === FATURADO ? "FATURADO (PRAZO)" : f);

const COR = { escuro: "#1f2a37", destaque: "#0f766e", claro: "#f1f5f4", linha: "#e2e8f0", texto: "#1f2937", suave: "#64748b", verm: "#b91c1c" };

type Col = { titulo: string; largura: number; alinhar?: "left" | "right"; valor: (r: any) => string };

export function gerarPdf(p: Periodo, tipo: TipoRel = "completo"): PDFKit.PDFDocument {
  const r = resumo(p);
  const V = tipo !== "contas";
  const C = tipo !== "vendas";
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: `${NOME_REL[tipo]} ${dt(p.de)} a ${dt(p.ate)}` } });
  const L = 40;
  const W = doc.page.width - 80;
  const fimPagina = () => doc.page.height - 60;

  doc.rect(0, 0, doc.page.width, 92).fill(COR.escuro);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(20).text(EMPRESA, L, 26);
  doc.font("Helvetica").fontSize(11).fillColor("#cbd5e1").text(`${NOME_REL[tipo]}  |  ${dt(p.de)} a ${dt(p.ate)}`, L, 54);
  doc.y = 112;

  const cards: [string, number | string, string?][] = tipo === "vendas"
    ? [["Vendas totais", r.totalVendas], ["Vendas à vista", r.avista], ["Vendido faturado", r.faturado], ["Recebido de faturados", r.recebido], ["Entradas no caixa", r.entradas, COR.destaque], ["Dias com venda", String(r.porDia.filter((d) => d.vendas > 0).length)]]
    : tipo === "contas"
    ? [["Total pago", r.contas, COR.verm]]
    : [["Vendas totais", r.totalVendas], ["Vendas à vista", r.avista], ["Vendido faturado", r.faturado], ["Recebido de faturados", r.recebido], ["Contas pagas", r.contas, COR.verm], ["Saldo do período", r.saldo, r.saldo < 0 ? COR.verm : COR.destaque]];
  const cw = (W - 20) / 3;
  const y0 = doc.y;
  cards.forEach(([t, v, c], i) => {
    const x = L + (i % 3) * (cw + 10);
    const y = y0 + Math.floor(i / 3) * 62;
    doc.roundedRect(x, y, cw, 52, 6).fill(COR.claro);
    doc.fillColor(COR.suave).font("Helvetica").fontSize(9).text(t.toUpperCase(), x + 12, y + 10, { width: cw - 24 });
    doc.fillColor(c ?? COR.texto).font("Helvetica-Bold").fontSize(15).text(typeof v === "number" ? brl(v) : v, x + 12, y + 25, { width: cw - 24, lineBreak: false, ellipsis: true });
  });
  doc.y = y0 + 62 * Math.ceil(cards.length / 3) + 4;
  if (tipo !== "contas") doc.fillColor(COR.suave).font("Helvetica").fontSize(8.5).text(tipo === "vendas" ? "Entradas no caixa = vendas à vista + recebido de faturados. Vendas faturadas entram no caixa somente quando recebidas." : "Saldo = vendas à vista + recebido de faturados - contas pagas. Vendas faturadas entram no caixa somente quando recebidas.", L, doc.y, { width: W });
  doc.moveDown(1);

  const titulo = (t: string) => {
    if (doc.y > fimPagina() - 80) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor(COR.destaque).font("Helvetica-Bold").fontSize(12.5).text(t, L, doc.y);
    doc.moveTo(L, doc.y + 3).lineTo(L + W, doc.y + 3).lineWidth(1.2).strokeColor(COR.destaque).stroke();
    doc.y += 9;
  };

  const tabela = (cols: Col[], linhas: any[], total?: Record<number, string>) => {
    const soma = cols.reduce((s, c) => s + c.largura, 0);
    const ws = cols.map((c) => (c.largura / soma) * W);
    const cab = () => {
      const y = doc.y;
      doc.rect(L, y, W, 18).fill(COR.escuro);
      let x = L;
      cols.forEach((c, i) => {
        doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8.5).text(c.titulo, x + 5, y + 5, { width: ws[i] - 10, align: c.alinhar ?? "left", lineBreak: false });
        x += ws[i];
      });
      doc.y = y + 18;
    };
    const linha = (vals: string[], fundo?: string, negrito = false) => {
      doc.font(negrito ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      const h = Math.max(16, ...vals.map((v, i) => doc.heightOfString(v, { width: ws[i] - 10 }) + 7));
      if (doc.y + h > fimPagina()) { doc.addPage(); cab(); }
      const y = doc.y;
      if (fundo) doc.rect(L, y, W, h).fill(fundo);
      let x = L;
      vals.forEach((v, i) => {
        doc.fillColor(COR.texto).font(negrito ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).text(v, x + 5, y + 4, { width: ws[i] - 10, align: cols[i].alinhar ?? "left" });
        x += ws[i];
      });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.5).strokeColor(COR.linha).stroke();
      doc.y = y + h;
    };
    cab();
    if (!linhas.length) linha(["Nenhum registro no período", ...cols.slice(1).map(() => "")]);
    linhas.forEach((l, i) => linha(cols.map((c) => c.valor(l)), i % 2 ? COR.claro : undefined));
    if (total) linha(cols.map((_, i) => total[i] ?? ""), "#dbeafe", true);
    doc.y += 4;
  };

  const pct = (v: number, t: number) => (t ? `${((v / t) * 100).toFixed(1).replace(".", ",")}%` : "-");

  if (V) {
  titulo("Vendas por forma de pagamento");
  tabela(
    [
      { titulo: "Forma", largura: 3, valor: (x) => nomeForma(x.forma) },
      { titulo: "Qtd", largura: 1, alinhar: "right", valor: (x) => String(x.qtd) },
      { titulo: "Participação", largura: 1.4, alinhar: "right", valor: (x) => pct(x.total, r.totalVendas) },
      { titulo: "Total", largura: 1.8, alinhar: "right", valor: (x) => brl(x.total) },
    ],
    r.porForma,
    { 0: "TOTAL", 3: brl(r.totalVendas) }
  );
  }

  if (tipo === "vendas") {
    const vd = vendasPorDia(p);
    const curto = (f: string) => ({ DINHEIRO: "Dinheiro", "CARTAO DEBITO": "Débito", "CARTAO CREDITO": "Crédito", PIX: "PIX", PRAZO: "Faturado" } as Record<string, string>)[f] ?? f;
    titulo("Vendas por dia");
    const tot: Record<number, string> = { 0: "TOTAL" };
    vd.formas.forEach((f, i) => (tot[i + 1] = brl(r.porForma.find((x) => x.forma === f)?.total ?? 0)));
    tot[vd.formas.length + 1] = brl(r.totalVendas);
    tabela(
      [
        { titulo: "Data", largura: 1.1, valor: (x) => dt(x.data) },
        ...vd.formas.map((f) => ({ titulo: curto(f), largura: 1.2, alinhar: "right" as const, valor: (x: any) => (x.v[f] ? brl(x.v[f]) : "-") })),
        { titulo: "Total", largura: 1.3, alinhar: "right" as const, valor: (x: any) => brl(x.total) },
      ],
      vd.dias,
      tot
    );
  }

  if (V) {
  titulo("Recebido de faturados por forma");
  tabela(
    [
      { titulo: "Forma", largura: 3, valor: (x) => x.forma },
      { titulo: "Qtd", largura: 1, alinhar: "right", valor: (x) => String(x.qtd) },
      { titulo: "Total", largura: 1.8, alinhar: "right", valor: (x) => brl(x.total) },
    ],
    r.recebPorForma,
    { 0: "TOTAL", 2: brl(r.recebido) }
  );
  }

  if (C) {
  titulo("Contas pagas por categoria");
  tabela(
    [
      { titulo: "Categoria", largura: 3, valor: (x) => x.nome },
      { titulo: "Qtd", largura: 1, alinhar: "right", valor: (x) => String(x.qtd) },
      { titulo: "Participação", largura: 1.4, alinhar: "right", valor: (x) => pct(x.total, r.contas) },
      { titulo: "Total", largura: 1.8, alinhar: "right", valor: (x) => brl(x.total) },
    ],
    r.porCategoria,
    { 0: "TOTAL", 3: brl(r.contas) }
  );
  }

  if (C) {
  titulo("Contas pagas por banco de saída");
  tabela(
    [
      { titulo: "Banco", largura: 3, valor: (x) => x.nome },
      { titulo: "Qtd", largura: 1, alinhar: "right", valor: (x) => String(x.qtd) },
      { titulo: "Total", largura: 1.8, alinhar: "right", valor: (x) => brl(x.total) },
    ],
    r.porBanco,
    { 0: "TOTAL", 2: brl(r.contas) }
  );
  }

  if (tipo === "completo") {
  titulo("Movimento diário");
  tabela(
    [
      { titulo: "Data", largura: 1.2, valor: (x) => dt(x.data) },
      { titulo: "À vista", largura: 1.4, alinhar: "right", valor: (x) => brl(x.avista) },
      { titulo: "Faturado", largura: 1.4, alinhar: "right", valor: (x) => brl(x.faturado) },
      { titulo: "Recebido fat.", largura: 1.4, alinhar: "right", valor: (x) => brl(x.recebido) },
      { titulo: "Contas", largura: 1.4, alinhar: "right", valor: (x) => brl(x.contas) },
      { titulo: "Saldo", largura: 1.4, alinhar: "right", valor: (x) => brl(x.avista + x.recebido - x.contas) },
    ],
    r.porDia,
    { 0: "TOTAL", 1: brl(r.avista), 2: brl(r.faturado), 3: brl(r.recebido), 4: brl(r.contas), 5: brl(r.saldo) }
  );
  }

  if (C) {
  titulo("Detalhe das contas pagas");
  tabela(
    [
      { titulo: "Data", largura: 1, valor: (x) => dt(x.data) },
      { titulo: "Descrição", largura: 2.6, valor: (x) => x.descricao },
      { titulo: "Categoria", largura: 1.5, valor: (x) => x.categoria ?? "" },
      { titulo: "Banco", largura: 1.5, valor: (x) => x.banco ?? "" },
      { titulo: "Valor", largura: 1.3, alinhar: "right", valor: (x) => brl(x.valor) },
    ],
    listarContas(p).reverse(),
    { 0: "TOTAL", 4: brl(r.contas) }
  );
  }

  const fat = listarVendas(p).filter((v) => v.forma === FATURADO).reverse();
  if (V) {
  titulo("Vendas faturadas (a receber)");
  tabela(
    [
      { titulo: "Data", largura: 1, valor: (x) => dt(x.data) },
      { titulo: "Venda", largura: 0.8, valor: (x) => x.codigo ?? "" },
      { titulo: "Cliente", largura: 3.4, valor: (x) => x.cliente || x.obs || "" },
      { titulo: "Valor", largura: 1.3, alinhar: "right", valor: (x) => brl(x.valor) },
    ],
    fat,
    { 0: "TOTAL", 3: brl(r.faturado) }
  );
  }

  if (V) {
  titulo("Recebimentos de faturados");
  tabela(
    [
      { titulo: "Data", largura: 1, valor: (x) => dt(x.data) },
      { titulo: "Cliente", largura: 2.8, valor: (x) => x.cliente },
      { titulo: "Título", largura: 0.9, valor: (x) => x.titulo ?? "" },
      { titulo: "Forma", largura: 1.2, valor: (x) => x.forma },
      { titulo: "Recebido", largura: 1.3, alinhar: "right", valor: (x) => brl(x.recebido) },
    ],
    listarRecebimentos(p).reverse(),
    { 0: "TOTAL", 4: brl(r.recebido) }
  );
  }

  const range = doc.bufferedPageRange();
  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 34;
    doc.page.margins.bottom = 0;
    doc.fillColor(COR.suave).font("Helvetica").fontSize(8).text(`Gerado em ${agora}`, L, y, { width: W / 2, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, y, { width: W / 2, align: "right", lineBreak: false });
  }
  doc.end();
  return doc;
}

export async function gerarExcel(p: Periodo, tipo: TipoRel = "completo"): Promise<Buffer> {
  const r = resumo(p);
  const V = tipo !== "contas";
  const C = tipo !== "vendas";
  const wb = new ExcelJS.Workbook();
  wb.creator = EMPRESA;
  const MOEDA = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  const cabecalho = (ws: ExcelJS.Worksheet, linha: number) => {
    const row = ws.getRow(linha);
    row.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2A37" } };
      c.alignment = { vertical: "middle" };
    });
    row.height = 20;
  };
  const zebra = (ws: ExcelJS.Worksheet, de: number, ate: number) => {
    for (let i = de; i <= ate; i++) if ((i - de) % 2) ws.getRow(i).eachCell({ includeEmpty: true }, (c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F4" } }));
  };
  const totalRow = (ws: ExcelJS.Worksheet, row: ExcelJS.Row) => row.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
    c.border = { top: { style: "thin" } };
  });

  const res = wb.addWorksheet("Resumo", { views: [{ showGridLines: false }] });
  res.columns = [{ width: 34 }, { width: 18 }, { width: 4 }, { width: 30 }, { width: 18 }];
  res.mergeCells("A1:E1");
  res.getCell("A1").value = `${EMPRESA}  |  ${NOME_REL[tipo]} ${dt(p.de)} a ${dt(p.ate)}`;
  res.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  res.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2A37" } };
  res.getRow(1).height = 30;
  const kpis: [string, number][] = tipo === "vendas"
    ? [["Vendas totais", r.totalVendas], ["Vendas à vista", r.avista], ["Vendido faturado", r.faturado], ["Recebido de faturados", r.recebido], ["Entradas no caixa", r.entradas]]
    : tipo === "contas"
    ? [["Total pago", r.contas]]
    : [["Vendas totais", r.totalVendas], ["Vendas à vista", r.avista], ["Vendido faturado", r.faturado], ["Recebido de faturados", r.recebido], ["Contas pagas", r.contas], ["Saldo do período", r.saldo]];
  kpis.forEach(([t, v], i) => {
    const row = res.getRow(3 + i);
    const ultimo = i === kpis.length - 1 && tipo !== "contas";
    row.getCell(1).value = t;
    row.getCell(2).value = v;
    row.getCell(2).numFmt = MOEDA;
    row.getCell(1).font = { bold: ultimo };
    row.getCell(2).font = { bold: true, color: { argb: ultimo ? (v < 0 ? "FFB91C1C" : "FF0F766E") : "FF1F2937" } };
  });

  let lin = 11;
  const bloco = (titulo: string, col: number, itens: { nome: string; total: number }[]) => {
    let l = lin;
    res.getCell(l, col).value = titulo;
    res.getCell(l, col + 1).value = "Total";
    [col, col + 1].forEach((c) => {
      const cell = res.getCell(l, c);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    });
    for (const it of itens) {
      l++;
      res.getCell(l, col).value = it.nome;
      res.getCell(l, col + 1).value = it.total;
      res.getCell(l, col + 1).numFmt = MOEDA;
    }
    return l;
  };
  if (tipo === "vendas") {
    bloco("Vendas por forma", 1, r.porForma.map((x) => ({ nome: nomeForma(x.forma), total: x.total })));
    bloco("Recebido de faturados", 4, r.recebPorForma.map((x) => ({ nome: x.forma, total: x.total })));
  } else if (tipo === "contas") {
    bloco("Contas por categoria", 1, r.porCategoria);
    bloco("Contas por banco", 4, r.porBanco);
  } else {
    const a = bloco("Vendas por forma", 1, r.porForma.map((x) => ({ nome: nomeForma(x.forma), total: x.total })));
    const b = bloco("Contas por categoria", 4, r.porCategoria);
    lin = Math.max(a, b) + 2;
    bloco("Recebido de faturados", 1, r.recebPorForma.map((x) => ({ nome: x.forma, total: x.total })));
    bloco("Contas por banco", 4, r.porBanco);
  }

  if (tipo === "vendas") {
    const vd = vendasPorDia(p);
    const ws = wb.addWorksheet("Vendas por dia", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [{ header: "Data", key: "data", width: 12 }, ...vd.formas.map((f) => ({ header: nomeForma(f), key: f, width: 17 })), { header: "Total", key: "total", width: 16 }];
    vd.dias.forEach((d) => ws.addRow({ data: new Date(d.data + "T12:00:00"), ...d.v, total: d.total }));
    const nn = vd.dias.length + 1;
    const last = vd.formas.length + 2;
    const tr = ws.addRow(["TOTAL", ...Array.from({ length: last - 1 }, (_, i) => ({ formula: `SUM(${ws.getColumn(i + 2).letter}2:${ws.getColumn(i + 2).letter}${nn})` }))]);
    totalRow(ws, tr);
    ws.getColumn(1).numFmt = "dd/mm/yyyy";
    for (let c = 2; c <= last; c++) ws.getColumn(c).numFmt = MOEDA;
    cabecalho(ws, 1);
    zebra(ws, 2, nn);
  }

  const dia = tipo === "completo" ? wb.addWorksheet("Diário", { views: [{ state: "frozen", ySplit: 1 }] }) : new ExcelJS.Workbook().addWorksheet("x");
  dia.columns = [
    { header: "Data", key: "data", width: 12 },
    { header: "Vendas totais", key: "vendas", width: 16 },
    { header: "À vista", key: "avista", width: 16 },
    { header: "Faturado", key: "faturado", width: 16 },
    { header: "Recebido faturado", key: "recebido", width: 18 },
    { header: "Contas pagas", key: "contas", width: 16 },
    { header: "Saldo", key: "saldo", width: 16 },
  ];
  r.porDia.forEach((x, i) => {
    const row = dia.addRow({ ...x, data: new Date(x.data + "T12:00:00") });
    row.getCell("saldo").value = { formula: `C${i + 2}+E${i + 2}-F${i + 2}` };
  });
  const nd = r.porDia.length + 1;
  const td = dia.addRow(["TOTAL", ...["B", "C", "D", "E", "F", "G"].map((c) => ({ formula: `SUM(${c}2:${c}${nd})` }))]);
  totalRow(dia, td);
  dia.getColumn(1).numFmt = "dd/mm/yyyy";
  for (let c = 2; c <= 7; c++) dia.getColumn(c).numFmt = MOEDA;

  const planilha = (nome: string, cols: Partial<ExcelJS.Column>[], linhas: any[], somaCol: string) => {
    const ws = wb.addWorksheet(nome, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = cols;
    linhas.forEach((l) => ws.addRow({ ...l, data: l.data ? new Date(l.data + "T12:00:00") : null, vencimento: l.vencimento ? new Date(l.vencimento + "T12:00:00") : null }));
    const n = linhas.length + 1;
    const idx = cols.findIndex((c) => c.key === somaCol) + 1;
    const tr = ws.addRow([]);
    tr.getCell(1).value = "TOTAL";
    tr.getCell(idx).value = { formula: `SUM(${ws.getColumn(idx).letter}2:${ws.getColumn(idx).letter}${n})` };
    totalRow(ws, tr);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    cols.forEach((c, i) => {
      if (["valor", "recebido", "bruto"].includes(c.key as string)) ws.getColumn(i + 1).numFmt = MOEDA;
      if (["data", "vencimento"].includes(c.key as string)) ws.getColumn(i + 1).numFmt = "dd/mm/yyyy";
    });
    cabecalho(ws, 1);
    zebra(ws, 2, n);
  };

  if (C) planilha("Contas pagas", [
    { header: "Data", key: "data", width: 12 },
    { header: "Descrição", key: "descricao", width: 40 },
    { header: "Categoria", key: "categoria", width: 20 },
    { header: "Banco", key: "banco", width: 20 },
    { header: "Valor", key: "valor", width: 16 },
  ], listarContas(p).reverse(), "valor");

  if (V) planilha("Vendas", [
    { header: "Data", key: "data", width: 12 },
    { header: "Forma", key: "forma", width: 18 },
    { header: "Venda", key: "codigo", width: 10 },
    { header: "Cliente", key: "cliente", width: 40 },
    { header: "Funcionário", key: "funcionario", width: 14 },
    { header: "Bruto", key: "bruto", width: 14 },
    { header: "Desc. %", key: "desconto", width: 9 },
    { header: "Valor", key: "valor", width: 16 },
    { header: "Obs", key: "obs", width: 24 },
  ], listarVendas(p).reverse(), "valor");

  if (V) planilha("Recebimentos faturados", [
    { header: "Data", key: "data", width: 12 },
    { header: "Cliente", key: "cliente", width: 36 },
    { header: "Título", key: "titulo", width: 10 },
    { header: "Vencimento", key: "vencimento", width: 12 },
    { header: "Valor título", key: "valor", width: 15 },
    { header: "Recebido", key: "recebido", width: 15 },
    { header: "Forma", key: "forma", width: 16 },
  ], listarRecebimentos(p).reverse(), "recebido");

  cabecalho(dia, 1);
  zebra(dia, 2, nd);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
