import { extrairLinhas, num, dataIso } from "./parser.js";

export interface ItemPedido {
  codigo: string;
  descricao: string;
  qtd: number;
  preco: number;
  total: number;
}

export interface PedidoLido {
  numero: string;
  data: string;
  hora: string;
  cliente: string;
  endereco: string;
  celular: string;
  forma: string;
  vendedor: string;
  descontoTexto: string;
  descontoValor: number;
  total: number;
  itens: ItemPedido[];
  avisos: string[];
}

const N = String.raw`(\d{1,3}(?:\.\d{3})*(?:,\d+)?)`;
const reItem = new RegExp(String.raw`^(\d+) (.+?) ${N} ${N} ${N}$`);
const r2 = (n: number) => Math.round(n * 100) / 100;

function lerBloco(linhas: string[]): Partial<PedidoLido> & { itens: ItemPedido[] } {
  const texto = linhas.join("\n");
  const p: Partial<PedidoLido> & { itens: ItemPedido[] } = { itens: [] };
  p.numero = texto.match(/PEDIDO DE VENDA\s+(\d+)/i)?.[1];
  const d = texto.match(/DATA:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1];
  if (d) p.data = dataIso(d);
  p.hora = texto.match(/HORA:\s*(\d{2}:\d{2}(?::\d{2})?)/i)?.[1];
  const cli = texto.match(/CLIENTE:\s*(.+)/i)?.[1];
  if (cli) p.cliente = cli.replace(/\s+(TEL|CEL):.*$/i, "").trim();
  const cel = texto.match(/CEL:\s*([\d() -]{8,})/i)?.[1];
  if (cel) p.celular = cel.trim();
  const end = texto.match(/END:\s*(.+)/i)?.[1];
  if (end) p.endereco = end.trim();
  const vend = texto.match(/VENDEDOR:\s*([A-ZÀ-Ú]+(?: [A-ZÀ-Ú]+)*?)(?=\s+(?:VISTO|DESCONTO)|\s*$)/im)?.[1];
  if (vend) p.vendedor = vend.trim();
  const desc = texto.match(/DESCONTO:\s*([\d.,]+\s*%?)/i)?.[1];
  if (desc) p.descontoTexto = desc.replace(/\s+/g, "");
  const tot = texto.match(/TOTAL:\s*([\d.]+,\d{2})/i)?.[1];
  if (tot) p.total = num(tot);

  let qtdPrimeiro = false;
  let dentro = false;
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].replace(/^=+\s*/, "");
    if (/^C[óo]digo\s+Descri/i.test(l)) {
      dentro = true;
      const iq = l.search(/\bQtd\b/i);
      const iu = l.search(/Valor Unit/i);
      qtdPrimeiro = iq >= 0 && iu >= 0 && iq < iu;
      continue;
    }
    if (/FORMA PAGAMENTO/i.test(l)) {
      dentro = false;
      const resto = l.replace(/.*FORMA PAGAMENTO:?\s*/i, "").trim();
      const forma = /^[A-ZÀ-Ú ]{3,}$/.test(resto) ? resto : (linhas[i + 1] ?? "").trim();
      if (/^[A-ZÀ-Ú ]{3,30}$/.test(forma) && !/VENDEDOR|PEDIDO/i.test(forma)) p.forma = forma;
      continue;
    }
    if (!dentro || /^=+$/.test(l)) continue;
    const m = l.match(reItem);
    if (!m) continue;
    const a = num(m[3]);
    const b = num(m[4]);
    const total = num(m[5]);
    const [qtd, preco] = qtdPrimeiro ? [a, b] : [b, a];
    p.itens.push({ codigo: m[1], descricao: m[2].trim(), qtd, preco, total });
  }
  return p;
}

export async function parsePedidos(buf: Uint8Array): Promise<PedidoLido[]> {
  const linhas = await extrairLinhas(buf);
  if (!linhas.some((l) => /PEDIDO DE VENDA/i.test(l))) throw new Error("O arquivo não parece ser um Pedido de Venda.");

  const blocos: string[][] = [];
  for (const l of linhas.map((x) => x.replace(/^=+\s*/, "")).filter(Boolean)) {
    if (/PEDIDO DE VENDA\s+\d+/i.test(l)) blocos.push([]);
    if (blocos.length) blocos[blocos.length - 1].push(l);
  }

  const porNumero = new Map<string, PedidoLido>();
  for (const b of blocos) {
    const p = lerBloco(b);
    if (!p.numero) continue;
    const atual = porNumero.get(p.numero);
    if (!atual) {
      porNumero.set(p.numero, {
        numero: p.numero, data: p.data ?? "", hora: p.hora ?? "", cliente: p.cliente ?? "", endereco: p.endereco ?? "",
        celular: p.celular ?? "", forma: p.forma ?? "", vendedor: p.vendedor ?? "", descontoTexto: p.descontoTexto ?? "",
        descontoValor: 0, total: p.total ?? 0, itens: p.itens, avisos: [],
      });
      continue;
    }
    for (const k of ["data", "hora", "cliente", "endereco", "celular", "forma", "vendedor", "descontoTexto"] as const) if (!atual[k] && p[k]) atual[k] = p[k] as string;
    if (!atual.total && p.total) atual.total = p.total;
    if (!atual.itens.length && p.itens.length) atual.itens = p.itens;
  }

  const out = [...porNumero.values()];
  for (const p of out) {
    const soma = r2(p.itens.reduce((s, i) => s + i.total, 0));
    for (const i of p.itens) if (Math.abs(r2(i.qtd * i.preco) - i.total) > 0.05) p.avisos.push(`Item ${i.codigo}: ${i.qtd} x ${i.preco} não dá ${i.total}.`);
    const dt = p.descontoTexto;
    if (dt.endsWith("%")) p.descontoValor = r2((soma * num(dt.slice(0, -1))) / 100);
    else if (dt) p.descontoValor = num(dt);
    if (!p.total) p.total = r2(soma - p.descontoValor);
    if (Math.abs(r2(soma - p.descontoValor) - p.total) > 0.05) p.avisos.push(`Soma dos itens (${soma.toFixed(2)}) menos desconto não bate com o total (${p.total.toFixed(2)}).`);
    if (!p.itens.length) p.avisos.push("Nenhum item encontrado.");
    if (!p.cliente) p.avisos.push("Cliente não encontrado.");
    if (!p.data) p.avisos.push("Data não encontrada.");
  }
  return out;
}
