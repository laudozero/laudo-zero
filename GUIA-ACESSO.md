# Guia: ligar o controle de acesso (e-mail + código da compra)

Sem este guia o app continua funcionando em "modo aberto" (qualquer pessoa com o link usa).
Quando você preencher o arquivo `js/config-acesso.js` (passo 4), o app passa a exigir e-mail + código da compra.

## Como vai funcionar
1. O cliente compra na Hotmart.
2. A Hotmart avisa o seu Supabase, que cria o acesso: e-mail do comprador + código da compra, 1 relatório e 30 dias de validade.
3. O cliente abre o app, digita o e-mail e o código da compra (o "código da transação" que vem no e-mail da Hotmart, começa com HP) e entra.
4. Ao tocar em Continuar na tela "Dados da vistoria", o app desconta o crédito. Esse é o momento que gasta o acesso.
5. Reembolso, chargeback ou cancelamento bloqueiam o acesso sozinhos.

O Supabase é em inglês. Vou colocar o nome em inglês em **negrito**, com a tradução ao lado.

## Passo 1. Criar o projeto no Supabase
1. Entre em supabase.com e crie uma conta gratuita.
2. Clique em **New project** (novo projeto). Dê o nome `laudo-zero`.
3. Crie uma senha do banco e guarde. Escolha a região mais próxima (South America, São Paulo).
4. Espere 1 a 2 minutos até o projeto ficar pronto.

## Passo 2. Criar as tabelas
1. No menu da esquerda, abra **SQL Editor** (editor de SQL) e clique em **New query**.
2. Abra o arquivo `supabase/acesso.sql` deste pacote, copie todo o texto e cole.
3. Clique em **Run** (executar). Deve aparecer "Success".
4. Em **Table Editor**, confira que existem as tabelas `acessos`, `vistorias_iniciadas`, `hotmart_eventos` e `tentativas_acesso`.

## Passo 3. Pegar o endereço e a chave pública
1. Clique no botão **Connect** (no topo da página do projeto) ou vá em **Project Settings > API Keys**.
2. Copie a **Project URL** (algo como `https://abcdefghijkl.supabase.co`).
3. Copie a chave **publishable** (começa com `sb_publishable_`). Se o seu projeto só mostrar a chave antiga **anon** (começa com `eyJ`), pode usar essa.
4. Nunca use a chave **secret** ou **service_role** no app. Essas ficam só no servidor.

## Passo 4. Colocar no app
1. No GitHub, abra o arquivo `js/config-acesso.js` do repositório `laudo-zero` e clique no lápis (editar).
2. Preencha `url` e `chave` com o que você copiou, entre aspas.
3. Clique em **Commit changes**. Em 1 a 2 minutos o app passa a pedir o acesso.
4. Faça o mesmo upload dos arquivos novos deste pacote: `js/acesso.js`, `js/app.js`, `js/db.js`, `sw.js` e a pasta `supabase`.

## Passo 5. Criar a função que recebe o aviso da Hotmart
1. No Supabase, abra **Edge Functions** (funções de borda) e clique em **Deploy a new function**, escolhendo **Via Editor**.
2. Nome da função: `hotmart-webhook`.
3. Apague o texto de exemplo, abra o arquivo `supabase/functions/hotmart-webhook/index.ts` deste pacote, copie tudo e cole. Clique em **Deploy**.
4. **Desligue a verificação de JWT** dessa função (nas configurações da função, algo como **Verify JWT**). A Hotmart não envia esse tipo de login, então com ela ligada o aviso é recusado. Se não achar a opção, me diga o que aparece na tela.
5. Em **Edge Functions > Secrets** (segredos), adicione o segredo `HOTMART_HOTTOK`. O valor você copia da Hotmart no passo 6.
6. O endereço da função é `https://SEU-PROJETO.supabase.co/functions/v1/hotmart-webhook`. Guarde.
7. Opcional, nos mesmos segredos: `VALIDADE_DIAS` (padrão 30), `RELATORIOS` (padrão 1) e `HOTMART_PRODUCT_ID` (para ignorar outros produtos seus).

## Passo 6. Ligar a Hotmart
1. Na Hotmart, vá em **Ferramentas > Webhook** (o caminho pode mudar um pouco).
2. Cadastre o endereço do passo 5.6 e marque os eventos: compra aprovada, compra reembolsada, chargeback e compra cancelada. Use a versão 2.0.0.
3. Copie o **hottok** que a Hotmart mostra e cadastre no Supabase como segredo `HOTMART_HOTTOK` (passo 5.5).
4. Use o botão de teste de webhook da Hotmart. No Supabase, em **Edge Functions > hotmart-webhook > Logs**, veja se chegou sem erro, e na tabela `hotmart_eventos` deve aparecer uma linha.

## Passo 7. Testar sem comprar nada
No **SQL Editor**, rode (troque o e-mail pelo seu):

```sql
insert into acessos (email, transacao, validade_ate)
values ('seuemail@exemplo.com', 'HPTESTE000001', now() + interval '30 days');
```

Abra o app, entre com esse e-mail e o código `HPTESTE000001` e faça uma vistoria.
Teste também: e-mail errado, segunda vistoria (deve ser recusada) e, com o celular em modo avião, o botão Continuar da tela de dados (deve pedir internet).

## Passo 8. Teste com compra real
Faça uma compra de teste pela Hotmart e confira três coisas:
1. O e-mail da Hotmart traz o "código da transação"? Se o nome for outro, avise para eu corrigir o texto da tela de acesso.
2. O código que o cliente vê é exatamente o que aparece na tabela `acessos`?
3. O e-mail usado na compra é o mesmo que o cliente digita no app?

## Dia a dia (rodar no SQL Editor)

Ver os acessos:
```sql
select email, transacao, relatorios_usados, relatorios_total, validade_ate, status
from acessos order by criado_em desc;
```

Cliente perdeu a vistoria (limpou o navegador) e você decidiu liberar de novo:
```sql
delete from vistorias_iniciadas where acesso_id = (select id from acessos where transacao = 'HPCODIGO');
update acessos set relatorios_usados = 0 where transacao = 'HPCODIGO';
```

Estender o prazo:
```sql
update acessos set validade_ate = now() + interval '30 days' where transacao = 'HPCODIGO';
```

Bloquear manualmente:
```sql
update acessos set status = 'cancelado', cancelado_motivo = 'manual' where transacao = 'HPCODIGO';
```

## Atenções
- **Limite que continua:** o código do app é público e o PDF é gerado no celular. Uma pessoa com conhecimento técnico poderia copiar o app e tirar a verificação. Para o seu produto, a verificação barra o uso casual e o repasse do link, que é o risco principal.
- **Vistoria perdida:** se o cliente limpar os dados do navegador no meio da vistoria, ela se perde e o crédito já foi gasto. Reforce na página de vendas: gere e salve o PDF no mesmo dia. Para liberar de novo, use o comando acima.
- **Internet:** é preciso para entrar e para tocar em Continuar na tela de dados. Depois disso, o resto funciona offline.
- **Plano gratuito:** o Supabase pode pausar projetos gratuitos sem uso por um tempo. Confira as regras atuais, porque uma pausa derruba o login e o recebimento das compras.
- **Privacidade:** o servidor guarda e-mail e código da compra, que uma vistoria foi iniciada (código aleatório e data) e o que a Hotmart enviar. Fotos, nome do imóvel e respostas da vistoria não saem do celular. Atualize a Política de privacidade (já ajustei o rascunho no documento).
- **Segurança:** a chave publishable pode ficar no app. A chave secret e a service_role nunca.
