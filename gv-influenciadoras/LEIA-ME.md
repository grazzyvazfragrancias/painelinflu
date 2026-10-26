# Clube de Influenciadoras · Grazzy Vaz Fragrâncias

Sistema do painel das influenciadoras: login próprio para cada uma, vendas da Bagy entrando sozinhas, carteira, campanhas, ranking, gamificação, envios e dados da NF de remessa.

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `supabase/migrations/20261023000000_inicial.sql` | Cria o banco de dados e as regras de acesso. Roda uma vez. |
| `supabase/sql/02_meu_acesso_admin.sql` | Diz ao sistema qual é o seu e-mail de administradora. |
| `supabase/functions/painel/index.ts` | Função do servidor: recebe os pedidos da Bagy, busca pedidos antigos e cria o acesso das influenciadoras. |
| `supabase/config.toml` | Só usado se o Daniel publicar pela linha de comando. |
| `site/index.html` | O painel em si (admin e influenciadoras). |

Tempo para colocar no ar: cerca de 40 minutos.

---

## Passo a passo

### 1. Criar o projeto no Supabase
1. Entre em [supabase.com](https://supabase.com) e crie uma conta (pode usar o Google).
2. Clique em **New project**. Nome: `clube-influenciadoras`. Região: **South America (São Paulo)**. Crie uma senha forte para o banco e guarde.
3. Espere uns 2 minutos até o projeto ficar pronto.

### 2. Criar o banco de dados
1. No menu da esquerda, abra **SQL Editor** e clique em **New query**.
2. Abra o arquivo `supabase/migrations/20261023000000_inicial.sql` no Bloco de Notas (ou TextEdit), copie **tudo** e cole no editor.
3. Clique em **Run**. Deve aparecer "Success".
4. Abra uma nova query, cole o conteúdo de `supabase/sql/02_meu_acesso_admin.sql`, **troque `seu-email@exemplo.com.br` pelo seu e-mail** e clique em **Run**.

### 3. Criar o seu login de administradora
1. Menu **Authentication** > **Users** > **Add user** > **Create new user**.
2. Use **o mesmo e-mail** do passo 2.4, crie uma senha e marque **Auto Confirm User**.

### 4. Fechar o cadastro para estranhos
1. Em **Authentication**, abra as configurações de login (**Sign In / Providers**).
2. Desligue **Allow new users to sign up**. Só você cria acessos, pelo painel.
3. Deixe **Confirm email** ligado.

### 5. Publicar a função do servidor
1. Menu **Edge Functions** > **Deploy a new function** > **Via Editor**.
2. Nome da função: `painel` (exatamente assim).
3. Apague o código de exemplo, cole todo o conteúdo de `supabase/functions/painel/index.ts` e clique em **Deploy function**.
4. Na página da função, desligue **Verify JWT** e salve. Isso é necessário porque a Bagy não faz login para mandar os avisos. A função tem sua própria chave secreta.
5. Confira: abra no navegador `https://SEU-PROJETO.supabase.co/functions/v1/painel/bagy` (troque SEU-PROJETO). Se aparecer `"Webhook da Bagy pronto para receber pedidos."`, está certo. Se aparecer erro 401, o Verify JWT ainda está ligado.

> Para o Daniel, pela linha de comando: `supabase functions deploy painel --no-verify-jwt`

### 6. Ligar a Bagy à função (token)
1. Na Bagy: **Loja Virtual** > **Configurações** > **APIs e Webhooks** > **Adicionar API**. Nome: `Clube de Influenciadoras`. Clique em **Adicionar** e copie o token.
2. No Supabase: **Edge Functions** > **Secrets** (Segredos). Key: `BAGY_TOKEN`. Value: o token copiado. **Save**.

### 7. Configurar o site
1. No Supabase, abra **Project Settings** > **API**. Copie a **Project URL** e a chave pública (**publishable key**, ou a **anon key** em "Legacy API keys").
2. Abra `site/index.html` no Bloco de Notas. Perto do começo do código, troque:
   - `https://SEU-PROJETO.supabase.co` pela Project URL
   - `COLE-AQUI-A-CHAVE-PUBLICA` pela chave pública
3. Salve. Essa chave pode ficar no site: ela não dá acesso a nada sem login. As regras do banco protegem os dados.

> Nunca coloque no site a chave **secret** ou **service_role**.

### 8. Colocar o site no ar
1. Entre em [app.netlify.com/drop](https://app.netlify.com/drop) (conta gratuita).
2. Arraste a pasta `site` para a página. Em segundos você recebe um endereço como `https://nome-aleatorio.netlify.app`.
3. Opcional: em **Domain settings**, troque o nome ou ligue um domínio seu, como `parceiras.grazzyvazfragrancias.com.br`.

Para atualizar o site no futuro, arraste a pasta de novo em **Deploys**.

### 9. Ligar o aviso de pedidos da Bagy (webhook)
1. Entre no painel com seu e-mail e senha.
2. Abra **Integração Bagy** e clique em **Copiar** ao lado da URL de callback. Ela termina com `?chave=...`, que é a chave secreta.
3. Na Bagy: **Configurações** > **APIs e Webhooks** > **Adicionar webhook**. Evento: **Pedidos**. Cole a URL e clique em **Adicionar**.
4. No painel, clique em **Testar conexão**. Devem aparecer os últimos pedidos da loja.

### 10. Começar a usar
1. Cadastre as influenciadoras em **Influenciadoras** > **Nova influenciadora**. O cupom precisa ser **igual ao cupom criado na Bagy**.
2. Abra cada uma e clique em **Criar acesso / nova senha**. Use **Copiar mensagem para WhatsApp** e mande para ela.
3. Para trazer vendas de antes da integração, use **Integração Bagy** > **Buscar pedidos antigos**.
4. Faça um pedido de teste com cupom e confira em **Últimos avisos recebidos**.

---

## Como as regras funcionam

- **Quais pedidos entram:** só pedidos com cupom. Se o cupom ainda não tem dona cadastrada, a venda fica como "cupom sem dona" e passa para a influenciadora assim que você cadastrar o cupom dela.
- **Status:** "Aguardando pagamento" não gera comissão. Quando a Bagy confirma o pagamento, a venda vira "Paga". Pedido cancelado, estornado ou recusado não gera comissão.
- **Liberação:** a comissão fica "a liberar" pelo número de dias definido em Configurações (padrão 15), contados **a partir do dia em que o pedido ficou pago**.
- **Base da comissão:** por padrão, valor dos produtos com desconto, **sem frete**. Dá para mudar para o valor total em Configurações.
- **% de comissão:** cada venda guarda a % da influenciadora no momento da venda. Se você mudar a % dela, só as vendas novas usam a nova %.
- **Saldo disponível:** comissões liberadas + bônus de desafios − pagamentos registrados.
- **Vendas editadas à mão:** se você editar ou cancelar no painel uma venda que veio da Bagy, a integração deixa de alterar essa venda.
- **Privacidade:** a influenciadora vê só as próprias vendas, com o primeiro nome e a inicial da cliente. No ranking, ela vê o nome e o número de pedidos das outras, nunca o valor vendido.
- **NF de remessa:** o painel monta os dados (destinatária, produtos, CFOP sugerido 5.910 ou 6.910). **Confirme CFOP e tributação com sua contabilidade** antes de emitir.

## Problemas comuns

| O que acontece | O que fazer |
|---|---|
| Tela "Falta configurar" | Preencha SUPABASE_URL e SUPABASE_KEY no `index.html` (passo 7) e suba a pasta de novo. |
| "Acesso pendente" ao entrar como admin | O e-mail do passo 2.4 não é igual ao do passo 3. Rode o arquivo `02_meu_acesso_admin.sql` de novo com o e-mail certo. |
| "Não consegui falar com a função do servidor" | A função não foi publicada com o nome `painel` (passo 5). |
| "A Bagy recusou o token" | Gere outro token na Bagy e atualize o segredo `BAGY_TOKEN` (passo 6). |
| Testar conexão funciona, mas nenhum aviso aparece depois de um pedido | Confira a URL do webhook na Bagy (passo 9) e se o Verify JWT está desligado (passo 5.5). Enquanto isso, **Buscar pedidos antigos** traz tudo. |
| Pedido com cupom aparece como "Pedido sem cupom" nos avisos | Clique em **Testar conexão** e abra "Ver os dados de desconto dos pedidos". Mande o que aparecer para o Daniel ajustar onde a Bagy guarda o cupom. |
| Influenciadora esqueceu a senha | Abra o cadastro dela e clique em **Criar acesso / nova senha**. |

## Custos

- **Supabase:** o plano gratuito atende bem este volume (500 MB de banco, 500 mil chamadas de função por mês). Ele pausa projetos sem nenhum uso por 7 dias. Com pedidos chegando e acessos diários isso não acontece, mas se acontecer é só reativar no painel do Supabase. O plano Pro (US$ 25 por mês) não pausa.
- **Netlify:** plano gratuito.

Confira os valores atuais em [supabase.com/pricing](https://supabase.com/pricing) antes de decidir.
