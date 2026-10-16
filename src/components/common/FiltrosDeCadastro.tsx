import React, { useState } from 'react';
import { CampoFiltro, CampoPeriodo, PainelFiltros, estiloCampoFiltro } from './PainelFiltros';
import FiltroCidadeCliente from './FiltroCidadeCliente';
import { SEM_CIDADE, type FiltroLocalCliente, type LocaisDosClientes } from '../../utils/clientSearch';
import type { FiltroExtraClientes } from '../../utils/relatorioClientesDomain';

/**
 * FILTROS DOS CADASTROS DE PESSOAS (Clientes e Fornecedores, 16/10/2026):
 * Estado, Cidade, Pessoa (fisica/juridica), Bairro e Cadastrado de/ate.
 * `children` entra entre Cidade e Pessoa (ex.: "Tipo" do fornecedor).
 * A regra de filtrar mora em clientSearch.ts (local) e
 * relatorioClientesDomain.ts (o resto); o relatorio sai com o mesmo filtro.
 */
interface FiltrosDeCadastroProps {
  aberto: boolean;
  quantidadeAtiva: number;
  onLimpar: () => void;
  locais: LocaisDosClientes;
  filtroLocal: FiltroLocalCliente;
  onFiltroLocal: (filtro: FiltroLocalCliente) => void;
  filtro: FiltroExtraClientes;
  onFiltro: (parcial: Partial<FiltroExtraClientes>) => void;
  children?: React.ReactNode;
}

const FiltrosDeCadastro: React.FC<FiltrosDeCadastroProps> = ({
  aberto, quantidadeAtiva, onLimpar, locais, filtroLocal, onFiltroLocal, filtro, onFiltro, children,
}) => {
  const [cidadeAberta, setCidadeAberta] = useState(false);

  // Mesma regra da Consulta de clientes: cidade de outro estado nao combina com o estado novo.
  const mudarEstado = (uf: string) => {
    const novoUf = uf || null;
    const ufDaCidade = filtroLocal.cidade && filtroLocal.cidade !== SEM_CIDADE ? filtroLocal.cidade.split('|')[1] || null : null;
    const manterCidade = filtroLocal.cidade && novoUf && ufDaCidade === novoUf;
    onFiltroLocal({ uf: novoUf, cidade: manterCidade ? filtroLocal.cidade : null });
  };

  return (
    <PainelFiltros aberto={aberto} quantidadeAtiva={quantidadeAtiva} onLimpar={onLimpar}>
      <CampoFiltro rotulo="Estado">
        <select value={filtroLocal.uf ?? ''} onChange={(e) => mudarEstado(e.target.value)} style={estiloCampoFiltro}>
          <option value="">Todos</option>
          {locais.ufs.map((u) => <option key={u.uf} value={u.uf}>{u.uf} ({u.total})</option>)}
        </select>
      </CampoFiltro>
      {/* div, nao label: a lista de cidades tem varios botoes dentro. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-muted)', minWidth: '220px' }}>
        Cidade
        <FiltroCidadeCliente
          locais={locais}
          filtro={filtroLocal}
          onChange={onFiltroLocal}
          aberto={cidadeAberta}
          onAbertoChange={setCidadeAberta}
        />
      </div>
      {children}
      <CampoFiltro rotulo="Pessoa">
        <select
          value={filtro.tipoPessoa}
          onChange={(e) => onFiltro({ tipoPessoa: e.target.value as FiltroExtraClientes['tipoPessoa'] })}
          style={estiloCampoFiltro}
        >
          <option value="">Todas</option>
          <option value="pf">Pessoa física (CPF)</option>
          <option value="pj">Pessoa jurídica (CNPJ)</option>
          <option value="sem">Sem CPF/CNPJ no cadastro</option>
        </select>
      </CampoFiltro>
      <CampoFiltro rotulo="Bairro">
        <input
          type="text"
          value={filtro.bairro}
          onChange={(e) => onFiltro({ bairro: e.target.value })}
          placeholder="Parte do nome do bairro"
          style={estiloCampoFiltro}
        />
      </CampoFiltro>
      <CampoPeriodo
        rotulo="Cadastrado"
        de={filtro.cadastradoDe}
        ate={filtro.cadastradoAte}
        onChangeDe={(cadastradoDe) => onFiltro({ cadastradoDe })}
        onChangeAte={(cadastradoAte) => onFiltro({ cadastradoAte })}
      />
    </PainelFiltros>
  );
};

export default FiltrosDeCadastro;
