# Caixa (controle financeiro do depósito)

Sistema web simples para lançar vendas do dia, contas pagas e recebimentos de faturados,
importar o "Relatório de Movimento de Caixa" (Isasoft) em PDF e gerar relatórios em PDF e Excel.

## Como funciona nas duas máquinas

Uma das máquinas é o **servidor**: é nela que o sistema roda e onde fica o banco de dados
(arquivo `dados/caixa.db`, SQLite). A outra máquina só abre o navegador apontando para ela.
As duas veem e gravam os mesmos dados em tempo real.

## Instalação (só na máquina servidor)

1. Instale o Node.js 20 ou mais novo (https://nodejs.org, versão LTS).
2. Copie esta pasta para a máquina.
3. Dê dois cliques em `iniciar.bat` (no Windows) ou rode `npm install` e depois `npm start`.
4. O terminal mostra os endereços, por exemplo:

```
Nesta máquina:   http://localhost:3000
Na outra máquina: http://192.168.0.15:3000
```

5. Na outra máquina, abra o segundo endereço no navegador (as duas precisam estar na mesma rede).

Se a outra máquina não conseguir abrir, libere a porta 3000 no Firewall do Windows
(o Windows costuma perguntar na primeira vez; marque "Redes privadas" e permita).

Dica: fixe o IP da máquina servidor no roteador para o endereço não mudar.

## Configurações opcionais

Variáveis de ambiente: `PORTA` (padrão 3000), `NOME_EMPRESA` (aparece nos relatórios,
padrão "Depósito WM") e `DADOS_DIR` (pasta do banco).

## Backup

Basta copiar a pasta `dados`. Faça isso com frequência (pendrive, Google Drive).

## Telas

- **Painel**: totais do período, gráficos e botões de exportar PDF e Excel.
- **Vendas do dia**: valor por forma (dinheiro, débito, crédito, PIX, faturado).
- **Contas pagas**: categoria, descrição, valor, data e banco de saída.
- **Faturados**: recebimentos de clientes a prazo e lista do que foi vendido faturado.
- **Importar caixa**: arraste o PDF do movimento de caixa; o sistema lê todas as vendas e
  recebimentos, confere com os totais do relatório e importa. Importar o mesmo movimento de novo
  substitui o anterior (não duplica).
- **Cadastros**: categorias e bancos.

## Como o saldo é calculado

Saldo = vendas à vista + recebido de faturados - contas pagas.
Venda faturada (PRAZO) aparece separada e só entra no caixa quando é recebida.

## Cobranças (aba Cobranças)

1. **Pedidos**: arraste os PDFs dos Pedidos de Venda (vários de uma vez). O sistema lê número,
   data, cliente, itens, quantidades e preços. Pedidos repetidos não duplicam.
2. Clique num pedido para colocar o **preço promocional** de cada item, ou digite o **total
   combinado** e o desconto é distribuído nos itens. O preço promocional fica salvo para aquele
   cliente e é aplicado sozinho nos próximos pedidos dele com o mesmo produto.
   A coluna "Un." (sc, un, ton, pc...) é salva por produto e aparece na planilha.
3. **Gerar fechamento**: escolha cliente, período, vencimento e arredondamento. Sai a planilha
   "Fechamento cliente X período X" em Excel e PDF. Os pedidos ficam marcados como cobrados.
4. **Fechamentos**: histórico com situação (em aberto, enviado, pago) e downloads.
5. **Clientes**: valor não cobrado de cada um e opção de juntar nomes duplicados.
