import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import path from "path";

const dir = process.env.DADOS_DIR ?? path.resolve("dados");
mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(dir, "caixa.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export function transacao<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS bancos (id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS categorias (id INTEGER PRIMARY KEY, nome TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS contas (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  categoria_id INTEGER REFERENCES categorias(id),
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  banco_id INTEGER REFERENCES bancos(id),
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS movimentos (
  id INTEGER PRIMARY KEY,
  numero TEXT UNIQUE,
  data TEXT NOT NULL,
  responsavel TEXT,
  abertura REAL DEFAULT 0,
  total_vendas REAL DEFAULT 0,
  total_recebimentos REAL DEFAULT 0,
  sangrias REAL DEFAULT 0,
  importado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  forma TEXT NOT NULL,
  valor REAL NOT NULL,
  bruto REAL,
  desconto REAL DEFAULT 0,
  codigo TEXT,
  cliente TEXT,
  funcionario TEXT,
  obs TEXT,
  movimento_id INTEGER REFERENCES movimentos(id) ON DELETE CASCADE,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recebimentos (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  cliente TEXT NOT NULL,
  titulo TEXT,
  vencimento TEXT,
  valor REAL,
  recebido REAL NOT NULL,
  forma TEXT NOT NULL,
  movimento_id INTEGER REFERENCES movimentos(id) ON DELETE CASCADE,
  criado_em TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_contas_data ON contas(data);
CREATE INDEX IF NOT EXISTS ix_vendas_data ON vendas(data);
CREATE INDEX IF NOT EXISTS ix_receb_data ON recebimentos(data);
`);

const vazio = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as unknown as { c: number }).c === 0;
if (vazio("categorias")) {
  const ins = db.prepare("INSERT INTO categorias (nome) VALUES (?)");
  for (const c of ["Fornecedores", "Funcionários", "Impostos", "Aluguel", "Energia", "Água", "Internet/Telefone", "Frete", "Combustível", "Manutenção", "Pró-labore", "Outros"]) ins.run(c);
}
if (vazio("bancos")) {
  const ins = db.prepare("INSERT INTO bancos (nome) VALUES (?)");
  for (const b of ["Caixa (dinheiro)", "Banco do Brasil", "Itaú", "Bradesco", "Sicoob"]) ins.run(b);
}

export const FORMAS = ["DINHEIRO", "CARTAO DEBITO", "CARTAO CREDITO", "PIX", "PRAZO"];
export const FATURADO = "PRAZO";

export interface Periodo { de: string; ate: string }

const r2 = (n: number) => Math.round((n ?? 0) * 100) / 100;

export function resumo({ de, ate }: Periodo) {
  const porForma = db.prepare(`SELECT forma, ROUND(SUM(valor),2) total, COUNT(*) qtd FROM vendas WHERE data BETWEEN ? AND ? GROUP BY forma ORDER BY total DESC`).all(de, ate) as unknown as { forma: string; total: number; qtd: number }[];
  const recebPorForma = db.prepare(`SELECT forma, ROUND(SUM(recebido),2) total, COUNT(*) qtd FROM recebimentos WHERE data BETWEEN ? AND ? GROUP BY forma ORDER BY total DESC`).all(de, ate) as unknown as { forma: string; total: number; qtd: number }[];
  const porCategoria = db.prepare(`SELECT COALESCE(c.nome,'Sem categoria') nome, ROUND(SUM(x.valor),2) total, COUNT(*) qtd FROM contas x LEFT JOIN categorias c ON c.id=x.categoria_id WHERE x.data BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC`).all(de, ate) as unknown as { nome: string; total: number; qtd: number }[];
  const porBanco = db.prepare(`SELECT COALESCE(b.nome,'Sem banco') nome, ROUND(SUM(x.valor),2) total, COUNT(*) qtd FROM contas x LEFT JOIN bancos b ON b.id=x.banco_id WHERE x.data BETWEEN ? AND ? GROUP BY 1 ORDER BY total DESC`).all(de, ate) as unknown as { nome: string; total: number; qtd: number }[];
  const porDia = db.prepare(`
    WITH dias AS (SELECT data FROM vendas WHERE data BETWEEN @de AND @ate UNION SELECT data FROM recebimentos WHERE data BETWEEN @de AND @ate UNION SELECT data FROM contas WHERE data BETWEEN @de AND @ate)
    SELECT d.data,
      ROUND(COALESCE((SELECT SUM(valor) FROM vendas WHERE data=d.data),0),2) vendas,
      ROUND(COALESCE((SELECT SUM(valor) FROM vendas WHERE data=d.data AND forma<>'${FATURADO}'),0),2) avista,
      ROUND(COALESCE((SELECT SUM(valor) FROM vendas WHERE data=d.data AND forma='${FATURADO}'),0),2) faturado,
      ROUND(COALESCE((SELECT SUM(recebido) FROM recebimentos WHERE data=d.data),0),2) recebido,
      ROUND(COALESCE((SELECT SUM(valor) FROM contas WHERE data=d.data),0),2) contas
    FROM dias d ORDER BY d.data`).all({ de, ate }) as unknown as { data: string; vendas: number; avista: number; faturado: number; recebido: number; contas: number }[];

  const totalVendas = r2(porForma.reduce((s, f) => s + f.total, 0));
  const faturado = r2(porForma.filter((f) => f.forma === FATURADO).reduce((s, f) => s + f.total, 0));
  const avista = r2(totalVendas - faturado);
  const recebido = r2(recebPorForma.reduce((s, f) => s + f.total, 0));
  const contas = r2(porCategoria.reduce((s, f) => s + f.total, 0));
  const entradas = r2(avista + recebido);
  return { de, ate, porForma, recebPorForma, porCategoria, porBanco, porDia, totalVendas, faturado, avista, recebido, contas, entradas, saldo: r2(entradas - contas) };
}

export function listarContas({ de, ate }: Periodo) {
  return db.prepare(`SELECT x.*, c.nome categoria, b.nome banco FROM contas x LEFT JOIN categorias c ON c.id=x.categoria_id LEFT JOIN bancos b ON b.id=x.banco_id WHERE x.data BETWEEN ? AND ? ORDER BY x.data DESC, x.id DESC`).all(de, ate) as unknown as any[];
}
export function listarVendas({ de, ate }: Periodo) {
  return db.prepare(`SELECT v.*, m.numero movimento FROM vendas v LEFT JOIN movimentos m ON m.id=v.movimento_id WHERE v.data BETWEEN ? AND ? ORDER BY v.data DESC, v.forma, v.id`).all(de, ate) as unknown as any[];
}
export function listarRecebimentos({ de, ate }: Periodo) {
  return db.prepare(`SELECT r.*, m.numero movimento FROM recebimentos r LEFT JOIN movimentos m ON m.id=r.movimento_id WHERE r.data BETWEEN ? AND ? ORDER BY r.data DESC, r.cliente`).all(de, ate) as unknown as any[];
}
