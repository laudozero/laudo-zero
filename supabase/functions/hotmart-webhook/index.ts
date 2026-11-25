// Função do Supabase (Edge Function) que recebe os avisos da Hotmart.
//  - compra aprovada  -> cria o acesso (e-mail + código da transação)
//  - reembolso, chargeback ou cancelamento -> bloqueia o acesso
//
// Segredos (Edge Functions > Secrets no painel do Supabase):
//   HOTMART_HOTTOK        obrigatório: o "hottok" que a Hotmart mostra na tela de webhook
//   VALIDADE_DIAS         opcional: dias de validade do acesso (padrão 30)
//   RELATORIOS            opcional: relatórios por compra (padrão 1)
//   HOTMART_PRODUCT_ID    opcional: se preenchido, ignora compras de outros produtos
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente dentro da função.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const EVENTOS_DE_BLOQUEIO = new Set(['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_CANCELED']);

function resposta(status: number, corpo: Record<string, unknown>): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
}

// Comparação sem vazar informação pelo tempo de resposta
function tokensIguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diferenca = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diferenca |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diferenca === 0;
}

function inteiroPositivo(valor: string | undefined, padrao: number): number {
  const n = Number.parseInt(valor ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return resposta(405, { ok: false, erro: 'Use POST' });

  const hottokEsperado = Deno.env.get('HOTMART_HOTTOK') ?? '';
  if (!hottokEsperado) {
    console.error('Segredo HOTMART_HOTTOK não configurado');
    return resposta(500, { ok: false, erro: 'Servidor sem configuração' });
  }

  // deno-lint-ignore no-explicit-any
  const corpo: any = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return resposta(400, { ok: false, erro: 'Corpo inválido' });

  const recebido = req.headers.get('x-hotmart-hottok') ?? corpo.hottok ?? '';
  if (!recebido || !tokensIguais(String(recebido), hottokEsperado)) {
    console.warn('Webhook recusado: hottok inválido');
    return resposta(401, { ok: false, erro: 'Token inválido' });
  }

  const evento = String(corpo.event ?? 'DESCONHECIDO');
  const transacao = String(corpo.data?.purchase?.transaction ?? '').trim().toUpperCase();
  const email = String(corpo.data?.buyer?.email ?? '').trim().toLowerCase();
  const produtoId = corpo.data?.product?.id != null ? String(corpo.data.product.id) : null;

  try {
    // Guarda o aviso para auditoria, sem o token
    // deno-lint-ignore no-unused-vars
    const { hottok: _descartado, ...payloadSeguro } = corpo;
    await supabase.from('hotmart_eventos').insert({ evento, transacao: transacao || null, payload: payloadSeguro });

    if (!transacao) return resposta(200, { ok: true, ignorado: 'Aviso sem código de transação' });

    const produtoPermitido = Deno.env.get('HOTMART_PRODUCT_ID');
    if (produtoPermitido && produtoId !== produtoPermitido) {
      return resposta(200, { ok: true, ignorado: 'Outro produto' });
    }

    if (evento === 'PURCHASE_APPROVED') {
      if (!email) return resposta(200, { ok: true, ignorado: 'Compra sem e-mail do comprador' });

      const validadeDias = inteiroPositivo(Deno.env.get('VALIDADE_DIAS'), 30);
      const validadeAte = new Date(Date.now() + validadeDias * 24 * 60 * 60 * 1000).toISOString();

      // Se a Hotmart avisar duas vezes da mesma compra, não cria outro acesso.
      const { error } = await supabase.from('acessos').upsert(
        {
          email,
          transacao,
          produto_id: produtoId,
          comprador_nome: corpo.data?.buyer?.name ?? null,
          relatorios_total: inteiroPositivo(Deno.env.get('RELATORIOS'), 1),
          validade_ate: validadeAte,
        },
        { onConflict: 'transacao', ignoreDuplicates: true },
      );
      if (error) throw error;
      return resposta(200, { ok: true, acesso: 'criado ou já existente' });
    }

    if (EVENTOS_DE_BLOQUEIO.has(evento)) {
      const { data, error } = await supabase
        .from('acessos')
        .update({ status: 'cancelado', cancelado_motivo: evento })
        .eq('transacao', transacao)
        .select('id');
      if (error) throw error;
      return resposta(200, { ok: true, bloqueados: data?.length ?? 0 });
    }

    return resposta(200, { ok: true, ignorado: `Evento ${evento} não tratado` });
  } catch (err) {
    // 500 faz a Hotmart tentar de novo mais tarde
    console.error('Erro ao processar aviso da Hotmart', err);
    return resposta(500, { ok: false, erro: 'Erro interno' });
  }
});
