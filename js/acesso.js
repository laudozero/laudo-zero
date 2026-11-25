// Conversa com o Supabase para confirmar a compra (e-mail + código da compra) e descontar o crédito.
import { ACESSO } from './config-acesso.js';

export const acessoAtivo = () => Boolean(ACESSO.url && ACESSO.chave);

async function chamar(funcao, corpo) {
  const cabecalhos = { 'Content-Type': 'application/json', apikey: ACESSO.chave };
  // chaves antigas (anon) são JWT e também precisam ir em Authorization
  if (ACESSO.chave.startsWith('eyJ')) cabecalhos.Authorization = `Bearer ${ACESSO.chave}`;
  let resposta;
  try {
    resposta = await fetch(`${ACESSO.url.replace(/\/+$/, '')}/rest/v1/rpc/${funcao}`, {
      method: 'POST',
      headers: cabecalhos,
      body: JSON.stringify(corpo),
    });
  } catch {
    return { ok: false, motivo: 'sem_internet' };
  }
  if (!resposta.ok) return { ok: false, motivo: 'erro_servidor' };
  try {
    return await resposta.json();
  } catch {
    return { ok: false, motivo: 'erro_servidor' };
  }
}

export const normalizarEmail = (texto) => String(texto ?? '').trim().toLowerCase();
export const normalizarCodigo = (texto) => String(texto ?? '').replace(/\s+/g, '').toUpperCase();

export const entrar = (email, codigo) =>
  chamar('entrar', { p_email: normalizarEmail(email), p_codigo: normalizarCodigo(codigo) });

export const iniciarVistoria = (email, codigo, vistoria, imovel) =>
  chamar('iniciar_vistoria', {
    p_email: normalizarEmail(email),
    p_codigo: normalizarCodigo(codigo),
    p_vistoria: vistoria,
    p_imovel: imovel,
  });

const MENSAGENS = {
  nao_encontrado: 'Não encontramos uma compra com esse e-mail e código. Confira se usou o mesmo e-mail da compra e o código completo.',
  cancelado: 'Esta compra foi cancelada ou reembolsada, por isso o acesso está bloqueado.',
  expirado: 'O prazo de acesso desta compra terminou.',
  sem_saldo: 'Este acesso já foi usado em uma vistoria. Cada compra vale para 1 imóvel.',
  muitas_tentativas: 'Muitas tentativas seguidas. Espere 15 minutos e tente de novo.',
  sem_internet: 'Sem internet. Conecte-se para confirmar o acesso e tente de novo.',
  erro_servidor: 'Não conseguimos confirmar seu acesso agora. Tente de novo em instantes.',
};

export const mensagemDoMotivo = (motivo) => MENSAGENS[motivo] ?? MENSAGENS.erro_servidor;
