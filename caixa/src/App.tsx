import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Cobrancas from "./Cobrancas";
import { api, brl, dataBR, hoje, lerMoeda, formaLabel } from "./api";

type Aba = "painel" | "vendas" | "contas" | "faturados" | "cobrancas" | "importar" | "cadastros";
type Item = { id: number; nome: string };
type Periodo = { de: string; ate: string };

const ABAS: [Aba, string][] = [
  ["painel", "Painel"],
  ["vendas", "Vendas do dia"],
  ["contas", "Contas pagas"],
  ["faturados", "Faturados"],
  ["cobrancas", "Cobranças"],
  ["importar", "Importar caixa"],
  ["cadastros", "Cadastros"],
];

const inicioMes = () => hoje().slice(0, 8) + "01";

function useToast() {
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const timer = useRef<number>(0);
  const show = useCallback((t: string, erro = false) => {
    setMsg({ t, erro });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 6000);
  }, []);
  const el = msg ? <div className={`toast ${msg.erro ? "erro" : ""}`}>{msg.t}</div> : null;
  return { show, el };
}
type Toast = (t: string, erro?: boolean) => void;

function Moeda({ value, onChange, autoFocus, placeholder }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
  return (
    <div className="moeda">
      <span>R$</span>
      <input inputMode="decimal" value={value} autoFocus={autoFocus} placeholder={placeholder ?? "0,00"} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function FiltroPeriodo({ p, setP }: { p: Periodo; setP: (p: Periodo) => void }) {
  const atalho = (de: string, ate: string) => setP({ de, ate });
  const d = new Date(hoje() + "T12:00:00");
  const mesPassadoIni = new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString("sv-SE");
  const mesPassadoFim = new Date(d.getFullYear(), d.getMonth(), 0).toLocaleDateString("sv-SE");
  return (
    <div className="periodo">
      <label>De <input type="date" value={p.de} onChange={(e) => setP({ ...p, de: e.target.value })} /></label>
      <label>Até <input type="date" value={p.ate} onChange={(e) => setP({ ...p, ate: e.target.value })} /></label>
      <div className="chips">
        <button onClick={() => atalho(hoje(), hoje())}>Hoje</button>
        <button onClick={() => atalho(inicioMes(), hoje())}>Este mês</button>
        <button onClick={() => atalho(mesPassadoIni, mesPassadoFim)}>Mês passado</button>
        <button onClick={() => atalho(hoje().slice(0, 4) + "-01-01", hoje())}>Este ano</button>
      </div>
    </div>
  );
}

const qs = (p: Periodo) => `de=${p.de}&ate=${p.ate}`;

function Painel({ p }: { p: Periodo }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => { api(`/api/resumo?${qs(p)}`).then(setR).catch(() => setR(null)); }, [p]);
  if (!r) return <div className="vazio">Carregando...</div>;
  const max = Math.max(1, ...r.porForma.map((f: any) => f.total));
  const maxCat = Math.max(1, ...r.porCategoria.map((f: any) => f.total));
  return (
    <>
      <div className="cards">
        <Card t="Vendas totais" v={r.totalVendas} />
        <Card t="Vendas à vista" v={r.avista} />
        <Card t="Vendido faturado" v={r.faturado} sub="a receber" />
        <Card t="Recebido de faturados" v={r.recebido} />
        <Card t="Contas pagas" v={r.contas} cor="neg" />
        <Card t="Saldo do período" v={r.saldo} cor={r.saldo < 0 ? "neg" : "pos"} sub="à vista + recebido - contas" destaque />
      </div>
      <div className="exportar">
        <a className="btn" href={`/api/relatorio.pdf?${qs(p)}`} target="_blank">Relatório em PDF</a>
        <a className="btn sec" href={`/api/relatorio.xlsx?${qs(p)}`}>Planilha Excel</a>
      </div>
      <div className="grid2">
        <section className="box">
          <h3>Vendas por forma</h3>
          {r.porForma.length === 0 && <div className="vazio">Sem vendas no período</div>}
          {r.porForma.map((f: any) => (
            <div className="barra" key={f.forma}>
              <span>{formaLabel(f.forma)}</span>
              <div><i style={{ width: `${(f.total / max) * 100}%` }} className={f.forma === "PRAZO" ? "fat" : ""} /></div>
              <b>{brl(f.total)}</b>
            </div>
          ))}
        </section>
        <section className="box">
          <h3>Contas por categoria</h3>
          {r.porCategoria.length === 0 && <div className="vazio">Sem contas no período</div>}
          {r.porCategoria.map((f: any) => (
            <div className="barra" key={f.nome}>
              <span>{f.nome}</span>
              <div><i style={{ width: `${(f.total / maxCat) * 100}%` }} className="neg" /></div>
              <b>{brl(f.total)}</b>
            </div>
          ))}
        </section>
      </div>
      <section className="box">
        <h3>Dia a dia</h3>
        <div className="tabela">
          <table>
            <thead><tr><th>Data</th><th className="n">À vista</th><th className="n">Faturado</th><th className="n">Recebido fat.</th><th className="n">Contas</th><th className="n">Saldo</th></tr></thead>
            <tbody>
              {r.porDia.length === 0 && <tr><td colSpan={6} className="vazio">Nada lançado no período</td></tr>}
              {r.porDia.map((d: any) => {
                const s = d.avista + d.recebido - d.contas;
                return (
                  <tr key={d.data}>
                    <td>{dataBR(d.data)}</td><td className="n">{brl(d.avista)}</td><td className="n">{brl(d.faturado)}</td>
                    <td className="n">{brl(d.recebido)}</td><td className="n">{brl(d.contas)}</td><td className={`n b ${s < 0 ? "neg" : ""}`}>{brl(s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Card({ t, v, cor, sub, destaque }: { t: string; v: number; cor?: string; sub?: string; destaque?: boolean }) {
  return (
    <div className={`card ${destaque ? "destaque" : ""}`}>
      <small>{t}</small>
      <strong className={cor}>{brl(v)}</strong>
      {sub && <em>{sub}</em>}
    </div>
  );
}

function Vendas({ p, toast, formas }: { p: Periodo; toast: Toast; formas: string[] }) {
  const [data, setData] = useState(hoje());
  const [vals, setVals] = useState<Record<string, string>>({});
  const [obs, setObs] = useState("");
  const [lista, setLista] = useState<any[]>([]);
  const carregar = useCallback(() => api(`/api/vendas?${qs(p)}`).then(setLista), [p]);
  useEffect(() => { carregar(); }, [carregar]);
  const total = formas.reduce((s, f) => s + lerMoeda(vals[f] ?? ""), 0);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/vendas/dia", { method: "POST", json: { data, obs, itens: formas.map((f) => ({ forma: f, valor: lerMoeda(vals[f] ?? "") })) } });
      setVals({}); setObs("");
      toast("Vendas lançadas!");
      carregar();
    } catch (er: any) { toast(er.message, true); }
  };
  const excluir = async (id: number) => {
    if (!confirm("Excluir este lançamento?")) return;
    await api(`/api/vendas/${id}`, { method: "DELETE" });
    carregar();
  };

  const porDia = useMemo(() => {
    const m = new Map<string, any[]>();
    lista.forEach((v) => m.set(v.data, [...(m.get(v.data) ?? []), v]));
    return [...m.entries()];
  }, [lista]);

  return (
    <>
      <form className="box form" onSubmit={salvar}>
        <h3>Lançar vendas do dia</h3>
        <p className="dica">Coloque quanto entrou em cada forma. Ex.: vendeu 1.000, sendo 500 no dinheiro e 500 no débito.</p>
        <div className="linha">
          <label className="curto">Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        </div>
        <div className="formas">
          {formas.map((f, i) => (
            <label key={f} className={f === "PRAZO" ? "fat" : ""}>{formaLabel(f)}
              <Moeda value={vals[f] ?? ""} autoFocus={i === 0} onChange={(v) => setVals({ ...vals, [f]: v })} />
            </label>
          ))}
        </div>
        <label>Observação (opcional)<input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: caixa da tarde" /></label>
        <div className="rodape">
          <div className="total">Total: <b>{brl(total)}</b></div>
          <button className="btn" disabled={!total}>Salvar vendas</button>
        </div>
      </form>

      <section className="box">
        <h3>Vendas lançadas no período</h3>
        {porDia.length === 0 && <div className="vazio">Nenhuma venda no período</div>}
        {porDia.map(([d, itens]) => {
          const tot: Record<string, number> = {};
          itens.forEach((v) => (tot[v.forma] = (tot[v.forma] ?? 0) + v.valor));
          return (
            <details key={d} className="dia">
              <summary>
                <b>{dataBR(d)}</b>
                <span className="pills">{Object.entries(tot).map(([f, v]) => <span key={f} className={`pill ${f === "PRAZO" ? "fat" : ""}`}>{formaLabel(f)} {brl(v)}</span>)}</span>
                <b className="n">{brl(itens.reduce((s, v) => s + v.valor, 0))}</b>
              </summary>
              <div className="tabela">
                <table>
                  <thead><tr><th>Forma</th><th>Venda</th><th>Cliente / obs</th><th className="n">Valor</th><th></th></tr></thead>
                  <tbody>
                    {itens.map((v) => (
                      <tr key={v.id}>
                        <td>{formaLabel(v.forma)}</td><td>{v.codigo ?? (v.movimento ? "" : "manual")}</td>
                        <td>{v.cliente || v.obs || ""}</td><td className="n">{brl(v.valor)}</td>
                        <td className="acoes">{!v.movimento_id && <button className="x" onClick={() => excluir(v.id)}>Excluir</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </section>
    </>
  );
}

const contaVazia = () => ({ id: 0, data: hoje(), categoria_id: "", descricao: "", valor: "", banco_id: "" });

function Contas({ p, toast, categorias, bancos }: { p: Periodo; toast: Toast; categorias: Item[]; bancos: Item[] }) {
  const [f, setF] = useState<any>(contaVazia());
  const [lista, setLista] = useState<any[]>([]);
  const [busca, setBusca] = useState("");
  const carregar = useCallback(() => api(`/api/contas?${qs(p)}`).then(setLista), [p]);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...f, valor: lerMoeda(f.valor), categoria_id: Number(f.categoria_id) || null, banco_id: Number(f.banco_id) || null };
    try {
      if (f.id) await api(`/api/contas/${f.id}`, { method: "PUT", json: body });
      else await api("/api/contas", { method: "POST", json: body });
      toast(f.id ? "Conta atualizada!" : "Conta lançada!");
      setF({ ...contaVazia(), data: f.data, banco_id: f.banco_id });
      carregar();
    } catch (er: any) { toast(er.message, true); }
  };
  const editar = (c: any) => {
    setF({ ...c, valor: c.valor.toFixed(2).replace(".", ","), categoria_id: c.categoria_id ?? "", banco_id: c.banco_id ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const excluir = async (id: number) => {
    if (!confirm("Excluir esta conta?")) return;
    await api(`/api/contas/${id}`, { method: "DELETE" });
    carregar();
  };
  const filtradas = lista.filter((c) => `${c.descricao} ${c.categoria} ${c.banco}`.toLowerCase().includes(busca.toLowerCase()));
  const total = filtradas.reduce((s, c) => s + c.valor, 0);

  return (
    <>
      <form className="box form" onSubmit={salvar}>
        <h3>{f.id ? "Editar conta paga" : "Lançar conta paga"}</h3>
        <div className="linha">
          <label className="curto">Data<input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} required /></label>
          <label>Categoria
            <select value={f.categoria_id} onChange={(e) => setF({ ...f, categoria_id: e.target.value })}>
              <option value="">Selecione...</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Banco de saída
            <select value={f.banco_id} onChange={(e) => setF({ ...f, banco_id: e.target.value })}>
              <option value="">Selecione...</option>
              {bancos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        </div>
        <div className="linha">
          <label className="largo">O que está sendo pago<input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: Boleto Votorantim cimento" required /></label>
          <label className="curto">Valor<Moeda value={f.valor} onChange={(v) => setF({ ...f, valor: v })} /></label>
        </div>
        <div className="rodape">
          {f.id ? <button type="button" className="btn sec" onClick={() => setF(contaVazia())}>Cancelar edição</button> : <span />}
          <button className="btn">{f.id ? "Salvar alterações" : "Lançar conta"}</button>
        </div>
      </form>

      <section className="box">
        <div className="cab">
          <h3>Contas pagas no período</h3>
          <input className="busca" placeholder="Buscar..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="tabela">
          <table>
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Banco</th><th className="n">Valor</th><th></th></tr></thead>
            <tbody>
              {filtradas.length === 0 && <tr><td colSpan={6} className="vazio">Nenhuma conta no período</td></tr>}
              {filtradas.map((c) => (
                <tr key={c.id}>
                  <td>{dataBR(c.data)}</td><td>{c.descricao}</td><td><span className="tag">{c.categoria ?? "-"}</span></td><td>{c.banco ?? "-"}</td>
                  <td className="n b">{brl(c.valor)}</td>
                  <td className="acoes"><button className="x" onClick={() => editar(c)}>Editar</button><button className="x" onClick={() => excluir(c.id)}>Excluir</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="n">{brl(total)}</td><td /></tr></tfoot>
          </table>
        </div>
      </section>
    </>
  );
}

function Faturados({ p, toast }: { p: Periodo; toast: Toast }) {
  const vazio = { data: hoje(), cliente: "", titulo: "", recebido: "", forma: "DINHEIRO" };
  const [f, setF] = useState<any>(vazio);
  const [recebs, setRecebs] = useState<any[]>([]);
  const [vendas, setVendas] = useState<any[]>([]);
  const carregar = useCallback(() => {
    api(`/api/recebimentos?${qs(p)}`).then(setRecebs);
    api(`/api/vendas?${qs(p)}`).then((v: any[]) => setVendas(v.filter((x) => x.forma === "PRAZO")));
  }, [p]);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/recebimentos", { method: "POST", json: { ...f, recebido: lerMoeda(f.recebido) } });
      toast("Recebimento lançado!");
      setF({ ...vazio, data: f.data });
      carregar();
    } catch (er: any) { toast(er.message, true); }
  };
  const excluir = async (id: number) => {
    if (!confirm("Excluir este recebimento?")) return;
    await api(`/api/recebimentos/${id}`, { method: "DELETE" });
    carregar();
  };
  const totR = recebs.reduce((s, r) => s + r.recebido, 0);
  const totV = vendas.reduce((s, r) => s + r.valor, 0);

  return (
    <>
      <form className="box form" onSubmit={salvar}>
        <h3>Lançar recebimento de faturado</h3>
        <div className="linha">
          <label className="curto">Data<input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></label>
          <label className="largo">Cliente<input value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} required /></label>
          <label className="curto">Título / nota<input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></label>
        </div>
        <div className="linha">
          <label>Forma
            <select value={f.forma} onChange={(e) => setF({ ...f, forma: e.target.value })}>
              {["DINHEIRO", "PIX", "CARTAO DEBITO", "CARTAO CREDITO", "BOLETO", "CHEQUE", "TRANSFERENCIA"].map((x) => <option key={x} value={x}>{formaLabel(x)}</option>)}
            </select>
          </label>
          <label className="curto">Valor recebido<Moeda value={f.recebido} onChange={(v) => setF({ ...f, recebido: v })} /></label>
          <div className="fim"><button className="btn">Lançar</button></div>
        </div>
      </form>
      <div className="grid2">
        <section className="box">
          <h3>Recebido de faturados <span className="soma">{brl(totR)}</span></h3>
          <div className="tabela">
            <table>
              <thead><tr><th>Data</th><th>Cliente</th><th>Forma</th><th className="n">Valor</th><th></th></tr></thead>
              <tbody>
                {recebs.length === 0 && <tr><td colSpan={5} className="vazio">Nenhum recebimento</td></tr>}
                {recebs.map((r) => (
                  <tr key={r.id}>
                    <td>{dataBR(r.data)}</td><td>{r.cliente}{r.titulo && <small className="sub"> #{r.titulo}</small>}</td><td>{formaLabel(r.forma)}</td>
                    <td className="n b">{brl(r.recebido)}</td>
                    <td className="acoes">{!r.movimento_id && <button className="x" onClick={() => excluir(r.id)}>Excluir</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="box">
          <h3>Vendido faturado (a prazo) <span className="soma fat">{brl(totV)}</span></h3>
          <div className="tabela">
            <table>
              <thead><tr><th>Data</th><th>Cliente</th><th className="n">Valor</th></tr></thead>
              <tbody>
                {vendas.length === 0 && <tr><td colSpan={3} className="vazio">Nenhuma venda faturada</td></tr>}
                {vendas.map((v) => <tr key={v.id}><td>{dataBR(v.data)}</td><td>{v.cliente || v.obs || "-"}</td><td className="n b">{brl(v.valor)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Importar({ toast }: { toast: Toast }) {
  const [mov, setMov] = useState<any>(null);
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [hist, setHist] = useState<any[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const carregar = () => api("/api/movimentos").then(setHist);
  useEffect(() => { carregar(); }, []);

  const lote = async (files: File[]) => {
    if (files.length === 1) return ler(files[0]);
    setLendo(true); setMov(null);
    const ok: string[] = [];
    const falhas: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("arquivo", file);
      try {
        const m = await api("/api/importar/ler", { method: "POST", body: fd });
        if (m.existente) { falhas.push(`${dataBR(m.data)}: já importado`); continue; }
        if (!m.conferido) { falhas.push(`${dataBR(m.data)}: totais não conferem, importe sozinho para revisar`); continue; }
        await api("/api/importar/confirmar", { method: "POST", json: m });
        ok.push(dataBR(m.data));
      } catch (e: any) { falhas.push(`${file.name}: ${e.message}`); }
    }
    setLendo(false);
    if (input.current) input.current.value = "";
    carregar();
    toast(`${ok.length} importado(s)${ok.length ? ": " + ok.join(", ") : ""}${falhas.length ? ". Não importados: " + falhas.join("; ") : ""}`, ok.length === 0);
  };

  const ler = async (file?: File) => {
    if (!file) return;
    setLendo(true); setMov(null);
    const fd = new FormData();
    fd.append("arquivo", file);
    try { setMov(await api("/api/importar/ler", { method: "POST", body: fd })); }
    catch (e: any) { toast(e.message, true); }
    finally { setLendo(false); if (input.current) input.current.value = ""; }
  };
  const confirmar = async () => {
    try {
      const r = await api("/api/importar/confirmar", { method: "POST", json: { ...mov, substituir: !!mov.existente } });
      toast(`Importado: ${r.vendas} vendas e ${r.recebimentos} recebimentos.`);
      setMov(null); carregar();
    } catch (e: any) { toast(e.message, true); }
  };
  const excluir = async (id: number) => {
    if (!confirm("Excluir este movimento e todas as vendas e recebimentos dele?")) return;
    await api(`/api/movimentos/${id}`, { method: "DELETE" });
    carregar();
  };

  const porForma = useMemo(() => {
    const m: Record<string, { qtd: number; total: number }> = {};
    mov?.vendas.forEach((v: any) => { m[v.forma] ??= { qtd: 0, total: 0 }; m[v.forma].qtd++; m[v.forma].total += v.liquido; });
    return Object.entries(m);
  }, [mov]);

  return (
    <>
      <section
        className={`box drop ${arrastando ? "on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); lote([...e.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
      >
        <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => lote([...(e.target.files ?? [])])} />
        <div className="drop-ico">PDF</div>
        <b>{lendo ? "Lendo relatório..." : "Arraste aqui um ou vários Relatórios de Movimento de Caixa"}</b>
        <span>ou clique para escolher o arquivo</span>
      </section>

      {mov && (
        <section className="box">
          <div className="cab">
            <h3>Movimento nº {mov.movimento} de {dataBR(mov.data)}</h3>
            <span className={`tag ${mov.conferido ? "ok" : "alerta"}`}>{mov.conferido ? "Totais conferidos" : "Verificar"}</span>
          </div>
          <p className="dica">Responsável: {mov.responsavel} | Abertura {brl(mov.abertura)} | Sangrias {brl(mov.sangrias.reduce((s: number, x: any) => s + x.valor, 0))}</p>
          {mov.avisos.map((a: string) => <div key={a} className="aviso">{a}</div>)}
          {mov.existente && <div className="aviso">Este movimento já foi importado em {dataBR(mov.existente.importado_em.slice(0, 10))}. Confirmar vai substituir os dados anteriores.</div>}
          <div className="cards mini">
            {porForma.map(([f, x]) => <Card key={f} t={`${formaLabel(f)} (${x.qtd})`} v={x.total} />)}
            <Card t={`Recebido faturados (${mov.recebimentos.length})`} v={mov.totalRecebimentos} />
            <Card t="Total vendas" v={mov.totalVendas} destaque />
          </div>
          <details className="dia">
            <summary><b>Ver as {mov.vendas.length} vendas e {mov.recebimentos.length} recebimentos</b></summary>
            <div className="tabela">
              <table>
                <thead><tr><th>Venda</th><th>Forma</th><th>Cliente</th><th className="n">Desc.%</th><th className="n">Valor</th></tr></thead>
                <tbody>{mov.vendas.map((v: any) => <tr key={v.codigo}><td>{v.codigo}</td><td>{formaLabel(v.forma)}</td><td>{v.cliente}</td><td className="n">{v.desconto || ""}</td><td className="n">{brl(v.liquido)}</td></tr>)}</tbody>
              </table>
              <table>
                <thead><tr><th>Cliente</th><th>Título</th><th>Forma</th><th className="n">Recebido</th></tr></thead>
                <tbody>{mov.recebimentos.map((r: any) => <tr key={r.titulo}><td>{r.cliente}</td><td>{r.titulo}</td><td>{formaLabel(r.forma)}</td><td className="n">{brl(r.recebido)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
          <div className="rodape">
            <button className="btn sec" onClick={() => setMov(null)}>Cancelar</button>
            <button className="btn" onClick={confirmar}>{mov.existente ? "Substituir e importar" : "Confirmar importação"}</button>
          </div>
        </section>
      )}

      <section className="box">
        <h3>Movimentos importados</h3>
        <div className="tabela">
          <table>
            <thead><tr><th>Data</th><th>Nº</th><th>Responsável</th><th className="n">Vendas</th><th className="n">Recebimentos</th><th className="n">Sangrias</th><th></th></tr></thead>
            <tbody>
              {hist.length === 0 && <tr><td colSpan={7} className="vazio">Nenhum movimento importado ainda</td></tr>}
              {hist.map((m) => (
                <tr key={m.id}>
                  <td>{dataBR(m.data)}</td><td>{m.numero}</td><td>{m.responsavel}</td><td className="n">{brl(m.total_vendas)}</td>
                  <td className="n">{brl(m.total_recebimentos)}</td><td className="n">{brl(m.sangrias)}</td>
                  <td className="acoes"><button className="x" onClick={() => excluir(m.id)}>Excluir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Lista({ titulo, url, itens, recarregar, toast }: { titulo: string; url: string; itens: Item[]; recarregar: () => void; toast: Toast }) {
  const [nome, setNome] = useState("");
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api(url, { method: "POST", json: { nome } }); setNome(""); recarregar(); }
    catch (er: any) { toast(er.message, true); }
  };
  const del = async (id: number) => {
    try { await api(`${url}/${id}`, { method: "DELETE" }); recarregar(); }
    catch (er: any) { toast(er.message, true); }
  };
  return (
    <section className="box">
      <h3>{titulo}</h3>
      <form className="add" onSubmit={add}><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Novo..." /><button className="btn">Adicionar</button></form>
      <ul className="itens">{itens.map((i) => <li key={i.id}>{i.nome}<button className="x" onClick={() => del(i.id)}>Remover</button></li>)}</ul>
    </section>
  );
}

export default function App() {
  const [aba, setAba] = useState<Aba>("painel");
  const [p, setP] = useState<Periodo>({ de: inicioMes(), ate: hoje() });
  const [categorias, setCategorias] = useState<Item[]>([]);
  const [bancos, setBancos] = useState<Item[]>([]);
  const [formas, setFormas] = useState<string[]>([]);
  const { show, el } = useToast();
  const recarregar = useCallback(() => {
    api("/api/categorias").then(setCategorias);
    api("/api/bancos").then(setBancos);
  }, []);
  useEffect(() => { recarregar(); api("/api/formas").then(setFormas); }, [recarregar]);

  return (
    <div className="app">
      <header>
        <div className="marca"><span className="logo">$</span><div><b>Depósito WM</b><small>Controle financeiro</small></div></div>
        <nav>{ABAS.map(([k, t]) => <button key={k} className={aba === k ? "ativo" : ""} onClick={() => setAba(k)}>{t}</button>)}</nav>
      </header>
      <main>
        {!["importar", "cadastros", "cobrancas"].includes(aba) && <FiltroPeriodo p={p} setP={setP} />}
        {aba === "painel" && <Painel p={p} />}
        {aba === "vendas" && <Vendas p={p} toast={show} formas={formas} />}
        {aba === "contas" && <Contas p={p} toast={show} categorias={categorias} bancos={bancos} />}
        {aba === "faturados" && <Faturados p={p} toast={show} />}
        {aba === "cobrancas" && <Cobrancas toast={show} />}
        {aba === "importar" && <Importar toast={show} />}
        {aba === "cadastros" && (
          <div className="grid2">
            <Lista titulo="Categorias de contas" url="/api/categorias" itens={categorias} recarregar={recarregar} toast={show} />
            <Lista titulo="Bancos" url="/api/bancos" itens={bancos} recarregar={recarregar} toast={show} />
          </div>
        )}
      </main>
      {el}
    </div>
  );
}
