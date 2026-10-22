import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../../contexts/AuthContext';
import { showError } from '../../utils/alerts';

/**
 * LINK COM O NUMERO DO REGISTRO (pedido do dono, 22/10/2026).
 *
 * O link do pedido aberto mostrava o codigo interno do banco
 * (/pedidos-venda/visualizar/zWWih8mhQhkL8y0XDnmy). Agora a rota aceita o
 * NUMERO (/pedidos-venda/0035, /os/01, /orcamentos/0012, /clientes/1) e a
 * tela, assim que carrega o registro, troca o endereco e o nome da aba
 * ("Pedido 0035"). O link antigo com o codigo continua funcionando.
 *
 * Como: a rota `.../:numero` e a `.../visualizar/:id` renderizam o MESMO
 * elemento (este wrapper + o formulario), entao trocar de um endereco para o
 * outro nao remonta a tela. O wrapper resolve numero -> id com uma consulta
 * (ou pelo cache, quando a propria tela acabou de registrar o par) e entrega
 * o id pelo contexto; o formulario le com `useIdDaRota()` no lugar de
 * `useParams().id`.
 */

interface RegistroDaRota {
  id: string | undefined;
}

const RegistroIdContext = createContext<RegistroDaRota | null>(null);

/** Id do registro aberto: vindo do contexto (rota por numero) ou do `:id` da rota. */
export const useIdDaRota = (): string | undefined => {
  const contexto = useContext(RegistroIdContext);
  const { id } = useParams();
  return contexto ? contexto.id : id;
};

// numero -> id, por empresa e colecao. Preenchido pela consulta ou pela tela
// que acabou de carregar o registro (antes de trocar o endereco).
const cache = new Map<string, string>();
const chave = (tenantId: string, colecao: string, numero: string) => `${tenantId}/${colecao}/${numero}`;

export const registrarNumeroDoRegistro = (tenantId: string, colecao: string, numero: string, id: string) => {
  cache.set(chave(tenantId, colecao, numero), id);
};

const limparNumero = (numero: string): string => numero.trim().replace(/^#/, '');

/** Formas em que o numero pode estar gravado ("35", "0035", 35...). */
const valoresPossiveis = (numero: string): unknown[] => {
  const n = limparNumero(numero);
  const semZeros = n.replace(/^0+(?=\d)/, '');
  const variantes = new Set<unknown>([n, semZeros, semZeros.padStart(2, '0'), semZeros.padStart(3, '0'), semZeros.padStart(4, '0'), semZeros.padStart(5, '0'), semZeros.padStart(6, '0')]);
  if (/^\d+$/.test(semZeros)) variantes.add(Number(semZeros));
  return [...variantes].slice(0, 10);
};

export const ehNumeroDeRegistro = (valor: string | undefined): boolean => typeof valor === 'string' && /^#?\d{1,8}$/.test(valor.trim());

interface Props {
  /** Colecao do Firestore (ex.: 'pedidos_venda') e campo do numero (ex.: 'numeroPedido'). */
  colecao: string;
  campo: string;
  /** Para onde voltar quando o numero nao existe (ex.: '/pedidos-venda'). */
  lista: string;
  /** Como a tela chama o registro na mensagem de "nao encontrado". */
  rotulo: string;
  children: React.ReactNode;
}

const RegistroPorNumero: React.FC<Props> = ({ colecao, campo, lista, rotulo, children }) => {
  const { id: idDaRota, numero } = useParams();
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const emCache = tenantId && numero ? cache.get(chave(tenantId, colecao, limparNumero(numero))) : undefined;
  const [resolvido, setResolvido] = useState<{ numero: string; id: string } | null>(null);

  const idResolvido = idDaRota || emCache || (resolvido && numero && resolvido.numero === limparNumero(numero) ? resolvido.id : undefined);

  useEffect(() => {
    if (idResolvido || !numero || !tenantId) return undefined;
    if (!ehNumeroDeRegistro(numero)) {
      showError(`${rotulo} não encontrado`, `O endereço "${numero}" não é um número de ${rotulo.toLowerCase()}.`);
      navigate(lista, { replace: true });
      return undefined;
    }
    let vivo = true;
    const procurar = async () => {
      try {
        const snap = await getDocs(query(collection(db, colecao), where('tenantId', '==', tenantId), where(campo, 'in', valoresPossiveis(numero))));
        if (!vivo) return;
        if (snap.empty) {
          showError(`${rotulo} não encontrado`, `Não existe ${rotulo.toLowerCase()} número ${limparNumero(numero)} nesta filial.`);
          navigate(lista, { replace: true });
          return;
        }
        const id = snap.docs[0].id;
        registrarNumeroDoRegistro(tenantId, colecao, limparNumero(numero), id);
        setResolvido({ numero: limparNumero(numero), id });
      } catch (erro) {
        console.error(`Erro ao localizar ${rotulo} pelo número:`, erro);
        if (vivo) { showError(`Não foi possível abrir`, `Não deu para localizar o ${rotulo.toLowerCase()} número ${limparNumero(numero)}. Tente de novo.`); navigate(lista, { replace: true }); }
      }
    };
    void procurar();
    return () => { vivo = false; };
  }, [idResolvido, numero, tenantId, colecao, campo, lista, rotulo, navigate]);

  if (numero && !idResolvido) {
    return <div style={{ padding: '24px', color: 'var(--text-muted)' }}>Abrindo {rotulo.toLowerCase()} {limparNumero(numero)}...</div>;
  }
  return <RegistroIdContext.Provider value={{ id: idResolvido }}>{children}</RegistroIdContext.Provider>;
};

export default RegistroPorNumero;

/**
 * A tela chama quando ja' sabe o numero do registro aberto: registra o par
 * numero -> id e troca o endereco da aba para `${base}/${numero}` (sem
 * remontar; ver o comentario do arquivo). O nome da aba vem de
 * resolveTabLabel ("Pedido 0035"). Fora do sistema de abas, nada acontece.
 */
export const useEnderecoComNumero = (args: { ativo: boolean; colecao: string; base: string; numero: string; id: string | undefined }) => {
  const { tenantId } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { numero: numeroNaRota } = useParams();
  const numero = limparNumero(args.numero || '');
  useEffect(() => {
    if (!args.ativo || !args.id || !numero || !tenantId) return;
    if (numeroNaRota !== undefined) return;
    const alvo = `${args.base}/${numero}`;
    if (location.pathname === alvo) return;
    registrarNumeroDoRegistro(tenantId, args.colecao, numero, args.id);
    navigate(`${alvo}${location.search}`, { replace: true });
  }, [args.ativo, args.id, args.colecao, args.base, numero, tenantId, numeroNaRota, location.pathname, location.search, navigate]);
};
