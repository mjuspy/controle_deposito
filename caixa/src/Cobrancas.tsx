import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, brl, dataBR, hoje, lerMoeda } from "./api";

type Toast = (t: string, erro?: boolean) => void;
type Sub = "pedidos" | "fechar" | "fechamentos" | "clientes";

const num2 = (n: number) => n.toFixed(2).replace(".", ",");
const mesPassado = () => {
  const d = new Date(hoje() + "T12:00:00");
  return {
    de: new Date(d.getFullYear(), d.getMonth() - 1, 1).toLocaleDateString("sv-SE"),
    ate: new Date(d.getFullYear(), d.getMonth(), 0).toLocaleDateString("sv-SE"),
  };
};

function CampoPreco({ valor, original, onSalvar }: { valor: number | null; original: number; onSalvar: (v: number | null) => void }) {
  const [t, setT] = useState(valor != null ? num2(valor) : "");
  useEffect(() => setT(valor != null ? num2(valor) : ""), [valor]);
  const salvar = () => {
    const v = t.trim() ? lerMoeda(t) : null;
    if (v === valor || (v === null && valor === null)) return;
    onSalvar(v);
  };
  return (
    <div className={`moeda mini ${valor != null ? "promo" : ""}`}>
      <span>R$</span>
      <input value={t} placeholder={num2(original)} onChange={(e) => setT(e.target.value)} onBlur={salvar} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

function CampoUnidade({ codigo, valor, onSalvo }: { codigo: string; valor: string | null; onSalvo: () => void }) {
  const [t, setT] = useState(valor ?? "");
  useEffect(() => setT(valor ?? ""), [valor]);
  const salvar = async () => {
    if ((valor ?? "") === t.trim()) return;
    await api(`/api/produtos/${encodeURIComponent(codigo)}`, { method: "PUT", json: { unidade: t } });
    onSalvo();
  };
  return <input className="un" value={t} placeholder="un" onChange={(e) => setT(e.target.value)} onBlur={salvar} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />;
}

function DetalhePedido({ p, recarregar, toast }: { p: any; recarregar: () => void; toast: Toast }) {
  const [combinado, setCombinado] = useState("");
  const bloqueado = !!p.fechamento_id;
  const salvarPromo = async (itemId: number, v: number | null) => {
    try { await api(`/api/itens/${itemId}`, { method: "PUT", json: { preco_promo: v } }); recarregar(); }
    catch (e: any) { toast(e.message, true); }
  };
  const combinar = async (total: number | null) => {
    try {
      await api(`/api/pedidos/${p.id}/combinar`, { method: "POST", json: { total } });
      setCombinado("");
      toast(total == null ? "Preços originais restaurados." : `Desconto distribuído: total ${brl(total)}.`);
      recarregar();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="detalhe">
      {bloqueado && <div className="aviso">Este pedido já está no fechamento nº {p.fechamento_id}. Para mudar preços, exclua o fechamento antes.</div>}
      <div className="tabela">
        <table>
          <thead><tr><th>Cód.</th><th>Produto</th><th className="n">Qtd</th><th>Un.</th><th className="n">Unit. original</th><th>Preço promocional</th><th className="n">Total</th><th className="n">Desconto</th></tr></thead>
          <tbody>
            {p.itens.map((i: any) => (
              <tr key={i.id}>
                <td className="sub">{i.codigo}</td><td>{i.descricao}</td><td className="n">{i.qtd.toLocaleString("pt-BR")}</td>
                <td>{bloqueado ? i.unidade : <CampoUnidade codigo={i.codigo} valor={i.unidade} onSalvo={recarregar} />}</td>
                <td className="n">{brl(i.preco)}</td>
                <td>{bloqueado ? (i.promo ? brl(i.preco_ef) : "-") : <CampoPreco valor={i.promo ? i.preco_ef : null} original={i.preco} onSalvar={(v) => salvarPromo(i.id, v)} />}</td>
                <td className="n b">{brl(i.total_ef)}</td>
                <td className={`n ${i.desconto > 0 ? "red" : "sub"}`}>{i.desconto > 0 ? brl(i.desconto) : "-"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={6}>Total {p.desconto > 0 && <span className="sub">(original {brl(p.original)})</span>}</td><td className="n">{brl(p.comDesconto)}</td><td className="n red">{p.desconto > 0 ? brl(p.desconto) : ""}</td></tr></tfoot>
        </table>
      </div>
      {!bloqueado && (
        <div className="combinar">
          <span>Combinou um valor fechado? Digite o total e o desconto é distribuído nos itens:</span>
          <div className="moeda mini"><span>R$</span><input value={combinado} placeholder={num2(p.comDesconto)} onChange={(e) => setCombinado(e.target.value)} onKeyDown={(e) => e.key === "Enter" && combinado && combinar(lerMoeda(combinado))} /></div>
          <button className="btn red sm" disabled={!combinado} onClick={() => combinar(lerMoeda(combinado))}>Aplicar</button>
          {p.desconto > 0 && <button className="btn sec sm" onClick={() => combinar(null)}>Voltar ao original</button>}
        </div>
      )}
      <p className="dica">O preço promocional fica salvo para este cliente e é aplicado sozinho nos próximos pedidos dele com o mesmo produto.</p>
    </div>
  );
}

function Pedidos({ toast, clientes, recarregarClientes }: { toast: Toast; clientes: any[]; recarregarClientes: () => void }) {
  const [lidos, setLidos] = useState<any[] | null>(null);
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [lista, setLista] = useState<any[]>([]);
  const [cliente, setCliente] = useState("");
  const [soAbertos, setSoAbertos] = useState(true);
  const [aberto, setAberto] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const carregar = useCallback(() => {
    const q = new URLSearchParams();
    if (cliente) q.set("cliente_id", cliente);
    if (soAbertos) q.set("abertos", "1");
    api(`/api/pedidos?${q}`).then(setLista);
  }, [cliente, soAbertos]);
  useEffect(() => { carregar(); }, [carregar]);

  const ler = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    if (!pdfs.length) return;
    setLendo(true);
    const fd = new FormData();
    pdfs.forEach((f) => fd.append("arquivos", f));
    try { setLidos(await api("/api/pedidos/ler", { method: "POST", body: fd })); }
    catch (e: any) { toast(e.message, true); }
    finally { setLendo(false); if (input.current) input.current.value = ""; }
  };
  const importar = async (substituir: boolean) => {
    const validos = (lidos ?? []).filter((p) => !p.erro && (substituir || !p.existente));
    try {
      const r = await api("/api/pedidos/importar", { method: "POST", json: { pedidos: validos, substituir } });
      toast(`${r.ok} pedido(s) importado(s)${r.existente ? `, ${r.existente} já existiam` : ""}${r.cobrado ? `, ${r.cobrado} já cobrados (mantidos)` : ""}.`);
      setLidos(null); carregar(); recarregarClientes();
    } catch (e: any) { toast(e.message, true); }
  };
  const excluir = async (id: number) => {
    if (!confirm("Excluir este pedido?")) return;
    try { await api(`/api/pedidos/${id}`, { method: "DELETE" }); carregar(); recarregarClientes(); }
    catch (e: any) { toast(e.message, true); }
  };

  const novos = (lidos ?? []).filter((p) => !p.erro && !p.existente).length;
  const existentes = (lidos ?? []).filter((p) => p.existente && !p.cobrado).length;

  return (
    <>
      <section
        className={`box drop red ${arrastando ? "on" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); ler([...e.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
      >
        <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => ler([...(e.target.files ?? [])])} />
        <div className="drop-ico">PDF</div>
        <b>{lendo ? "Lendo pedidos..." : "Arraste aqui os PDFs dos Pedidos de Venda"}</b>
        <span>pode mandar vários de uma vez</span>
      </section>

      {lidos && (
        <section className="box">
          <div className="cab"><h3>{lidos.length} pedido(s) lido(s)</h3></div>
          <div className="tabela">
            <table>
              <thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Forma</th><th className="n">Itens</th><th className="n">Total</th><th>Situação</th></tr></thead>
              <tbody>
                {lidos.map((p, k) => p.erro ? (
                  <tr key={k}><td colSpan={7}><span className="tag alerta">{p.arquivo}: {p.erro}</span></td></tr>
                ) : (
                  <tr key={k}>
                    <td className="b">{p.numero}</td><td>{dataBR(p.data)}</td><td>{p.cliente}</td><td>{p.forma}</td>
                    <td className="n">{p.itens.length}</td><td className="n b">{brl(p.total)}</td>
                    <td>
                      {p.cobrado ? <span className="tag">já cobrado</span> : p.existente ? <span className="tag alerta">já importado</span> : <span className="tag ok">novo</span>}
                      {p.avisos.map((a: string) => <div key={a} className="aviso mini">{a}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rodape">
            <button className="btn sec" onClick={() => setLidos(null)}>Cancelar</button>
            <div className="acoes-dir">
              {existentes > 0 && <button className="btn sec" onClick={() => importar(true)}>Reimportar {existentes} existente(s)</button>}
              <button className="btn red" disabled={!novos} onClick={() => importar(false)}>Importar {novos} pedido(s)</button>
            </div>
          </div>
        </section>
      )}

      <section className="box">
        <div className="cab">
          <h3>Pedidos</h3>
          <div className="filtros">
            <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
              <option value="">Todos os clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={soAbertos} onChange={(e) => setSoAbertos(e.target.checked)} /> Só não cobrados</label>
          </div>
        </div>
        <p className="dica">Clique num pedido para colocar o preço promocional dos itens.</p>
        <div className="tabela">
          <table>
            <thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Forma</th><th className="n">Original</th><th className="n">A cobrar</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {lista.length === 0 && <tr><td colSpan={8} className="vazio">Nenhum pedido</td></tr>}
              {lista.map((p) => (
                <Fragment key={p.id}>
                  <tr className={`clicavel ${aberto === p.id ? "sel" : ""}`} onClick={() => setAberto(aberto === p.id ? null : p.id)}>
                    <td className="b">{p.numero}</td><td>{dataBR(p.data)}</td><td>{p.cliente}</td><td>{p.forma}</td>
                    <td className="n">{brl(p.original)}</td>
                    <td className="n b">{brl(p.comDesconto)}{p.desconto > 0 && <span className="pill red-pill">-{brl(p.desconto)}</span>}</td>
                    <td>{p.fechamento_id ? <span className="tag">cobrado nº {p.fechamento_id}</span> : <span className="tag alerta">em aberto</span>}</td>
                    <td className="acoes">{!p.fechamento_id && <button className="x" onClick={(e) => { e.stopPropagation(); excluir(p.id); }}>Excluir</button>}</td>
                  </tr>
                  {aberto === p.id && <tr className="sem-hover"><td colSpan={8}><DetalhePedido p={p} recarregar={carregar} toast={toast} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function GerarFechamento({ toast, clientes, inicial, aoGerar }: { toast: Toast; clientes: any[]; inicial: string; aoGerar: () => void }) {
  const mp = mesPassado();
  const [cliente, setCliente] = useState(inicial);
  const [de, setDe] = useState(mp.de);
  const [ate, setAte] = useState(mp.ate);
  const [venc, setVenc] = useState("");
  const [modo, setModo] = useState("inteiro");
  const [manual, setManual] = useState("");
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [previa, setPrevia] = useState<any>(null);
  const [gerado, setGerado] = useState<number | null>(null);

  useEffect(() => setCliente(inicial), [inicial]);
  useEffect(() => {
    setGerado(null);
    if (!cliente) { setPedidos([]); return; }
    api(`/api/pedidos?cliente_id=${cliente}&de=${de}&ate=${ate}&abertos=1`).then((l: any[]) => {
      const ord = [...l].sort((a, b) => a.data.localeCompare(b.data) || Number(a.numero) - Number(b.numero));
      setPedidos(ord);
      setMarcados(new Set(ord.filter((p) => !p.forma || /PRAZO/i.test(p.forma)).map((p) => p.id)));
    });
  }, [cliente, de, ate]);

  const corpo = useMemo(() => ({ cliente_id: Number(cliente), pedidoIds: [...marcados], vencimento: venc || null, modo, manual: lerMoeda(manual), de, ate }), [cliente, marcados, venc, modo, manual, de, ate]);
  useEffect(() => {
    if (!cliente) { setPrevia(null); return; }
    api("/api/fechamentos/previa", { method: "POST", json: corpo }).then(setPrevia).catch(() => setPrevia(null));
  }, [corpo, cliente]);

  const alternar = (id: number) => {
    const s = new Set(marcados);
    s.has(id) ? s.delete(id) : s.add(id);
    setMarcados(s);
  };
  const gerar = async () => {
    try {
      const r = await api("/api/fechamentos", { method: "POST", json: corpo });
      setGerado(r.id);
      toast("Fechamento gerado!");
      setPedidos(pedidos.filter((p) => !marcados.has(p.id)));
      setMarcados(new Set());
      aoGerar();
    } catch (e: any) { toast(e.message, true); }
  };
  const nome = clientes.find((c) => String(c.id) === cliente)?.nome;

  return (
    <>
      <section className="box form">
        <h3>Gerar fechamento</h3>
        <div className="linha">
          <label className="largo">Cliente
            <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
              <option value="">Selecione...</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.valor_aberto > 0 ? `  (${brl(c.valor_aberto)} em aberto)` : ""}</option>)}
            </select>
          </label>
          <label className="curto">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="curto">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        </div>
        <div className="linha">
          <label className="curto">Vencimento (opcional)<input type="date" value={venc} onChange={(e) => setVenc(e.target.value)} /></label>
          <label>Arredondamento
            <select value={modo} onChange={(e) => setModo(e.target.value)}>
              <option value="nenhum">Não arredondar</option>
              <option value="inteiro">Tirar os centavos</option>
              <option value="cinco">Para baixo, múltiplo de R$ 5</option>
              <option value="manual">Valor manual</option>
            </select>
          </label>
          {modo === "manual" && <label className="curto">Ajuste (use - para abater)<div className="moeda"><span>R$</span><input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="-0,50" /></div></label>}
        </div>
        {nome && <div className="titulo-prev">Fechamento cliente {nome} período {dataBR(de)} a {dataBR(ate)}</div>}
      </section>

      {cliente && (
        <section className="box">
          <h3>Pedidos não cobrados no período</h3>
          {pedidos.length === 0 && <div className="vazio">Nenhum pedido em aberto deste cliente no período</div>}
          {pedidos.map((p) => (
            <label key={p.id} className={`linha-ped ${marcados.has(p.id) ? "on" : ""}`}>
              <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} />
              <b>Nota {p.numero}</b><span className="sub">{dataBR(p.data)}</span><span className="sub">{p.forma}</span>
              <span className="fim-linha">
                {p.desconto > 0 && <s className="sub">{brl(p.original)}</s>}
                <b>{brl(p.comDesconto)}</b>
              </span>
            </label>
          ))}
          {previa && marcados.size > 0 && (
            <div className="resumo-fech">
              <div><span>Total original</span><b>{brl(previa.original)}</b></div>
              <div><span>Desconto</span><b className="red">{brl(previa.desconto)}</b></div>
              {Math.abs(previa.arredondamento) > 0.004 && <div><span>Arredondamento</span><b>{brl(previa.arredondamento)}</b></div>}
              <div className="pagar"><span>TOTAL A PAGAR</span><b>{brl(previa.totalPagar)}</b></div>
            </div>
          )}
          <div className="rodape">
            <span className="dica">Os pedidos que entrarem no fechamento ficam marcados como cobrados.</span>
            <button className="btn red" disabled={!marcados.size} onClick={gerar}>Gerar fechamento</button>
          </div>
          {gerado && (
            <div className="gerado">
              <b>Fechamento nº {gerado} pronto.</b>
              <a className="btn red" href={`/api/fechamentos/${gerado}/planilha.xlsx`}>Baixar planilha Excel</a>
              <a className="btn sec" href={`/api/fechamentos/${gerado}/fechamento.pdf`} target="_blank">Abrir PDF</a>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Fechamentos({ toast, versao }: { toast: Toast; versao: number }) {
  const [lista, setLista] = useState<any[]>([]);
  const carregar = useCallback(() => api("/api/fechamentos").then(setLista), []);
  useEffect(() => { carregar(); }, [carregar, versao]);
  const status = async (id: number, s: string) => { await api(`/api/fechamentos/${id}`, { method: "PATCH", json: { status: s } }); carregar(); };
  const excluir = async (id: number) => {
    if (!confirm("Excluir este fechamento? Os pedidos dele voltam a ficar em aberto.")) return;
    try { await api(`/api/fechamentos/${id}`, { method: "DELETE" }); carregar(); toast("Fechamento excluído."); }
    catch (e: any) { toast(e.message, true); }
  };
  const aberto = lista.filter((f) => f.status !== "pago").reduce((s, f) => s + f.total_pagar, 0);
  return (
    <section className="box">
      <div className="cab"><h3>Fechamentos</h3><span className="soma red">{brl(aberto)} a receber</span></div>
      <div className="tabela">
        <table>
          <thead><tr><th>Nº</th><th>Cliente</th><th>Período</th><th>Vencimento</th><th className="n">Notas</th><th className="n">Total a pagar</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={8} className="vazio">Nenhum fechamento gerado ainda</td></tr>}
            {lista.map((f) => (
              <tr key={f.id}>
                <td className="b">{f.id}</td><td>{f.cliente}</td><td>{dataBR(f.de)} a {dataBR(f.ate)}</td>
                <td>{f.vencimento ? dataBR(f.vencimento) : "-"}</td><td className="n">{f.qtd_pedidos}</td>
                <td className="n b">{brl(f.total_pagar)}</td>
                <td>
                  <select className={`status ${f.status}`} value={f.status} onChange={(e) => status(f.id, e.target.value)}>
                    <option value="aberto">Em aberto</option><option value="enviado">Enviado</option><option value="pago">Pago</option>
                  </select>
                </td>
                <td className="acoes">
                  <a className="x" href={`/api/fechamentos/${f.id}/planilha.xlsx`}>Excel</a>
                  <a className="x" href={`/api/fechamentos/${f.id}/fechamento.pdf`} target="_blank">PDF</a>
                  <button className="x" onClick={() => excluir(f.id)}>Excluir</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Clientes({ toast, clientes, recarregar, fechar }: { toast: Toast; clientes: any[]; recarregar: () => void; fechar: (id: string) => void }) {
  const [edit, setEdit] = useState<any>(null);
  const [juntar, setJuntar] = useState<{ id: number; destino: string } | null>(null);
  const salvar = async () => {
    try { await api(`/api/clientes/${edit.id}`, { method: "PUT", json: edit }); setEdit(null); recarregar(); }
    catch (e: any) { toast(e.message, true); }
  };
  const confirmarJuntar = async () => {
    if (!juntar?.destino) return;
    try { await api(`/api/clientes/${juntar.id}/juntar`, { method: "POST", json: { destino: Number(juntar.destino) } }); setJuntar(null); recarregar(); toast("Clientes unidos."); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <section className="box">
      <h3>Clientes</h3>
      <p className="dica">Os clientes são criados sozinhos ao importar os pedidos. Se o mesmo cliente aparecer com nomes diferentes, use "Juntar".</p>
      <div className="tabela">
        <table>
          <thead><tr><th>Cliente</th><th>Celular</th><th className="n">Pedidos</th><th className="n">Não cobrado</th><th>Desde</th><th></th></tr></thead>
          <tbody>
            {clientes.length === 0 && <tr><td colSpan={6} className="vazio">Importe pedidos para os clientes aparecerem aqui</td></tr>}
            {clientes.map((c) => edit?.id === c.id ? (
              <tr key={c.id} className="sem-hover">
                <td><input value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></td>
                <td><input value={edit.celular ?? ""} onChange={(e) => setEdit({ ...edit, celular: e.target.value })} /></td>
                <td colSpan={3} />
                <td className="acoes"><button className="x" onClick={salvar}>Salvar</button><button className="x" onClick={() => setEdit(null)}>Cancelar</button></td>
              </tr>
            ) : juntar?.id === c.id ? (
              <tr key={c.id} className="sem-hover">
                <td colSpan={5}>
                  Juntar <b>{c.nome}</b> com:{" "}
                  <select value={juntar?.destino ?? ""} onChange={(e) => setJuntar({ id: c.id, destino: e.target.value })}>
                    <option value="">Selecione...</option>
                    {clientes.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                  </select>
                </td>
                <td className="acoes"><button className="x" onClick={confirmarJuntar}>Confirmar</button><button className="x" onClick={() => setJuntar(null)}>Cancelar</button></td>
              </tr>
            ) : (
              <tr key={c.id}>
                <td className="b">{c.nome}</td><td>{c.celular ?? "-"}</td><td className="n">{c.pedidos}</td>
                <td className={`n b ${c.valor_aberto > 0 ? "red" : ""}`}>{brl(c.valor_aberto)}</td><td>{c.desde ? dataBR(c.desde) : "-"}</td>
                <td className="acoes">
                  {c.valor_aberto > 0 && <button className="x red" onClick={() => fechar(String(c.id))}>Gerar fechamento</button>}
                  <button className="x" onClick={() => setEdit({ ...c })}>Editar</button>
                  <button className="x" onClick={() => setJuntar({ id: c.id, destino: "" })}>Juntar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Cobrancas({ toast }: { toast: Toast }) {
  const [sub, setSub] = useState<Sub>("pedidos");
  const [clientes, setClientes] = useState<any[]>([]);
  const [clienteFechar, setClienteFechar] = useState("");
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => api("/api/clientes").then(setClientes), []);
  useEffect(() => { recarregar(); }, [recarregar, sub]);

  const abas: [Sub, string][] = [["pedidos", "Pedidos"], ["fechar", "Gerar fechamento"], ["fechamentos", "Fechamentos"], ["clientes", "Clientes"]];
  return (
    <>
      <div className="subabas">
        {abas.map(([k, t]) => <button key={k} className={sub === k ? "ativo" : ""} onClick={() => setSub(k)}>{t}</button>)}
      </div>
      {sub === "pedidos" && <Pedidos toast={toast} clientes={clientes} recarregarClientes={recarregar} />}
      {sub === "fechar" && <GerarFechamento toast={toast} clientes={clientes} inicial={clienteFechar} aoGerar={() => { setVersao(versao + 1); recarregar(); }} />}
      {sub === "fechamentos" && <Fechamentos toast={toast} versao={versao} />}
      {sub === "clientes" && <Clientes toast={toast} clientes={clientes} recarregar={recarregar} fechar={(id) => { setClienteFechar(id); setSub("fechar"); }} />}
    </>
  );
}
