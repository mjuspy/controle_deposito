export async function api<T = any>(url: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = opts;
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json" } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro ?? "Erro na comunicação com o servidor.");
  return data as T;
}

export const brl = (n: number) => (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const dataBR = (s: string) => (s ? s.split("-").reverse().join("/") : "");
export const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function lerMoeda(s: string): number {
  const t = s.replace(/[^\d,.-]/g, "");
  if (!t) return 0;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export const FORMA_LABEL: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  "CARTAO DEBITO": "Débito",
  "CARTAO CREDITO": "Crédito",
  PIX: "PIX",
  PRAZO: "Faturado",
};
export const formaLabel = (f: string) => FORMA_LABEL[f] ?? f;
