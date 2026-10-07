import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export interface VendaImportada {
  codigo: string;
  funcionario: string;
  cliente: string;
  forma: string;
  total: number;
  desconto: number;
  liquido: number;
}

export interface RecebimentoImportado {
  cliente: string;
  titulo: string;
  vencimento: string;
  valor: number;
  recebido: number;
  restante: number;
  forma: string;
}

export interface SangriaImportada {
  funcionario: string;
  hora: string;
  descricao: string;
  valor: number;
}

export interface MovimentoImportado {
  data: string;
  movimento: string;
  responsavel: string;
  abertura: number;
  vendas: VendaImportada[];
  recebimentos: RecebimentoImportado[];
  sangrias: SangriaImportada[];
  totalVendas: number;
  totalRecebimentos: number;
  conferido: boolean;
  avisos: string[];
}

export const num = (s: string): number => Number(s.replace(/\./g, "").replace(",", "."));

export const dataIso = (s: string): string => {
  const [d, m, a] = s.split("/");
  return `${a}-${m}-${d}`;
};

export async function extrairLinhas(buf: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data: buf, useSystemFonts: true }).promise;
  const linhas: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const grupos: { y: number; itens: { x: number; s: string }[] }[] = [];
    for (const it of content.items as any[]) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let g = grupos.find((g) => Math.abs(g.y - y) < 3);
      if (!g) {
        g = { y, itens: [] };
        grupos.push(g);
      }
      g.itens.push({ x, s: it.str.trim() });
    }
    grupos.sort((a, b) => b.y - a.y);
    for (const g of grupos) {
      g.itens.sort((a, b) => a.x - b.x);
      linhas.push(g.itens.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim());
    }
  }
  return linhas;
}

const V = String.raw`(-?[\d.]+,\d{2})`;
const reVenda = new RegExp(String.raw`^(\d+) (\S+)(?: (.*?))? ${V} ([\d.]+(?:,\d+)?) ${V}$`);
const reReceb = new RegExp(String.raw`^(.+?)(?: (\d+/\d+))? (\d{2}/\d{2}/\d{4}) ${V} ${V} ${V} ${V} (.+)$`);
const reSangria = new RegExp(String.raw`^(\S+) (\d{2}:\d{2}:\d{2}) (.*?) ${V}$`);

export async function parseMovimento(buf: Uint8Array): Promise<MovimentoImportado> {
  const linhas = await extrairLinhas(buf);
  const texto = linhas.join("\n");
  if (!/Movimento de Caixa/i.test(texto)) throw new Error("O arquivo não parece ser um Relatório de Movimento de Caixa.");

  const data = texto.match(/Data\s*:?\s*(\d{2}\/\d{2}\/\d{4})/)?.[1];
  if (!data) throw new Error("Data do movimento não encontrada.");
  const movimento = texto.match(/N°\s*Movimento:?\s*(\d+)/)?.[1] ?? "";
  const responsavel = texto.match(/Responsavel:?\s*([A-ZÀ-Ú ]+?)\s+Data/)?.[1]?.trim() ?? "";
  const abertura = num(texto.match(/Valor Abertura\s*:?\s*([\d.]+,\d{2})/)?.[1] ?? "0");

  const vendas: VendaImportada[] = [];
  const recebimentos: RecebimentoImportado[] = [];
  const sangrias: SangriaImportada[] = [];
  const avisos: string[] = [];
  let secao = "";
  let forma = "";
  let totalVendas = 0;
  let totalRecebimentos = 0;

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (/^Recebimentos a prazo/i.test(l)) { secao = "receb"; continue; }
    const mv = l.match(/^Vendas:\s*(.+)$/);
    if (mv) { secao = "vendas"; forma = mv[1].trim().toUpperCase(); continue; }
    if (/^SANGRIAS/i.test(l)) { secao = "sangria"; continue; }
    if (/Total Vendas/i.test(l)) {
      const nums = linhas[i + 1]?.match(/-?[\d.]+,\d{2}/g);
      if (nums) { totalVendas = num(nums[0]); totalRecebimentos = num(nums[1] ?? "0"); }
      secao = "";
      continue;
    }
    if (/^=+|Valor Inicial/.test(l)) { if (secao !== "sangria") secao = ""; continue; }

    if (secao === "receb") {
      const m = l.match(reReceb);
      if (m) recebimentos.push({ cliente: m[1].trim(), titulo: m[2] ?? "", vencimento: dataIso(m[3]), valor: num(m[4]), recebido: num(m[6]), restante: num(m[7]), forma: m[8].trim().toUpperCase() });
    } else if (secao === "vendas") {
      const m = l.match(reVenda);
      if (m) {
        vendas.push({ codigo: m[1], funcionario: m[2], cliente: (m[3] ?? "").trim(), forma, total: num(m[4]), desconto: num(m[5]), liquido: num(m[6]) });
      } else if (vendas.length && !/Sub Total|Código|^[\d.,\s]+$/.test(l) && /^[A-ZÀ-Ú0-9 .&\-\/]+$/.test(l)) {
        const ult = vendas[vendas.length - 1];
        if (ult.forma === forma) ult.cliente = `${ult.cliente} ${l}`.trim();
      }
    } else if (secao === "sangria") {
      const m = l.match(reSangria);
      if (m) sangrias.push({ funcionario: m[1], hora: m[2], descricao: m[3].trim(), valor: num(m[4]) });
      if (/TOTAL SANGRIA/i.test(l)) secao = "";
    }
  }

  const soma = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100;
  const sv = soma(vendas.map((v) => v.liquido));
  const sr = soma(recebimentos.map((r) => r.recebido));
  if (totalVendas && Math.abs(sv - totalVendas) > 0.009) avisos.push(`Soma das vendas lidas (${sv.toFixed(2)}) difere do total do relatório (${totalVendas.toFixed(2)}).`);
  if (Math.abs(sr - totalRecebimentos) > 0.009) avisos.push(`Soma dos recebimentos lidos (${sr.toFixed(2)}) difere do total do relatório (${totalRecebimentos.toFixed(2)}).`);
  if (!totalVendas) avisos.push("Total de vendas do relatório não encontrado para conferência.");

  return { data: dataIso(data), movimento, responsavel, abertura, vendas, recebimentos, sangrias, totalVendas, totalRecebimentos, conferido: avisos.length === 0, avisos };
}
