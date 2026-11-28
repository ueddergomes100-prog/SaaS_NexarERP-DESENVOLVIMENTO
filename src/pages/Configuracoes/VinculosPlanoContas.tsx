import React from 'react';
import {
  CATEGORIAS_FIXAS_DO_SISTEMA,
  EVENTOS_FINANCEIROS,
  ROTULO_DO_GRUPO,
  categoriaDoEvento,
  type DefinicaoDoEvento,
  type EventoFinanceiro,
  type VinculosDoPlano,
} from '../../utils/vinculosPlanoContasDomain';
import './VinculosPlanoContas.css';

/*
 * PLANO DE CONTAS > LANCAMENTOS AUTOMATICOS (28/11/2026, pedido do dono: "venda
 * cartao, pix, dinheiro e todas as formas de pagamento que a empresa usa,
 * recebimento, pagamento, tudo 100% vinculado"). Cada situacao em que o
 * sistema lanca sozinho e a categoria em que cai. Regra em
 * src/utils/vinculosPlanoContasDomain.ts; quem grava os lancamentos pergunta la'.
 */

interface Props {
  vinculos: VinculosDoPlano;
  receitas: readonly string[];
  despesas: readonly string[];
  editavel: boolean;
  /** Formas que a filial escondeu: a venda nelas nao aparece (nao vende nelas). */
  formasOcultas?: readonly string[];
  onTrocar: (evento: EventoFinanceiro, categoria: string) => void;
}

const GRUPOS = ['vendas', 'recebimentos', 'pagamentos', 'compras'] as const;

const VinculosPlanoContas: React.FC<Props> = ({ vinculos, receitas, despesas, editavel, formasOcultas = [], onTrocar }) => {
  const config = { vinculosPlanoContas: vinculos };
  const ocultas = new Set(formasOcultas.map((f) => f.toLocaleLowerCase('pt-BR')));
  const aparece = (d: DefinicaoDoEvento) => !(d.evento.startsWith('venda:') && ocultas.has(d.evento.slice(6).toLocaleLowerCase('pt-BR')));
  const opcoes = (definicao: DefinicaoDoEvento) => {
    const lista = definicao.tipo === 'receita' ? receitas : despesas;
    const atual = categoriaDoEvento(config, definicao.evento);
    return lista.some((c) => c.toLocaleLowerCase('pt-BR') === atual.toLocaleLowerCase('pt-BR')) ? lista : [atual, ...lista];
  };

  return (
    <div className="vinculos-plano">
      <div className="vinculos-plano__cabeca">
        <h4>Lançamentos automáticos</h4>
        <p>Em qual categoria o sistema lança sozinho cada situação. Já vem preenchido; troque se quiser. Conta de venda recebida depois (boleto, a prazo) passa para a categoria da forma em que o cliente pagou.</p>
      </div>
      <div className="vinculos-plano__grupos">
        {GRUPOS.map((grupo) => (
          <div key={grupo} className="vinculos-plano__grupo">
            <h5>{ROTULO_DO_GRUPO[grupo]}</h5>
            {EVENTOS_FINANCEIROS.filter((d) => d.grupo === grupo && aparece(d)).map((definicao) => {
              const id = `vinculo-${definicao.evento.replace(/[^a-z0-9]/gi, '-')}`;
              return (
                <div key={definicao.evento} className="vinculos-plano__linha">
                  <label htmlFor={id}>
                    <span className={`vinculos-plano__tipo is-${definicao.tipo}`} aria-hidden="true" />
                    {definicao.rotulo}
                  </label>
                  <select
                    id={id}
                    className="form-select"
                    value={categoriaDoEvento(config, definicao.evento)}
                    onChange={(e) => onTrocar(definicao.evento, e.target.value)}
                    disabled={!editavel}
                  >
                    {opcoes(definicao).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="vinculos-plano__fixos">Sempre com o mesmo nome, porque abatem a receita no DRE: {CATEGORIAS_FIXAS_DO_SISTEMA.join(', ')}.</p>
    </div>
  );
};

export default VinculosPlanoContas;
